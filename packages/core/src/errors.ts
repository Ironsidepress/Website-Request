/**
 * Domain errors carry a safe, client-facing code and message; anything
 * sensitive belongs in internal logs keyed by correlation id
 * (docs/security-model.md).
 */
export type DomainErrorCode =
  'not_found' | 'forbidden' | 'unauthenticated' | 'validation_failed' | 'conflict' | 'expired';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/**
 * Tenant-membership failures surface as not_found, not forbidden, to avoid
 * leaking the existence of other tenants' resources.
 */
export function notFound(what = 'resource'): DomainError {
  return new DomainError('not_found', `The requested ${what} was not found`);
}

export function forbidden(message = 'You do not have permission to do this'): DomainError {
  return new DomainError('forbidden', message);
}

export function unauthenticated(): DomainError {
  return new DomainError('unauthenticated', 'Authentication required');
}
