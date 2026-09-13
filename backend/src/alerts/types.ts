export type AlertConditionType = 'price_above' | 'price_below';

/** Mirrors the `alerts` table in supabase/migrations - only the columns the
 * engine actually needs to evaluate a tick and record a trigger. */
export interface AlertRow {
  id: string;
  user_id: string;
  symbol: string;
  condition_type: AlertConditionType;
  target_value: number;
  enabled: boolean;
  cooldown_seconds: number;
  last_triggered_at: string | null; // ISO 8601 (Postgres timestamptz via PostgREST)
}

export interface DeviceRow {
  id: string;
  user_id: string;
  fcm_token: string;
  platform: string;
  active: boolean;
}
