import type { Finding } from '../../../packages/contracts/src/index';
export function badge(f: Finding): string {
  if (f.suppression?.reason === 'intentionally_public')
    return 'Intentionally public — declared SELECT access';
  if (f.state === 'confirmed')
    return f.category === 'CREDENTIAL_EXPOSURE'
      ? 'Static exposure confirmed'
      : f.expectation?.source === 'inferred'
        ? 'Confirmed against inferred intent'
        : 'Confirmed in replica';
  if (f.state === 'fixed')
    return f.category === 'CREDENTIAL_EXPOSURE'
      ? 'Exposure removed from submitted files'
      : f.expectation?.source === 'inferred'
        ? 'Fix verified against inferred intent'
        : 'Fix verified in replica';
  return {
    needs_expectation: 'Needs expectation',
    suspected: 'Suspected',
    not_reproduced: 'Not reproduced',
    blocked: 'Verification setup blocked',
    not_testable: 'Not testable',
    fix_not_verified: 'Fix not verified',
  }[f.state];
}
