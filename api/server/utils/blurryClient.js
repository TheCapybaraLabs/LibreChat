const axios = require('axios');
const { logger } = require('@librechat/data-schemas');

const blurryClient = {
  anonymizeText: async (text, level = 'full', return_entities = true) => {
    const baseURL = process.env.BLURRY_BASE_URL || 'https://9a39-138-255-244-234.ngrok-free.app';
    const apiKey = process.env.BLURRY_API_KEY;
    const timeout = Number(process.env.BLURRY_TIMEOUT_MS) || 10000;

    if (!apiKey) {
      throw new Error('BLURRY_API_KEY is missing');
    }

    const config = {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout,
    };

    const body = {
      text,
      anonymization_level: level,
      return_entities,
    };

    const startTime = Date.now();
    let response;
    let attempts = 0;
    const maxAttempts = 2; // 1 initial + 1 retry

    while (attempts < maxAttempts) {
      try {
        attempts++;
        response = await axios.post(`${baseURL}/v1/anonymize`, body, config);
        break; // Success
      } catch (error) {
        const status = error.response?.status;
        const retryableStatuses = [429, 502, 503, 504];
        
        if (attempts < maxAttempts && retryableStatuses.includes(status)) {
          logger.warn(`Blurry API retry attempt ${attempts} due to status ${status}`);
          continue;
        }
        
        logger.error('Blurry API error:', {
          status,
          message: error.message,
          data: error.response?.data,
        });
        throw error;
      }
    }

    const totalTime = Date.now() - startTime;
    const { anonymized_text, entities, stats, processing_ms } = response.data;

    logger.info('Blurry Anonymization Complete', {
      statusCode: response.status,
      totalTimeMs: totalTime,
      processingMs: processing_ms,
    });

    if (process.env.DEBUG_LOGGING === 'true') {
      logger.debug('Anonymized Text:', { anonymized_text });
    }

    if (!anonymized_text) {
      throw new Error('Blurry returned empty anonymized_text');
    }

    return {
      anonymized_text,
      entities,
      stats,
      processing_ms,
    };
  },
};

module.exports = blurryClient;
