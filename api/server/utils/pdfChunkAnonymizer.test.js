jest.mock('./pdfText', () => ({
  extractPdfText: jest.fn(),
}));

jest.mock('./blurryClient', () => ({
  anonymizeText: jest.fn(),
}));

const { extractPdfText } = require('./pdfText');
const blurryClient = require('./blurryClient');
const { chunkText, preparePdfWithChunkedAnonymization } = require('./pdfChunkAnonymizer');

describe('pdfChunkAnonymizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
