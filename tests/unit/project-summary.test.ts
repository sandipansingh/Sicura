import { expect, it, vi, afterEach } from 'vitest';
import {
  summaryFacts,
  validateSummaryOutput,
  summarizeProject,
} from '../../packages/core/src/ai/project-summary';
import { analyzeSqlFiles } from '../../packages/core/src/rls/sql-analysis';
import { staticExpectations, staticFindings } from '../../packages/core/src/rls/static-findings';
import { validate } from '../../packages/contracts/src/index';
import { modelInput, generationSchema } from '../../packages/core/src/ai/ollama';

afterEach(() => vi.unstubAllGlobals());
it('keeps static SQL findings independent from catalogue proof and executable AI actions', async () => {
  const a = await analyzeSqlFiles([
    {
      path: 'schema.sql',
      content:
        'CREATE TABLE public.notes(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id)); CREATE POLICY p ON public.notes TO authenticated USING(true); CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$SELECT 1$$;',
    },
  ]);
  const findings = staticFindings(a, staticExpectations(a, [], [], 'p'), 'p');
  const f = findings.find((f) => f.expectation?.source === 'inferred')!;
  expect(f.evidence.kind).toBe('rls_static');
  expect(f.location.kind === 'database' && f.location.resource.table).toBe('notes');
  expect(() => validate('Finding', { ...f, state: 'confirmed' })).toThrow(
    'STATIC_EVIDENCE_INVALID',
  );
  expect(modelInput(f).allowed_test_ids).toEqual([]);
  expect(JSON.stringify(generationSchema(modelInput(f)))).toContain(
    '"recommended_test_id":{"enum":[null]}',
  );
  expect(summaryFacts(findings, a).replica_ready).toBe(false);
});
it('rejects invented references and SQL from project summaries', () => {
  const output = {
    summary: 'Static analysis only.',
    priorities: [{ finding_id: 'f', explanation: 'Review intended access.' }],
    limitations: ['Production untested'],
    next_steps: ['Review findings.'],
  };
  expect(validateSummaryOutput(JSON.stringify(output), ['f']).priorities).toHaveLength(1);
  expect(() => validateSummaryOutput(JSON.stringify(output), ['other'])).toThrow(
    'AI_REFERENCE_INVALID',
  );
  expect(() =>
    validateSummaryOutput(JSON.stringify({ ...output, summary: 'CREATE POLICY dangerous' }), ['f']),
  ).toThrow('AI_WORDING_INVALID');
});
it('records model outage without manufacturing a summary', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const summary = await summarizeProject([], null, 1, 0, () => {});
  expect(summary.status).toBe('unavailable');
  expect(summary.output).toBeNull();
  expect(summary.duration_ms).toBeGreaterThanOrEqual(0);
});
