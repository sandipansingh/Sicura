import { posix } from 'node:path';
import type { ImportReport, ImportSelection } from '../../../contracts/src/index';
import { admitPath } from '../intake/admit';

export const IMPORT_LIMITS = { files: 500, bytes: 10 * 1024 * 1024, file: 2 * 1024 * 1024 };
export type Exclusion = ImportReport['exclusions'][number];
export function exclusion(path: string): Exclusion['reason'] | null {
  if (
    [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return 'unsafe_path';
  // Upload paths reject archives outright. Repository discovery reports them.
  try {
    admitPath(path.replace(/\.(?:zip|gz|tar|exe|bin)$/i, '.excluded'));
  } catch {
    return 'unsafe_path';
  }
  const parts = path.toLowerCase().split('/');
  if (
    parts.some((p) =>
      ['node_modules', 'vendor', '.git', '.venv', 'venv', '__pycache__', 'pods'].includes(p),
    )
  )
    return 'dependency';
  if (
    parts.some((p) =>
      [
        '.next',
        '.nuxt',
        'dist',
        'build',
        'coverage',
        '.turbo',
        '.cache',
        'generated',
        'target',
      ].includes(p),
    ) ||
    /(?:\.min\.(?:js|css)|\.map|(?:package-lock|pnpm-lock|yarn\.lock|bun\.lock))/.test(path)
  )
    return 'generated';
  if (/\.(?:zip|gz|tar|tgz|bz2|xz|7z|rar|jar|war)$/i.test(path)) return 'archive';
  if (/\.(?:gguf|safetensors|onnx|pt|pth|ckpt|weights)$/i.test(path)) return 'model_weight';
  if (
    /\.(?:png|jpe?g|gif|ico|webp|avif|pdf|mp[34]|wav|woff2?|ttf|otf|sqlite|db|bin|exe|dll|so|dylib)$/i.test(
      path,
    )
  )
    return 'binary';
  if (
    /\.(?:[cm]?[jt]sx?|sql|json[lc]?|ya?ml|toml|ini|conf|config|env|txt|md|mdx|py|rb|go|rs|java|kt|swift|php|sh|bash|zsh|fish|vue|svelte|html|css|scss|graphql|gql|prisma|xml|properties|tf|tfvars|exs?|erl|hs|cs|fs|dart|r|jl)$/i.test(
      path,
    ) ||
    /^(?:\.env(?:\..*)?|dockerfile(?:\..*)?|makefile|gemfile|procfile|\.npmrc|\.gitignore|\.gitattributes)$/i.test(
      posix.basename(path),
    )
  )
    return null;
  return 'unsupported_file';
}

/** SQL roots include excluded/oversized SQL so a missing migration cannot disappear. */
export function discoverRoots(paths: string[], eligible: Set<string>): ImportReport['roots'] {
  const migrations = new Map<string, string[]>();
  const schemas: string[] = [];
  for (const path of paths) {
    if (!path.endsWith('.sql')) continue;
    const migration = /^(.*?(?:^|\/)(?:migrations|migration|db\/migrate))\//.exec(path);
    if (migration) {
      const root = migration[1]!;
      migrations.set(root, [...(migrations.get(root) ?? []), path]);
    } else if (/^(?:schema|structure)\.sql$/.test(posix.basename(path))) schemas.push(path);
  }
  const roots: ImportReport['roots'] = [...migrations].map(([path, files]) => {
    const prefix = (file: string) =>
      file
        .slice(path.length + 1)
        .split('/')[0]!
        .match(/^(?:V)?(\d+)[_.-]/i)?.[1];
    const prefixes = files.map(prefix);
    const ordered =
      prefixes.every((p) => p !== undefined) &&
      new Set(prefixes.map((p) => p && BigInt(p).toString())).size === files.length;
    return {
      path,
      kind: /(?:^|\/)supabase\/migrations$/.test(path) ? 'supabase' : 'migrations',
      files: files.sort((a, b) => {
        const x = prefix(a);
        const y = prefix(b);
        return x && y && BigInt(x) !== BigInt(y)
          ? BigInt(x) < BigInt(y)
            ? -1
            : 1
          : a.localeCompare(b, 'en');
      }),
      ordered,
      complete: files.every((f) => eligible.has(f)),
    };
  });
  if (!roots.length)
    for (const file of schemas)
      roots.push({
        path: file,
        kind: 'schema',
        files: [file],
        ordered: true,
        complete: eligible.has(file),
      });
  return roots.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function chooseSql(
  roots: ImportReport['roots'],
  selection: ImportSelection | null,
): { root: ImportReport['roots'][number] | null; order: string[] } {
  if (selection) {
    const root = roots.find((r) => r.path === selection.root);
    const order = selection.sql_order.length
      ? selection.sql_order
      : root?.ordered
        ? root.files
        : [];
    if (
      !root ||
      order.length !== root.files.length ||
      new Set(order).size !== order.length ||
      order.some((p) => !root.files.includes(p))
    )
      return { root: null, order: [] };
    return { root, order };
  }
  const preferred = roots.some((r) => r.kind === 'supabase')
    ? roots.filter((r) => r.kind === 'supabase')
    : roots;
  const root = preferred.length === 1 && preferred[0]!.ordered ? preferred[0]! : null;
  return { root, order: root?.files ?? [] };
}
