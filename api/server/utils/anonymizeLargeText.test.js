jest.mock('./blurryClient', () => ({
  anonymizeText: jest.fn(),
}));

const blurryClient = require('./blurryClient');
const { anonymizeLargeText } = require('./anonymizeLargeText');

describe('anonymizeLargeText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('anonymizes full text in a single request and aggregates metadata', async () => {
    blurryClient.anonymizeText
      .mockResolvedValueOnce({
        anonymized_text: 'AAA',
        stats: { PERSON: 2 },
        processing_ms: 12,
        entities: [{ id: 1 }],
      });

    const result = await anonymizeLargeText('1234567890abcdefghij');

    expect(result.anonymizedText).toBe('AAA');
    expect(result.processingMsTotal).toBe(12);
    expect(result.stats).toEqual({ PERSON: 2 });
    expect(result.chunksCount).toBe(1);
    expect(result.entitiesByChunk).toEqual([
      { chunk_index: 0, entities: [{ id: 1 }] },
    ]);
  });
});
