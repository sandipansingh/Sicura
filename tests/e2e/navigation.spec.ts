import { expect, test } from '@playwright/test';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
import { uploadProject } from '../support/upload-project';

test('release excludes demo and evaluation endpoints and ignores legacy demo links', async ({
  page,
}) => {
  const ready = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/projects' && response.request().method() === 'GET',
  );
  await page.goto('/app');
  await ready;
  const session = validate(
    'SessionResponse',
    parseStrictJson(await (await page.request.get('/api/session')).text()),
  );
  const before = validate(
    'ProjectsResponse',
    parseStrictJson(await (await page.request.get('/api/projects')).text()),
  );
  for (const path of ['/api/demo', '/api/evaluation']) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
    expect(validate('ApiError', parseStrictJson(await response.text())).error.code).toBe(
      'NOT_FOUND',
    );
  }
  const response = await page.request.post('/api/demo', {
    headers: { origin: 'http://127.0.0.1:3100', 'x-csrf-token': session.csrf_token },
    data: {},
  });
  expect(response.status()).toBe(404);
  expect(validate('ApiError', parseStrictJson(await response.text())).error.code).toBe('NOT_FOUND');
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') mutations.push(new URL(request.url()).pathname);
  });
  await page.goto('/app?demo=1');
  await expect(page).toHaveURL(/\/app(?:\?project=project_[a-f0-9]{32})?$/);
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button'),
  ).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Evaluation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /flagship|demo/i })).toHaveCount(0);
  const after = validate(
    'ProjectsResponse',
    parseStrictJson(await (await page.request.get('/api/projects')).text()),
  );
  expect(after.projects.map((p) => p.id)).toEqual(before.projects.map((p) => p.id));
  expect(mutations).toEqual([]);
});

test('landing enters the connected workbench and stays usable offline on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open workbench', exact: true })).toBeVisible({
    timeout: 2000,
  });
  await expect(
    page.getByText(/flagship|demo|evaluation|core protocol|workbench boundaries/i),
  ).toHaveCount(0);
  await page.screenshot({ path: '.local/ui-review/landing-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Open workbench', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(external).toEqual([]);
  await page.screenshot({ path: '.local/ui-review/workbench-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '.local/ui-review/workbench-desktop.png' });
});

test('file upload creates one project and legacy links retain that selected project', async ({
  page,
}) => {
  let creates = 0;
  let uploads = 0;
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/projects') creates++;
    if (path.endsWith('/inputs')) uploads++;
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Open workbench', exact: true }).click();
  await uploadProject(page);
  await expect(
    page.getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' }),
  ).toBeVisible({ timeout: 45000 });
  expect(creates).toBe(1);
  expect(uploads).toBe(1);
  const project = new URL(page.url()).searchParams.get('project');
  expect(project).toMatch(/^project_[a-f0-9]{32}$/);
  await page.reload();
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' }),
  ).toBeVisible();
  expect(creates).toBe(1);
  expect(uploads).toBe(1);
  await page.goto(`/?project=${project}`);
  await expect(page).toHaveURL(new RegExp(`/app\\?project=${project}$`));
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Potentially over-broad SELECT policy on profiles' }),
  ).toBeVisible();

  const opener = page.getByRole('button', { name: 'Run local verification', exact: true });
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Run local verification', exact: true });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0, {
    timeout: 2000,
  });
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Run local verification', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  const readView = async () =>
    validate(
      'ProjectView',
      parseStrictJson(
        await (await page.request.get(`/api/projects/${project}`)).text(),
        16 * 1024 * 1024,
      ),
    );
  const before = await readView();
  await page.getByRole('button', { name: 'Expected Access', exact: true }).click();
  await page
    .getByLabel('Expected profiles authenticated DELETE', { exact: true })
    .selectOption('unknown');
  await page.getByRole('button', { name: 'Save expectations', exact: true }).click();
  await expect
    .poll(async () => (await readView()).project.expectation_set_revision)
    .toBe(before.project.expectation_set_revision + 1);
  await expect(opener).toBeEnabled();
  await opener.click();
  await expect(dialog.getByText(/unknown expectations/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Run local verification', exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: 'Cancel job', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await readView()).jobs.some((job) => job.kind === 'verify' && job.status === 'cancelled'),
      { timeout: 45000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete local project', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});
