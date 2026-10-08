import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir, arch, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { validate, parseStrictJson } from '../packages/contracts/src/index';
import { hash } from '../packages/core/src/hash';
import { createHash } from 'node:crypto';
import lock from '../config/runtime-lock.json';
import { makeReport } from '../eval/harness/runtime';

const artifact = resolve(process.argv[2] ?? '.local/artifacts/sicura-0.3.0.tgz');
const dir = await mkdtemp(join(tmpdir(), 'proofsec-consumer-gate-'));
const consumer = join(dir, 'consumer');
const workspace = join(dir, 'workspace');
const data = join(dir, 'data');
await mkdir(consumer);
await mkdir(join(workspace, 'supabase/migrations'), { recursive: true });
const secret = 'sb_secret_TEST_ONLY_CONSUMER_CANARY';
const started = performance.now();
const metadata = await makeReport('deterministic', [], 0, []);
const install = execFileSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--prefix', consumer, '--no-audit', '--no-fund', artifact],
  { encoding: 'utf8', timeout: 180000 },
);
if (install.includes(secret)) throw new Error('CONSUMER_SECRET_LEAK');
execFileSync('git', ['init', '-q', workspace]);
await writeFile(
  join(workspace, 'supabase/migrations/1_schema.sql'),
  `CREATE TABLE public.profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), value text NOT NULL DEFAULT 'synthetic', created timestamptz DEFAULT now()); ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.profiles TO authenticated; CREATE POLICY broad ON public.profiles FOR SELECT TO authenticated USING (true);`,
);
await writeFile(join(workspace, 'client.ts'), `const serviceRoleKey = "${secret}";`);
const executable = join(consumer, 'node_modules/sicura/bin/sicura.mjs');
const packageRoot = join(consumer, 'node_modules/sicura');
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
if (manifest.name !== 'sicura' || manifest.bin.sicura !== 'bin/sicura.mjs')
  throw new Error('CONSUMER_PACKAGE_INVALID');
for (const path of ['eval/fixtures', 'eval/reports']) {
  try {
    await readdir(join(packageRoot, path));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
  throw new Error('CONSUMER_TEST_ASSETS_SHIPPED');
}
const help = execFileSync(process.execPath, [executable, '--help'], { encoding: 'utf8' });
if (!['sicura scan', 'sicura ui', 'sicura doctor'].every((command) => help.includes(command)))
  throw new Error('CONSUMER_CLI_INVALID');
const notice = await readFile(join(packageRoot, 'NOTICE'), 'utf8');
if (!notice.startsWith('Sicura\n') || !notice.includes('Ollama'))
  throw new Error('CONSUMER_NOTICE_INVALID');
const port = 3229;
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [executable, 'scan', workspace, '--no-open', '--port', String(port)],
  {
    cwd: consumer,
    env: { ...process.env, PROOFSEC_DATA_DIR: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
child.stdout.on('data', (b: Buffer) => {
  output += b.toString();
});
child.stderr.on('data', (b: Buffer) => {
  output += b.toString();
});
const browser = await chromium.launch({ headless: true });
try {
  await expect.poll(() => output.includes('Dashboard:'), { timeout: 45000 }).toBe(true);
  if (output.includes(secret)) throw new Error('CONSUMER_SECRET_LEAK');
  const url = output.match(/Dashboard: (http:\/\/127\.0\.0\.1:\d+\/app\?project=([A-Za-z0-9_]+))/);
  if (!url) throw new Error('CONSUMER_URL_MISSING');
  const project_id = url[2]!;
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url[1]!);
  await expect(page).toHaveTitle('Sicura · Investigation workbench');
  await expect(page.getByRole('link', { name: 'Sicura', exact: true })).toHaveText('SSICURA');
  await expect(page.getByRole('button', { name: 'Evaluation', exact: true })).toHaveCount(0);
  await expect(page.getByText(/flagship|demo/i)).toHaveCount(0);
  await expect(page.getByText(/Supported SQL admitted/)).toBeVisible({ timeout: 45000 });
  await expect(page.getByLabel('Schema and source files', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run local verification' })).toBeEnabled({
    timeout: 90000,
  });
  const screenshots = resolve('.local/ui-review/release-installed');
  await mkdir(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(screenshots, 'workbench-desktop.png'), fullPage: true });
  await page.goto(origin);
  await expect(page.getByRole('link', { name: 'Open workbench', exact: true })).toBeVisible();
  await page.screenshot({ path: join(screenshots, 'landing-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error('CONSUMER_LAYOUT_OVERFLOW');
  await page.screenshot({ path: join(screenshots, 'landing-mobile.png'), fullPage: true });
  await page.goto(url[1]!);
  await expect(page.getByText(/Supported SQL admitted/)).toBeVisible();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error('CONSUMER_LAYOUT_OVERFLOW');
  await page.screenshot({ path: join(screenshots, 'workbench-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByText(/Supported SQL admitted/)).toBeVisible();
  for (const path of ['/api/demo', '/api/evaluation']) {
    const response = await page.request.get(origin + path);
    if (
      response.status() !== 404 ||
      validate('ApiError', parseStrictJson(await response.text())).error.code !== 'NOT_FOUND'
    )
      throw new Error('CONSUMER_RELEASE_ENDPOINT_INVALID');
  }
  const session = validate(
    'SessionResponse',
    parseStrictJson(await (await page.request.get(origin + '/api/session')).text()),
  );
  const removedPost = await page.request.post(origin + '/api/demo', {
    headers: { origin, 'x-csrf-token': session.csrf_token },
    data: {},
  });
  if (
    removedPost.status() !== 404 ||
    validate('ApiError', parseStrictJson(await removedPost.text())).error.code !== 'NOT_FOUND'
  )
    throw new Error('CONSUMER_RELEASE_ENDPOINT_INVALID');
  await expect(
    page.getByRole('button', { name: 'Run local verification', exact: true }),
  ).toBeEnabled({ timeout: 90000 });
  const view = validate(
    'ProjectView',
    parseStrictJson(
      await (await page.request.get(`${origin}/api/projects/${project_id}`)).text(),
      16 * 1024 * 1024,
    ),
  );
  if (view.summary?.status !== 'available' || !view.summary.output)
    throw new Error('CONSUMER_PROJECT_SUMMARY_UNAVAILABLE');
  if (view.jobs.filter((j) => j.kind === 'import').length !== 1)
    throw new Error('CONSUMER_DUPLICATE_IMPORT');
  const importedExpectation = view.expectations.find(
    (e) =>
      e.actor === 'authenticated' && e.operation === 'SELECT' && e.resource.table === 'profiles',
  )!;
  if (importedExpectation.source !== 'inferred') throw new Error('CONSUMER_EXPECTATION_MISSING');
  const edit = await page.request.put(`${origin}/api/projects/${project_id}/expectations`, {
    headers: { origin, 'x-csrf-token': session.csrf_token },
    data: {
      expected_revision: view.project.expectation_set_revision,
      changes: ['authenticated', 'anon'].flatMap((actor) =>
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((operation) => ({
          resource: importedExpectation.resource,
          actor,
          operation,
          expected:
            actor === 'authenticated' && operation === 'SELECT' ? 'own_rows_only' : 'deny_all',
          owner_column: actor === 'authenticated' ? 'user_id' : null,
          team_binding: null,
          intentionally_public: false,
          rationale:
            'Human-reviewed synthetic fixture: private reads, writes and anonymous access denied',
        })),
      ),
    },
  });
  if (!edit.ok()) throw new Error('CONSUMER_EXPECTATION_SAVE_FAILED');
  await page.reload();
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' })
    .click();
  await page.getByRole('button', { name: 'Investigate with Gemma' }).click();
  await expect(page.getByText(/gemma4:e4b · prompt/)).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Run local verification', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Run local verification', exact: true })
    .click();
  await expect(page.getByText('Confirmed in replica', { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.getByRole('button', { name: 'Review suggested patch' }).click();
  await page.getByRole('button', { name: 'Approve and apply to replica' }).click();
  await expect(
    page.getByRole('heading', { name: 'Fix verified in replica', exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export redacted report', exact: true }).click();
  const reportFile = join(dir, 'report.json');
  await (await download).saveAs(reportFile);
  const exportedText = await readFile(reportFile, 'utf8');
  const exported = validate('ExportReport', parseStrictJson(exportedText, 16 * 1024 * 1024));
  if (exported.finding.state !== 'fixed' || exportedText.includes(secret))
    throw new Error('CONSUMER_EXPORT_INVALID');
  // Ordinary verification rebuilds the submitted vulnerable inputs. It must
  // supersede the current fix projection, while retaining the approved retest.
  await page.getByRole('button', { name: 'Run local verification', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Run local verification', exact: true })
    .click();
  await expect(page.getByText('Confirmed in replica', { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(
    page.getByRole('heading', { name: 'Fix verified in replica', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Identical scenarios: pass/)).toHaveCount(0);
  const reopened = validate(
    'ProjectView',
    parseStrictJson(
      await (await page.request.get(origin + '/api/projects/' + project_id)).text(),
      16 * 1024 * 1024,
    ),
  );
  const current = reopened.findings.find((f) => f.id === exported.finding.id)!;
  if (
    current.state !== 'confirmed' ||
    current.retest_result !== null ||
    current.remediation.patch_id !== null ||
    !current.verification.evidence.some(
      (r) => r.expected === 'deny' && r.observed === 'allow' && r.outcome === 'mismatch',
    ) ||
    !reopened.runs.some((r) => r.id === exported.finding.retest_result!.run_id)
  )
    throw new Error('CONSUMER_REVERIFICATION_INVALID');
  await page.getByRole('button', { name: 'Review suggested patch' }).click();
  await page.getByRole('button', { name: 'Approve and apply to replica' }).click();
  await expect(
    page.getByRole('heading', { name: 'Fix verified in replica', exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const finalView = await (await page.request.get(`${origin}/api/projects/${project_id}`)).text();
  if (
    output.includes(secret) ||
    finalView.includes(secret) ||
    (await page.content()).includes(secret) ||
    errors.length
  )
    throw new Error('CONSUMER_SINK_INVALID');
  const inspect = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (entry.isFile() && (await readFile(file)).includes(Buffer.from(secret)))
        throw new Error('CONSUMER_SECRET_LEAK');
    }
  };
  await inspect(data);
  await inspect(join(consumer, 'node_modules/sicura/runtime/web/.next'));
  const remaining = execFileSync(
    'docker',
    ['ps', '-aq', '--filter', `label=io.proofsec.scope=${hash(resolve(data)).slice(0, 24)}`],
    { encoding: 'utf8' },
  ).trim();
  if (remaining) throw new Error('CONSUMER_REPLICA_REMAINING');
  const result = {
    schema_version: '1.0',
    created_at: new Date().toISOString(),
    commit: metadata.commit,
    implementation_digest: metadata.implementation_digest,
    working_tree_dirty: metadata.working_tree_dirty,
    status: 'passed',
    artifact: artifact.split('/').at(-1),
    artifact_digest: createHash('sha256')
      .update(await readFile(artifact))
      .digest('hex'),
    duration_ms: performance.now() - started,
    project_summary_duration_ms: view.summary.duration_ms,
    hardware: {
      platform: process.platform,
      arch: arch(),
      cpu: cpus()[0]?.model,
      ram_bytes: totalmem(),
      gpu: metadata.hardware.gpu,
    },
    runtime: {
      node: process.versions.node,
      postgres_image: lock.postgres_image,
      model: lock.ollama_model,
    },
    dataset:
      'Synthetic consumer repository: one table, UUID/time defaults, broad SELECT, redaction sentinel',
    checks: [
      'npm install in empty consumer',
      'Sicura package/bin/help/NOTICE and production dashboard branding',
      'release navigation and absent demo/evaluation endpoints',
      'compiled CLI-to-production-dashboard import',
      'automatic live Gemma project summary; imported projects omit manual upload',
      'refresh/idempotency',
      'declared expectation',
      'live Gemma',
      'replica confirmation',
      'digest-bound approval/identical retest',
      'post-fix ordinary verification reopens mismatch without a current pass; fresh approval/retest',
      'export',
      'CLI/API/UI/SQLite/production-cache redaction',
      'owned replica cleanup',
    ],
    limitations: [
      'Only executed on the labeled host; Apple M4/macOS and Windows remain unperformed',
      'Synthetic rows and static credential exposure only',
    ],
  };
  await mkdir('.local/consumer', { recursive: true });
  await writeFile('.local/consumer/latest.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  child.kill('SIGTERM');
  await new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once('exit', () => done());
  });
  await rm(dir, { recursive: true, force: true });
}
