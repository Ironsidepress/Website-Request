import { describe, expect, it } from 'vitest';

import {
  EnvValidationError,
  orchestratorEnvSchema,
  parseEnv,
  sharedEnvSchema,
  webEnvSchema,
} from './env';

describe('sharedEnvSchema', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = parseEnv(sharedEnvSchema, { APP_ENV: 'staging' });
    expect(env).toEqual({ APP_ENV: 'staging', LOG_LEVEL: 'info' });
  });

  it('rejects unknown APP_ENV values', () => {
    expect(() => parseEnv(sharedEnvSchema, { APP_ENV: 'prod' })).toThrow(EnvValidationError);
  });
});

describe('webEnvSchema', () => {
  const base = {
    APP_ENV: 'development',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    APP_BASE_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
  };

  it('parses a comma-separated origin list into an array', () => {
    const env = parseEnv(webEnvSchema, {
      ...base,
      ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
    });
    expect(env.ALLOWED_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('rejects an empty origin list', () => {
    expect(() => parseEnv(webEnvSchema, { ...base, ALLOWED_ORIGINS: ' ' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects non-URL origins', () => {
    expect(() => parseEnv(webEnvSchema, { ...base, ALLOWED_ORIGINS: 'not-a-url' })).toThrow(
      EnvValidationError,
    );
  });

  it('accepts a valid INITIAL_ADMIN_EMAIL and allows omitting it', () => {
    const withEmail = parseEnv(webEnvSchema, { ...base, INITIAL_ADMIN_EMAIL: 'admin@example.com' });
    expect(withEmail.INITIAL_ADMIN_EMAIL).toBe('admin@example.com');

    const withoutEmail = parseEnv(webEnvSchema, base);
    expect(withoutEmail.INITIAL_ADMIN_EMAIL).toBeUndefined();
  });

  it('rejects an invalid INITIAL_ADMIN_EMAIL', () => {
    expect(() => parseEnv(webEnvSchema, { ...base, INITIAL_ADMIN_EMAIL: 'nope' })).toThrow(
      EnvValidationError,
    );
  });

  it('requires BETTER_AUTH_SECRET to be at least 32 characters', () => {
    expect(() => parseEnv(webEnvSchema, { ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(
      EnvValidationError,
    );
  });
});

describe('parseEnv error reporting', () => {
  it('reports paths and messages but never input values', () => {
    const secretLikeValue = 'super-secret-value-that-must-not-leak';
    try {
      parseEnv(orchestratorEnvSchema, { APP_ENV: secretLikeValue });
      expect.unreachable('parse should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const validationError = error as EnvValidationError;
      expect(validationError.message).toContain('APP_ENV');
      expect(validationError.message).not.toContain(secretLikeValue);
      expect(JSON.stringify(validationError.issues)).not.toContain(secretLikeValue);
    }
  });
});
