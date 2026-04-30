const fs = require('fs').promises;
const path = require('path');
const { TextDecoder } = require('util');
const { logger } = require('@librechat/data-schemas');
const blurryClient = require('./blurryClient');
const { extractPdfText } = require('./pdfText');

const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_CHUNK_TIMEOUT_MS = 30000;
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.tsv',
]);
const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/x-ndjson',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/xml',
]);

const normalizeText = (text) =>
  (text || '')
    .split('\u0000')
    .join('')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitLongParagraph = (paragraph, maxChars) => {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|\S.+$/g) ?? [paragraph];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = '';
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
    } else {
      current = sentence.trim();
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const chunkText = (text, maxChars = DEFAULT_MAX_CHARS) => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const paragraphChunks =
      paragraph.length > maxChars ? splitLongParagraph(paragraph, maxChars) : [paragraph];

    for (const paragraphChunk of paragraphChunks) {
      if (!paragraphChunk) {
        throw new Error('Empty PDF chunk generated');
      }
      const next = current ? `${current}\n\n${paragraphChunk}` : paragraphChunk;
      if (next.length <= maxChars) {
        current = next;
      } else {
        if (current) {
          chunks.push(current);
        }
        current = paragraphChunk;
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.map((chunk, index) => ({
    chunkIndex: index,
    totalChunks: chunks.length,
    text: chunk,
  }));
};

const mergeStats = (statsList) =>
  statsList.reduce((acc, stats) => {
    if (!stats || typeof stats !== 'object') {
      return acc;
    }
    for (const [key, value] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (typeof value === 'number' ? value : 0);
    }
    return acc;
  }, {});

const countEntities = (entitiesByChunk) =>
  entitiesByChunk.reduce(
    (count, item) => count + (Array.isArray(item.entities) ? item.entities.length : 0),
    0,
  );

const getExtension = (filename = '') => path.extname(filename).toLowerCase();

const createSafeContext = ({
  requestId,
  stage,
  errorCode,
  fileType,
  fileSize,
  pages,
  chunksTotal,
  chunkIndex,
  status,
}) => ({
  stage,
  errorCode,
  fileType,
  fileSize,
  pages,
  chunksTotal,
  chunkIndex,
  status,
  requestId,
});

const logSafeStage = (context) => {
  logger.info('[prepareFileWithChunkedAnonymization] trace', createSafeContext(context));
};

const createSafeError = (message, code, stage, context = {}) => {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  Object.assign(error, createSafeContext({ ...context, stage, errorCode: code, status: 'failed' }));
  return error;
};

const isSupportedTextFile = ({ filename, mimeType }) => {
  const normalizedMimeType = (mimeType || '').split(';')[0].trim().toLowerCase();
  return (
    normalizedMimeType.startsWith('text/') ||
    TEXT_MIME_TYPES.has(normalizedMimeType) ||
    TEXT_EXTENSIONS.has(getExtension(filename))
  );
};

const extractTextFile = async ({ filePath }) => {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    error.code = error.code || 'TEXT_READ_FAILED';
    throw error;
  }

  if (buffer.includes(0)) {
    const error = new Error('O arquivo parece ser binário. O envio foi bloqueado por segurança.');
    error.code = 'TEXT_BINARY_UNSUPPORTED';
    throw error;
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    error.code = 'TEXT_ENCODING_UNSUPPORTED';
    error.message = 'Não foi possível validar o encoding UTF-8 do arquivo.';
    throw error;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    const error = new Error('Não foi possível extrair texto deste arquivo.');
    error.code = 'TEXT_EXTRACTION_EMPTY';
    throw error;
  }

  return {
    text: normalized,
    chars: normalized.length,
    lines: normalized.split('\n').length,
  };
};

const withTimeout = (promise, timeoutMs, errorCode) => {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        createSafeError(
          'O serviço de anonimização demorou mais que o esperado.',
          errorCode,
          'anonymize_failed',
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
};

async function prepareFileWithChunkedAnonymization({
  filePath,
  fileId,
  filename,
  mimeType,
  size,
  maxChars,
  chunkTimeoutMs,
}) {
  const extension = getExtension(filename);
  const normalizedMimeType = (mimeType || '').split(';')[0].trim().toLowerCase();
  const isPdf = normalizedMimeType === 'application/pdf' || extension === '.pdf';
  const timeoutMs = Number(chunkTimeoutMs) || DEFAULT_CHUNK_TIMEOUT_MS;
  const requestId = fileId;
  const fileType = isPdf ? 'application/pdf' : normalizedMimeType || extension || 'unknown';
  const baseContext = {
    requestId,
    fileType,
    fileSize: size,
  };

  if (!isPdf && !isSupportedTextFile({ filename, mimeType: normalizedMimeType })) {
    throw createSafeError(
      'Tipo de arquivo não suportado para preparação segura.',
      'FILE_TYPE_UNSUPPORTED',
      'file_selected',
      baseContext,
    );
  }

  logSafeStage({
    ...baseContext,
    stage: 'file_selected',
    status: 'started',
  });

  logSafeStage({
    ...baseContext,
    stage: 'extract_started',
    status: 'started',
  });

  let extracted;
  try {
    extracted = isPdf ? await extractPdfText({ filePath }) : await extractTextFile({ filePath });
  } catch (error) {
    if (isPdf) {
      throw createSafeError(
        'Não foi possível extrair texto deste PDF.',
        'PDF_TEXT_EXTRACTION_FAILED',
        'failed',
        baseContext,
      );
    }
    error.stage = 'failed';
    Object.assign(
      error,
      createSafeContext({ ...baseContext, errorCode: error.code, status: 'failed' }),
    );
    throw error;
  }

  logSafeStage({
    ...baseContext,
    stage: 'extract_completed',
    pages: extracted.pagesProcessed,
    status: 'completed',
  });

  if (!extracted.text) {
    throw createSafeError(
      isPdf
        ? 'Este PDF não possui texto selecionável.'
        : 'Não foi possível extrair texto deste arquivo. O envio foi bloqueado por segurança.',
      isPdf ? 'PDF_NO_SELECTABLE_TEXT' : 'TEXT_EXTRACTION_EMPTY',
      'failed',
      {
        ...baseContext,
        pages: extracted.pagesProcessed,
      },
    );
  }

  logSafeStage({
    ...baseContext,
    stage: 'chunking_started',
    pages: extracted.pagesProcessed,
    status: 'started',
  });

  let chunks;
  try {
    chunks = chunkText(extracted.text, maxChars);
  } catch (_error) {
    throw createSafeError(
      'Não foi possível dividir o texto em partes seguras.',
      'CHUNKING_FAILED',
      'failed',
      {
        ...baseContext,
        pages: extracted.pagesProcessed,
      },
    );
  }

  if (!chunks.length) {
    throw createSafeError(
      isPdf
        ? 'Este PDF não possui texto selecionável.'
        : 'Não foi possível preparar chunks deste arquivo. O envio foi bloqueado por segurança.',
      isPdf ? 'PDF_NO_SELECTABLE_TEXT' : 'TEXT_CHUNKING_EMPTY',
      'failed',
      {
        ...baseContext,
        pages: extracted.pagesProcessed,
        chunksTotal: 0,
      },
    );
  }

  logSafeStage({
    ...baseContext,
    stage: 'chunking_completed',
    pages: extracted.pagesProcessed,
    chunksTotal: chunks.length,
    status: 'completed',
  });

  logSafeStage({
    ...baseContext,
    stage: 'anonymize_started',
    pages: extracted.pagesProcessed,
    chunksTotal: chunks.length,
    status: 'started',
  });

  const results = [];
  const start = Date.now();

  for (const chunk of chunks) {
    logSafeStage({
      ...baseContext,
      stage: 'anonymize_chunk_started',
      pages: extracted.pagesProcessed,
      chunksTotal: chunks.length,
      chunkIndex: chunk.chunkIndex,
      status: 'started',
    });
    let result;
    try {
      result = await withTimeout(
        blurryClient.anonymizeText({
          text: chunk.text,
          policy: 'strict',
          anonymization_level: 'full',
          return_entities: true,
        }),
        timeoutMs,
        'BLURRY_TIMEOUT',
      );
    } catch (error) {
      logSafeStage({
        ...baseContext,
        stage: 'anonymize_failed',
        errorCode: error.code || 'BLURRY_ANONYMIZE_FAILED',
        pages: extracted.pagesProcessed,
        chunksTotal: chunks.length,
        chunkIndex: chunk.chunkIndex,
        status: 'failed',
      });
      throw createSafeError(
        error.code === 'BLURRY_TIMEOUT'
          ? 'O serviço de anonimização demorou mais que o esperado.'
          : 'A anonimização falhou em uma parte do documento.',
        error.code === 'BLURRY_TIMEOUT' ? 'BLURRY_TIMEOUT' : 'BLURRY_ANONYMIZE_FAILED',
        'anonymize_failed',
        {
          ...baseContext,
          pages: extracted.pagesProcessed,
          chunksTotal: chunks.length,
          chunkIndex: chunk.chunkIndex,
        },
      );
    }

    if (!result.anonymized_text) {
      logSafeStage({
        ...baseContext,
        stage: 'anonymize_failed',
        errorCode: 'INVALID_ANONYMIZE_RESPONSE',
        pages: extracted.pagesProcessed,
        chunksTotal: chunks.length,
        chunkIndex: chunk.chunkIndex,
        status: 'failed',
      });
      throw createSafeError(
        'A resposta de anonimização veio inválida.',
        'INVALID_ANONYMIZE_RESPONSE',
        'anonymize_failed',
        {
          ...baseContext,
          pages: extracted.pagesProcessed,
          chunksTotal: chunks.length,
          chunkIndex: chunk.chunkIndex,
        },
      );
    }

    logSafeStage({
      ...baseContext,
      stage: 'anonymize_chunk_completed',
      pages: extracted.pagesProcessed,
      chunksTotal: chunks.length,
      chunkIndex: chunk.chunkIndex,
      status: 'completed',
    });

    results.push({
      chunkIndex: chunk.chunkIndex,
      anonymizedText: result.anonymized_text,
      stats: result.stats,
      entities: result.entities ?? [],
      processingMs: result.processing_ms ?? 0,
    });
  }

  logSafeStage({
    ...baseContext,
    stage: 'merge_started',
    pages: extracted.pagesProcessed,
    chunksTotal: chunks.length,
    status: 'started',
  });

  const ordered = results.sort((a, b) => a.chunkIndex - b.chunkIndex);
  const entitiesByChunk = ordered.map(({ chunkIndex, entities }) => ({ chunkIndex, entities }));
  const processingMs = Date.now() - start;

  logSafeStage({
    ...baseContext,
    stage: 'merge_completed',
    pages: extracted.pagesProcessed,
    chunksTotal: chunks.length,
    status: 'completed',
  });

  logSafeStage({
    ...baseContext,
    stage: 'ready',
    pages: extracted.pagesProcessed,
    chunksTotal: chunks.length,
    status: 'ready',
  });

  return {
    fileId,
    requestId,
    filename,
    mimeType: normalizedMimeType,
    type: isPdf ? 'pdf' : 'text',
    providerSafe: true,
    anonymizedText: ordered.map((item) => item.anonymizedText).join('\n\n'),
    pages: extracted.pagesProcessed,
    lines: extracted.lines,
    stats: mergeStats(ordered.map((item) => item.stats)),
    entityCount: countEntities(entitiesByChunk),
    processingMs,
    chunks: {
      total: chunks.length,
      succeeded: ordered.length,
      failed: 0,
    },
  };
}

async function preparePdfWithChunkedAnonymization({ filePath, fileId, filename, maxChars }) {
  logger.info('[preparePdfWithChunkedAnonymization] extract_started', { fileId });
  const extracted = await extractPdfText({ filePath });
  logger.info('[preparePdfWithChunkedAnonymization] extract_completed', {
    fileId,
    chars: extracted.chars,
    pages: extracted.pagesProcessed,
  });

  if (!extracted.text) {
    const error = new Error(
      'Não foi possível extrair texto selecionável deste PDF. O envio foi bloqueado por segurança.',
    );
    error.code = 'PDF_TEXT_EXTRACTION_EMPTY';
    throw error;
  }

  const chunks = chunkText(extracted.text, maxChars);
  if (!chunks.length) {
    const error = new Error(
      'Não foi possível extrair texto selecionável deste PDF. O envio foi bloqueado por segurança.',
    );
    error.code = 'PDF_CHUNKING_EMPTY';
    throw error;
  }

  logger.info('[preparePdfWithChunkedAnonymization] chunking_completed', {
    fileId,
    chunkCount: chunks.length,
  });

  const results = [];
  const start = Date.now();

  for (const chunk of chunks) {
    logger.info('[preparePdfWithChunkedAnonymization] anonymizing_chunk', {
      fileId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
    });
    let result;
    try {
      result = await blurryClient.anonymizeText({
        text: chunk.text,
        policy: 'strict',
        anonymization_level: 'full',
        return_entities: true,
      });
    } catch (error) {
      if (!error.code) {
        error.code = 'PDF_CHUNK_ANONYMIZE_FAILED';
      }
      throw error;
    }

    if (!result.anonymized_text) {
      const error = new Error(
        'Falha ao anonimizar uma parte do PDF. O envio foi bloqueado por segurança.',
      );
      error.code = 'PDF_CHUNK_EMPTY_RESPONSE';
      throw error;
    }

    results.push({
      chunkIndex: chunk.chunkIndex,
      anonymizedText: result.anonymized_text,
      stats: result.stats,
      entities: result.entities ?? [],
      processingMs: result.processing_ms ?? 0,
    });
  }

  const ordered = results.sort((a, b) => a.chunkIndex - b.chunkIndex);
  const entitiesByChunk = ordered.map(({ chunkIndex, entities }) => ({ chunkIndex, entities }));
  const processingMs = Date.now() - start;

  logger.info('[preparePdfWithChunkedAnonymization] merge_completed', {
    fileId,
    chunkCount: chunks.length,
    processingMs,
    providerSafe: true,
  });

  return {
    fileId,
    filename,
    providerSafe: true,
    anonymizedText: ordered.map((item) => item.anonymizedText).join('\n\n'),
    pages: extracted.pagesProcessed,
    stats: mergeStats(ordered.map((item) => item.stats)),
    entityCount: countEntities(entitiesByChunk),
    processingMs,
    chunks: {
      total: chunks.length,
      succeeded: ordered.length,
      failed: 0,
    },
  };
}

module.exports = {
  chunkText,
  extractTextFile,
  isSupportedTextFile,
  prepareFileWithChunkedAnonymization,
  preparePdfWithChunkedAnonymization,
};
