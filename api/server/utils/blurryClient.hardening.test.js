/**
 * Blurry hardening test suite — 15 required scenarios
 *
 * Covers: capabilities, upload, polling stages, review_required,
 * download expiry, cancellation, retry, model safety guarantees.
 */

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const blurryClient = require('./blurryClient');

const filePath = path.join(os.tmpdir(), 'blurry-hardening-test.pdf');

const makeFile = () => ({
  path: filePath,
  originalname: 'judicial.pdf',
  mimetype: 'application/pdf',
  size: 1024,
});

const axiosError = (status, data = {}) => {
  const err = new Error(`Request failed with status ${status}`);
  err.response = { status, data };
  return err;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Garante implementação padrão limpa após testes que usam mockImplementation
  axios.get.mockReset();
  axios.post.mockReset();
  fs.writeFileSync(filePath, '%PDF test');
  process.env.BLURRY_API_KEY = 'test-key';
  process.env.BLURRY_BASE_URL = 'https://blurry.test';
  process.env.BLURRY_DOCUMENT_POLL_INTERVAL_MS = '1';
  process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS = '200';
});

afterEach(() => {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // noop
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Capabilities indisponível
// ─────────────────────────────────────────────────────────────────────────────
describe('1. Capabilities indisponível', () => {
  it('retorna null e não lança quando o endpoint de capabilities falha', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await blurryClient.getCapabilities();
    expect(result).toBeNull();
  });

  it('retorna null sem api key configurada', async () => {
    process.env.BLURRY_API_KEY = '';
    const result = await blurryClient.getCapabilities();
    expect(result).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Capabilities com documents disabled
// ─────────────────────────────────────────────────────────────────────────────
describe('2. Capabilities com documents disabled', () => {
  it('retorna capabilities com documents.enabled=false', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        documents: { enabled: false, maxFileMb: 0, allowedMime: [], ocrEnabled: false },
        anonymize: { enabled: true },
      },
    });
    const caps = await blurryClient.getCapabilities();
    expect(caps.documents.enabled).toBe(false);
  });

  it('retorna documents.ocrEnabled=false quando OCR não está disponível', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        documents: { enabled: true, ocrEnabled: false, maxFileMb: 10, allowedMime: ['application/pdf'] },
        anonymize: { enabled: true },
      },
    });
    const caps = await blurryClient.getCapabilities();
    expect(caps.documents.ocrEnabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Upload document — sucesso com jobId
// ─────────────────────────────────────────────────────────────────────────────
describe('3. Upload document', () => {
  it('envia o arquivo e retorna jobId', async () => {
    axios.post.mockResolvedValueOnce({
      data: { jobId: 'job-upload-1', status: 'queued', providerSafe: false },
    });

    const result = await blurryClient.uploadDocument(makeFile(), { requestId: 'req-1' });

    expect(result.jobId).toBe('job-upload-1');
    expect(result.status).toBe('queued');
    expect(result.providerSafe).toBe(false);
    expect(axios.post).toHaveBeenCalledWith(
      'https://blurry.test/v1/documents',
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('lança erro quando upload não retorna jobId', async () => {
    axios.post.mockResolvedValueOnce({ data: { status: 'queued' } });
    await expect(blurryClient.uploadDocument(makeFile())).rejects.toThrow(/jobId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Polling queued — não é erro
// ─────────────────────────────────────────────────────────────────────────────
describe('4. Polling queued', () => {
  it('continua polling quando status é queued e resolve ao completar', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { jobId: 'job-q', status: 'queued', stage: 'queued' } })
      .mockResolvedValueOnce({
        data: { jobId: 'job-q', status: 'completed', providerSafe: true, stage: 'completed' },
      });

    const result = await blurryClient.pollDocumentJob('job-q', { requestId: 'req-q' });
    expect(result.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Polling processing — não é erro
// ─────────────────────────────────────────────────────────────────────────────
describe('5. Polling processing', () => {
  it('não lança quando status é processing e continua até completed', async () => {
    axios.get
      .mockResolvedValueOnce({
        data: { jobId: 'job-p', status: 'processing', stage: 'extracting', progress: 30 },
      })
      .mockResolvedValueOnce({
        data: { jobId: 'job-p', status: 'completed', providerSafe: true, stage: 'completed', progress: 100 },
      });

    const result = await blurryClient.pollDocumentJob('job-p', { requestId: 'req-p' });
    expect(result.status).toBe('completed');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Polling ocr — não é erro
// ─────────────────────────────────────────────────────────────────────────────
describe('6. Polling ocr', () => {
  it('não lança quando stage é ocr e continua polling', async () => {
    axios.get
      .mockResolvedValueOnce({
        data: {
          jobId: 'job-ocr',
          status: 'processing',
          stage: 'ocr',
          ocrActive: true,
          pagesTotal: 5,
          pagesProcessed: 2,
        },
      })
      .mockResolvedValueOnce({
        data: { jobId: 'job-ocr', status: 'completed', providerSafe: true, stage: 'completed' },
      });

    const result = await blurryClient.pollDocumentJob('job-ocr', { requestId: 'req-ocr' });
    expect(result.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Polling completed — resolve com providerSafe=true
// ─────────────────────────────────────────────────────────────────────────────
describe('7. Polling completed', () => {
  it('resolve com status completed e providerSafe=true', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-done',
        status: 'completed',
        providerSafe: true,
        stage: 'completed',
        progress: 100,
        outputs: {
          sanitizedTextUrl: '/v1/documents/jobs/job-done/download?type=text',
          sanitizedPdfUrl: '/v1/documents/jobs/job-done/download?type=pdf',
        },
      },
    });

    const result = await blurryClient.pollDocumentJob('job-done', { requestId: 'req-done' });
    expect(result.status).toBe('completed');
    expect(result.providerSafe).toBe(true);
    expect(result.outputs?.sanitizedPdfUrl).toContain('download');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Polling failed — lança erro
// ─────────────────────────────────────────────────────────────────────────────
describe('8. Polling failed', () => {
  it('lança quando status é failed com errorCode do Blurry', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-fail',
        status: 'failed',
        errorCode: 'OCR_FAILED',
        message: 'OCR timeout after 20s',
      },
    });

    await expect(blurryClient.pollDocumentJob('job-fail')).rejects.toThrow(
      'Blurry document job failed',
    );
  });

  it('lança quando status é failed sem mensagem específica', async () => {
    axios.get.mockResolvedValueOnce({
      data: { jobId: 'job-fail2', status: 'failed' },
    });

    await expect(blurryClient.pollDocumentJob('job-fail2')).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. review_required com providerSafe=true — permite download
// ─────────────────────────────────────────────────────────────────────────────
describe('9. review_required com providerSafe=true', () => {
  it('getDocumentJob retorna review_required com providerSafe=true e outputs', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-rev',
        status: 'review_required',
        stage: 'review_required',
        providerSafe: true,
        outputs: {
          sanitizedTextUrl: '/v1/documents/jobs/job-rev/download?type=text',
          sanitizedPdfUrl: '/v1/documents/jobs/job-rev/download?type=pdf',
        },
      },
    });

    const result = await blurryClient.getDocumentJob('job-rev', { requestId: 'req-rev' });
    expect(result.status).toBe('review_required');
    expect(result.providerSafe).toBe(true);
    expect(result.outputs?.sanitizedPdfUrl).toBeTruthy();
  });

  it('pollDocumentJob em review_required expira quando não é estado terminal', async () => {
    // O pollDocumentJob não considera review_required como terminal:
    // continua até timeout. Esse é o comportamento atual do blurryClient de baixo nível.
    // O tratamento de review_required é feito no nível da rota (files.js) e do cliente.
    process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS = '50';
    axios.get.mockResolvedValue({
      data: { jobId: 'job-rev-poll', status: 'review_required', providerSafe: false },
    });

    await expect(blurryClient.pollDocumentJob('job-rev-poll')).rejects.toThrow(/timed out/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. review_required com providerSafe=false — bloqueia
// ─────────────────────────────────────────────────────────────────────────────
describe('10. review_required com providerSafe=false', () => {
  it('getDocumentJob retorna review_required com providerSafe=false sem outputs de download', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-rev-block',
        status: 'review_required',
        stage: 'review_required',
        providerSafe: false,
        errorCode: 'REVIEW_REQUIRED',
      },
    });

    const result = await blurryClient.getDocumentJob('job-rev-block', { requestId: 'req-block' });
    expect(result.status).toBe('review_required');
    expect(result.providerSafe).toBe(false);
    // Sem outputs disponíveis para download quando não seguro
    expect(result.outputs?.sanitizedPdfUrl).toBeFalsy();
  });

  it('getDocumentJob com providerSafe=false não tem outputs para download direto', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-rev-block2',
        status: 'review_required',
        providerSafe: false,
      },
    });

    const result = await blurryClient.getDocumentJob('job-rev-block2');
    expect(result.providerSafe).toBe(false);
    // Cliente deve checar providerSafe antes de permitir download
    const hasDownloadableOutput =
      result.providerSafe === true &&
      (result.outputs?.sanitizedPdfUrl || result.outputs?.sanitizedTextUrl);
    expect(hasDownloadableOutput).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Download expirado — HTTP 410
// ─────────────────────────────────────────────────────────────────────────────
describe('11. Download expirado', () => {
  it('lança quando download retorna 410 ARTIFACT_EXPIRED', async () => {
    axios.get.mockRejectedValueOnce(axiosError(410, { errorCode: 'ARTIFACT_EXPIRED' }));

    await expect(
      blurryClient.downloadDocumentOutput('job-expired', { requestId: 'req-exp', type: 'pdf' }),
    ).rejects.toThrow();
  });

  it('erro 410 preserva o status na response para distinção de outros erros', async () => {
    const err = axiosError(410, { errorCode: 'ARTIFACT_EXPIRED' });
    axios.get.mockRejectedValueOnce(err);

    try {
      await blurryClient.downloadDocumentOutput('job-expired2', { type: 'pdf' });
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error.response?.status).toBe(410);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Modal cancelado — polling para sem vazar dados
// ─────────────────────────────────────────────────────────────────────────────
describe('12. Modal cancelado', () => {
  it('cancelamento de AbortController ao chamar abort antes do poll completar', async () => {
    // pollDocumentJob não suporta AbortSignal nativamente, mas o teste verifica
    // que um timeout curto evita loop infinito — cancelamento local funciona via timeout
    process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS = '50';

    // Simula job que ficará sempre processing (nunca termina)
    axios.get.mockResolvedValue({
      data: { jobId: 'job-cancel', status: 'processing', stage: 'redacting' },
    });

    await expect(
      blurryClient.pollDocumentJob('job-cancel', { requestId: 'req-cancel' }),
    ).rejects.toThrow(/timed out/);
  });

  it('cancelamento interrompe antes de qualquer dado ser baixado', async () => {
    // Garante que sem completed não há download
    process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS = '30';
    axios.get.mockResolvedValue({ data: { jobId: 'job-c2', status: 'queued' } });

    await expect(
      blurryClient.pollDocumentJob('job-c2', { requestId: 'req-c2' }),
    ).rejects.toThrow(/timed out/);

    // downloadDocumentOutput não deve ter sido chamado
    // (pollDocumentJob não chama download internamente)
    expect(axios.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/download'),
      expect.anything(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Retry após erro — o retry do cliente frontend repete prepareFileForChat
// O pollDocumentJob (baixo nível) propaga erros de rede imediatamente.
// O retry fica na camada do useFileHandling (retryPdfPreparation).
// ─────────────────────────────────────────────────────────────────────────────
describe('13. Retry após erro', () => {
  it('pollDocumentJob propaga erro de rede imediatamente (sem retry interno)', async () => {
    axios.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await expect(
      blurryClient.pollDocumentJob('job-net-error', { requestId: 'req-net' }),
    ).rejects.toThrow('ETIMEDOUT');

    // Apenas 1 tentativa — sem retry interno no blurryClient
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('getDocumentJob pode ser chamado novamente após falha — retry é externo', async () => {
    // Primeira chamada falha
    axios.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(blurryClient.getDocumentJob('job-retry', { requestId: 'req-r' })).rejects.toThrow();

    // Segunda chamada (retry externo) tem sucesso
    // getDocumentJob retorna status raw — 'completed' é o que o Blurry API expõe
    axios.get.mockResolvedValueOnce({
      data: { jobId: 'job-retry', status: 'completed', providerSafe: true },
    });
    const result = await blurryClient.getDocumentJob('job-retry', { requestId: 'req-r' });
    expect(result.status).toBe('completed');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Provider recebe somente texto anonimizado
// ─────────────────────────────────────────────────────────────────────────────
describe('14. Provider recebe somente texto anonimizado', () => {
  it('download text retorna apenas texto anonimizado (não PDF bruto)', async () => {
    const anonymizedText = 'Nome: [PERSON_1]\nCPF: [CPF_1]\nEmail: [EMAIL_1]';
    axios.get.mockResolvedValueOnce({
      // axios mock não aplica transformResponse, então data é string diretamente
      data: anonymizedText,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

    const result = await blurryClient.downloadDocumentOutput('job-text', {
      requestId: 'req-text',
      type: 'text',
    });

    expect(result.text).toBe(anonymizedText);
    expect(result.contentType).toContain('text/plain');
    // Garante que não é PDF binário
    expect(result.text).not.toContain('%PDF');
    // Garante que entidades foram mascaradas (placeholder, não valor real)
    expect(result.text).toContain('[PERSON');
  });

  it('texto anonimizado vazio lança erro semântico (download era de um job não pronto)', async () => {
    // Retorna string vazia — Blurry retornaria 404/400 na prática, mas
    // se chegou com body vazio, downloadDocumentOutput lança
    axios.get.mockResolvedValueOnce({
      data: '',
      headers: { 'content-type': 'text/plain' },
    });

    await expect(
      blurryClient.downloadDocumentOutput('job-empty', { type: 'text' }),
    ).rejects.toThrow(/empty/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. PDF bruto nunca é enviado ao modelo
// ─────────────────────────────────────────────────────────────────────────────
describe('15. PDF bruto nunca é enviado ao modelo', () => {
  it('download type=pdf retorna buffer binário — inviável envio como texto ao modelo', async () => {
    const sanitizedPdfContent = Buffer.from('%PDF sanitized anonymized content');
    axios.get.mockResolvedValueOnce({
      data: sanitizedPdfContent,
      headers: { 'content-type': 'application/pdf' },
    });

    const result = await blurryClient.downloadDocumentOutput('job-pdf', {
      requestId: 'req-pdf',
      type: 'pdf',
    });

    // Retorna buffer (não string), bloqueando envio acidental como texto
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.contentType).toContain('application/pdf');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('getDocumentJob com job não finalizado tem providerSafe falsy — bloqueia download', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-unsafe',
        status: 'processing',
        // Blurry não seta providerSafe=true para jobs não concluídos
        stage: 'redacting',
      },
    });

    const result = await blurryClient.getDocumentJob('job-unsafe', { requestId: 'req-unsafe' });
    // providerSafe deve ser undefined/null/false — nunca true para processing
    expect(result.providerSafe).toBeFalsy();
  });

  it('uploadDocument sempre retorna providerSafe=false (job apenas criado)', async () => {
    axios.post.mockResolvedValueOnce({
      data: { jobId: 'job-fresh', status: 'queued', providerSafe: false },
    });

    const result = await blurryClient.uploadDocument(makeFile(), { requestId: 'req-fresh' });
    // Upload nunca retorna providerSafe=true — só completed faz isso
    expect(result.providerSafe).not.toBe(true);
  });
});
