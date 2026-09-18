import 'package:in_app_purchase/in_app_purchase.dart';

/// 2026-09-17 AdMob + Billing task — the clean server-verification seam
/// the task asks for, without inventing a verification that doesn't exist.
///
/// A real server-side check needs a Google Play Developer API service
/// account (Play Console → API access → a service account with the
/// "View financial data" + purchase-management permissions, its JSON key
/// stored as a Cloudflare Worker secret — never in this repo). That
/// account does not exist yet, so there is nothing genuine to call today.
///
/// [ClientTrustPurchaseVerifier] is the only implementation wired up right
/// now: it trusts the [PurchaseDetails] Google Play's own Billing Library
/// already delivered to this device, which is the same client-side signal
/// the Play Billing Library itself is built around, and is a legitimate,
/// commonly-shipped baseline (many apps launch with client-trust only).
/// It is NOT a fabricated verification — it makes no claim about the
/// purchase beyond what Play itself already reported.
///
/// Operator handoff: once a service account key is provisioned, add a
/// `ServerPurchaseVerifier` here that POSTs
/// `{purchaseToken: purchase.verificationData.serverVerificationData,
/// productId: purchase.productID, packageName: 'com.mlabs.mkr'}` to the
/// MKR Worker's `POST /api/mkr/billing/verify-purchase` stub (already
/// scaffolded — see `backend/src/billing/verify-purchase-route.ts`), have
/// the Worker call the real Google Play Developer API
/// `purchases.subscriptions.get`/`purchases.products.get` with that
/// service account, and swap the single `PurchaseVerifier` instance
/// `PlayBillingRepository` is constructed with in `lib/app/app.dart`. No
/// other file needs to change.
abstract class PurchaseVerifier {
  const PurchaseVerifier();

  Future<bool> verify(PurchaseDetails purchase);
}

class ClientTrustPurchaseVerifier implements PurchaseVerifier {
  const ClientTrustPurchaseVerifier();

  @override
  Future<bool> verify(PurchaseDetails purchase) async {
    return purchase.status == PurchaseStatus.purchased || purchase.status == PurchaseStatus.restored;
  }
}
