const { logger } = require('@librechat/data-schemas');
const blurryClient = require('./blurryClient');

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

async function anonymizeLargeText(text) {
  const normalized = normalizeText(text);
  logger.info('[anonymizeLargeText] chunking_started', {
    chars: normalized.length,
    chunks_count: 1,
  });
  const result = await blurryClient.anonymizeText({
    text: normalized,
    policy: 'default',
    anonymization_level: 'full',
    return_entities: true,
  });
  logger.info('[anonymizeLargeText] chunking_completed', {
    chunks_count: 1,
    processingMsTotal: result.processing_ms ?? 0,
  });

  logger.info('[anonymizeLargeText] Completed anonymization', {
    processingMsTotal: result.processing_ms ?? 0,
  });

  return {
    anonymizedText: result.anonymized_text,
    stats: result.stats,
    entitiesByChunk: [{ chunk_index: 0, entities: result.entities ?? [] }],
    processingMsTotal: result.processing_ms ?? 0,
    chunksCount: 1,
  };
}

module.exports = {
  anonymizeLargeText,
  normalizeText,
};
