const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const { v4 } = require('uuid');
const { EnvVar } = require('@librechat/agents');
const { logger } = require('@librechat/data-schemas');
const {
  Time,
  isUUID,
  CacheKeys,
  FileSources,
  ResourceType,
  EModelEndpoint,
  PermissionBits,
  checkOpenAIStorage,
  isAssistantsEndpoint,
} = require('librechat-data-provider');
const {
  filterFile,
  processFileUpload,
  processDeleteRequest,
  processAgentFileUpload,
} = require('~/server/services/Files/process');
const { fileAccess } = require('~/server/middleware/accessResources/fileAccess');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getOpenAIClient } = require('~/server/controllers/assistants/helpers');
const { checkPermission } = require('~/server/services/PermissionService');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { refreshS3FileUrls } = require('~/server/services/Files/S3/crud');
const { hasAccessToFilesViaAgent } = require('~/server/services/Files');
const { getFiles, batchUpdateFiles } = require('~/models/File');
const { cleanFileName } = require('~/server/utils/files');
const blurryClient = require('~/server/utils/blurryClient');
const { getAssistant } = require('~/models/Assistant');
const { getAgent } = require('~/models/Agent');
const { getLogStores } = require('~/cache');
const { Readable } = require('stream');
const crypto = require('crypto');

const router = express.Router();
const preparedDownloads = new Map();
const preparedJobs = new Map();
const PREPARED_DOWNLOAD_TTL_MS =
  Number(process.env.BLURRY_PREPARED_DOWNLOAD_TTL_MS) || 15 * 60 * 1000;

let _capabilitiesCache = null;
let _capabilitiesCachedAt = 0;
const CAPABILITIES_CACHE_TTL_MS = Number(process.env.BLURRY_CAPABILITIES_CACHE_TTL_MS) || 5 * 60 * 1000;

const hashFilename = (filename = '') =>
  crypto.createHash('sha256').update(filename).digest('hex').slice(0, 12);

const safePrepareErrorCodes = new Set([
  'FILE_TYPE_UNSUPPORTED',
  'BLURRY_TIMEOUT',
  'BLURRY_JOB_TIMEOUT',
  'PDF_TEXT_EXTRACTION_FAILED',
  'PDF_NO_SELECTABLE_TEXT',
  'PDF_PARSER_NOT_AVAILABLE',
  'PDF_READ_FAILED',
  'PDF_EXTRACTION_FAILED',
  'BLURRY_ANONYMIZE_FAILED',
  'INVALID_ANONYMIZE_RESPONSE',
  'CHUNKING_FAILED',
  'TEXT_BINARY_UNSUPPORTED',
  'TEXT_ENCODING_UNSUPPORTED',
  'TEXT_EXTRACTION_EMPTY',
  'TEXT_CHUNKING_EMPTY',
  'SANITIZED_TEXT_MISSING',
  'BLURRY_TEXT_OUTPUT_MISSING',
  'PROVIDER_SAFE_MISSING',
  'BLURRY_PROVIDER_UNSAFE',
  'BLURRY_DOCUMENT_UPLOAD_FAILED',
  'BLURRY_JOB_FAILED',
  'BLURRY_DOWNLOAD_FAILED',
  'BLURRY_CAPABILITIES_UNAVAILABLE',
]);

const buildSanitizedFileName = (filename = 'documento.pdf') => {
  const cleaned = cleanFileName(filename || 'documento.pdf');
  const extension = path.extname(cleaned) || '.pdf';
  const baseName = path.basename(cleaned, extension) || 'documento';
  return `${baseName}.anonimizado${extension}`;
};

const registerPreparedDownload = ({ requestId, userId, filename, sanitizedPdfUrl }) => {
  if (!requestId || !userId || !sanitizedPdfUrl) {
    return null;
  }

  const sanitizedFileName = buildSanitizedFileName(filename);
  preparedDownloads.set(requestId, {
    userId,
    sanitizedPdfUrl,
    sanitizedFileName,
    expiresAt: Date.now() + PREPARED_DOWNLOAD_TTL_MS,
  });

  return {
    sanitizedPdfUrl: `/api/files/prepared-download/${encodeURIComponent(requestId)}`,
    sanitizedFileName,
  };
};

const prepareJobExpiresAt = () => Date.now() + PREPARED_DOWNLOAD_TTL_MS;

const normalizeJobStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'complete' || normalized === 'succeeded' || normalized === 'done') {
    return 'completed';
  }
  if (normalized === 'error' || normalized === 'cancelled' || normalized === 'canceled') {
    return 'failed';
  }
  if (normalized === 'review_required' || normalized === 'requires_review') {
    return 'review_required';
  }
  if (normalized === 'queued' || normalized === 'processing' || normalized === 'completed') {
    return normalized;
  }
  return 'processing';
};

const getSafeJobErrorCode = (job) => {
  const rawCode =
    job?.raw?.errorCode ??
    job?.raw?.error_code ??
    job?.raw?.code ??
    job?.raw?.error?.code ??
    job?.errorCode ??
    job?.error?.code;

  if (typeof rawCode === 'string' && rawCode.trim()) {
    return rawCode.trim().toUpperCase();
  }

  const rawMessage = String(
    job?.raw?.error ?? job?.raw?.errorMessage ?? job?.raw?.message ?? job?.error ?? '',
  ).toUpperCase();

  if (rawMessage.includes('OCR')) {
    return 'OCR_FAILED';
  }
  if (rawMessage.includes('CHUNK')) {
    return 'CHUNK_FAILED';
  }
  if (rawMessage.includes('TIMEOUT')) {
    return 'TIMEOUT';
  }
  if (rawMessage.includes('TEXT') && rawMessage.includes('LARGE')) {
    return 'TEXT_TOO_LARGE';
  }

  return 'BLURRY_JOB_FAILED';
};

const registerPreparedJob = ({ jobId, requestId, userId, filename, fileType, fileSize }) => {
  if (!jobId || !userId) {
    return;
  }
  preparedJobs.set(jobId, {
    userId,
    requestId,
    filename,
    fileType,
    fileSize,
    createdAt: Date.now(),
    expiresAt: prepareJobExpiresAt(),
  });
};

const getPreparedJobForUser = ({ jobId, userId }) => {
  const prepared = preparedJobs.get(jobId);
  if (!prepared) {
    return null;
  }
  if (prepared.expiresAt <= Date.now()) {
    preparedJobs.delete(jobId);
    return null;
  }
  if (prepared.userId !== userId) {
    return null;
  }
  return prepared;
};

const refreshPreparedJobTTL = (jobId) => {
  const prepared = preparedJobs.get(jobId);
  if (!prepared) {
    return;
  }
  preparedJobs.set(jobId, { ...prepared, expiresAt: prepareJobExpiresAt() });
};

const toJobResponse = ({ prepared, jobId, job, includeSafeOutputs = false }) => {
  const status = normalizeJobStatus(job?.status);
  const raw = job?.raw ?? {};
  let fallbackStage = status;
  if (status === 'queued') {
    fallbackStage = 'upload';
  } else if (status === 'processing') {
    fallbackStage = 'processing';
  }
  const processingStage =
    raw?.stage ?? raw?.currentStage ?? raw?.phase ?? raw?.step ?? fallbackStage;
  const pagesTotal = raw?.pagesTotal ?? raw?.pages ?? raw?.totalPages;
  const pagesProcessed = raw?.pagesProcessed ?? raw?.ocrPagesDone ?? raw?.processedPages;
  const chunksTotal = raw?.chunksTotal ?? raw?.chunks_count ?? raw?.chunksCount;
  const chunksProcessed =
    raw?.chunksProcessed ?? raw?.chunksDone ?? raw?.sanitizedChunks ?? raw?.processedChunks;

  const response = {
    ok: true,
    requestId: prepared?.requestId,
    jobId,
    status,
    providerSafe: status === 'completed' ? (raw?.providerSafe ?? job?.providerSafe ?? true) : false,
    processingStage,
    message: raw?.message ?? null,
    progress: raw?.progress,
    estimatedSeconds: raw?.etaSeconds ?? raw?.estimatedSeconds ?? raw?.eta,
    elapsedMs: raw?.elapsedMs ?? raw?.elapsed_ms,
    ocrActive: raw?.ocrActive ?? raw?.ocr_enabled ?? true,
    pagesTotal,
    pagesProcessed,
    chunksTotal,
    chunksProcessed,
    fileName: prepared?.filename,
    fileType: prepared?.fileType,
    fileSize: prepared?.fileSize,
  };

  if (status === 'failed') {
    response.errorCode = getSafeJobErrorCode(job);
    response.message =
      raw?.errorMessage ?? raw?.error ?? job?.error ?? 'Document processing failed';
  }

  if (status === 'review_required') {
    response.reviewRequired = true;
    if (!response.providerSafe) {
      response.errorCode = 'BLURRY_PROVIDER_UNSAFE';
      response.message = raw?.message ?? 'Documento não validado como seguro pelo provedor.';
    }
  }

  const hasArtifactAvailable = status === 'completed' || (status === 'review_required' && response.providerSafe);

  if (includeSafeOutputs && hasArtifactAvailable) {
    response.outputs = {
      sanitizedTextAvailable: true,
      sanitizedPdfUrl: `/api/files/prepare-file/jobs/${encodeURIComponent(jobId)}/download?type=pdf`,
      sanitizedFileName: buildSanitizedFileName(prepared?.filename || 'documento.pdf'),
    };
  }

  return response;
};

const prepareFile = async (req, res) => {
  const fileId = req.file_id ?? req.body?.file_id ?? v4();
  const file = req.file;
  const extension = file?.originalname
    ? cleanFileName(file.originalname).split('.').pop()
    : undefined;

  try {
    if (!file) {
      return res.status(400).json({ message: 'No file provided' });
    }

    const upload = await blurryClient.uploadDocument(file, {
      policy: process.env.BLURRY_DOCUMENT_POLICY || 'default',
      anonymization_level: 'full',
      ocr: process.env.BLURRY_DOCUMENT_OCR !== 'false',
      return_entities: true,
      requestId: fileId,
    });

    registerPreparedJob({
      jobId: upload.jobId,
      requestId: upload.requestId || fileId,
      userId: req.user?.id,
      filename: file.originalname,
      fileType: file.mimetype || extension,
      fileSize: file.size,
    });

    const initialStatus = normalizeJobStatus(upload.status || 'processing');
    res.status(202).json({
      ok: true,
      requestId: upload.requestId || fileId,
      jobId: upload.jobId,
      status: initialStatus,
      providerSafe: false,
      processingStage: initialStatus === 'queued' ? 'upload' : 'processing',
    });
  } catch (error) {
    const rawCode = error.code;
    const errorCode = safePrepareErrorCodes.has(rawCode) ? rawCode : 'BLURRY_DOCUMENT_UPLOAD_FAILED';
    const message = safePrepareErrorCodes.has(rawCode)
      ? error.message
      : 'Falha ao iniciar a preparação segura do arquivo.';
    logger.error('[prepare-file] Failed to prepare file', {
      requestId: error.requestId || fileId,
      fileNameHash: hashFilename(file?.originalname),
      stage: error.stage || 'failed',
      fileType: error.fileType || file?.mimetype || extension,
      fileSize: error.fileSize || file?.size,
      pages: error.pages,
      chunksTotal: error.chunksTotal,
      chunkIndex: error.chunkIndex,
      errorCode,
      status: 'failed',
    });
    res.status(500).json({
      message,
      errorCode,
      stage: error.stage || 'failed',
      requestId: error.requestId || fileId,
      fileType: error.fileType || file?.mimetype || extension,
      fileSize: error.fileSize || file?.size,
      pages: error.pages,
      chunksTotal: error.chunksTotal,
      chunkIndex: error.chunkIndex,
      status: 'failed',
    });
  } finally {
    if (file?.path) {
      try {
        await fs.unlink(file.path);
      } catch (error) {
        logger.error('[prepare-file] Error deleting temp file:', {
          fileId,
          errorCode: error.code,
        });
      }
    }
  }
};

router.get('/blurry/capabilities', async (req, res) => {
  if (_capabilitiesCache && Date.now() - _capabilitiesCachedAt < CAPABILITIES_CACHE_TTL_MS) {
    return res.status(200).json(_capabilitiesCache);
  }
  try {
    const caps = await blurryClient.getCapabilities();
    if (caps) {
      _capabilitiesCache = caps;
      _capabilitiesCachedAt = Date.now();
    }
    return res.status(200).json(
      caps ?? { documents: { enabled: true, ocrEnabled: true }, anonymize: { enabled: true } },
    );
  } catch (error) {
    logger.warn('[blurry/capabilities] Failed to fetch capabilities:', error.message);
    return res.status(200).json({
      documents: { enabled: true, ocrEnabled: true },
      anonymize: { enabled: true },
    });
  }
});

router.post('/prepare-file', prepareFile);
router.post('/prepare-pdf', prepareFile);

router.get('/prepare-file/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const prepared = getPreparedJobForUser({ jobId, userId: req.user?.id });
  if (!prepared) {
    return res.status(404).json({ message: 'Job não encontrado.' });
  }

  try {
    const job = await blurryClient.getDocumentJob(jobId, {
      requestId: prepared.requestId,
    });
    refreshPreparedJobTTL(jobId);

    const status = normalizeJobStatus(job.status);
    const providerSafe = status === 'completed' ? (job.raw?.providerSafe ?? job?.providerSafe ?? true) : false;
    const hasArtifact = status === 'completed' || (status === 'review_required' && providerSafe);

    if (hasArtifact) {
      const sanitizedPdfUrl = job.outputs?.sanitizedPdfUrl;
      const downloadOutput = registerPreparedDownload({
        requestId: prepared.requestId,
        userId: req.user?.id,
        filename: prepared.filename,
        sanitizedPdfUrl,
      });

      if (downloadOutput) {
        return res.status(200).json({
          ...toJobResponse({ prepared, jobId, job, includeSafeOutputs: true }),
          outputs: {
            sanitizedTextAvailable: true,
            sanitizedPdfUrl: downloadOutput.sanitizedPdfUrl,
            sanitizedFileName: downloadOutput.sanitizedFileName,
          },
        });
      }
    }

    return res.status(200).json(toJobResponse({ prepared, jobId, job, includeSafeOutputs: true }));
  } catch (error) {
    logger.error('[prepare-file-job] Failed to fetch job status', {
      jobId,
      requestId: prepared.requestId,
      errorCode: error.code,
    });
    return res.status(502).json({
      ok: false,
      jobId,
      status: 'failed',
      providerSafe: false,
      errorCode: 'BLURRY_JOB_FAILED',
      message: 'Não foi possível consultar o status do documento.',
    });
  }
});

router.get('/prepare-file/jobs/:jobId/download', async (req, res) => {
  const { jobId } = req.params;
  const type = String(req.query.type || 'pdf').toLowerCase();
  const prepared = getPreparedJobForUser({ jobId, userId: req.user?.id });
  if (!prepared) {
    return res
      .status(404)
      .json({ ok: false, jobId, errorCode: 'ARTIFACT_NOT_FOUND', message: 'Job não encontrado.' });
  }
  if (type !== 'text' && type !== 'pdf') {
    return res.status(400).json({ message: 'Tipo de download inválido.' });
  }

  try {
    refreshPreparedJobTTL(jobId);
    if (type === 'text') {
      const textOutput = await blurryClient.downloadDocumentOutput(jobId, {
        requestId: prepared.requestId,
        type: 'text',
      });
      return res.status(200).json({
        ok: true,
        jobId,
        type: 'text',
        providerSafe: true,
        text: textOutput.text,
      });
    }

    const pdfOutput = await blurryClient.downloadDocumentOutput(jobId, {
      requestId: prepared.requestId,
      type: 'pdf',
    });
    res.setHeader('Content-Type', pdfOutput.contentType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${buildSanitizedFileName(prepared.filename || 'documento.pdf')}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdfOutput.buffer);
  } catch (error) {
    logger.error('[prepare-file-download] Failed to download output', {
      jobId,
      requestId: prepared.requestId,
      type,
      errorCode: error.code,
    });
    const upstreamStatus = error?.response?.status;
    const isExpired = upstreamStatus === 410;
    const isNotFound = upstreamStatus === 404;
    const httpStatus = isExpired ? 410 : isNotFound ? 404 : 502;
    const errorCode = isExpired
      ? 'ARTIFACT_EXPIRED'
      : isNotFound
        ? 'ARTIFACT_NOT_FOUND'
        : 'BLURRY_DOWNLOAD_FAILED';
    const message = isExpired
      ? 'O arquivo anonimizado expirou e não está mais disponível.'
      : isNotFound
        ? 'O arquivo anonimizado não foi encontrado.'
        : 'Não foi possível baixar o output anonimizado.';
    return res.status(httpStatus).json({ ok: false, jobId, status: 'failed', errorCode, message });
  }
});

router.get('/prepared-download/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const prepared = preparedDownloads.get(requestId);

  if (!prepared) {
    return res.status(404).json({ message: 'Arquivo anonimizado não está mais disponível.' });
  }
  if (prepared.expiresAt <= Date.now()) {
    preparedDownloads.delete(requestId);
    return res.status(404).json({ message: 'Arquivo anonimizado não está mais disponível.' });
  }
  if (prepared.userId !== req.user?.id) {
    return res.status(404).json({ message: 'Arquivo anonimizado não está mais disponível.' });
  }

  try {
    const sanitized = await blurryClient.downloadSanitizedDocument(undefined, {
      requestId,
      downloadUrl: prepared.sanitizedPdfUrl,
    });

    res.setHeader('Content-Type', sanitized.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${prepared.sanitizedFileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(sanitized.buffer);
  } catch (error) {
    logger.error('[prepared-download] Failed to download sanitized file', {
      requestId,
      errorCode: error.code,
      status: 'failed',
    });
    return res.status(502).json({ message: 'Não foi possível baixar o arquivo anonimizado.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const appConfig = req.config;
    const files = await getFiles({ user: req.user.id });
    if (appConfig.fileStrategy === FileSources.s3) {
      try {
        const cache = getLogStores(CacheKeys.S3_EXPIRY_INTERVAL);
        const alreadyChecked = await cache.get(req.user.id);
        if (!alreadyChecked) {
          await refreshS3FileUrls(files, batchUpdateFiles);
          await cache.set(req.user.id, true, Time.THIRTY_MINUTES);
        }
      } catch (error) {
        logger.warn('[/files] Error refreshing S3 file URLs:', error);
      }
    }
    res.status(200).send(files);
  } catch (error) {
    logger.error('[/files] Error getting files:', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

/**
 * Get files specific to an agent
 * @route GET /files/agent/:agent_id
 * @param {string} agent_id - The agent ID to get files for
 * @returns {Promise<TFile[]>} Array of files attached to the agent
 */
router.get('/agent/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;
    const userId = req.user.id;

    if (!agent_id) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    const agent = await getAgent({ id: agent_id });
    if (!agent) {
      return res.status(200).json([]);
    }

    if (agent.author.toString() !== userId) {
      const hasEditPermission = await checkPermission({
        userId,
        role: req.user.role,
        resourceType: ResourceType.AGENT,
        resourceId: agent._id,
        requiredPermission: PermissionBits.EDIT,
      });

      if (!hasEditPermission) {
        return res.status(200).json([]);
      }
    }

    const agentFileIds = [];
    if (agent.tool_resources) {
      for (const [, resource] of Object.entries(agent.tool_resources)) {
        if (resource?.file_ids && Array.isArray(resource.file_ids)) {
          agentFileIds.push(...resource.file_ids);
        }
      }
    }

    if (agentFileIds.length === 0) {
      return res.status(200).json([]);
    }

    const files = await getFiles({ file_id: { $in: agentFileIds } }, null, { text: 0 });

    res.status(200).json(files);
  } catch (error) {
    logger.error('[/files/agent/:agent_id] Error fetching agent files:', error);
    res.status(500).json({ error: 'Failed to fetch agent files' });
  }
});

router.get('/config', async (req, res) => {
  try {
    const appConfig = req.config;
    res.status(200).json(appConfig.fileConfig);
  } catch (error) {
    logger.error('[/files] Error getting fileConfig', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { files: _files } = req.body;

    /** @type {MongoFile[]} */
    const files = _files.filter((file) => {
      if (!file.file_id) {
        return false;
      }
      if (!file.filepath) {
        return false;
      }

      if (/^(file|assistant)-/.test(file.file_id)) {
        return true;
      }

      return isUUID.safeParse(file.file_id).success;
    });

    if (files.length === 0) {
      res.status(204).json({ message: 'Nothing provided to delete' });
      return;
    }

    const fileIds = files.map((file) => file.file_id);
    const dbFiles = await getFiles({ file_id: { $in: fileIds } });

    const ownedFiles = [];
    const nonOwnedFiles = [];

    for (const file of dbFiles) {
      if (file.user.toString() === req.user.id.toString()) {
        ownedFiles.push(file);
      } else {
        nonOwnedFiles.push(file);
      }
    }

    if (nonOwnedFiles.length === 0) {
      await processDeleteRequest({ req, files: ownedFiles });
      logger.debug(
        `[/files] Files deleted successfully: ${ownedFiles
          .filter((f) => f.file_id)
          .map((f) => f.file_id)
          .join(', ')}`,
      );
      res.status(200).json({ message: 'Files deleted successfully' });
      return;
    }

    let authorizedFiles = [...ownedFiles];
    let unauthorizedFiles = [];

    if (req.body.agent_id && nonOwnedFiles.length > 0) {
      const nonOwnedFileIds = nonOwnedFiles.map((f) => f.file_id);
      const accessMap = await hasAccessToFilesViaAgent({
        userId: req.user.id,
        role: req.user.role,
        fileIds: nonOwnedFileIds,
        agentId: req.body.agent_id,
        isDelete: true,
      });

      for (const file of nonOwnedFiles) {
        if (accessMap.get(file.file_id)) {
          authorizedFiles.push(file);
        } else {
          unauthorizedFiles.push(file);
        }
      }
    } else {
      unauthorizedFiles = nonOwnedFiles;
    }

    if (unauthorizedFiles.length > 0) {
      return res.status(403).json({
        message: 'You can only delete files you have access to',
        unauthorizedFiles: unauthorizedFiles.map((f) => f.file_id),
      });
    }

    /* Handle agent unlinking even if no valid files to delete */
    if (req.body.agent_id && req.body.tool_resource && dbFiles.length === 0) {
      const agent = await getAgent({
        id: req.body.agent_id,
      });

      const toolResourceFiles = agent.tool_resources?.[req.body.tool_resource]?.file_ids ?? [];
      const agentFiles = files.filter((f) => toolResourceFiles.includes(f.file_id));

      await processDeleteRequest({ req, files: agentFiles });
      res.status(200).json({ message: 'File associations removed successfully from agent' });
      return;
    }

    /* Handle assistant unlinking even if no valid files to delete */
    if (req.body.assistant_id && req.body.tool_resource && dbFiles.length === 0) {
      const assistant = await getAssistant({
        id: req.body.assistant_id,
      });

      const toolResourceFiles = assistant.tool_resources?.[req.body.tool_resource]?.file_ids ?? [];
      const assistantFiles = files.filter((f) => toolResourceFiles.includes(f.file_id));

      await processDeleteRequest({ req, files: assistantFiles });
      res.status(200).json({ message: 'File associations removed successfully from assistant' });
      return;
    } else if (
      req.body.assistant_id &&
      req.body.files?.[0]?.filepath === EModelEndpoint.azureAssistants
    ) {
      await processDeleteRequest({ req, files: req.body.files });
      return res
        .status(200)
        .json({ message: 'File associations removed successfully from Azure Assistant' });
    }

    await processDeleteRequest({ req, files: authorizedFiles });

    logger.debug(
      `[/files] Files deleted successfully: ${authorizedFiles
        .filter((f) => f.file_id)
        .map((f) => f.file_id)
        .join(', ')}`,
    );
    res.status(200).json({ message: 'Files deleted successfully' });
  } catch (error) {
    logger.error('[/files] Error deleting files:', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

function isValidID(str) {
  return /^[A-Za-z0-9_-]{21}$/.test(str);
}

router.get('/code/download/:session_id/:fileId', async (req, res) => {
  try {
    const { session_id, fileId } = req.params;
    const logPrefix = `Session ID: ${session_id} | File ID: ${fileId} | Code output download requested by user `;
    logger.debug(logPrefix);

    if (!session_id || !fileId) {
      return res.status(400).send('Bad request');
    }

    if (!isValidID(session_id) || !isValidID(fileId)) {
      logger.debug(`${logPrefix} invalid session_id or fileId`);
      return res.status(400).send('Bad request');
    }

    const { getDownloadStream } = getStrategyFunctions(FileSources.execute_code);
    if (!getDownloadStream) {
      logger.warn(
        `${logPrefix} has no stream method implemented for ${FileSources.execute_code} source`,
      );
      return res.status(501).send('Not Implemented');
    }

    const result = await loadAuthValues({ userId: req.user.id, authFields: [EnvVar.CODE_API_KEY] });

    /** @type {AxiosResponse<ReadableStream> | undefined} */
    const response = await getDownloadStream(
      `${session_id}/${fileId}`,
      result[EnvVar.CODE_API_KEY],
    );
    res.set(response.headers);
    response.data.pipe(res);
  } catch (error) {
    logger.error('Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});

router.get('/download/:userId/:file_id', fileAccess, async (req, res) => {
  try {
    const { userId, file_id } = req.params;
    logger.debug(`File download requested by user ${userId}: ${file_id}`);

    // Access already validated by fileAccess middleware
    const file = req.fileAccess.file;

    if (checkOpenAIStorage(file.source) && !file.model) {
      logger.warn(`File download requested by user ${userId} has no associated model: ${file_id}`);
      return res.status(400).send('The model used when creating this file is not available');
    }

    const { getDownloadStream } = getStrategyFunctions(file.source);
    if (!getDownloadStream) {
      logger.warn(
        `File download requested by user ${userId} has no stream method implemented: ${file.source}`,
      );
      return res.status(501).send('Not Implemented');
    }

    const setHeaders = () => {
      const cleanedFilename = cleanFileName(file.filename);
      res.setHeader('Content-Disposition', `attachment; filename="${cleanedFilename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-File-Metadata', JSON.stringify(file));
    };

    if (checkOpenAIStorage(file.source)) {
      req.body = { model: file.model };
      const endpointMap = {
        [FileSources.openai]: EModelEndpoint.assistants,
        [FileSources.azure]: EModelEndpoint.azureAssistants,
      };
      const { openai } = await getOpenAIClient({
        req,
        res,
        overrideEndpoint: endpointMap[file.source],
      });
      logger.debug(`Downloading file ${file_id} from OpenAI`);
      const passThrough = await getDownloadStream(file_id, openai);
      setHeaders();
      logger.debug(`File ${file_id} downloaded from OpenAI`);

      // Handle both Node.js and Web streams
      const stream =
        passThrough.body && typeof passThrough.body.getReader === 'function'
          ? Readable.fromWeb(passThrough.body)
          : passThrough.body;

      stream.pipe(res);
    } else {
      const fileStream = await getDownloadStream(req, file.filepath);

      fileStream.on('error', (streamError) => {
        logger.error('[DOWNLOAD ROUTE] Stream error:', streamError);
      });

      setHeaders();
      fileStream.pipe(res);
    }
  } catch (error) {
    logger.error('[DOWNLOAD ROUTE] Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});

router.post('/', async (req, res) => {
  const metadata = req.body;
  let cleanup = true;

  try {
    filterFile({ req });

    metadata.temp_file_id = metadata.file_id;
    metadata.file_id = req.file_id;

    if (isAssistantsEndpoint(metadata.endpoint)) {
      return await processFileUpload({ req, res, metadata });
    }

    return await processAgentFileUpload({ req, res, metadata });
  } catch (error) {
    let message = 'Error processing file';
    logger.error('[/files] Error processing file:', error);

    if (error.message?.includes('file_ids')) {
      message += ': ' + error.message;
    }

    if (
      error.message?.includes('Invalid file format') ||
      error.message?.includes('No OCR result') ||
      error.message?.includes('exceeds token limit') ||
      error.message?.includes('PDF sem texto selecionável') ||
      error.message?.includes('Falha na anonimização')
    ) {
      message = error.message;
    }

    try {
      await fs.unlink(req.file.path);
      cleanup = false;
    } catch (error) {
      logger.error('[/files] Error deleting file:', error);
    }
    res.status(500).json({ message });
  } finally {
    if (cleanup) {
      try {
        await fs.unlink(req.file.path);
      } catch (error) {
        logger.error('[/files] Error deleting file after file processing:', error);
      }
    } else {
      logger.debug('[/files] File processing completed without cleanup');
    }
  }
});

module.exports = router;
