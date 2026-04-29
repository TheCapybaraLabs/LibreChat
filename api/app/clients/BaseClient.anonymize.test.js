const { FileSources } = require('librechat-data-provider');
const BaseClient = require('./BaseClient');

class TestClient extends BaseClient {
  setOptions() {}
  async getCompletion() {}
  async sendCompletion() {}
  getSaveOptions() {
    return {};
  }
  async buildMessages() {}
  getBuildMessagesOptions() {
    return {};
  }
}

describe('BaseClient anonymize PDF handling', () => {
  beforeEach(() => {
    process.env.BLURRY_FAIL_CLOSED = 'true';
  });

  it('allows provider-safe anonymized PDFs to be uploaded as documents', async () => {
    const client = new TestClient('key', { req: { body: { anonymize: true } } });
    client.options = { req: { body: { anonymize: true } } };
    client.addDocuments = jest.fn().mockResolvedValue([]);
    client.addImageURLs = jest.fn().mockResolvedValue([]);
    client.addVideos = jest.fn().mockResolvedValue([]);
    client.addAudios = jest.fn().mockResolvedValue([]);

    const message = {};
    const attachments = [
      {
        file_id: 'file-1',
        type: 'application/pdf',
        metadata: { anonymized: true, providerSafe: true, sanitized: true },
        source: FileSources.local,
      },
    ];

    await client.processAttachments(message, attachments);

    expect(client.addDocuments).toHaveBeenCalledWith(message, attachments);
  });

  it('fails closed when anonymize is true and PDF is not anonymized', async () => {
    const client = new TestClient('key', { req: { body: { anonymize: true } } });
    client.options = { req: { body: { anonymize: true } } };
    const message = {};
    const attachments = [
      {
        file_id: 'file-2',
        type: 'application/pdf',
        source: FileSources.local,
      },
    ];

    await expect(client.processAttachments(message, attachments)).rejects.toThrow(
      'PDF anexado requer anonimização',
    );
  });

  it('fails closed when an anonymized PDF is not provider-safe', async () => {
    const client = new TestClient('key', { req: { body: { anonymize: true } } });
    client.options = { req: { body: { anonymize: true } } };
    const message = {};
    const attachments = [
      {
        file_id: 'file-3',
        type: 'application/pdf',
        metadata: { anonymized: true },
        source: FileSources.local,
      },
    ];

    await expect(client.processAttachments(message, attachments)).rejects.toThrow(
      'não foi marcado como seguro',
    );
  });
});
