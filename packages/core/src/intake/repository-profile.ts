import { parseSql } from './admit';
import { redactText } from '../secrets/redact';
import { AppError } from '../errors';
export const REPLAY_PROFILE = 'repository-v3';
export const BOOTSTRAP_VERSION = 'supabase-database-v1';
export async function admitRepositorySql(sql: string): Promise<string> {
  if (redactText(sql) !== sql) throw new AppError('SQL_CONTAINS_SECRET');
  return (await parseSql(sql, true)).sql;
}
