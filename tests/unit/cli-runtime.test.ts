import { expect, it } from 'vitest';
import { applicationDataDirectory, assertExternalData } from '../../apps/cli/src/runtime';
import { resolve } from 'node:path';

it('uses user application data independently of the current project', () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  expect(applicationDataDirectory('linux', env, '/test-user')).toBe(
    '/test-user/.local/share/proofsec',
  );
  expect(applicationDataDirectory('darwin', env, '/test-user')).toBe(
    '/test-user/Library/Application Support/ProofSec',
  );
  expect(
    applicationDataDirectory('win32', { ...env, LOCALAPPDATA: '/local-app-data' }, '/test-user'),
  ).toBe('/local-app-data/ProofSec');
  expect(() => assertExternalData('/project', '/project/.local')).toThrow(
    'CLI_DATA_INSIDE_PROJECT',
  );
  expect(() => assertExternalData('/project', '/project')).toThrow('CLI_DATA_INSIDE_PROJECT');
  expect(() => assertExternalData('/project', '/project-neighbor/data')).not.toThrow();
  expect(
    applicationDataDirectory('linux', { ...env, PROOFSEC_DATA_DIR: '.local/unit' }, '/test-user'),
  ).toBe(resolve('.local/unit'));
});
