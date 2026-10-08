import { homedir } from 'node:os';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { AppError } from '../../../packages/core/src/errors';

export function applicationDataDirectory(
  platform = process.platform,
  env = process.env,
  userHome = homedir(),
): string {
  return resolve(
    env.PROOFSEC_DATA_DIR ??
      (platform === 'win32'
        ? join(env.LOCALAPPDATA ?? join(userHome, 'AppData', 'Local'), 'ProofSec')
        : platform === 'darwin'
          ? join(userHome, 'Library', 'Application Support', 'ProofSec')
          : join(env.XDG_DATA_HOME ?? join(userHome, '.local', 'share'), 'proofsec')),
  );
}
export function assertExternalData(project: string, data: string): void {
  const rel = relative(resolve(project), resolve(data));
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)))
    throw new AppError('CLI_DATA_INSIDE_PROJECT');
}
