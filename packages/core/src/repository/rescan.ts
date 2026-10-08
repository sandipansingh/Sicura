import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AdmittedInputs, ImportReport, ImportRequest } from '../../../contracts/src/index';

export async function repositoryScopeComplete(
  previous: AdmittedInputs,
  current: AdmittedInputs,
  report: ImportReport,
  request: ImportRequest,
): Promise<boolean> {
  for (const f of previous.manifest) {
    if (current.manifest.some((n) => n.path === f.path)) continue;
    if (request.source.kind === 'github') {
      if (report.exclusions.some((e) => e.path === f.path)) return false;
      continue; // Absent from the complete pinned tree.
    }
    let missing = false;
    const parts = f.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      try {
        if ((await lstat(resolve(request.source.directory, ...parts.slice(0, i)))).isSymbolicLink())
          return false;
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
          missing = true;
          break;
        }
        return false;
      }
    }
    if (!missing) return false; // Ignored, unreadable or excluded is not removed.
  }
  return true;
}
