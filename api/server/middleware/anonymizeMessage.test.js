const anonymizeMessage = require('./anonymizeMessage');

jest.mock('../utils/blurryClient');
jest.mock('@librechat/api', () => ({
  handleError: jest.fn((res, payload) => {
    res.status(500).json(payload);
  }),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const blurryClient = require('../utils/blurryClient');
const { handleError } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BLURRY_API_KEY = 'test-key';
  process.env.BLURRY_FAIL_CLOSED = 'true';
});

afterEach(() => {
  delete process.env.BLURRY_API_KEY;
  delete process.env.BLURRY_FAIL_CLOSED;
});

// Test 1: Toggle ON calls Blurry for text
test('toggle ON calls blurryClient.anonymizeText with the message text', async () => {
  blurryClient.anonymizeText = jest.fn().mockResolvedValue({
    anonymized_text: 'anonymized',
    entities: [],
    stats: {},
    processing_ms: 42,
  });

  const req = { body: { text: 'Hello João', anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(blurryClient.anonymizeText).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Hello João' }),
  );
  expect(next).toHaveBeenCalled();
  expect(handleError).not.toHaveBeenCalled();
});

// Test 2: Toggle OFF (boolean false) does NOT call Blurry
test('toggle OFF (false) skips Blurry and calls next immediately', async () => {
  blurryClient.anonymizeText = jest.fn();

  const req = { body: { text: 'Hello', anonymize: false } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

// Test 3: Toggle OFF (undefined) skips Blurry
test('toggle absent (undefined) skips Blurry and calls next immediately', async () => {
  blurryClient.anonymizeText = jest.fn();

  const req = { body: { text: 'Hello' } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

// Test 4: Toggle ON substitutes text before provider sees it
test('toggle ON replaces req.body.text with anonymized version', async () => {
  blurryClient.anonymizeText = jest.fn().mockResolvedValue({
    anonymized_text: '[NOME] ligou para [TELEFONE]',
    entities: [{ type: 'NAME' }, { type: 'PHONE' }],
    stats: {},
    processing_ms: 10,
  });

  const req = { body: { text: 'Carlos ligou para 11 99999-0000', anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(req.body.text).toBe('[NOME] ligou para [TELEFONE]');
  expect(req.body.anonymized).toBe(true);
  expect(req.body.entities).toHaveLength(2);
  expect(next).toHaveBeenCalled();
});

// Test 5: Blurry fails → fail-closed blocks the request
test('Blurry failure with FAIL_CLOSED=true calls handleError and NOT next', async () => {
  blurryClient.anonymizeText = jest.fn().mockRejectedValue(new Error('Network error'));

  const req = { body: { text: 'sensitive text', anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(handleError).toHaveBeenCalledWith(
    res,
    expect.objectContaining({ text: expect.stringContaining('anonimização') }),
  );
  expect(next).not.toHaveBeenCalled();
});

// Test 6: Blurry fails → fail-open (BLURRY_FAIL_CLOSED=false) calls next
test('Blurry failure with FAIL_CLOSED=false calls next (fail-open)', async () => {
  process.env.BLURRY_FAIL_CLOSED = 'false';
  blurryClient.anonymizeText = jest.fn().mockRejectedValue(new Error('Timeout'));

  const req = { body: { text: 'text', anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(handleError).not.toHaveBeenCalled();
});

// Test 7: BLURRY_API_KEY missing → fail-closed even before calling Blurry
test('missing BLURRY_API_KEY with toggle ON calls handleError', async () => {
  delete process.env.BLURRY_API_KEY;
  blurryClient.anonymizeText = jest.fn();

  const req = { body: { text: 'text', anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  expect(handleError).toHaveBeenCalledWith(
    res,
    expect.objectContaining({ text: expect.stringContaining('API Key') }),
  );
  expect(next).not.toHaveBeenCalled();
});

// Test 8: anonymize as string 'true' (FormData coercion) calls Blurry
test('toggle ON as string "true" (FormData) calls blurryClient.anonymizeText', async () => {
  blurryClient.anonymizeText = jest.fn().mockResolvedValue({
    anonymized_text: 'anon',
    entities: [],
    stats: {},
    processing_ms: 5,
  });

  const req = { body: { text: 'raw text', anonymize: 'true' } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(blurryClient.anonymizeText).toHaveBeenCalled();
  expect(req.body.text).toBe('anon');
  expect(next).toHaveBeenCalled();
});

// Test 9: No raw text logged — logger.error is called on error but text is NOT logged
test('logger does not receive raw text content on success path', async () => {
  const rawText = 'CPF: 123.456.789-00';
  blurryClient.anonymizeText = jest.fn().mockResolvedValue({
    anonymized_text: 'CPF: [CPF]',
    entities: [{ type: 'CPF' }],
    stats: {},
    processing_ms: 15,
  });

  const req = { body: { text: rawText, anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  const allLoggerCalls = [
    ...logger.error.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.info.mock.calls,
  ];
  const allLogMessages = allLoggerCalls.map((call) => JSON.stringify(call));
  const rawTextExposed = allLogMessages.some((msg) => msg.includes(rawText));
  expect(rawTextExposed).toBe(false);
});

// Test 10: Empty/null text with toggle ON passes through without calling Blurry
test('empty text with toggle ON skips Blurry and calls next', async () => {
  blurryClient.anonymizeText = jest.fn();

  const req = { body: { text: '', anonymize: true } };
  const res = makeRes();
  const next = jest.fn();

  await anonymizeMessage(req, res, next);

  expect(blurryClient.anonymizeText).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});
