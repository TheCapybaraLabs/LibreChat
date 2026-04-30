jest.mock('./pdfText', () => ({
  extractPdfText: jest.fn(),
}));

jest.mock('./blurryClient', () => ({
  anonymizeText: jest.fn(),
  uploadDocument: jest.fn(),
  pollDocumentJob: jest.fn(),
  downloadSanitizedText: jest.fn(),
}));

const { extractPdfText } = require('./pdfText');
const fs = require('fs').promises;
const blurryClient = require('./blurryClient');
const {
  chunkText,
  prepareFileWithChunkedAnonymization,
  preparePdfWithChunkedAnonymization,
} = require('./pdfChunkAnonymizer');

describe('pdfChunkAnonymizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
    blurryClient.uploadDocument.mockResolvedValue(null);
  });

  it('chunks text by paragraphs while preserving order', () => {
    const chunks = chunkText('Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro.', 25);

    expect(chunks).toEqual([
      { chunkIndex: 0, totalChunks: 3, text: 'Primeiro parágrafo.' },
      { chunkIndex: 1, totalChunks: 3, text: 'Segundo parágrafo.' },
      { chunkIndex: 2, totalChunks: 3, text: 'Terceiro.' },
    ]);
  });

  it('prepares a small textual PDF with providerSafe metadata', async () => {
    extractPdfText.mockResolvedValue({
      text: 'João tem CPF 123.\n\nMaria mora em Recife.',
      chars: 40,
      pagesProcessed: 1,
    });
    blurryClient.anonymizeText
      .mockResolvedValueOnce({
        anonymized_text: '[NOME] tem CPF [CPF].',
        stats: { NAME: 1, CPF: 1 },
        entities: [{ type: 'NAME' }, { type: 'CPF' }],
        processing_ms: 10,
      })
      .mockResolvedValueOnce({
        anonymized_text: '[NOME] mora em [LOCAL].',
        stats: { NAME: 1, ADDRESS: 1 },
        entities: [{ type: 'NAME' }, { type: 'ADDRESS' }],
        processing_ms: 15,
      });

    const result = await preparePdfWithChunkedAnonymization({
      filePath: '/tmp/test.pdf',
      fileId: 'file-1',
      filename: 'test.pdf',
      maxChars: 30,
    });

    expect(blurryClient.anonymizeText).toHaveBeenCalledTimes(2);
    expect(blurryClient.anonymizeText).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: 'strict',
        anonymization_level: 'full',
        return_entities: true,
      }),
    );
    expect(result.providerSafe).toBe(true);
    expect(result.anonymizedText).toBe('[NOME] tem CPF [CPF].\n\n[NOME] mora em [LOCAL].');
    expect(result.chunks).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(result.stats).toEqual({ NAME: 2, CPF: 1, ADDRESS: 1 });
    expect(result.entityCount).toBe(4);
  });

  it('prepares a large textual PDF across multiple chunks', async () => {
    extractPdfText.mockResolvedValue({
      text: 'A primeira sentença contém dados.\n\nA segunda sentença contém dados.\n\nA terceira sentença contém dados.',
      chars: 94,
      pagesProcessed: 3,
    });
    blurryClient.anonymizeText
      .mockResolvedValueOnce({ anonymized_text: 'chunk-1', stats: {}, entities: [] })
      .mockResolvedValueOnce({ anonymized_text: 'chunk-2', stats: {}, entities: [] })
      .mockResolvedValueOnce({ anonymized_text: 'chunk-3', stats: {}, entities: [] });

    const result = await preparePdfWithChunkedAnonymization({
      filePath: '/tmp/large.pdf',
      fileId: 'file-2',
      filename: 'large.pdf',
      maxChars: 40,
    });

    expect(result.pages).toBe(3);
    expect(result.chunks.total).toBe(3);
    expect(result.anonymizedText).toBe('chunk-1\n\nchunk-2\n\nchunk-3');
  });

  it('fails closed when extraction returns no selectable text', async () => {
    extractPdfText.mockResolvedValue({ text: '', chars: 0, pagesProcessed: 1 });

    await expect(
      preparePdfWithChunkedAnonymization({
        filePath: '/tmp/scan.pdf',
        fileId: 'file-3',
        filename: 'scan.pdf',
      }),
    ).rejects.toMatchObject({ code: 'PDF_TEXT_EXTRACTION_EMPTY' });
    expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  });

  it('fails closed when one chunk fails', async () => {
    extractPdfText.mockResolvedValue({
      text: 'Primeiro.\n\nSegundo.',
      chars: 20,
      pagesProcessed: 1,
    });
    blurryClient.anonymizeText
      .mockResolvedValueOnce({ anonymized_text: 'ok', stats: {}, entities: [] })
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(
      preparePdfWithChunkedAnonymization({
        filePath: '/tmp/fail.pdf',
        fileId: 'file-4',
        filename: 'fail.pdf',
        maxChars: 12,
      }),
    ).rejects.toThrow('timeout');
  });

  it('prepares a TXT file with providerSafe metadata', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('Ana tem CPF 123.\nLinha 2.', 'utf8'));
    blurryClient.anonymizeText.mockResolvedValueOnce({
      anonymized_text: '[NOME] tem CPF [CPF].\nLinha 2.',
      stats: { NAME: 1, CPF: 1 },
      entities: [{ type: 'NAME' }, { type: 'CPF' }],
    });

    const result = await prepareFileWithChunkedAnonymization({
      filePath: '/tmp/file.txt',
      fileId: 'file-txt',
      filename: 'file.txt',
      mimeType: 'text/plain',
      size: 24,
    });

    expect(extractPdfText).not.toHaveBeenCalled();
    expect(result.providerSafe).toBe(true);
    expect(result.type).toBe('text');
    expect(result.lines).toBe(2);
    expect(result.entityCount).toBe(2);
    expect(result.anonymizedText).toContain('[CPF]');
  });

  it('reports PDF_NO_SELECTABLE_TEXT for PDFs without selectable text in the unified pipeline', async () => {
    extractPdfText.mockResolvedValue({ text: '', chars: 0, pagesProcessed: 2 });

    await expect(
      prepareFileWithChunkedAnonymization({
        filePath: '/tmp/scan.pdf',
        fileId: 'file-scan',
        filename: 'scan.pdf',
        mimeType: 'application/pdf',
        size: 1000,
      }),
    ).rejects.toMatchObject({
      code: 'PDF_NO_SELECTABLE_TEXT',
      stage: 'failed',
      pages: 2,
      requestId: 'file-scan',
    });
    expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  });

  it('uses Blurry sanitized text and exposes sanitized PDF output for PDFs', async () => {
    blurryClient.uploadDocument.mockResolvedValueOnce({
      jobId: 'job-1',
      status: 'completed',
      providerSafe: true,
      outputs: {
        sanitizedTextUrl: '/signed/text',
        sanitizedPdfUrl: '/signed/pdf',
      },
      raw: {
        providerSafe: true,
        pages: 2,
        chunks_count: 1,
        stats: { NAME: 1 },
      },
    });
    blurryClient.downloadSanitizedText.mockResolvedValueOnce({
      text: '[NOME] revisou o documento.',
      contentType: 'text/plain',
      bytes: 27,
    });

    const result = await prepareFileWithChunkedAnonymization({
      filePath: '/tmp/ocr.pdf',
      fileId: 'file-ocr',
      filename: 'ocr.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    });

    expect(extractPdfText).not.toHaveBeenCalled();
    expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
    expect(blurryClient.downloadSanitizedText).toHaveBeenCalledWith('/signed/text', {
      requestId: 'file-ocr',
    });
    expect(result.providerSafe).toBe(true);
    expect(result.anonymizedText).toBe('[NOME] revisou o documento.');
    expect(result.outputs).toEqual({
      sanitizedPdfUrl: '/signed/pdf',
      sanitizedTextAvailable: true,
    });
  });

  it('blocks model send when Blurry returns a sanitized PDF without sanitized text', async () => {
    blurryClient.uploadDocument.mockResolvedValueOnce({
      jobId: 'job-2',
      status: 'completed',
      providerSafe: true,
      outputs: {
        sanitizedPdfUrl: '/signed/pdf',
      },
      raw: { providerSafe: true },
    });

    await expect(
      prepareFileWithChunkedAnonymization({
        filePath: '/tmp/no-text.pdf',
        fileId: 'file-no-text-output',
        filename: 'no-text.pdf',
        mimeType: 'application/pdf',
        size: 4096,
      }),
    ).rejects.toMatchObject({
      code: 'SANITIZED_TEXT_MISSING',
      stage: 'anonymize_failed',
      requestId: 'file-no-text-output',
    });
    expect(extractPdfText).not.toHaveBeenCalled();
    expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  });

  it('uses inline sanitized_text from Blurry without downloading raw file content', async () => {
    blurryClient.uploadDocument.mockResolvedValueOnce({
      jobId: 'job-3',
      status: 'completed',
      providerSafe: true,
      outputs: {
        sanitized_text: '[NOME] revisou o arquivo.',
        sanitized_pdf_url: '/signed/pdf',
      },
      raw: { providerSafe: true },
    });

    const result = await prepareFileWithChunkedAnonymization({
      filePath: '/tmp/inline.pdf',
      fileId: 'file-inline-output',
      filename: 'inline.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    });

    expect(blurryClient.downloadSanitizedText).not.toHaveBeenCalled();
    expect(result.anonymizedText).toBe('[NOME] revisou o arquivo.');
    expect(result.outputs.sanitizedPdfUrl).toBe('/signed/pdf');
  });

  it('reports BLURRY_ANONYMIZE_FAILED without exposing chunk content', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('Ana tem CPF 123.', 'utf8'));
    blurryClient.anonymizeText.mockRejectedValueOnce(new Error('upstream failed'));

    await expect(
      prepareFileWithChunkedAnonymization({
        filePath: '/tmp/file.txt',
        fileId: 'file-blurry',
        filename: 'file.txt',
        mimeType: 'text/plain',
        size: 16,
      }),
    ).rejects.toMatchObject({
      code: 'BLURRY_ANONYMIZE_FAILED',
      stage: 'anonymize_failed',
      chunkIndex: 0,
      requestId: 'file-blurry',
    });
  });

  it('reports INVALID_ANONYMIZE_RESPONSE for empty Blurry responses', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('Ana tem CPF 123.', 'utf8'));
    blurryClient.anonymizeText.mockResolvedValueOnce({
      anonymized_text: '',
      stats: {},
      entities: [],
    });

    await expect(
      prepareFileWithChunkedAnonymization({
        filePath: '/tmp/file.txt',
        fileId: 'file-invalid',
        filename: 'file.txt',
        mimeType: 'text/plain',
        size: 16,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ANONYMIZE_RESPONSE',
      stage: 'anonymize_failed',
      chunkIndex: 0,
      requestId: 'file-invalid',
    });
  });

  it('prepares CSV and JSON text files through the same pipeline', async () => {
    jest
      .spyOn(fs, 'readFile')
      .mockResolvedValueOnce(Buffer.from('name,cpf\nAna,123', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('{"name":"Ana","cpf":"123"}', 'utf8'));
    blurryClient.anonymizeText
      .mockResolvedValueOnce({ anonymized_text: 'name,cpf\n[NOME],[CPF]', stats: {}, entities: [] })
      .mockResolvedValueOnce({
        anonymized_text: '{"name":"[NOME]","cpf":"[CPF]"}',
        stats: {},
        entities: [],
      });

    const csv = await prepareFileWithChunkedAnonymization({
      filePath: '/tmp/file.csv',
      fileId: 'file-csv',
      filename: 'file.csv',
      mimeType: 'text/csv',
      size: 16,
    });
    const json = await prepareFileWithChunkedAnonymization({
      filePath: '/tmp/file.json',
      fileId: 'file-json',
      filename: 'file.json',
      mimeType: 'application/json',
      size: 26,
    });

    expect(csv.providerSafe).toBe(true);
    expect(json.providerSafe).toBe(true);
    expect(csv.anonymizedText).toContain('[NOME]');
    expect(json.anonymizedText).toContain('[CPF]');
  });

  it('fails closed for binary or invalid text files before calling Blurry', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from([0xff, 0x00, 0x01]));

    await expect(
      prepareFileWithChunkedAnonymization({
        filePath: '/tmp/file.txt',
        fileId: 'file-bin',
        filename: 'file.txt',
        mimeType: 'text/plain',
        size: 3,
      }),
    ).rejects.toMatchObject({ code: 'TEXT_BINARY_UNSUPPORTED' });
    expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  });

  it('fails closed when a chunk anonymization times out', async () => {
    jest.useFakeTimers();
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('Ana tem CPF 123.', 'utf8'));
    blurryClient.anonymizeText.mockImplementation(() => new Promise(() => {}));

    const promise = prepareFileWithChunkedAnonymization({
      filePath: '/tmp/file.txt',
      fileId: 'file-timeout',
      filename: 'file.txt',
      mimeType: 'text/plain',
      size: 16,
      chunkTimeoutMs: 10,
    });

    const rejection = promise.catch((error) => error);
    await jest.advanceTimersByTimeAsync(11);
    await expect(rejection).resolves.toMatchObject({
      code: 'BLURRY_TIMEOUT',
      stage: 'anonymize_failed',
      chunkIndex: 0,
    });
  });
});
