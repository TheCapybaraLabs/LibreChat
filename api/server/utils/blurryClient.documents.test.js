jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const blurryClient = require('./blurryClient');

describe('blurryClient document pipeline', () => {
  const filePath = path.join(os.tmpdir(), 'blurry-test.pdf');
  const file = {
    path: filePath,
    originalname: 'judicial.pdf',
    mimetype: 'application/pdf',
    size: 12,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fs.writeFileSync(filePath, '%PDF test');
    process.env.BLURRY_API_KEY = 'test-key';
    process.env.BLURRY_BASE_URL = 'https://blurry.test';
    process.env.BLURRY_DOCUMENT_POLL_INTERVAL_MS = '1';
    process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS = '20';
  });

  afterEach(() => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // noop
    }
  });

  it('uploads PDF documents with OCR enabled and returns the job id', async () => {
    axios.post.mockResolvedValueOnce({
      data: { jobId: 'job-1', status: 'processing' },
    });

    const result = await blurryClient.uploadDocument(file, {
      requestId: 'req-1',
      ocr: true,
    });

    expect(result.jobId).toBe('job-1');
    expect(axios.post).toHaveBeenCalledWith(
      'https://blurry.test/v1/documents',
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'X-Request-Id': 'req-1',
        }),
      }),
    );
    expect(axios.post.mock.calls[0][1]._streams.join('\n')).toContain('ocr');
    expect(axios.post.mock.calls[0][1]._streams.join('\n')).toContain('true');
  });

  it('polls until a document job completes', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { job_id: 'job-1', status: 'processing' } })
      .mockResolvedValueOnce({
        data: { job_id: 'job-1', status: 'completed', download_url: '/download/job-1' },
      });

    const result = await blurryClient.pollDocumentJob('job-1', { requestId: 'req-1' });

    expect(result.status).toBe('completed');
    expect(result.downloadUrl).toBe('/download/job-1');
  });

  it('throws when a document job fails', async () => {
    axios.get.mockResolvedValueOnce({
      data: { job_id: 'job-1', status: 'failed', error: 'ocr failed' },
    });

    await expect(blurryClient.pollDocumentJob('job-1')).rejects.toThrow(
      'Blurry document job failed: ocr failed',
    );
  });

  it('throws when polling times out', async () => {
    process.env.BLURRY_DOCUMENT_POLL_TIMEOUT_MS = '2';
    axios.get.mockResolvedValue({ data: { job_id: 'job-1', status: 'processing' } });

    await expect(blurryClient.pollDocumentJob('job-1')).rejects.toThrow(
      'Blurry document job timed out',
    );
  });

  it('downloads the sanitized document as a buffer', async () => {
    axios.get.mockResolvedValueOnce({
      data: Buffer.from('%PDF sanitized'),
      headers: { 'content-type': 'application/pdf' },
    });

    const result = await blurryClient.downloadSanitizedDocument('job-1', {
      requestId: 'req-1',
    });

    expect(result.buffer.toString()).toBe('%PDF sanitized');
    expect(result.contentType).toBe('application/pdf');
    expect(result.bytes).toBe(14);
  });
});
