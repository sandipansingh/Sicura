import { resolve } from 'node:path';
export default {
  serverExternalPackages: ['better-sqlite3', 'pgsql-parser'],
  poweredByHeader: false,
  logging: false,
  turbopack: { root: resolve(process.env.PROOFSEC_ROOT_DIR ?? '../..') },
};
