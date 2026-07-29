import type { StepRunner } from './engine';

/**
 * Deterministic StepRunner for tests (docs/testing-strategy.md): memoizes
 * completed steps by name like Cloudflare Workflows, retries failing steps up
 * to maxAttempts, and fast-forwards sleeps. Reuse a runner to model a resumed
 * instance; use a fresh runner over the same database to model a full replay.
 */
export class InMemoryStepRunner implements StepRunner {
  readonly executed: string[] = [];
  private readonly memo = new Map<string, unknown>();

  constructor(
    private readonly options: {
      maxAttempts?: number;
      /** Step-name substring → number of times it fails before succeeding. */
      failuresBeforeSuccess?: Record<string, number>;
    } = {},
  ) {}

  async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.memo.has(name)) return this.memo.get(name) as T;
    const maxAttempts = this.options.maxAttempts ?? 3;
    const failures = this.options.failuresBeforeSuccess ?? {};

    let remainingInjected = 0;
    for (const [pattern, count] of Object.entries(failures)) {
      if (name.includes(pattern)) remainingInjected = count;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (remainingInjected > 0) {
          remainingInjected -= 1;
          for (const pattern of Object.keys(failures)) {
            if (name.includes(pattern)) failures[pattern] = remainingInjected;
          }
          throw new Error(`injected failure in ${name}`);
        }
        const result = await fn();
        this.memo.set(name, result);
        this.executed.push(name);
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async sleep(name: string): Promise<void> {
    this.executed.push(`sleep:${name}`);
  }
}
