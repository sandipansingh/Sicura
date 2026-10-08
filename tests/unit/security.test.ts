import { expect, it } from 'vitest';
import { checkHost, checkMutation, session } from '../../apps/web/lib/security';
import { Store } from '../../packages/store/src/index';
const origin = 'http://127.0.0.1:3000';
it('rejects foreign hosts, origins and missing CSRF; accepts Next internal URL with validated Host', () => {
  const s = new Store(':memory:');
  try {
    const make = (headers: Record<string, string>) =>
      new Request('http://localhost:3000/api/projects', { method: 'POST', headers });
    expect(() => checkHost(make({ host: 'evil.invalid' }))).toThrow('HOST_REJECTED');
    expect(() =>
      checkHost(make({ host: '127.0.0.1:3000', origin: 'https://evil.invalid' })),
    ).toThrow('ORIGIN_REJECTED');
    expect(() => checkHost(make({ host: '127.0.0.1:3000' }))).not.toThrow();
    expect(() => checkMutation(make({ host: '127.0.0.1:3000', origin }), s)).toThrow(
      'SESSION_REQUIRED',
    );
    const token = session(make({ host: '127.0.0.1:3000' }), s, true);
    const headers = { host: '127.0.0.1:3000', origin, cookie: `proofsec_session=${token.token}` };
    expect(() => checkMutation(make(headers), s)).toThrow('CSRF_REJECTED');
    expect(() => checkMutation(make({ ...headers, 'x-csrf-token': token.csrf }), s)).not.toThrow();
  } finally {
    s.close();
  }
});
