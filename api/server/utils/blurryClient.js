const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
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

const getConfig = () => ({
  baseURL: process.env.BLURRY_BASE_URL || 'https://9a39-138-255-244-234.ngrok-free.app',
  apiKey: process.env.BLURRY_API_KEY,
  timeout: Number(process.env.BLURRY_TIMEOUT_MS) || 10000,
});

const getDocumentPollConfig = () => ({
  timeoutMs: Number(process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS) || 120000,
  intervalMs: Number(process.env.BLURRY_DOCUMENT_POLL_INTERVAL_MS) || 2000,
});

const getJobId = (data) => data?.jobId ?? data?.job_id ?? data?.id;

const getJobStatus = (data) => {
  const status = data?.status ?? data?.state;
  return typeof status === 'string' ? status.toLowerCase() : status;
};

const getDownloadUrl = (data) =>
  data?.download_url ??
  data?.downloadUrl ??
  data?.sanitized_url ??
  data?.sanitizedUrl ??
  data?.result?.download_url ??
  data?.result?.downloadUrl;

const getOutputs = (data) => data?.outputs ?? data?.result?.outputs ?? data?.data?.outputs ?? {};

const getSanitizedTextUrl = (data) => {
  const outputs = getOutputs(data);
  return (
    outputs?.sanitizedTextUrl ??
    outputs?.sanitized_text_url ??
    data?.sanitizedTextUrl ??
    data?.sanitized_text_url
  );
};

const getSanitizedText = (data) => {
  const outputs = getOutputs(data);
  return (
    outputs?.sanitizedText ?? outputs?.sanitized_text ?? data?.sanitizedText ?? data?.sanitized_text
  );
};

const getSanitizedPdfUrl = (data) => {
  const outputs = getOutputs(data);
  return (
    outputs?.sanitizedPdfUrl ??
    outputs?.sanitized_pdf_url ??
    outputs?.sanitizedFileUrl ??
    outputs?.sanitized_file_url ??
    outputs?.sanitizedImageUrl ??
    outputs?.sanitized_image_url ??
    getDownloadUrl(data)
  );
};

const buildDocumentUrl = ({ baseURL, jobId, suffix = '' }) => {
  const template = process.env.BLURRY_DOCUMENTS_PATH;
  if (template) {
    const pathTemplate = template.includes(':jobId')
      ? template.replace(':jobId', jobId ?? '')
      : `${template}${jobId ? `/${jobId}` : ''}`;
    return `${baseURL}${pathTemplate}${suffix}`;
  }
  return `${baseURL}/v1/documents${jobId ? `/${jobId}` : ''}${suffix}`;
};

const blurryClient = {
  checkHealth: async () => {
    const { baseURL, apiKey, timeout } = getConfig();

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
    const { baseURL, apiKey, timeout } = getConfig();

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

  uploadDocument: async (
    file,
    {
      policy = 'default',
      anonymization_level = 'full',
      ocr = true,
      requestId = crypto.randomUUID(),
    } = {},
  ) => {
    const { baseURL, apiKey, timeout } = getConfig();
    if (!apiKey) {
      throw new Error('BLURRY_API_KEY is missing');
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(file.path), {
      filename: path.basename(file.originalname || file.path),
      contentType: file.mimetype || 'application/pdf',
      knownLength: file.size,
    });
    form.append('policy', policy);
    form.append('anonymization_level', anonymization_level);
    form.append('ocr', String(ocr));
    form.append('request_id', requestId);

    logger.info('[blurryClient] document_upload_started', {
      requestId,
      mime_type: file.mimetype,
      size: file.size,
      ocr,
    });

    const response = await axios.post(buildDocumentUrl({ baseURL }), form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
        'X-Request-Id': requestId,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: Number(process.env.BLURRY_DOCUMENT_UPLOAD_TIMEOUT_MS) || timeout,
    });

    const jobId = getJobId(response.data);
    if (!jobId) {
      throw new Error('Blurry document upload did not return a jobId');
    }

    logger.info('[blurryClient] document_job_created', {
      requestId,
      job_id: jobId,
      status: getJobStatus(response.data),
    });

    return {
      jobId,
      status: getJobStatus(response.data),
      requestId,
      providerSafe: response.data?.providerSafe ?? response.data?.provider_safe,
      outputs: {
        sanitizedTextUrl: getSanitizedTextUrl(response.data),
        sanitizedText: getSanitizedText(response.data),
        sanitizedPdfUrl: getSanitizedPdfUrl(response.data),
      },
      raw: response.data,
    };
  },

  getDocumentJob: async (jobId, { requestId } = {}) => {
    const { baseURL, apiKey, timeout } = getConfig();
    if (!apiKey) {
      throw new Error('BLURRY_API_KEY is missing');
    }

    const response = await axios.get(buildDocumentUrl({ baseURL, jobId }), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
      },
      timeout,
    });

    return {
      jobId: getJobId(response.data) ?? jobId,
      status: getJobStatus(response.data),
      error: response.data?.error ?? response.data?.message,
      downloadUrl: getDownloadUrl(response.data),
      providerSafe: response.data?.providerSafe ?? response.data?.provider_safe,
      outputs: {
        sanitizedTextUrl: getSanitizedTextUrl(response.data),
        sanitizedText: getSanitizedText(response.data),
        sanitizedPdfUrl: getSanitizedPdfUrl(response.data),
      },
      raw: response.data,
    };
  },

  downloadSanitizedText: async (downloadUrl, { requestId } = {}) => {
    const { baseURL, apiKey, timeout } = getConfig();
    if (!apiKey) {
      throw new Error('BLURRY_API_KEY is missing');
    }
    if (!downloadUrl) {
      throw new Error('Blurry sanitized text URL is missing');
    }

    logger.info('[blurryClient] sanitized_text_download_started', { requestId });
    const response = await axios.get(
      downloadUrl.startsWith('http') ? downloadUrl : `${baseURL}${downloadUrl}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(requestId ? { 'X-Request-Id': requestId } : {}),
        },
        responseType: 'text',
        timeout: Number(process.env.BLURRY_DOCUMENT_DOWNLOAD_TIMEOUT_MS) || timeout,
        transformResponse: [(data) => data],
      },
    );

    const text = typeof response.data === 'string' ? response.data.trim() : '';
    if (!text) {
      throw new Error('Blurry sanitized text download was empty');
    }

    logger.info('[blurryClient] sanitized_text_download_completed', {
      requestId,
      size: text.length,
      content_type: response.headers?.['content-type'],
    });

    return {
      text,
      contentType: response.headers?.['content-type'] || 'text/plain',
      bytes: Buffer.byteLength(text),
    };
  },

  pollDocumentJob: async (jobId, { requestId } = {}) => {
    const { timeoutMs, intervalMs } = getDocumentPollConfig();
    const deadline = Date.now() + timeoutMs;

    logger.info('[blurryClient] document_polling_started', {
      requestId,
      job_id: jobId,
      timeout_ms: timeoutMs,
      interval_ms: intervalMs,
    });

    while (Date.now() <= deadline) {
      const job = await blurryClient.getDocumentJob(jobId, { requestId });
      if (job.status === 'completed' || job.status === 'complete' || job.status === 'succeeded') {
        logger.info('[blurryClient] document_completed', {
          requestId,
          job_id: job.jobId,
          status: job.status,
        });
        return { ...job, status: 'completed' };
      }
      if (job.status === 'failed' || job.status === 'error' || job.status === 'cancelled') {
        logger.error('[blurryClient] document_failed', {
          requestId,
          job_id: job.jobId,
          status: job.status,
          message: job.error,
        });
        throw new Error(`Blurry document job failed: ${job.error || job.status}`);
      }
      await sleep(intervalMs);
    }

    throw new Error(`Blurry document job timed out after ${timeoutMs}ms`);
  },

  downloadSanitizedDocument: async (jobId, { requestId, downloadUrl } = {}) => {
    const { baseURL, apiKey, timeout } = getConfig();
    if (!apiKey) {
      throw new Error('BLURRY_API_KEY is missing');
    }

    logger.info('[blurryClient] sanitized_download_started', {
      requestId,
      job_id: jobId,
    });

    const url =
      downloadUrl ??
      process.env.BLURRY_DOCUMENT_DOWNLOAD_PATH?.replace(':jobId', jobId) ??
      buildDocumentUrl({ baseURL, jobId, suffix: '/download' });
    const response = await axios.get(url.startsWith('http') ? url : `${baseURL}${url}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
      },
      responseType: 'arraybuffer',
      timeout: Number(process.env.BLURRY_DOCUMENT_DOWNLOAD_TIMEOUT_MS) || timeout,
    });

    const buffer = Buffer.from(response.data);
    if (!buffer.length) {
      throw new Error('Blurry sanitized document download was empty');
    }

    logger.info('[blurryClient] sanitized_download_completed', {
      requestId,
      job_id: jobId,
      size: buffer.length,
      content_type: response.headers?.['content-type'],
    });

    return {
      buffer,
      contentType: response.headers?.['content-type'] || 'application/pdf',
      bytes: buffer.length,
    };
  },
};

module.exports = blurryClient;
