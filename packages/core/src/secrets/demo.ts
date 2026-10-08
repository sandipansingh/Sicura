import { validate, type Finding } from '../../../contracts/src/index';
import { credentialFindings } from './findings';

export const DEMO_CREDENTIAL_PATH = 'frontend/src/lib/supabase.ts';
/** Trusted bundled adapter only. Normal uploads cannot request candidate injection. */
export function demoCredential(
  project_id: string,
  revision: number,
  key: Buffer,
): { finding: Finding; fingerprint: string } {
  let fingerprint = '';
  const base = credentialFindings(
    DEMO_CREDENTIAL_PATH,
    "const SERVICE_ROLE_KEY = 'TEST_ONLY_NOT_A_KEY';",
    project_id,
    revision,
    {
      key,
      capture: (_id, fp) => {
        fingerprint = fp;
      },
    },
  )[0]!;
  const finding = validate('Finding', {
    ...base,
    title: 'Synthetic credential fixture — privileged frontend exposure',
    severity: 'critical',
    severity_basis:
      'Potential impact of privileged frontend exposure; injected synthetic candidate, not a usable credential',
    state: 'confirmed',
    suppression: null,
    evidence: {
      ...base.evidence,
      classification: 'likely_secret',
      use_context:
        'Synthetic credential fixture: injected candidate facts, not a usable credential or a detector-recall measurement.',
    },
    context: {
      ...base.context,
      signals: ['Synthetic credential fixture', 'Privileged literal in frontend context'],
      limitations: [
        ...base.context.limitations,
        'Candidate injection is inaccessible in normal uploads.',
      ],
    },
    timestamps: { ...base.timestamps, confirmed_at: base.timestamps.created_at },
  });
  return { finding, fingerprint };
}
