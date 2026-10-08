import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 45000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    video: { mode: 'on', size: { width: 1440, height: 900 } },
  },
  webServer: {
    command: 'pnpm run dev',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PROOFSEC_ORIGIN: 'http://127.0.0.1:3100',
      PROOFSEC_DATA_DIR: resolve(process.env.PROOFSEC_E2E_DATA_DIR ?? '.local/e2e'),
      PROOFSEC_ROOT_DIR: resolve('.'),
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: `--import=${resolve('tests/support/github-ingress.mjs')}`,
    },
  },
});
