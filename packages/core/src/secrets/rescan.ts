import {
  validate,
  type Finding,
  type AdmittedInputs,
  type CredentialFingerprint,
  type ScanReport,
} from '../../../contracts/src/index';
import { transitionFinding } from '../../../contracts/src/lifecycle';
import { hash, newId } from '../hash';
import { admitPath } from '../intake/admit';
import { AppError } from '../errors';

export function assertCompleteScope(
  previous: AdmittedInputs,
  files: AdmittedInputs['manifest'],
  deleted: string[],
): void {
  deleted.forEach(admitPath);
  const prior = previous.manifest.filter((f) => f.kind === 'source').map((f) => f.path);
  if (
    files.some((f) => f.kind !== 'source') ||
    deleted.some((p) => !prior.includes(p) || files.some((f) => f.path === p)) ||
    prior.some((p) => !deleted.includes(p) && !files.some((f) => f.path === p))
  )
    throw new AppError('RESCAN_INCOMPLETE', 409);
}

/** Compare private keyed identities across the entire validated replacement scope. */
export function compareStaticRescan(
  previous: Finding[],
  fingerprints: CredentialFingerprint[],
  current: AdmittedInputs,
  revision: number,
): { report: ScanReport; updates: Finding[] } {
  const report = validate('ScanReport', {
    id: newId('scan'),
    input_revision: revision,
    source_manifest_digest: hash(current.manifest),
    analyzer_version: '1.0.0',
    complete: true,
    finding_ids: current.credential_findings.map((f) => f.id),
    created_at: new Date().toISOString(),
  });
  const present = new Set(current.credential_fingerprints.map((f) => f.fingerprint));
  const updates = previous
    .filter((f) => ['confirmed', 'fix_not_verified', 'fixed'].includes(f.state))
    .map((f) => {
      const fingerprint = fingerprints.find((fp) => fp.finding_id === f.id)?.fingerprint;
      const removed = !!fingerprint && !present.has(fingerprint);
      // A prior fixed occurrence that reappears requires fresh review.
      if (f.state === 'fixed' && !removed)
        return validate('Finding', {
          ...f,
          revision: f.revision + 1,
          input_revision: revision,
          state: 'confirmed',
          retest_result: null,
        });
      const pending =
        f.state === 'fixed' ? f : transitionFinding(f, { type: 'patch_applied', approved: true });
      const next = transitionFinding(pending, {
        type: 'retest',
        approved: true,
        current: true,
        result: {
          kind: 'credential_rescan',
          baseline_run_id: null,
          run_id: report.id,
          status: !fingerprint ? 'not_testable' : removed ? 'passed' : 'failed',
          identical_scenarios: true,
          regressions_passed: removed,
          failed_result_ids: [],
          scope: removed
            ? 'Exposure removed from submitted files; rotation and previously published artifacts were not verified.'
            : 'Matching occurrence remains or private comparison identity is unavailable; removal was not verified.',
          completed_at: report.created_at,
        },
      });
      return validate('Finding', { ...next, input_revision: revision });
    });
  return { report, updates };
}
