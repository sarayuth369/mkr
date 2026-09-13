export interface PushTarget {
  token: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  success: boolean;
  error?: string;
}

/**
 * Transport-only abstraction for sending one push notification. FCM is the
 * only implementation today (see [FcmPushProvider]); a future provider
 * (e.g. APNs for a future iOS build) implements the same interface. Never
 * conflate this with a user database - Supabase remains the source of
 * truth for devices/tokens (see src/supabase/).
 */
export interface PushProvider {
  readonly id: string;
  /** False when required credentials are missing - callers must treat a
   * `send()` result the same way either way ([DisabledPushProvider] simply
   * always fails cleanly), but `isConfigured` lets admin/health surfaces
   * report the real state instead of guessing from a failed send. */
  readonly isConfigured: boolean;
  send(target: PushTarget, notification: PushNotificationPayload): Promise<PushSendResult>;
}
