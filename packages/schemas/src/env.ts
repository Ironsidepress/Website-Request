import { z } from 'zod';

/**
 * Environment-variable schemas (versioned like every other schema in this package).
 *
 * Rules:
 * - Every deployable validates its environment at startup with `parseEnv`.
 * - Validation errors never echo variable values (a secret must not leak into
 *   logs via a failed parse) — only paths and messages are reported.
 * - Secrets (auth secrets, API tokens) are provided via Cloudflare secrets or
 *   `.dev.vars` locally; they are declared here so their presence is validated,
 *   but no default is ever provided for a secret.
 */

export const APP_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

export const appEnvironmentSchema = z.enum(APP_ENVIRONMENTS);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

/** Variables common to every deployable. */
export const sharedEnvSchema = z.object({
  APP_ENV: appEnvironmentSchema,
  LOG_LEVEL: logLevelSchema.default('info'),
});

/**
 * Comma-separated list of origins allowed to call the web app's API
 * (e.g. "https://staging.example.workers.dev"). Must be explicit per
 * environment — staging and production never share values (ADR-0016).
 */
export const allowedOriginsSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

/** Environment for `apps/web`. */
export const webEnvSchema = sharedEnvSchema.extend({
  ALLOWED_ORIGINS: allowedOriginsSchema,
  /**
   * ADR-0015: email address of the initial administrator. Optional; when absent
   * the bootstrap check is skipped entirely. Remove after the first
   * administrator exists (see docs/environments.md).
   */
  INITIAL_ADMIN_EMAIL: z.email().optional(),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** Environment for `workers/orchestrator`. */
export const orchestratorEnvSchema = sharedEnvSchema;
export type OrchestratorEnv = z.infer<typeof orchestratorEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    const summary = issues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ');
    super(`Invalid environment configuration — ${summary}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validates an environment object against a schema. Throws `EnvValidationError`
 * listing paths and messages only — never the offending values.
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
