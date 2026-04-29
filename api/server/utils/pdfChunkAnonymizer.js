const { logger } = require('@librechat/data-schemas');
const blurryClient = require('./blurryClient');
const { extractPdfText } = require('./pdfText');

const DEFAULT_MAX_CHARS = 6000;

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
  preparePdfWithChunkedAnonymization,
};
