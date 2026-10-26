import { afterEach, expect, it, vi } from 'vitest';
import finding from '../../packages/contracts/fixtures/rls-finding.json';
import output from '../../packages/contracts/fixtures/gemma-output.json';
import lock from '../../config/runtime-lock.json';
import { validate } from '../../packages/contracts/src/index';
import { investigate } from '../../packages/core/src/ai/ollama';
import { validatorFixture } from '../../eval/harness/validator-fixture';

afterEach(() => vi.unstubAllGlobals());
it.each(['malformed', 'unknown_test', 'empty', 'timeout', 'sql_field', 'tool_call'] as const)(
  'degrades %s model output without changing deterministic facts or echoing rejected content',
  async (kind) => {
    const { snapshot } = await validatorFixture();
    const f = validate('Finding', structuredClone(finding));
    const before = structuredClone(f);
    const requests: {
      messages: { content: string }[];
      stream: boolean;
      options: { num_predict: number };
    }[] = [];
    const canary = ['TEST_ONLY', 'REJECTED_MODEL_CONTENT'].join('_');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/tags'))
          return Response.json({
            models: [{ name: lock.ollama_model, digest: lock.ollama_model_digest }],
          });
        requests.push(JSON.parse(String(init?.body)));
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        if (kind === 'timeout') throw new DOMException('Transport timeout', 'TimeoutError');
        const content =
          kind === 'malformed'
            ? '{' + canary
            : kind === 'unknown_test'
              ? JSON.stringify({ ...output, recommended_test_id: 'run_sql', explanation: canary })
              : kind === 'empty'
                ? ''
                : kind === 'sql_field'
                  ? JSON.stringify({ ...output, sql: canary })
                  : JSON.stringify(output);
        return Response.json({
          message: { content, ...(kind === 'tool_call' ? { tool_calls: [{}] } : {}) },
        });
      }),
    );
    const analysis = await investigate(f, snapshot);
    expect(analysis.status).toBe(kind === 'timeout' ? 'unavailable' : 'invalid');
    expect(analysis.output).toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => !r.stream && r.options.num_predict === 768)).toBe(true);
    expect(
      JSON.stringify(requests).includes(canary),
      'Rejected output is absent from retry prompts',
    ).toBe(false);
    expect(f).toEqual(before);
  },
);
it('handles a lost Ollama endpoint before generation without a canned analysis', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Endpoint unavailable');
    }),
  );
  const result = await investigate(validate('Finding', structuredClone(finding)), null);
  expect(result.status).toBe('unavailable');
  expect(result.output).toBeNull();
  expect(result.reason_code).toBe('AI_UNAVAILABLE');
});
