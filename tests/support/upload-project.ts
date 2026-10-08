import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

export const credentialTitle = 'Credential-like literal exposed in submitted artifacts';
export const uploadCanary = 'sb_secret_TEST_ONLY_UPLOAD_CANARY';

/** Exercise ordinary bounded file admission; no trusted candidate injection. */
export async function uploadProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByLabel('Schema and source files', { exact: true }).setInputFiles([
    {
      name: 'schema.sql',
      mimeType: 'text/plain',
      buffer: await readFile('eval/fixtures/rls/R-01/schema.sql'),
    },
    {
      name: 'client.ts',
      mimeType: 'text/plain',
      buffer: Buffer.from(`const serviceRoleKey = "${uploadCanary}";`),
    },
  ]);
  await page.getByLabel('Expectation manifest (optional)', { exact: true }).setInputFiles({
    name: 'expectations.json',
    mimeType: 'application/json',
    buffer: await readFile('eval/fixtures/rls/R-01/expectations.json'),
  });
  await expect(page.getByText(/Manifest: \d+ declared rules/)).toBeVisible();
  await page.getByRole('button', { name: 'Analyze files', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Potentially over-broad SELECT policy on profiles',
      exact: true,
    }),
  ).toBeVisible({ timeout: 45000 });
}
