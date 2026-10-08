import type { CredentialEvidence } from '../../../contracts/src/index';
import { AppError } from '../errors';
import { newId } from '../hash';
import { createHmac } from 'node:crypto';
import { classifyCredential } from './classify';
import { parseStrictJson } from '../../../contracts/src/index';

interface Candidate {
  start: number;
  end: number;
  variable: string | null;
  family: CredentialEvidence['credential_type'];
  classification: CredentialEvidence['classification'];
  fingerprint: string | null;
}
const placeholder =
  /^(?:YOUR_API_KEY|CHANGEME|TEST_ONLY_NOT_A_KEY|\[REDACTED\]|<SYNTHETIC_SERVICE_ROLE_KEY>|\$\{[A-Z_]+\})$/;
const normalize = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const p = count / value.length;
    return sum - p * Math.log2(p);
  }, 0);
}
function publicJwt(value: string): boolean {
  if (value.length > 16384 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return false;
  try {
    const payload = parseStrictJson(
      Buffer.from(value.split('.')[1]!, 'base64url').toString('utf8'),
      16384,
    ) as {
      role?: unknown;
    };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}
function jwtShape(value: string): boolean {
  if (value.length > 16384 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return false;
  try {
    const header: unknown = parseStrictJson(
      Buffer.from(value.split('.')[0]!, 'base64url').toString('utf8'),
      16384,
    );
    return (
      !!header && typeof header === 'object' && 'alg' in header && typeof header.alg === 'string'
    );
  } catch {
    return false;
  }
}
function family(name: string, value: string): CredentialEvidence['credential_type'] {
  const n = normalize(name);
  if (value.startsWith('sb_secret_') || n.includes('service role'))
    return 'privileged_backend_credential';
  if (
    /(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s/]+:[^\s@]+@/.test(value) ||
    /(?:database|db) password|pgpassword/.test(n)
  )
    return 'database_credential';
  if (/PRIVATE KEY/.test(value) || n === 'private key') return 'private_key';
  if (n.includes('jwt secret') || n.includes('jwt signing') || jwtShape(value)) return 'jwt_secret';
  if (n.includes('aws secret') || n.includes('azure client secret')) return 'cloud_credential';
  if (n.includes('client secret')) return 'client_secret';
  if (n.includes('api key') || n.includes('access token') || n.includes('auth token'))
    return 'api_key';
  return 'unknown_secret';
}
function decoded(value: string): string {
  let result = value;
  for (let i = 0; i < 2; i++) {
    let next = result;
    try {
      if (/%[0-9a-f]{2}/i.test(result)) next = decodeURIComponent(result);
      else if (/^(?:[0-9a-f]{2}){8,}$/i.test(result))
        next = Buffer.from(result, 'hex').toString('utf8');
      else if (
        /^[A-Za-z0-9+/]+={0,2}$/.test(result) &&
        result.length >= 16 &&
        result.length % 4 === 0
      )
        next = Buffer.from(result, 'base64').toString('utf8');
      else if (/\\(?:["\\/bfnrt]|u[0-9a-f]{4})/i.test(result)) {
        const escapes: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        next = result.replace(
          /\\u([0-9a-f]{4})|\\(["\\/bfnrt])/gi,
          (_, hex: string | undefined, character: string | undefined) =>
            hex ? String.fromCharCode(parseInt(hex, 16)) : escapes[character!.toLowerCase()]!,
        );
      }
    } catch {
      break;
    }
    if (next === result) break;
    result = next;
  }
  return result;
}
function collect(text: string, key?: Buffer): Candidate[] {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new AppError('INPUT_LIMIT', 413);
  const candidates: Candidate[] = [];
  let decodedBytes = 0;
  const add = (start: number, end: number, variable: string | null, value: string) => {
    if (value.length > 65536) throw new AppError('SECRET_DECODE_LIMIT');
    const actual = decoded(value);
    decodedBytes += Buffer.byteLength(actual);
    if (decodedBytes > 1024 * 1024) throw new AppError('SECRET_DECODE_LIMIT');
    const n = normalize(variable ?? '');
    const publicValue = actual.startsWith('sb_publishable_') || publicJwt(actual);
    const sensitive =
      /(?:api key|access token|auth token|secret|password|pgpassword|private key|service role)/.test(
        n,
      );
    const shaped =
      /(?:sb_secret_|sb_publishable_|PRIVATE KEY|(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s/]+:[^\s@]+@)/.test(
        actual,
      ) || jwtShape(actual);
    if (!shaped && !sensitive) return;
    if (!shaped && value.length < 8 && !placeholder.test(value)) return;
    const credential_type = family(variable ?? '', actual);
    candidates.push({
      start,
      end,
      variable,
      family: family(variable ?? '', actual),
      classification: classifyCredential({
        credential_type,
        literal: true,
        exposure: 'unknown',
        placeholder: placeholder.test(value),
        public_identifier: publicValue,
        strong_secret_signal:
          credential_type !== 'unknown_secret' &&
          (shaped ||
            credential_type !== 'api_key' ||
            (actual.length >= 20 && entropy(actual) >= 3.5)),
      })!,
      fingerprint: key ? createHmac('sha256', key).update(actual).digest('hex') : null,
    });
  };
  for (const m of text.matchAll(
    /(?:["']?([A-Za-z_$][\w$.-]*)["']?\s*[:=]\s*)((?:["'][^\r\n]*?["']\s*\+\s*)+["'][^\r\n]*?["'])/g,
  )) {
    const fragments = [...m[2]!.matchAll(/(["'])([^\r\n]*?)\1/g)];
    if (fragments.length > 8) throw new AppError('SECRET_DECODE_LIMIT');
    const joined = fragments.map((f) => f[2]).join('');
    const start = m.index! + m[0].indexOf(m[2]!);
    add(start, start + m[2]!.length, m[1]!, joined);
  }
  for (const match of text.matchAll(
    /(?:["']?([A-Za-z_$][\w$.-]*)["']?\s*[:=]\s*)(["'`])((?:\\[\s\S]|(?!\2)[^\\])*?)\2/g,
  )) {
    const whole = match[0];
    const literal = match[3]!;
    const start = match.index! + whole.length - literal.length - 2;
    add(start, start + literal.length + 2, match[1]!, literal);
  }
  // SQL defaults are literal credential contexts as well as assignments. Handle
  // SQL's doubled quotes as one literal, without persisting a partial secret.
  for (const match of text.matchAll(
    /\b([A-Za-z_$][\w$]*)\s+(?:[A-Za-z_][\w.]*)(?:\([^()\r\n]{1,100}\))?(?:\s+(?:NOT\s+NULL|NULL|UNIQUE|PRIMARY\s+KEY))*\s+DEFAULT\s+(?:E)?'((?:''|\\[\s\S]|[^'\\])*?)'(?!')/gi,
  )) {
    const literal = match[2]!;
    const start = match.index! + match[0].length - literal.length - 2;
    add(start, start + literal.length + 2, match[1]!, literal.replaceAll("''", "'"));
  }
  // Recognizable encoded values also occur in expressions and function arguments.
  for (const match of text.matchAll(/(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g))
    add(match.index!, match.index! + match[0].length, null, match[2]!);
  for (const m of text.matchAll(
    /^\s*(?:export\s+)?([A-Za-z_$][\w$.-]*)\s*=\s*([^\s"'`#][^\r\n#]*)/gm,
  )) {
    const value = m[2]!.trim();
    if (value.startsWith('process.env.') || value.startsWith('import.meta.env.')) continue;
    const start = m.index! + m[0].length - m[2]!.length;
    add(start, start + value.length, m[1]!, value);
  }
  for (const pattern of [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"'`]+:[^\s"'`@]+@[^\s"'`]+/g,
    /sb_(?:secret|publishable)_[A-Za-z0-9_./+-]+/g,
    /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  ])
    for (const m of text.matchAll(pattern)) add(m.index!, m.index! + m[0].length, null, m[0]);
  return candidates;
}
export function redactText(text: string): string {
  const spans = collect(text).sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  let result = '';
  let cursor = 0;
  for (const span of merged) {
    if (span.start < cursor) continue;
    result += text.slice(cursor, span.start) + '[REDACTED]';
    cursor = span.end;
  }
  return result + text.slice(cursor);
}
export function scanCredentials(
  path: string,
  text: string,
  projectKey?: Buffer,
): {
  redacted: string;
  evidence: CredentialEvidence;
  line: number;
  confirmed: boolean;
  fingerprint: string | null;
}[] {
  const redacted = redactText(text);
  const result = [];
  const seen = new Set<string>();
  for (const candidate of collect(text, projectKey)) {
    const line = text.slice(0, candidate.start).split('\n').length;
    const key = line + ':' + candidate.family + ':' + (candidate.fingerprint ?? candidate.start);
    if (seen.has(key)) continue;
    seen.add(key);
    const frontend =
      /(?:^|\/)(?:frontend|client)(?:\/|$)/.test(path) ||
      text.includes('use client') ||
      candidate.variable?.startsWith('NEXT_PUBLIC_');
    const exposure = frontend
      ? 'frontend'
      : /\.(?:env|json|yaml|yml|toml)$/.test(path) || path.includes('.env')
        ? 'config'
        : 'backend';
    const evidence: CredentialEvidence = {
      kind: 'credential',
      id: newId('evidence'),
      rule_ids: [
        candidate.family === 'privileged_backend_credential'
          ? 'SEC-006'
          : candidate.family === 'database_credential'
            ? 'SEC-002'
            : candidate.family === 'private_key'
              ? 'SEC-004'
              : candidate.family === 'jwt_secret'
                ? 'SEC-003'
                : candidate.family === 'client_secret' || candidate.family === 'cloud_credential'
                  ? 'SEC-005'
                  : candidate.family === 'api_key'
                    ? 'SEC-001'
                    : 'SEC-007',
      ],
      credential_type: candidate.family,
      value: '[REDACTED]',
      exposure,
      classification: candidate.classification,
      variable_name: candidate.variable ? redactText(candidate.variable) : null,
      redacted_snippet: redacted
        .split('\n')
        .slice(Math.max(0, line - 3), line + 2)
        .join('\n')
        .slice(0, 4000),
      validity: 'not_tested',
      use_context: 'Literal in submitted artifact; credential validity was not tested',
    };
    result.push({
      redacted,
      evidence,
      line,
      confirmed: candidate.classification === 'likely_secret',
      fingerprint: candidate.fingerprint,
    });
  }
  return result;
}
