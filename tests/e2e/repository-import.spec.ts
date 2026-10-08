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
  expect(view.snapshot).toBeNull();
  expect(view.runs).toHaveLength(0);
  expect(text).not.toContain(secret);
  expect(await page.content()).not.toContain(secret);
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Run local verification' })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete local project' }).click();
});
