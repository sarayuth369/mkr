import { jsonResponse } from '../errors';
import { logInfo } from '../logging';
import type { Env } from '../types';

/**
 * 2026-09-17 AdMob + Billing task - the clean server-verification
 * abstraction the task asks for, WITHOUT inventing a verification that
 * doesn't exist. A real check needs a Google Play Developer API service
 * account (Play Console -> API access -> a service account with
 * financial-data/purchase-management scope, its JSON key stored as a
 * Cloudflare Worker secret via `wrangler secret put` - never committed to
 * this repo). That account has not been provisioned yet, so there is
 * nothing genuine to call server-side today.
 *
 * This route exists so the Flutter client (see
 * `lib/features/billing/data/purchase_verifier.dart`) has a stable,
 * already-deployed endpoint to POST to once server verification is wired
 * up - today it honestly reports `verified: false, reason:
 * 'not_configured'` rather than fabricating a `true`. The client currently
 * does NOT call this route at all (it trusts Play's own client-delivered
 * purchase state via `ClientTrustPurchaseVerifier` - a legitimate,
 * commonly-shipped baseline, not a fabrication) - wiring the client to
 * call this route is a follow-up once the service account exists, at
 * which point ONLY this handler needs to change (validate the request,
 * call the real Google Play Developer API
 * `purchases.subscriptions.get`/`purchases.products.get` with the service
 * account, and return `{verified: true/false}` honestly based on the
 * real API response) - no other file needs to change.
 *
 * Never logs the purchase token itself (a real credential-adjacent value
 * - possession of it can be used to query purchase state) - only the
 * product ID and a boolean outcome, matching this codebase's existing
 * "never log secrets" discipline.
 */
export async function handleVerifyPurchase(request: Request, env: Env, requestId: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { purchaseToken?: string; productId?: string; packageName?: string } | null;
  if (!body?.purchaseToken || !body?.productId) {
    return jsonResponse({ verified: false, reason: 'invalid_request' }, { status: 400 });
  }

  logInfo('purchase verification requested (not yet configured)', { requestId, productId: body.productId });

  // No Google Play Developer API service account is configured on this
  // Worker yet (see this file's own doc comment) - honestly reports
  // "not configured" rather than a fabricated pass/fail. The client does
  // not currently depend on this response for granting entitlement.
  return jsonResponse({ verified: false, reason: 'not_configured' });
}
