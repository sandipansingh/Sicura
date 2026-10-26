import { scanCredentials } from '../../packages/core/src/secrets/redact';
import { classifyCredential } from '../../packages/core/src/secrets/classify';
import { modelInput } from '../../packages/core/src/ai/ollama';
import { credentialFindings } from '../../packages/core/src/secrets/findings';
import { redactValue } from '../../packages/core/src/secrets/sink';
import { validate, type DetectorRecipe, type EvalCase } from '../../packages/contracts/src/index';
import { fixture } from './dataset';
import { counts, confusion } from './metrics';

function source(recipe: DetectorRecipe['recipe']): string {
  const invalid = ['TEST_ONLY', 'INVALID_CANARY_MATERIAL'].join('_');
  const uri = `postgresql://demo:${invalid}@example.invalid/db`;
  const token = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from('{"role":"service_role"}').toString('base64url'),
    'TEST_ONLY_INVALID_SIGNATURE',
  ].join('.');
  switch (recipe) {
    case 'provider_invalid_marker':
      return `const apiKey = '${['sb_secret', invalid].join('_')}'`;
    case 'db_invalid_host':
      return `DATABASE_URL='${uri}'`;
    case 'jwt_invalid_signature':
      return `const authToken = '${token}'`;
    case 'pem_invalid_material':
      return `-----BEGIN PRIVATE KEY-----\n${invalid}\n-----END PRIVATE KEY-----`;
    case 'cloud_invalid_pair':
      return `AWS_ACCESS_KEY_ID='TEST_ONLY_INVALID_ID'\nAWS_SECRET_ACCESS_KEY='${invalid}'`;
    case 'client_secret_sentinel':
      return `CLIENT_SECRET='${invalid}'`;
    case 'public_client_id':
      return "const clientId='TEST_ONLY_PUBLIC_ID'";
    case 'publishable_identifier':
      return `const publicKey='${['sb_publishable', invalid].join('_')}'`;
    case 'placeholder':
      return "SERVICE_ROLE_KEY='TEST_ONLY_NOT_A_KEY'";
    case 'env_reference':
      return 'const secret = process.env.API_KEY;';
    case 'content_hash':
      return "const contentHash='abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'";
    case 'public_certificate':
      return '-----BEGIN PUBLIC KEY-----\nTEST_ONLY_INVALID_MATERIAL\n-----END PUBLIC KEY-----';
  }
}
export async function runDetector(id: string): Promise<EvalCase> {
  const started = performance.now();
  const recipe = await fixture(`eval/fixtures/credentials/recipes/${id}.json`, 'DetectorRecipe');
  const raw = source(recipe.recipe);
  const key = Buffer.alloc(32, 7);
  const detected = scanCredentials('config.env', raw, key).filter(
    (c) => !['placeholder', 'public_identifier'].includes(c.evidence.classification),
  );
  const unique = new Set(detected.map((c) => `${c.line}:${c.evidence.credential_type}`));
  const actual = unique.size > 0;
  const metrics = { ...counts(), ...confusion(recipe.positive, actual) };
  if (recipe.positive && unique.size > 1) metrics.fp += unique.size - 1;
  const findings = credentialFindings('config.env', raw, id, 1);
  const sinks = [
    findings,
    findings.map(modelInput),
    redactValue({ findings }),
    redactValue({ error: raw }),
  ];
  const canary = ['TEST_ONLY', 'INVALID_CANARY_MATERIAL'].join('_');
  metrics.inspected_sinks = sinks.length;
  metrics.leaked_canaries = recipe.positive
    ? sinks.filter((v) => JSON.stringify(v).includes(canary)).length
    : 0;
  const failures = [];
  if (actual !== recipe.positive || metrics.fp)
    failures.push('Detector candidate label disagreement');
  if (metrics.leaked_canaries) failures.push('Canary reached an inspected sink');
  return validate('EvalCase', {
    id,
    suite: 'detector',
    status: failures.length ? 'failed' : 'passed',
    duration_ms: performance.now() - started,
    failures,
    counts: metrics,
    rls: null,
    ai_analysis: null,
  });
}
export async function runContext(id: string): Promise<EvalCase> {
  const started = performance.now();
  const f = await fixture(`eval/fixtures/credentials/context/${id}.json`, 'ContextFixture');
  const classification = classifyCredential(f.facts);
  const actual = classification === 'likely_secret' && f.facts.exposure !== 'unknown';
  const failures =
    classification !== f.expected_classification || actual !== f.positive
      ? ['Injected candidate context label disagreement']
      : [];
  return validate('EvalCase', {
    id,
    suite: 'context',
    status: failures.length ? 'failed' : 'passed',
    duration_ms: performance.now() - started,
    failures,
    counts: { ...counts(), ...confusion(f.positive, actual) },
    rls: null,
    ai_analysis: null,
  });
}
