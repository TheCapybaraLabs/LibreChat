jest.mock('./blurryClient', () => ({
  anonymizeText: jest.fn(),
}));

const blurryClient = require('./blurryClient');
const {
  anonymizeLargeText,
  splitTextIntoChunks,
  mergeStats,
} = require('./anonymizeLargeText');

describe('anonymizeLargeText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BLURRY_MAX_CHARS = '10';
    process.env.BLURRY_CHUNK_OVERLAP = '0';
  });

  it('splits text into bounded chunks', () => {
    const text = 'One two three. Four five six. Seven eight.';
    const chunks = splitTextIntoChunks(text, 10, 0);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it('merges stats by summing numeric fields', () => {
    const merged = mergeStats({ a: 1 }, { a: 2, b: 3, c: 'x' });
    expect(merged).toEqual({ a: 3, b: 3, c: 'x' });
  });

  it('anonymizes chunks in order and aggregates metadata', async () => {
    blurryClient.anonymizeText
      .mockResolvedValueOnce({
        anonymized_text: 'AAA',
        stats: { a: 1 },
        processing_ms: 5,
        entities: [{ id: 1 }],
      })
      .mockResolvedValueOnce({
        anonymized_text: 'BBB',
        stats: { a: 2, b: 1 },
        processing_ms: 7,
        entities: [{ id: 2 }],
      });

    const result = await anonymizeLargeText('1234567890abcdefghij');

    expect(result.anonymizedText).toBe('AAABBB');
    expect(result.processingMsTotal).toBe(12);
    expect(result.stats).toEqual({ a: 3, b: 1 });
    expect(result.chunksCount).toBe(2);
    expect(result.entitiesByChunk).toEqual([
      { chunk_index: 0, entities: [{ id: 1 }] },
      { chunk_index: 1, entities: [{ id: 2 }] },
    ]);
  });
});
