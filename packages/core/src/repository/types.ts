import type { ImportReport } from '../../../contracts/src/index';
export interface RepositoryEntry {
  path: string;
  bytes: number;
  sha?: string;
  reason?: ImportReport['exclusions'][number]['reason'];
}
export interface RepositorySnapshot {
  entries: RepositoryEntry[];
  provenance: ImportReport['provenance'];
  read: (entry: RepositoryEntry) => Promise<Buffer>;
}
