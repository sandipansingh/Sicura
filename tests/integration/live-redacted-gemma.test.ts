import { expect, it, vi } from 'vitest';
import { admitInputs } from '../../packages/core/src/intake/inputs';
import { investigate } from '../../packages/core/src/ai/ollama';

it('sends only redacted credential facts to real pinned Gemma', async () => {
  const canary = ['sb_secret', 'TEST_ONLY_LIVE_MODEL_CANARY'].join('_');
  const inputs = await admitInputs(
    {
      files: [
        {
          path: 'frontend/client.ts',
          kind: 'source',
          content: 'const serviceRoleKey = "' + canary + '";',
        },
      ],
      sql_order: [],
      expectations: null,
    },
    'live_model_sink',
    1,
    Buffer.alloc(32, 7),
  );
  const finding = inputs.credential_findings[0]!;
  expect(finding).toBeDefined();
  expect(JSON.stringify(finding).includes(canary)).toBe(false);
  const transport = globalThis.fetch;
  let requests = 0;
  const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/api/chat')) {
      requests++;
      const body = String(init?.body);
      expect(body.includes(canary), 'Raw fixture value absent from actual Gemma request').toBe(
        false,
      );
      expect(
        body.includes('validity not tested'),
        'Only qualified static credential facts included',
      ).toBe(true);
    }
    return transport(url, init);
  });
  try {
    const result = await investigate(finding, null);
    expect(requests).toBeGreaterThan(0);
    expect(result.status).toBe('available');
    expect(JSON.stringify(result).includes(canary)).toBe(false);
  } finally {
    capture.mockRestore();
  }
});
