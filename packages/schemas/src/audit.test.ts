import { describe, expect, it } from 'vitest';

import { auditActionSchema, auditEventSchema, auditMetadataSchema } from './audit';

describe('audit schemas', () => {
  it('accepts well-formed events', () => {
    const event = auditEventSchema.parse({
      action: 'auth.login',
      resourceType: 'user',
      resourceId: 'u1',
      organizationId: null,
      actor: { type: 'user', id: 'u1' },
      metadata: { source: 'password', attempt: 1, remembered: false },
    });
    expect(event.action).toBe('auth.login');
  });

  it('rejects malformed action names', () => {
    expect(auditActionSchema.safeParse('Login!').success).toBe(false);
    expect(auditActionSchema.safeParse('auth').success).toBe(false);
    expect(auditActionSchema.safeParse('auth.Login').success).toBe(false);
  });

  it('rejects credential-like metadata keys — secrets cannot enter the audit log', () => {
    for (const key of [
      'password',
      'BETTER_AUTH_SECRET',
      'apiKey',
      'api_key',
      'sessionId',
      'authorization',
      'promptText',
      'refresh_token',
    ]) {
      const result = auditMetadataSchema.safeParse({ [key]: 'x' });
      expect(result.success, `key "${key}" should be rejected`).toBe(false);
    }
  });

  it('rejects nested objects and oversized values', () => {
    expect(auditMetadataSchema.safeParse({ nested: { a: 1 } }).success).toBe(false);
    expect(auditMetadataSchema.safeParse({ note: 'x'.repeat(501) }).success).toBe(false);
  });
});
