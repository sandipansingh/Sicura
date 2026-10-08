import { expect, test } from '@playwright/test';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
test.use({ video: 'off' });
test('imports helper migrations automatically and records real controlled access observations', async ({
  page,
}) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(
    page
      .getByText('Add a project', { exact: true })
      .or(page.getByText('Import another project or analyze replacement files', { exact: true }))
      .or(page.getByText('Import another repository', { exact: true })),
  ).toBeVisible();
  const other = page
    .getByText('Import another project or analyze replacement files', {
      exact: true,
    })
    .or(page.getByText('Import another repository', { exact: true }));
  if (await other.isVisible()) await other.click();
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/proofsec-fixtures/replay-example');
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await expect(
    page.getByText('Replica catalogue available; review intended access before verification.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Schema and source files', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run local verification' })).toBeEnabled({
    timeout: 90000,
  });
  const response = validate(
    'ProjectsResponse',
    parseStrictJson(await (await page.request.get('/api/projects')).text()),
  );
  const id = response.projects.at(-1)!.id;
  await page.getByRole('button', { name: 'Run local verification' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run local verification' }).click();
  await expect
    .poll(async () => {
      const view = validate(
        'ProjectView',
        parseStrictJson(await (await page.request.get(`/api/projects/${id}`)).text(), 16777216),
      );
      return view.runs.length;
    })
    .toBe(1);
  const view = validate(
    'ProjectView',
    parseStrictJson(await (await page.request.get(`/api/projects/${id}`)).text(), 16777216),
  );
  expect(view.snapshot?.replay_profile).toBe('repository-v3');
  expect(view.runs[0]?.coverage.executed).toBeGreaterThan(0);
  expect(view.sql_analysis?.diagnostics).toHaveLength(0);
  expect(view.jobs.every((j) => j.status !== 'failed')).toBe(true);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete local project' }).click();
});
