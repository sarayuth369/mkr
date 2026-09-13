import type { Env } from '../types';

const NEVER_LOG_KEYS = ['apikey', 'api_key', 'secret', 'password', 'token'];

/** Refuses to persist anything that looks like it might contain a credential. */
function assertSafeToLog(value: unknown, field: string): void {
  const text = JSON.stringify(value ?? null).toLowerCase();
  for (const key of NEVER_LOG_KEYS) {
    if (text.includes(key)) throw new Error(`Refusing to audit-log ${field}: looks like it may contain a secret`);
  }
}

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function recordAuditEntry(env: Env, entry: AuditEntry): Promise<void> {
  assertSafeToLog(entry.oldValue, 'oldValue');
  assertSafeToLog(entry.newValue, 'newValue');
  await env.MKR_DB.prepare(
    'INSERT INTO audit_log (actor, action, target, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      entry.actor,
      entry.action,
      entry.target ?? null,
      entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      Date.now(),
    )
    .run();
}

export interface AuditLogRow {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: number;
}

export async function listAuditLog(env: Env, limit = 100): Promise<AuditLogRow[]> {
  const { results } = await env.MKR_DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
    .bind(Math.min(Math.max(limit, 1), 500))
    .all<AuditLogRow>();
  return results ?? [];
}
