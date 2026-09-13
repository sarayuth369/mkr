import type { Env } from '../types';
import { DisabledPushProvider } from './disabled-provider';
import { FcmPushProvider } from './fcm-provider';
import type { PushProvider } from './push-provider';

/** All three FCM service-account fields are required together; any one
 * missing falls back to [DisabledPushProvider] rather than a half-working
 * client - never a fake successful send. */
export function getPushProvider(env: Env): PushProvider {
  if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    return new FcmPushProvider(env.FCM_PROJECT_ID, env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY);
  }
  return new DisabledPushProvider();
}
