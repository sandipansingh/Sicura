import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
import { credentialTitle, uploadCanary, uploadProject } from '../support/upload-project';

test('flagship: real replica confirmation, human approval, identical retest and export', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await expect(page).toHaveTitle('Sicura · Investigation workbench');
  await expect(page.getByRole('link', { name: 'Sicura', exact: true })).toHaveText('SSICURA');
  if (process.env.PROOFSEC_RECORD_FALLBACK === '1') {
    await page.evaluate(
      ({ commit, timestamp }) => {
        const label = document.createElement('div');
        label.textContent = `PRERECORDED FALLBACK · actual local-replica run · ${timestamp} · ${commit.slice(0, 8)}`;
        label.style.cssText =
          'position:fixed;bottom:0;left:0;right:0;background:#171d2b;color:white;padding:8px 16px;z-index:99999;font:14px sans-serif;pointer-events:none';
        document.body.appendChild(label);
      },
      {
        commit: process.env.PROOFSEC_RECORD_COMMIT ?? 'unknown',
        timestamp: process.env.PROOFSEC_RECORD_TIMESTAMP ?? 'unknown',
      },
    );
  }
  await uploadProject(page);
  await expect(page.getByLabel('Category filter')).toBeVisible();
  await page.getByLabel('Category filter').selectOption('CREDENTIAL_EXPOSURE');
  await expect(
    page.getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: credentialTitle,
    }),
  ).toBeVisible();
  await page.getByLabel('Category filter').selectOption('all');
  await page
    .getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' })
    .click();
  await expect(page.getByRole('heading', { name: 'AI Analysis — advisory' })).toBeVisible();
  await page.getByRole('button', { name: 'Investigate with Gemma' }).click();
  await expect(page.getByText(/gemma4:e4b · prompt/)).toBeVisible();
  await page.getByRole('button', { name: 'Run local verification', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Run local verification', exact: true })
    .click();
  await expect(page.getByText('Confirmed in replica', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Verified Evidence — local replica' }),
  ).toBeVisible();
  await expect(page.locator('td:nth-child(4)').filter({ hasText: /^ALLOW/ })).toHaveCount(4);
  await page.getByRole('button', { name: 'Review suggested patch' }).click();
  await expect(
    page.getByText(
      'Apply this reviewed migration to a disposable local replica, then rerun the recorded scenarios and regressions.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve and apply to replica' }).click();
  await expect(
    page.getByRole('heading', { name: 'Fix verified in replica', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Identical scenarios: pass · Regressions: pass')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export migration file' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('migration.sql');
  await page.screenshot({ path: info.outputPath('flagship.png'), fullPage: true });
  expect(await page.content()).not.toContain(uploadCanary);
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export redacted report', exact: true }).click();
  const reportPath = info.outputPath('report.json');
  await (await reportDownload).saveAs(reportPath);
  const exported = validate(
    'ExportReport',
    parseStrictJson(await readFile(reportPath, 'utf8'), 16 * 1024 * 1024),
  );
  expect(JSON.stringify(exported)).not.toContain(uploadCanary);
  expect(exported.finding.state).toBe('fixed');
  expect(exported.finding.retest_result?.regressions_passed).toBe(true);
  const readableDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export readable report' }).click();
  await (await readableDownload).saveAs(info.outputPath('report.md'));
  await page.getByRole('button', { name: 'All findings' }).click();
  await page.getByLabel('Show suppressed').check();
  await page
    .getByRole('button', { name: 'Potentially over-broad SELECT policy on posts' })
    .first()
    .click();
  await expect(page.getByText('all rows', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Intentionally public — declared SELECT access', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('td:nth-child(4)').filter({ hasText: /^ALLOW/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'All findings' }).click();
  await page.getByRole('button', { name: credentialTitle }).click();
  await expect(
    page.getByRole('heading', { name: 'Static exposure evidence — validity not tested' }),
  ).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: '[REDACTED]' })).toBeVisible();
  await expect(page.getByText('Validity was not tested.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Rescan complete source scope' }).click();
  await page.getByLabel('This path was deleted').check();
  await page
    .getByLabel('These files and deletions describe the complete submitted source scope')
    .check();
  await page.getByRole('button', { name: 'Confirm complete scope and rescan' }).click();
  await page.getByRole('button', { name: 'Findings', exact: false }).first().click();
  await page.getByRole('button', { name: credentialTitle }).click();
  await expect(
    page.getByText(
      'Exposure removed from submitted files; rotation and previously published artifacts were not verified.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
