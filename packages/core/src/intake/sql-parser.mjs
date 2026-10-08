import { parse, deparse } from 'pgsql-parser';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) process.exit(1);
}
try {
  const ast = await parse(input);
  if (Math.floor(ast.version / 10000) !== 17) throw new Error();
  if (process.argv.includes('--repository-v3')) {
    const lock = JSON.parse(
      await readFile(new URL('../../../../config/sql-parser-lock.json', import.meta.url), 'utf8'),
    );
    for (const [file, digest] of Object.entries(lock.artifacts)) {
      const bytes = await readFile(new URL(`./vendor/${file}`, import.meta.url));
      if (createHash('sha256').update(bytes).digest('hex') !== digest)
        throw new Error('SQL_PARSER_ARTIFACT_DRIFT');
    }
    const { validateRepositoryAst } = await import('./repository-validator.mjs');
    validateRepositoryAst(ast, input);
  }
  console.log(JSON.stringify({ ast, sql: await deparse(ast) }));
} catch (error) {
  const code = /^SQL_[A-Z_]+$|^SCHEMA_LIMIT$/.test(error?.message ?? '')
    ? error.message
    : 'SQL_PARSE_FAILED';
  process.stdout.write(
    JSON.stringify({
      error: code,
      ...(Number.isInteger(error?.statement) ? { statement: error.statement } : {}),
    }),
  );
  process.exitCode = 1;
}
