import type { SchemaSnapshot } from '../../packages/contracts/src/index';
import { validate } from '../../packages/contracts/src/index';
import { fixture } from './dataset';
/** Explicit mock catalogue for validator-only attacks; never used as observation evidence. */
export async function validatorFixture() {
  const finding = await fixture('packages/contracts/fixtures/rls-finding.json', 'Finding');
  const output = await fixture('packages/contracts/fixtures/gemma-output.json', 'GemmaOutput');
  const snapshot: SchemaSnapshot = validate('SchemaSnapshot', {
    id: 'validator_mock',
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
        primary_key: ['user_id'],
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
  });
  return { finding, output, snapshot };
}
