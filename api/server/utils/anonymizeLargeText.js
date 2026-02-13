const { logger } = require('@librechat/data-schemas');
const blurryClient = require('./blurryClient');

const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_OVERLAP = 200;

const getChunkConfig = () => {
  const maxChars = Number(process.env.BLURRY_MAX_CHARS) || DEFAULT_MAX_CHARS;
  const overlap = Number(process.env.BLURRY_CHUNK_OVERLAP) || DEFAULT_OVERLAP;
  return { maxChars, overlap };
};

const normalizeText = (text) => {
  if (!text) {
    return '';
  }
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const splitBySentences = (text) => {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
};

const splitLongParagraph = (paragraph, maxChars) => {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }

  const sentences = splitBySentences(paragraph);
  if (sentences.length === 1) {
    const chunks = [];
    for (let i = 0; i < paragraph.length; i += maxChars) {
      chunks.push(paragraph.slice(i, i + maxChars));
    }
    return chunks;
  }

  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length + sentence.length + 1 <= maxChars) {
      current += ` ${sentence}`;
      continue;
    }
    chunks.push(current);
    current = sentence;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
};

const splitTextIntoChunks = (text, maxChars, overlap) => {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const paragraphChunks = splitLongParagraph(paragraph, maxChars);

    for (const part of paragraphChunks) {
      if (!current) {
        current = part;
        continue;
      }

      if (current.length + part.length + 2 <= maxChars) {
        current += `\n\n${part}`;
        continue;
      }

      chunks.push(current);
      const overlapText = overlap > 0 ? current.slice(-overlap) : '';
      current = overlapText ? `${overlapText}${part}` : part;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const mergeStats = (base, incoming) => {
  if (!incoming || typeof incoming !== 'object') {
    return base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'number') {
      result[key] = (result[key] ?? 0) + value;
    } else if (result[key] == null) {
      result[key] = value;
    }
  }
  return result;
};

async function anonymizeLargeText(text) {
  const normalized = normalizeText(text);
  const { maxChars, overlap } = getChunkConfig();
  const chunks = splitTextIntoChunks(normalized, maxChars, overlap);

  const entitiesByChunk = [];
  let anonymizedText = '';
  let stats = {};
  let processingMsTotal = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const result = await blurryClient.anonymizeText(chunk, 'full', true);
    anonymizedText += result.anonymized_text;
    processingMsTotal += result.processing_ms ?? 0;
    stats = mergeStats(stats, result.stats);
    entitiesByChunk.push({ chunk_index: i, entities: result.entities ?? [] });
  }

  logger.info('[anonymizeLargeText] Completed chunked anonymization', {
    chunks: chunks.length,
    processingMsTotal,
  });

  return {
    anonymizedText,
    stats,
    entitiesByChunk,
    processingMsTotal,
    chunksCount: chunks.length,
  };
}

module.exports = {
  anonymizeLargeText,
  splitTextIntoChunks,
  normalizeText,
  getChunkConfig,
  mergeStats,
};
