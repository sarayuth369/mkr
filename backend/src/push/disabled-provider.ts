import type { PushNotificationPayload, PushProvider, PushSendResult, PushTarget } from './push-provider';

/** Active whenever FCM credentials aren't configured (see provider-factory.ts).
 * Never attempts a network call and never reports success - "push sent" must
 * always mean a push actually left the server. */
export class DisabledPushProvider implements PushProvider {
  readonly id = 'disabled';
  readonly isConfigured = false;

  async send(_target: PushTarget, _notification: PushNotificationPayload): Promise<PushSendResult> {
    return { success: false, error: 'push_not_configured' };
  }
}
