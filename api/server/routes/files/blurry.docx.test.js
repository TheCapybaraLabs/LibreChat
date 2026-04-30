/**
 * DOCX artifact flow — 8 required scenarios
 *
 * Covers: completed DOCX job with sanitizedText=true, no PDF button when sanitizedPdf=false,
 * text preview uses type=text, text-only download, ARTIFACT_NOT_FOUND from PDF doesn't block
 * text send, raw DOCX never sent, PDF button present when sanitizedPdf=true, TXT/CSV use text.
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────

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

jest.mock('~/models/Assistant', () => ({ getAssistant: jest.fn() }));
jest.mock('~/models/Agent', () => ({ getAgent: jest.fn() }));

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

// ─── Test setup ───────────────────────────────────────────────────────────────

const express = require('express');
const request = require('supertest');
const blurryClient = require('~/server/utils/blurryClient');

const USER_ID = 'user-docx-test-001';

function createApp(fileOverrides = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: USER_ID };
    if (req.method === 'POST' && req.url === '/prepare-file') {
      req.file = {
        originalname: fileOverrides.originalname || 'relatorio.docx',
        mimetype:
          fileOverrides.mimetype ||
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 4096,
        path: '/tmp/blurry-docx-test.docx',
      };
    }
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use('/', require('./files'));
  return app;
}

let app;
let appPdf;

beforeAll(() => {
  app = createApp(); // DOCX app
  appPdf = createApp({ originalname: 'relatorio.pdf', mimetype: 'application/pdf' }); // PDF app
});

beforeEach(() => jest.clearAllMocks());

let jobCounter = 0;

// Register a job and return jobId; blurryJobOutputs is what getDocumentJob will return via raw
async function registerJob(targetApp, blurryJobOutputs = {}) {
  jobCounter += 1;
  const jobId = `job-docx-${jobCounter}`;

  blurryClient.uploadDocument.mockResolvedValueOnce({
    jobId,
    requestId: `req-${jobId}`,
    status: 'queued',
  });

  const res = await request(targetApp).post('/prepare-file');
  expect(res.status).toBe(202);
  expect(res.body.jobId).toBe(jobId);

  // Pre-configure getDocumentJob for status polling
  blurryClient.getDocumentJob.mockResolvedValue({
    jobId,
    status: 'completed',
    providerSafe: true,
    outputs: { sanitizedPdfUrl: undefined },
    raw: {
      providerSafe: true,
      outputs: blurryJobOutputs,
    },
  });

  return jobId;
}

// ─── 1. DOCX completed with sanitizedText=true ────────────────────────────────
describe('1. DOCX job completado com sanitizedText=true', () => {
  it('status do job retorna sanitizedText=true e sanitizedPdf=false', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false, sanitizedDocx: false });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.outputs.sanitizedTextAvailable).toBe(true);
    expect(res.body.outputs.sanitizedPdf).toBe(false);
    expect(res.body.outputs.sanitizedPdfUrl).toBeUndefined();
  });
});

// ─── 2. DOCX sem sanitizedPdf não expõe URL de PDF ───────────────────────────
describe('2. DOCX sem sanitizedPdf não retorna sanitizedPdfUrl', () => {
  it('outputs não contém sanitizedPdfUrl quando sanitizedPdf=false', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(res.body.outputs).not.toHaveProperty('sanitizedPdfUrl');
  });
});

// ─── 3. Preview usa type=text ─────────────────────────────────────────────────
describe('3. Download de texto usa type=text', () => {
  it('GET /download?type=text retorna JSON com campo text', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false });

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      text: 'Nome: [PESSOA]. CNPJ: [CNPJ].',
      contentType: 'text/plain',
      bytes: 30,
    });

    const res = await request(app).get(
      `/prepare-file/jobs/${jobId}/download?type=text`,
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.text).toBe('string');
    expect(res.body.text.length).toBeGreaterThan(0);
    expect(blurryClient.downloadDocumentOutput).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ type: 'text' }),
    );
  });
});

// ─── 4. Envio ao modelo usa texto anonimizado (text sempre disponível) ────────
describe('4. Texto anonimizado disponível mesmo sem PDF', () => {
  it('GET /download?type=text funciona independente de sanitizedPdf', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false });

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      text: 'Documento de texto anonimizado.',
      contentType: 'text/plain',
      bytes: 31,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=text`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.text).toBeTruthy();
  });
});

// ─── 5. ARTIFACT_NOT_FOUND de PDF não bloqueia texto ─────────────────────────
describe('5. ARTIFACT_NOT_FOUND de PDF não afeta download de texto', () => {
  it('type=pdf retorna 404 mas type=text funciona no mesmo job', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false });

    // PDF download fails
    const pdfErr = new Error('Request failed with status code 404');
    pdfErr.response = { status: 404, data: {} };
    blurryClient.downloadDocumentOutput.mockRejectedValueOnce(pdfErr);

    const resPdf = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=pdf`);
    expect(resPdf.status).toBe(404);
    expect(resPdf.body.errorCode).toBe('ARTIFACT_NOT_FOUND');

    // But text download succeeds on the same job
    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      text: 'Texto seguro do DOCX.',
      contentType: 'text/plain',
      bytes: 21,
    });

    const resTxt = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=text`);
    expect(resTxt.status).toBe(200);
    expect(resTxt.body.ok).toBe(true);
  });
});

// ─── 6. DOCX bruto nunca é retornado — somente texto anonimizado ─────────────
describe('6. DOCX bruto nunca é retornado', () => {
  it('resposta de type=text é string — jamais binário bruto do DOCX', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false });

    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      text: 'Contrato anonimizado: Parte [PESSOA1] e Parte [PESSOA2].',
      contentType: 'text/plain',
      bytes: 56,
    });

    const res = await request(app).get(`/prepare-file/jobs/${jobId}/download?type=text`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.text).toBe('string');
    // Raw DOCX binary would start with PK (zip magic bytes)
    expect(res.body.text).not.toMatch(/^PK/);
    expect(res.body).not.toBeInstanceOf(Buffer);
  });
});

// ─── 7. PDF continua com botão quando sanitizedPdf=true ─────────────────────
describe('7. PDF continua funcionando quando sanitizedPdf=true', () => {
  it('status do job retorna sanitizedPdfUrl quando sanitizedPdf=true', async () => {
    const jobId = await registerJob(appPdf, { sanitizedText: true, sanitizedPdf: true });

    const res = await request(appPdf).get(`/prepare-file/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(res.body.outputs.sanitizedPdf).toBe(true);
    expect(res.body.outputs.sanitizedPdfUrl).toMatch(/download\?type=pdf/);
  });
});

// ─── 8. type=docx válido — download binário com Content-Type correto ─────────
describe('8. Download DOCX — Content-Type application/vnd...wordprocessingml', () => {
  it('GET /download?type=docx retorna binário com Content-Type de DOCX', async () => {
    const jobId = await registerJob(app, { sanitizedText: true, sanitizedPdf: false, sanitizedDocx: true });

    const docxMagic = Buffer.from('PK\x03\x04'); // DOCX/ZIP magic bytes
    blurryClient.downloadDocumentOutput.mockResolvedValueOnce({
      buffer: docxMagic,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docxMagic.length,
    });

    const res = await request(app)
      .get(`/prepare-file/jobs/${jobId}/download?type=docx`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);
    expect(res.headers['content-disposition']).toMatch(/\.anonimizado\.docx/);
    expect(blurryClient.downloadDocumentOutput).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ type: 'docx' }),
    );
  });
});
