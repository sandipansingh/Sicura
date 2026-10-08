import { expect, test } from '@playwright/test';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
test.use({ video: 'off' });

test('dashboard URL import persists redacted credential work and explicit unsupported-chain coverage across refresh', async ({
  page,
}) => {
  const secret = 'sb_secret_TEST_ONLY_DASHBOARD_IMPORT_CANARY';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(
    page
      .getByText('Add a project', { exact: true })
      .or(page.getByText('Import another project or analyze replacement files', { exact: true })),
  ).toBeVisible();
  const intake = page.getByText('Import another project or analyze replacement files', {
    exact: true,
  });
  if (await intake.isVisible()) await intake.click();
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/proofsec-fixtures/import-example');
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await expect(page.getByText(/Credential coverage: 3 UTF-8 files/)).toBeVisible();
  await expect(
    page.getByText(/RLS verification coverage: unsupported sql · SQL_UNSUPPORTED/),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Credential coverage: 3 UTF-8 files/)).toBeVisible();
  const projects = validate(
    'ProjectsResponse',
    parseStrictJson(await (await page.request.get('/api/projects')).text()),
  );
  const project = projects.projects.at(-1)!;
  const text = await (await page.request.get(`/api/projects/${project.id}`)).text();
  const view = validate('ProjectView', parseStrictJson(text, 16 * 1024 * 1024));
  expect(view.jobs.filter((j) => j.kind === 'import')).toHaveLength(1);
  expect(view.findings.some((f) => f.category === 'CREDENTIAL_EXPOSURE')).toBe(true);
  expect(view.sql_analysis?.diagnostics.some((d) => d.code === 'SQL_FUNCTION_UNSUPPORTED')).toBe(
    true,
  );
  expect(view.findings.some((f) => f.source.kind === 'sql_ast')).toBe(true);
  expect(view.summary).not.toBeNull();
  expect(view.snapshot).toBeNull();
  expect(view.runs).toHaveLength(0);
  expect(text).not.toContain(secret);
  expect(await page.content()).not.toContain(secret);
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Run local verification' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Gemma Analysis — advisory' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry Gemma summary' })).toBeEnabled({
    timeout: 90000,
  });
  await expect(page.getByLabel('This path was deleted')).toHaveCount(0);
  await page.getByText('Import another repository', { exact: true }).click();
  await expect(page.getByLabel('Schema and source files', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Analyze files', exact: true })).toHaveCount(0);
  const rescan = page.waitForResponse(
    (r) => r.url().endsWith('/rescan-repository') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Rescan repository' }).click();
  expect((await rescan).status()).toBe(202);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry Gemma summary' })).toBeEnabled({
    timeout: 90000,
  });
  await page.getByRole('button', { name: 'Delete local project' }).click();
});
