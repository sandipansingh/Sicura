/** Bounded JSON parser: duplicate keys (including escaped equivalents) fail closed. */
export function parseStrictJson(text: string, maxBytes = 16_384): unknown {
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('JSON_LIMIT');
  let cursor = 0;
  const fail = (): never => {
    throw new Error('INVALID_JSON');
  };
  const whitespace = () => {
    while (/[ \t\r\n]/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
  };
  const string = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '\\') {
        cursor++;
        continue;
      }
      if (char === '"') {
        try {
          return JSON.parse(text.slice(start, cursor)) as string;
        } catch {
          return fail();
        }
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 100) throw new Error('JSON_DEPTH_LIMIT');
    whitespace();
    const char = text[cursor];
    if (char === '"') return string();
    if (char === '{') {
      cursor++;
      whitespace();
      const keys = new Set<string>();
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (text[cursor] === '}') {
        cursor++;
        return result;
      }
      while (cursor < text.length) {
        whitespace();
        if (text[cursor] !== '"') return fail();
        const key = string();
        if (keys.has(key)) throw new Error('DUPLICATE_JSON_KEY');
        keys.add(key);
        whitespace();
        if (text[cursor++] !== ':') return fail();
        result[key] = value(depth + 1);
        whitespace();
        const end = text[cursor++];
        if (end === '}') return result;
        if (end !== ',') return fail();
      }
      return fail();
    }
    if (char === '[') {
      cursor++;
      whitespace();
      const result: unknown[] = [];
      if (text[cursor] === ']') {
        cursor++;
        return result;
      }
      while (cursor < text.length) {
        result.push(value(depth + 1));
        whitespace();
        const end = text[cursor++];
        if (end === ']') return result;
        if (end !== ',') return fail();
      }
      return fail();
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(cursor),
    )?.[0];
    if (!token) return fail();
    cursor += token.length;
    const result: unknown = JSON.parse(token);
    if (typeof result === 'number' && !Number.isFinite(result)) return fail();
    return result;
  };
  const result = value(0);
  whitespace();
  if (cursor !== text.length) return fail();
  return result;
}
