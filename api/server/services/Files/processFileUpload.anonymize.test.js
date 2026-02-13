jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('~/models/File', () => ({
  createFile: jest.fn(),
}));

jest.mock('~/server/utils/pdfText', () => ({
  extractPdfText: jest.fn(),
}));

jest.mock('~/server/utils/anonymizeLargeText', () => ({
  anonymizeLargeText: jest.fn(),
}));

const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { createFile } = require('~/models/File');
const { extractPdfText } = require('~/server/utils/pdfText');
const { anonymizeLargeText } = require('~/server/utils/anonymizeLargeText');

const { processFileUpload } = require('./process');

describe('processFileUpload anonymize PDF', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores anonymized text and metadata for PDF when anonymize=true', async () => {
    getStrategyFunctions.mockReturnValue({
      handleFileUpload: jest.fn().mockResolvedValue({
        id: 'file-123',
        bytes: 10,
        filename: 'test.pdf',
        filepath: '/tmp/test.pdf',
      }),
    });

    extractPdfText.mockResolvedValue({ text: 'original text' });
    anonymizeLargeText.mockResolvedValue({
      anonymizedText: 'anon text',
      stats: { a: 1 },
      processingMsTotal: 10,
      chunksCount: 1,
      entitiesByChunk: [],
    });

    const req = {
      user: { id: 'user-1' },
      body: { anonymize: true },
      file: {
        mimetype: 'application/pdf',
        originalname: 'test.pdf',
        path: '/tmp/upload.pdf',
      },
      config: { fileStrategy: 'local' },
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await processFileUpload({
      req,
      res,
      metadata: { file_id: 'temp', temp_file_id: 'temp', endpoint: 'openAI' },
    });

    expect(extractPdfText).toHaveBeenCalled();
    expect(anonymizeLargeText).toHaveBeenCalled();
    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'anon text',
        metadata: expect.objectContaining({
          anonymized: true,
          anonymization_level: 'full',
          chunks_count: 1,
          processing_ms_total: 10,
        }),
      }),
      true,
    );
  });
});
