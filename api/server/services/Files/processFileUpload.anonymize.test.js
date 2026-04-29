jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('~/models/File', () => ({
  createFile: jest.fn(),
}));

jest.mock('~/server/utils/blurryClient', () => ({
  uploadDocument: jest.fn(),
  pollDocumentJob: jest.fn(),
  downloadSanitizedDocument: jest.fn(),
}));

const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { createFile } = require('~/models/File');
const blurryClient = require('~/server/utils/blurryClient');

const { processFileUpload } = require('./process');

describe('processFileUpload anonymize PDF', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('uploads the sanitized PDF returned by Blurry documents when anonymize=true', async () => {
    const handleFileUpload = jest.fn().mockResolvedValue({
      id: 'file-123',
      bytes: 10,
      filename: 'file-123-anonymized.pdf',
      filepath: '/uploads/user-1/file-123-anonymized.pdf',
    });

    getStrategyFunctions.mockReturnValue({
      handleFileUpload,
    });

    blurryClient.uploadDocument.mockResolvedValue({
      jobId: 'job-1',
      requestId: 'file-123',
    });
    blurryClient.pollDocumentJob.mockResolvedValue({
      jobId: 'job-1',
      status: 'completed',
      raw: {
        stats: { a: 1 },
        processing_ms: 10,
        chunks_count: 1,
      },
    });
    blurryClient.downloadSanitizedDocument.mockResolvedValue({
      buffer: Buffer.from('%PDF sanitized'),
      contentType: 'application/pdf',
      bytes: 14,
    });

    const req = {
      user: { id: 'user-1' },
      body: { anonymize: true },
      file_id: 'file-123',
      file: {
        mimetype: 'application/pdf',
        originalname: 'test.pdf',
        path: '/tmp/upload.pdf',
        size: 100,
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

    expect(blurryClient.uploadDocument).toHaveBeenCalledWith(
      req.file,
      expect.objectContaining({ ocr: true, requestId: 'file-123' }),
    );
    expect(blurryClient.pollDocumentJob).toHaveBeenCalledWith('job-1', {
      requestId: 'file-123',
    });
    expect(blurryClient.downloadSanitizedDocument).toHaveBeenCalledWith('job-1', {
      requestId: 'file-123',
    });
    expect(handleFileUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          originalname: 'file-123-anonymized.pdf',
          mimetype: 'application/pdf',
          size: 14,
        }),
      }),
    );
    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          anonymized: true,
          providerSafe: true,
          sanitized: true,
          blurry_job_id: 'job-1',
          anonymization_level: 'full',
          chunks_count: 1,
          processing_ms_total: 10,
        }),
      }),
      true,
    );
  });

  it('fails closed when Blurry document upload fails', async () => {
    getStrategyFunctions.mockReturnValue({
      handleFileUpload: jest.fn(),
    });
    blurryClient.uploadDocument.mockRejectedValue(new Error('network down'));

    const req = {
      user: { id: 'user-1' },
      body: { anonymize: true },
      file_id: 'file-123',
      file: {
        mimetype: 'application/pdf',
        originalname: 'scan.pdf',
        path: '/tmp/upload.pdf',
        size: 100,
      },
      config: { fileStrategy: 'local' },
    };

    await expect(
      processFileUpload({
        req,
        res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
        metadata: { file_id: 'temp', temp_file_id: 'temp', endpoint: 'openAI' },
      }),
    ).rejects.toThrow('Falha na anonimização do PDF');
    expect(createFile).not.toHaveBeenCalled();
  });

  it('fails closed when sanitized PDF download fails', async () => {
    getStrategyFunctions.mockReturnValue({
      handleFileUpload: jest.fn(),
    });
    blurryClient.uploadDocument.mockResolvedValue({ jobId: 'job-1', requestId: 'file-123' });
    blurryClient.pollDocumentJob.mockResolvedValue({ jobId: 'job-1', status: 'completed' });
    blurryClient.downloadSanitizedDocument.mockRejectedValue(new Error('empty download'));

    const req = {
      user: { id: 'user-1' },
      body: { anonymize: true },
      file_id: 'file-123',
      file: {
        mimetype: 'application/pdf',
        originalname: 'judicial.pdf',
        path: '/tmp/upload.pdf',
        size: 100,
      },
      config: { fileStrategy: 'local' },
    };

    await expect(
      processFileUpload({
        req,
        res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
        metadata: { file_id: 'temp', temp_file_id: 'temp', endpoint: 'openAI' },
      }),
    ).rejects.toThrow('Falha na anonimização do PDF');
    expect(createFile).not.toHaveBeenCalled();
  });
});
