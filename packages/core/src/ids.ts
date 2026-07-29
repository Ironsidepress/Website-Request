import { uuidv7 } from 'uuidv7';

/** UUIDv7 ids generated in application code (ADR-0006). */
export function newId(): string {
  return uuidv7();
}
