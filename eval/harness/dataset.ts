import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  parseStrictJson,
  validate,
  type ContractMap,
  type DatasetManifest,
} from '../../packages/contracts/src/index';
import { hash } from '../../packages/core/src/hash';
import { AppError } from '../../packages/core/src/errors';
export const MANIFEST_PATH = 'eval/datasets/v1.manifest.json';
export async function fixture<K extends keyof ContractMap>(
  path: string,
  type: K,
): Promise<ContractMap[K]> {
  return validate(type, parseStrictJson(await readFile(path, 'utf8'), 1024 * 1024));
}
export async function freezeDataset(): Promise<void> {
  const ids = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);
  const suites = {
    detector: ids('CD', 12),
    context: ids('CC', 20),
    rls: ids('R', 13),
    adversarial: [
      'ADV-02',
      'ADV-03',
      'ADV-04',
      'ADV-05',
      'ADV-07',
      'ADV-08',
      'ADV-09',
      'ADV-10',
      'ADV-11',
      'ADV-15',
    ],
    ai: ids('AI', 4),
  };
  const paths = [
    ...suites.detector.map((id) => `eval/fixtures/credentials/recipes/${id}.json`),
    ...suites.context.map((id) => `eval/fixtures/credentials/context/${id}.json`),
    ...suites.rls.flatMap((id) =>
      ['schema.sql', 'expectations.json', 'labels.json'].map(
        (name) => `eval/fixtures/rls/${id}/${name}`,
      ),
    ),
    ...suites.adversarial.map((id) => `eval/fixtures/adversarial/${id}.json`),
    ...suites.ai.map((id) => `eval/fixtures/ai/${id}.json`),
  ];
  const files = [];
  for (const path of paths.sort()) {
    const bytes = await readFile(path);
    files.push({ path, sha256: hash(bytes.toString('utf8')), bytes: bytes.byteLength });
  }
  const manifest = validate('DatasetManifest', {
    id: 'proofsec-curated-v1-tier1',
    version: 1,
    created_at: new Date().toISOString(),
    suites,
    files,
    variants: [],
    limitations: [
      'Synthetic invalid detector recipes; no credential validity tested',
      'Context candidate injection is separate from end-to-end detector metrics',
      '13 RLS base fixtures; R-14 and six target seeder variants not implemented',
      'Four live AI cases; faithfulness rubric requires human review',
      'Ten adversarial fixtures; omitted IDs are not claimed',
    ],
  });
  await mkdir('eval/datasets', { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
}
export async function frozenDataset(): Promise<{ manifest: DatasetManifest; digest: string }> {
  const manifest = await fixture(MANIFEST_PATH, 'DatasetManifest');
  for (const f of manifest.files) {
    if (!/^eval\/fixtures\/[A-Za-z0-9_./-]+$/.test(f.path) || f.path.split('/').includes('..'))
      throw new AppError('EVAL_DATASET_DRIFT');
    const bytes = await readFile(f.path);
    if (bytes.byteLength !== f.bytes || hash(bytes.toString('utf8')) !== f.sha256)
      throw new AppError('EVAL_DATASET_DRIFT');
  }
  return { manifest, digest: hash(manifest) };
}
