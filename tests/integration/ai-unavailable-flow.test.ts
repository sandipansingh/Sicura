import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
import { uploadProject } from '../support/upload-project';

it('keeps the real browser/worker replica loop usable through AI endpoint loss, refresh and double approval', async () => {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done) => listener.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const data = resolve('.local/ai-unavailable-audit');
  await mkdir(data, { recursive: true });
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PROOFSEC_ORIGIN: origin,
      PROOFSEC_DATA_DIR: data,
      NODE_OPTIONS: '--import=' + resolve('tests/support/ollama-outage.mjs'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-262144);
    });
  const browser = await chromium.launch();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(origin + '/api/session', { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        /* Startup only. */
      }
      if (ready || child.exitCode !== null) break;
      await delay(100);
    }
    expect(ready).toBe(true);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.name));
    await page.goto(origin + '/app');
    await uploadProject(page);
    await page
      .getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' })
      .click({ timeout: 45000 });
    await page.getByRole('button', { name: 'Investigate with Gemma' }).click();
    await browserExpect(
      page.getByText(
        'AI analysis unavailable. Gemma analysis is unavailable. Deterministic evidence remains available.',
      ),
    ).toBeVisible({ timeout: 45000 });
    const queued = page.waitForResponse(
      (r) => r.url().endsWith('/verify') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Run local verification', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Run local verification', exact: true })
      .click();
    const { job } = validate('JobEnvelope', parseStrictJson(await (await queued).text()));
    await page.reload();
    await page.getByRole('button', { name: 'Findings', exact: true }).click();
    await page
      .getByRole('button', {
        name: /Potentially over-broad SELECT policy on profiles|SELECT mismatch reproduced in local replica/,
      })
      .first()
      .click({ timeout: 45000 });
    await browserExpect(page.getByText('Confirmed in replica', { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await page.getByRole('button', { name: 'Review suggested patch' }).click();
    let approvals = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/approve') && r.method() === 'POST') approvals++;
    });
    await page.getByRole('button', { name: 'Approve and apply to replica' }).dblclick();
    await browserExpect(
      page.getByRole('heading', { name: 'Fix verified in replica', exact: true }),
    ).toBeVisible({ timeout: 45000 });
    const view = validate(
      'ProjectView',
      parseStrictJson(
        await (await page.request.get(origin + '/api/projects/' + job.project_id)).text(),
        16 * 1024 * 1024,
      ),
    );
    const f = view.findings.find(
      (f) =>
        f.expectation?.resource.table === 'profiles' &&
        f.expectation.actor === 'authenticated' &&
        f.expectation.operation === 'SELECT',
    )!;
    expect(view.jobs.filter((j) => j.kind === 'verify')).toHaveLength(1);
    expect(view.jobs.filter((j) => j.kind === 'retest')).toHaveLength(1);
    expect(approvals).toBe(1);
    expect(f.ai_analysis.status).toBe('unavailable');
    expect(f.ai_analysis.output).toBeNull();
    expect(f.state).toBe('fixed');
    expect(f.retest_result?.identical_scenarios).toBe(true);
    expect(errors).toEqual([]);
    expect(logs.includes(['sb_secret', 'TEST_ONLY_LOG_CANARY'].join('_'))).toBe(false);
    await page.screenshot({ path: resolve(data, 'ai-unavailable.png'), fullPage: true });
  } finally {
    await browser.close();
    const closed = new Promise<void>((done) => child.once('exit', () => done()));
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid!, 'SIGTERM');
      const timer = setTimeout(() => {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid!, 'SIGKILL');
      }, 10000);
      await closed;
      clearTimeout(timer);
    }
    await writeFile(resolve(data, 'server.log'), logs);
  }
});
