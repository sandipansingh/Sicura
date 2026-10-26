import { execFile } from 'node:child_process';
import { AppError } from '../errors';

export function readCommand(
  command: string,
  args: string[],
  options: { cwd?: string; maxBuffer?: number; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      {
        encoding: 'buffer',
        timeout: options.timeout ?? 15000,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        windowsHide: true,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new AppError(
              error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                ? 'IMPORT_RESPONSE_LIMIT'
                : command === 'gh' && /rate limit/i.test(stderr.toString())
                  ? 'IMPORT_GITHUB_RATE_LIMIT'
                  : error.killed
                    ? 'IMPORT_TIMEOUT'
                    : 'IMPORT_TRANSPORT_FAILED',
            ),
          );
        else resolve(stdout);
      },
    ),
  );
}
