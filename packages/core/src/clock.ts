/** Injected time source (docs/testing-strategy.md — no real waiting in tests). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function isoNow(clock: Clock): string {
  return clock.now().toISOString();
}

export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string) {
    this.current = typeof start === 'string' ? new Date(start) : start;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
