import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

// Test-only public repository transport. Production has no injectable endpoint.
const prefix = '/repos/proofsec-fixtures/import-example';
const secret = 'sb_secret_TEST_ONLY_DASHBOARD_IMPORT_CANARY';
const files = {
  'src/client.ts': `const serviceRoleKey = '${secret}';`,
  'supabase/migrations/1_schema.sql': 'CREATE TABLE public.items(id uuid PRIMARY KEY, value text);',
  'supabase/migrations/2_function.sql':
    "CREATE FUNCTION public.custom() RETURNS text AS $$ SELECT pg_read_file('/etc/passwd') $$ LANGUAGE sql;",
};
const toBlobs = (files) =>
  Object.entries(files).map(([path, content]) => ({
    path,
    content: Buffer.from(content),
    sha: createHash('sha1')
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest('hex'),
  }));
const baseBlobs = toBlobs(files);
const replayPrefix = '/repos/proofsec-fixtures/replay-example';
const replayBlobs = toBlobs({
  'supabase/migrations/1_schema.sql':
    'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE public.notes(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), body text); ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;',
  'supabase/migrations/2_function.sql':
    'CREATE FUNCTION public.can_read(owner uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT owner=auth.uid() $$; CREATE POLICY p ON public.notes FOR SELECT TO authenticated USING(public.can_read(user_id)); GRANT SELECT ON public.notes TO authenticated;',
});
const original = https.request;
https.request = (options, callback) => {
  const raw =
    options.hostname === 'raw.githubusercontent.com' &&
    (options.path.startsWith('/proofsec-fixtures/import-example/') ||
      options.path.startsWith('/proofsec-fixtures/replay-example/'));
  if (
    !raw &&
    (options.hostname !== 'api.github.com' ||
      !(options.path.startsWith(prefix) || options.path.startsWith(replayPrefix)))
  )
    return original(options, callback);
  const blobs = options.path.includes('/replay-example') ? replayBlobs : baseBlobs;
  const request = new EventEmitter();
  request.destroy = () => {
    request.emit('close');
  };
  request.end = () => {
    let payload;
    if (raw)
      payload = blobs.find((b) => b.path === options.path.split('/').slice(4).join('/'))?.content;
    else if (options.path.includes('/git/blobs/'))
      payload = blobs.find((b) => options.path.endsWith(b.sha))?.content;
    else if (options.path.includes('/git/trees/'))
      payload = Buffer.from(
        JSON.stringify({
          sha: 'b'.repeat(40),
          url: 'https://api.github.com/tree',
          truncated: false,
          tree: blobs.map((b) => ({
            path: b.path,
            mode: '100644',
            type: 'blob',
            size: b.content.length,
            sha: b.sha,
            url: 'https://api.github.com/blob',
          })),
        }),
      );
    else if (options.path.includes('/commits/'))
      payload = Buffer.from(
        JSON.stringify({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } }),
      );
    else payload = Buffer.from(JSON.stringify({ default_branch: 'main' }));
    const response = Readable.from([payload ?? Buffer.from('')]);
    response.statusCode = payload ? 200 : 404;
    response.headers = {};
    callback(response);
    response.on('end', () => request.emit('close'));
  };
  return request;
};
syncBuiltinESMExports();
