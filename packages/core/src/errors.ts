export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
    readonly context: Record<string, string | number> = {},
  ) {
    super(code);
  }
}
export function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (
    error instanceof Error &&
    [
      'CONTRACT_INVALID',
      'COVERAGE_INVALID',
      'EXPECTATION_INVALID',
      'POSITIVE_CONTROL_FAILED',
      'INVALID_TRANSITION',
      'STALE_REVISION',
      'EVIDENCE_INVALID',
      'CONFIRMATION_INVALID',
      'FIX_INVALID',
      'STATIC_EVIDENCE_INVALID',
    ].includes(error.message)
  )
    return error.message;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  )
    return 'STORE_REVISION_CONFLICT';
  return 'INTERNAL_ERROR';
}
export function logEvent(
  component: string,
  code: string,
  context: { job_id?: string; request_id?: string } = {},
): void {
  console.log(JSON.stringify({ component, code, ...context, at: new Date().toISOString() }));
}
