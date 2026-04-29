const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('@librechat/data-schemas');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hashIdempotencyKey = ({ text, policy, anonymization_level }) => {
  const payload = `${policy}::${anonymization_level}::${text}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
};

const parseRetryAfterMs = (retryAfterHeader) => {
  if (!retryAfterHeader) {
    return null;
  }
  const seconds = Number(retryAfterHeader);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(dateMs)) {
    return Math.max(dateMs - Date.now(), 0);
  }
  return null;
};

const blurryClient = {
  checkHealth: async () => {
    const baseURL = process.env.BLURRY_BASE_URL || 'https://9a39-138-255-244-234.ngrok-free.app';
    const apiKey = process.env.BLURRY_API_KEY;
    const timeout = Number(process.env.BLURRY_TIMEOUT_MS) || 10000;

    if (!apiKey) {
      return { status: 'misconfigured', error: 'BLURRY_API_KEY is missing' };
    }

    try {
      const start = Date.now();
      await axios.get(`${baseURL}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout,
      });
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (error) {
      const status = error.response?.status;
      if (status) {
        return { status: 'degraded', httpStatus: status, error: error.message };
      }
      return { status: 'unreachable', error: error.message };
    }
  },

  anonymizeText: async ({
    text,
    policy = 'default',
    anonymization_level = 'full',
    return_entities = true,
  }) => {
    const baseURL = process.env.BLURRY_BASE_URL || 'https://9a39-138-255-244-234.ngrok-free.app';
    const apiKey = process.env.BLURRY_API_KEY;
    const timeout = Number(process.env.BLURRY_TIMEOUT_MS) || 10000;

    if (!apiKey) {
      throw new Error('BLURRY_API_KEY is missing');
    }

    const idempotencyKey = hashIdempotencyKey({ text, policy, anonymization_level });

    const config = {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      timeout,
    };

    const body = {
      text,
      policy,
      anonymization_level,
      return_entities,
    };

    const startTime = Date.now();
    let response;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        response = await axios.post(`${baseURL}/v1/anonymize`, body, config);
        break;
      } catch (error) {
        const status = error.response?.status;
        if (status === 429 && attempts < maxAttempts) {
          const retryAfterMs = parseRetryAfterMs(error.response?.headers?.['retry-after']);
          const delay = retryAfterMs ?? 1000 * attempts;
          logger.warn(`Blurry API rate limited (429). Retrying in ${delay}ms.`);
          await sleep(delay);
          continue;
        }
        if (status === 500 && attempts < maxAttempts) {
          const delay = 500 * 2 ** (attempts - 1);
          logger.warn(`Blurry API error 500. Retrying in ${delay}ms.`);
          await sleep(delay);
          continue;
        }

        logger.error('Blurry API error:', {
          status,
          message: error.message,
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
      idempotentReplay: response.headers?.['idempotent-replay'] ?? false,
    });

    if (!anonymized_text) {
      throw new Error('Blurry returned empty anonymized_text');
    }

    return {
      anonymized_text,
      entities,
      stats,
      processing_ms,
      idempotency_key: idempotencyKey,
      idempotent_replay: response.headers?.['idempotent-replay'] ?? false,
    };
  },
};

module.exports = blurryClient;
