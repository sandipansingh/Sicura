import { createHash, randomUUID } from 'node:crypto';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, v]) => JSON.stringify(key) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const hash = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : canonical(value))
    .digest('hex');
export const newId = (prefix: string): string => prefix + '_' + randomUUID().replaceAll('-', '');
