import type { PushNotificationPayload, PushProvider, PushSendResult, PushTarget } from './push-provider';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

function base64UrlFromBytes(bytes: ArrayBufferLike): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value).buffer);
}

function pemToPkcs8(pem: string): ArrayBuffer {
  // Secrets set via `wrangler secret put` are frequently pasted with
  // literal "\n" escapes instead of real newlines - handle both.
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * FCM HTTP v1 provider. Uses the Firebase service-account credentials to
 * mint its own OAuth2 access token via a hand-signed JWT (RS256 over
 * WebCrypto - no extra dependency) rather than any legacy server-key API,
 * per the spec's "current FCM HTTP v1 API" requirement. Active only when
 * [FCM_PROJECT_ID]/[FCM_CLIENT_EMAIL]/[FCM_PRIVATE_KEY] are all present
 * (see provider-factory.ts) - the private key never leaves this file's
 * signing call and is never logged.
 */
export class FcmPushProvider implements PushProvider {
  readonly id = 'fcm';
  readonly isConfigured = true;

  private cachedToken: CachedToken | null = null;
  private signingKey: CryptoKey | null = null;

  constructor(
    private readonly projectId: string,
    private readonly clientEmail: string,
    private readonly privateKeyPem: string,
  ) {}

  private async getSigningKey(): Promise<CryptoKey> {
    if (this.signingKey) return this.signingKey;
    this.signingKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8(this.privateKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return this.signingKey;
  }

  private async mintAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };
    const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;
    const key = await this.getSigningKey();
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
    const jwt = `${signingInput}.${base64UrlFromBytes(signature)}`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
    });
    if (!response.ok) throw new Error(`FCM OAuth token exchange failed: ${response.status}`);
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS };
    return json.access_token;
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.accessToken;
    return this.mintAccessToken();
  }

  async send(target: PushTarget, notification: PushNotificationPayload): Promise<PushSendResult> {
    try {
      const token = await this.accessToken();
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: target.token,
            notification: { title: notification.title, body: notification.body },
            data: notification.data,
          },
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { success: false, error: `fcm_http_${response.status}${text ? `: ${text.slice(0, 200)}` : ''}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: `fcm_exception: ${(err as Error).message}` };
    }
  }
}
