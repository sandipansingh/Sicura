import { describe, expect, it } from 'vitest';
import rls from '../../packages/contracts/fixtures/rls-finding.json';
import credential from '../../packages/contracts/fixtures/credential-finding.json';
import gemma from '../../packages/contracts/fixtures/gemma-output.json';
import { parseStrictJson, TEST_IDS, validate } from '../../packages/contracts/src/index';

describe('canonical contracts', () => {
  it('validates both documented examples and the Gemma example', () => {
    expect(validate('Finding', rls).category).toBe('RLS_MISCONFIGURATION');
    expect(validate('Finding', credential).evidence.kind).toBe('credential');
    expect(validate('GemmaOutput', gemma).recommended_test_id).toBe('rls.cross_user_read.v1');
    expect(TEST_IDS).toHaveLength(7);
  });
  it('rejects extra keys, wrong category unions and unknown enums', () => {
    expect(() => validate('Finding', { ...rls, sql: 'SELECT 1' })).toThrow();
    expect(() => validate('Finding', { ...rls, category: 'CREDENTIAL_EXPOSURE' })).toThrow();
    expect(() => validate('Finding', { ...rls, state: 'safe' })).toThrow();
    expect(() => validate('GemmaOutput', { ...gemma, recommended_test_id: 'arbitrary' })).toThrow();
  });
  it('rejects duplicate keys including escaped equivalent and nested keys', () => {
    for (const text of ['{"state":1,"state":2}', '{"a":{"x":1,"\\u0078":2}}', '[{"x":1,"x":2}]'])
      expect(() => parseStrictJson(text)).toThrow('DUPLICATE_JSON_KEY');
    expect(parseStrictJson('{"a":[1,true,null,"x"]}')).toEqual({ a: [1, true, null, 'x'] });
  });
  it('bounds input/depth and rejects trailing garbage and nonfinite numbers', () => {
    for (const text of [
      '{} trailing',
      '[1,]',
      '{"a":}',
      '1e999',
      '['.repeat(102) + ']'.repeat(102),
    ])
      expect(() => parseStrictJson(text)).toThrow();
    expect(() => parseStrictJson('"long"', 3)).toThrow('JSON_LIMIT');
  });
  it('unknown/inferred intent cannot become a declared confirmation implicitly', () => {
    const f = structuredClone(rls);
    f.expectation.source = 'unknown';
    f.expectation.expected = 'unknown';
    expect(() => validate('Finding', f)).toThrow();
    const inferred = {
      ...rls,
      expectation: { ...rls.expectation, source: 'inferred', origin: 'heuristic' },
    };
    expect(validate('Finding', inferred).expectation?.source).toBe('inferred');
  });
  it('errors and missing denial mechanisms are not denial evidence', () => {
    const result = rls.verification.evidence[0];
    expect(() =>
      validate('TestResult', { ...result, observed: 'error', outcome: 'match' }),
    ).toThrow();
    expect(() =>
      validate('TestResult', {
        ...result,
        observed: 'deny',
        outcome: 'match',
        denial_mechanism: null,
      }),
    ).toThrow();
    expect(() => validate('TestResult', { ...result, role_assertion_passed: false })).toThrow();
  });
});
