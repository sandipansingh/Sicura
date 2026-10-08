import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { userInfo } from 'node:os';
const lock = JSON.parse(await readFile('config/sql-parser-lock.json', 'utf8'));
const root = resolve('.'),
  source = resolve('.local/libpg_query');
await mkdir(resolve('.local'), { recursive: true });
try {
  execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { stdio: 'ignore' });
} catch {
  execFileSync('git', ['clone', '--depth', '1', '--branch', lock.tag, lock.upstream, source], {
    stdio: 'inherit',
  });
}
if (
  execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
  lock.commit
)
  throw new Error('PARSER_SOURCE_DRIFT');
const mount = [
  'run',
  '--rm',
  ...(process.platform === 'win32' ? [] : ['--user', `${userInfo().uid}:${userInfo().gid}`]),
  '-v',
  `${root}:/workspace`,
  '-w',
  '/workspace/.local/libpg_query',
  lock.compiler_image,
];
execFileSync('docker', [...mount, 'make', 'build', 'CC=emcc', 'AR=emar rs', '-j8'], {
  stdio: 'inherit',
});
execFileSync(
  'docker',
  [
    ...mount,
    'emcc',
    '/workspace/packages/core/src/intake/vendor/pg-query.c',
    'libpg_query.a',
    '-I.',
    '-O2',
    '-s',
    'MODULARIZE=1',
    '-s',
    'EXPORT_ES6=1',
    '-s',
    'ENVIRONMENT=node',
    '-s',
    'ALLOW_MEMORY_GROWTH=1',
    '-s',
    'MAXIMUM_MEMORY=134217728',
    '-s',
    'EXPORTED_FUNCTIONS=["_parse_sql","_parse_plpgsql","_malloc","_free"]',
    '-s',
    'EXPORTED_RUNTIME_METHODS=["UTF8ToString","stringToUTF8","lengthBytesUTF8"]',
    '-o',
    '/workspace/packages/core/src/intake/vendor/pg-query.mjs',
  ],
  { stdio: 'inherit' },
);
const modulePath = 'packages/core/src/intake/vendor/pg-query.mjs';
await writeFile(modulePath, (await readFile(modulePath, 'utf8')).replace(/[\t ]+$/gm, ''));
