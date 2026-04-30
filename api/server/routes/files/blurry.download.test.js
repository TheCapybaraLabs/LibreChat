/**
 * Blurry download route — 10 required scenarios
 *
 * Covers: PDF binary download, TXT JSON download, Content-Type/Content-Disposition
 * headers, ARTIFACT_NOT_FOUND, ARTIFACT_EXPIRED, ARTIFACT_NOT_FOUND (from Blurry 404),
 * BLURRY_DOWNLOAD_FAILED, no JSON parse of PDF, empty buffer handling.
 */

// ─── Module mocks (must be before any require) ───────────────────────────────

jest.mock('~/server/utils/blurryClient');

jest.mock('~/server/services/Files/process', () => ({
  processDeleteRequest: jest.fn().mockResolvedValue({}),
  filterFile: jest.fn(),
  processFileUpload: jest.fn(),
  processAgentFileUpload: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({})),
}));

jest.mock('~/server/controllers/assistants/helpers', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('~/server/services/Tools/credentials', () => ({
  loadAuthValues: jest.fn(),
}));

jest.mock('~/server/services/Files/S3/crud', () => ({
  refreshS3FileUrls: jest.fn(),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => ({ get: jest.fn(), set: jest.fn() })),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
  createMethods: jest.fn(() => ({})),
}));

jest.mock('@librechat/agents', () => ({
  EnvVar: { CODE_API_KEY: 'CODE_API_KEY' },
}));

jest.mock('librechat-data-provider', () => ({
  Time: { ONE_HOUR: 3600000 },
  isUUID: jest.fn(() => true),
  CacheKeys: {},
  FileSources: {},
  ResourceType: {},
  EModelEndpoint: {},
  PermissionBits: {},
  checkOpenAIStorage: jest.fn(() => false),
  isAssistantsEndpoint: jest.fn(() => false),
}));

jest.mock('~/models/File', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
  batchUpdateFiles: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/models/Assistant', () => ({
  getAssistant: jest.fn(),
}));

jest.mock('~/models/Agent', () => ({
  getAgent: jest.fn(),
}));

jest.mock('~/server/middleware/accessResources/fileAccess', () => ({
  fileAccess: jest.fn((req, res, next) => next()),
}));

jest.mock('~/server/services/PermissionService', () => ({
  checkPermission: jest.fn((req, res, next) => next()),
}));

jest.mock('~/server/services/Files', () => ({
  hasAccessToFilesViaAgent: jest.fn(),
}));

jest.mock('~/server/utils/files', () => ({
  cleanFileName: jest.fn((name) => name || 'documento.pdf'),
}));

// ─── Test setup ──────────────────────────────────────────────────────────────

const express = require('express');
const request = require('supertest');

const blurryClient = require('~/server/utils/blurryClient');

const TEST_USER_ID = 'user-download-test-001';

function createApp() {
  const app = express();
  app.use(express.json());
  // Inject user + fake file for POST /prepare-file
  app.use((req, res, next) => {
    req.user = { id: TEST_USER_ID };
    if (req.method === 'POST' && req.url === '/prepare-file') {
      req.file = {
        originalname: 'relatorio.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        path: '/tmp/blurry-test-upload.pdf',
      };
    }
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use('/', require('./files'));
  return app;
}

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Helper: register a job via POST /prepare-file ───────────────────────────

let jobCounter = 0;

async function registerJob(overrides = {}) {
  jobCounter += 1;
  const jobId = overrides.jobId ?? `job-dl-${jobCounter}`;
  blurryClient.uploadDocument.mockResolvedValueOnce({
    jobId,
    requestId: `req-${jobId}`,
    status: 'queued',
  });

  const res = await request(app).post('/prepare-file');
  expect(res.status).toBe(202);
  expect(res.body.jobId).toBe(jobId);
  return jobId;
}

// Helper: build an axios-style error with a response status
const axiosError = (status) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { message: `HTTP ${status}` } };
  return err;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. PDF download — Content-Type correto (application/pdf)
// ─────────────────────────────────────────────────────────────────────────────
describe('1. PDF download — Content-Type application/pdf', () => {
  it('retorna body binário com Content-Type: application/pdf', async () => {
    const jobId = await registerJob();
    const pdfBuffer = Buffer.from('%PDF-1.4 fake content');

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      bytes: pdfBuffer.length,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body).toBeInstanceOf(Buffer);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PDF download — Content-Disposition com filename sanitizado
// ─────────────────────────────────────────────────────────────────────────────
describe('2. PDF download — Content-Disposition: attachment com filename anonimizado', () => {
  it('inclui Content-Disposition: attachment e filename termina em .anonimizado.pdf', async () => {
    const jobId = await registerJob();
    const pdfBuffer = Buffer.from('%PDF-1.4');

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      bytes: pdfBuffer.length,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);

    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'] || '';
    expect(disposition).toMatch(/^attachment/);
    expect(disposition).toMatch(/\.anonimizado\.pdf/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TXT download — retorna JSON {ok, text}
// ─────────────────────────────────────────────────────────────────────────────
describe('3. TXT download — JSON {ok: true, text: string}', () => {
  it('retorna JSON com ok=true e campo text não vazio', async () => {
    const jobId = await registerJob();

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      text: 'Conteúdo anonimizado do documento.',
      contentType: 'text/plain',
      bytes: 34,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=text`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.text).toBe('string');
    expect(res.body.text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TXT preview — campo text é string legível
// ─────────────────────────────────────────────────────────────────────────────
describe('4. TXT preview — text é string, não Buffer', () => {
  it('text no JSON é string primitiva, não objeto Buffer', async () => {
    const jobId = await registerJob();

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      text: 'Nome: [PESSOA]. CPF: [CPF].',
      contentType: 'text/plain',
      bytes: 26,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=text`);

    expect(res.status).toBe(200);
    // text deve ser uma string, jamais um Buffer ou objeto binário
    expect(typeof res.body.text).toBe('string');
    expect(res.body.text).not.toBeInstanceOf(Buffer);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PDF não é parsado como JSON — body não tem .ok nem .text
// ─────────────────────────────────────────────────────────────────────────────
describe('5. PDF não é parsado como JSON', () => {
  it('resposta de PDF não tem campos ok/text (não é JSON)', async () => {
    const jobId = await registerJob();
    const pdfBuffer = Buffer.from('%PDF-1.4 binary content');

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      bytes: pdfBuffer.length,
    });

    const res = await request(app)
      .get(`/prepare-file/jobs/${jobId}/download?type=pdf`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // supertest parseia como Buffer para content-type binário — não como JSON
    expect(res.body).toBeInstanceOf(Buffer);
    // Se fosse JSON parseado, teria campo 'ok'
    expect(typeof res.body.ok).toBe('undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Job não encontrado → 404 ARTIFACT_NOT_FOUND
// ─────────────────────────────────────────────────────────────────────────────
describe('6. Job não encontrado → 404 ARTIFACT_NOT_FOUND', () => {
  it('retorna 404 com errorCode ARTIFACT_NOT_FOUND quando jobId não existe', async () => {
    const res = await request(app).get('/prepare-file/jobs/nonexistent-job-xyz/download?type=pdf');

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('ARTIFACT_NOT_FOUND');
    expect(res.body.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Blurry retorna 410 → 410 ARTIFACT_EXPIRED
// ─────────────────────────────────────────────────────────────────────────────
describe('7. Blurry retorna 410 → 410 ARTIFACT_EXPIRED', () => {
  it('propaga 410 e errorCode ARTIFACT_EXPIRED quando Blurry diz que artifact expirou', async () => {
    const jobId = await registerJob();

    blurryClient.downloadDocumentOutput.mockRejectedValueOnce(axiosError(410));

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);

    expect(res.status).toBe(410);
    expect(res.body.errorCode).toBe('ARTIFACT_EXPIRED');
    expect(res.body.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Blurry retorna 404 → 404 ARTIFACT_NOT_FOUND
// ─────────────────────────────────────────────────────────────────────────────
describe('8. Blurry retorna 404 → 404 ARTIFACT_NOT_FOUND', () => {
  it('propaga 404 e errorCode ARTIFACT_NOT_FOUND quando Blurry não encontra o artifact', async () => {
    const jobId = await registerJob();

    blurryClient.downloadDocumentOutput.mockRejectedValueOnce(axiosError(404));

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('ARTIFACT_NOT_FOUND');
    expect(res.body.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Erro genérico do Blurry → 502 BLURRY_DOWNLOAD_FAILED
// ─────────────────────────────────────────────────────────────────────────────
describe('9. Erro genérico do Blurry → 502 BLURRY_DOWNLOAD_FAILED', () => {
  it('retorna 502 com BLURRY_DOWNLOAD_FAILED para erros não mapeados', async () => {
    const jobId = await registerJob();

    blurryClient.downloadDocumentOutput.mockRejectedValueOnce(new Error('ECONNRESET'));

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('BLURRY_DOWNLOAD_FAILED');
    expect(res.body.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. PDF download usa arraybuffer — blurryClient chamado com type='pdf'
// ─────────────────────────────────────────────────────────────────────────────
describe('10. blurryClient.downloadDocumentOutput chamado com type=pdf (arraybuffer)', () => {
  it('chama downloadDocumentOutput com type="pdf" e nunca interpreta o buffer como JSON', async () => {
    const jobId = await registerJob();
    const pdfBuffer = Buffer.from('%PDF-1.4 valid binary');

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      bytes: pdfBuffer.length,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);

    expect(res.status).toBe(200);

    // Verify the client was called with type='pdf'
    expect(blurryClient.downloadDocumentOutput).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ type: 'pdf' }),
    );

    // Response is binary — supertest parses it as a Buffer, not a JS object
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // Buffer body means it was never JSON-parsed
    expect(res.body).toBeInstanceOf(Buffer);
  });
});
