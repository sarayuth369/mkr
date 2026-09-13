const REDACTED_KEYS = new Set(['apikey', 'api_key', 'authorization', 'secret', 'password', 'token', 'session']);

/** Deep-redacts anything that looks like a credential before it reaches console.log. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val);
    }
    return out;
  }
  return value;
}

export interface LogFields {
  requestId?: string;
  route?: string;
  symbol?: string;
  provider?: string;
  latencyMs?: number;
  status?: number;
  errorCode?: string;
  [key: string]: unknown;
}

/** Structured JSON logging - every field passes through [redact] first. */
export function logInfo(message: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ level: 'info', message, ...(redact(fields) as object) }));
}

export function logError(message: string, fields: LogFields = {}): void {
  console.error(JSON.stringify({ level: 'error', message, ...(redact(fields) as object) }));
}
