import { describe, expect, it } from 'vitest';

import { redactFields } from '../src/logging';

describe('structured logging redaction', () => {
  it('masks credential-like keys at any depth and leaves the rest intact', () => {
    const redacted = redactFields({
      correlationId: 'abc',
      request: {
        headers: { cookie: 'session=xyz', accept: 'application/json' },
        authorization: 'Bearer 123',
      },
      config: { BETTER_AUTH_SECRET: 'shhh', apiKey: 'k', api_key: 'k2', LOG_LEVEL: 'debug' },
      list: [{ password: 'p', name: 'ok' }],
    }) as Record<string, unknown>;

    expect(redacted).toMatchObject({
      correlationId: 'abc',
      request: {
        headers: { cookie: '[redacted]', accept: 'application/json' },
        authorization: '[redacted]',
      },
      config: {
        BETTER_AUTH_SECRET: '[redacted]',
        apiKey: '[redacted]',
        api_key: '[redacted]',
        LOG_LEVEL: 'debug',
      },
      list: [{ password: '[redacted]', name: 'ok' }],
    });
  });
});
