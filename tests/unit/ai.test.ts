import { expect, it } from 'vitest';
import finding from '../../packages/contracts/fixtures/rls-finding.json';
import output from '../../packages/contracts/fixtures/gemma-output.json';
import { validate } from '../../packages/contracts/src/index';
import { modelInput, validateModelOutput } from '../../packages/core/src/ai/ollama';
import type { SchemaSnapshot } from '../../packages/core/src/rls/introspect';

const snapshot = {
  id: 'snapshot',
  digest: 'a'.repeat(64),
  postgres_version: '17',
  tables: [
    {
      schema: 'public',
      name: 'profiles',
      owner: 'schema_loader',
      rls_enabled: true,
      force_rls: false,
      columns: [
        {
          name: 'user_id',
          type: 'uuid',
          not_null: true,
          identity: '',
          generated: '',
          default_expression: null,
          owner_fk: true,
        },
      ],
      primary_key: ['id'],
      constraints: [],
      policies: [
        {
          name: 'profiles_select',
          command: 'SELECT',
          permissive: true,
          roles: ['authenticated'],
          using: 'true',
          check: null,
        },
      ],
      grants: {
        authenticated: { SELECT: true, INSERT: true, UPDATE: true, DELETE: true },
        anon: { SELECT: true, INSERT: true, UPDATE: true, DELETE: true },
      },
    },
  ],
} satisfies SchemaSnapshot;
it('validates references without activating proposals or writing evidence', () => {
  const input = modelInput(validate('Finding', finding));
  const text = JSON.stringify(output);
  expect(validateModelOutput(text, input, snapshot).recommended_test_id).toBe(
    'rls.cross_user_read.v1',
  );
  expect(input.expectation?.source).toBe('declared');
});
it('rejects arbitrary SQL/tests, duplicate keys, missing evidence and unknown columns', () => {
  const input = modelInput(validate('Finding', finding));
  for (const invalid of [
    { ...output, sql: 'DROP TABLE x' },
    { ...output, recommended_test_id: 'run_sql' },
    { ...output, evidence_refs: ['fake'] },
    { ...output, remediation_intent: { ...output.remediation_intent, owner_column: 'missing' } },
  ])
    expect(() => validateModelOutput(JSON.stringify(invalid), input, snapshot)).toThrow();
  expect(() => validateModelOutput('{"finding_id":"a","finding_id":"b"}', input, snapshot)).toThrow(
    'DUPLICATE_JSON_KEY',
  );
});
it('rejects unqualified inferred explanations and absolute safety claims', () => {
  const f = validate('Finding', structuredClone(finding));
  f.expectation!.source = 'inferred';
  const input = modelInput(f);
  expect(() => validateModelOutput(JSON.stringify(output), input, snapshot)).toThrow(
    'AI_QUALIFICATION_INVALID',
  );
  const qualified = {
    ...output,
    context_interpretation: 'The inferred owner-only expectation is not a human declaration.',
  };
  expect(validateModelOutput(JSON.stringify(qualified), input, snapshot)).toEqual(qualified);
  expect(() =>
    validateModelOutput(
      JSON.stringify({ ...qualified, explanation: 'The database is fully safe and secure.' }),
      input,
      snapshot,
    ),
  ).toThrow('AI_WORDING_INVALID');
});
