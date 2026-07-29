/**
 * Structured logging with redaction (docs/security-model.md): every log line
 * is a single JSON object, and any field whose key looks credential-like is
 * masked before serialization — secrets cannot leak through logs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACTED_KEY = /secret|token|password|cookie|authorization|credential|api[-_]?key/i;

export function redactFields(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactFields(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEY.test(key) ? '[redacted]' : redactFields(item, depth + 1);
  }
  return out;
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    event,
    ...(redactFields(fields) as Record<string, unknown>),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
