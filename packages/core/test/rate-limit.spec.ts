import { describe, expect, it } from 'vitest';

import { BASE_URL, createTestWorld } from './helpers';

describe('auth rate limiting and abuse protection', () => {
  it('throttles repeated sign-in attempts with 429', async () => {
    const world = createTestWorld({ rateLimitEnabled: true });

    const attempt = () =>
      world.services.auth.handleRequest(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: BASE_URL,
            'x-forwarded-for': '203.0.113.7',
          },
          body: JSON.stringify({ email: 'attacker@example.com', password: 'guess-attempt' }),
        }),
      );

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push((await attempt()).status);
    }

    // Custom rule: /sign-in/email allows 5 per 60s window, then 429.
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(-1)[0]).toBe(429);
  });
});
