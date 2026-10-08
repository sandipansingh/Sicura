import { parse, deparse } from 'pgsql-parser';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) process.exit(1);
}
try {
  const ast = await parse(input);
  if (Math.floor(ast.version / 10000) !== 17) throw new Error();
  console.log(JSON.stringify({ ast, sql: await deparse(ast) }));
} catch {
  process.stdout.write('{"error":"SQL_PARSE_FAILED"}');
  process.exitCode = 1;
}
