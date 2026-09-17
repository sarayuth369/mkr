/**
 * 2026-09-17 Hosted Privacy Policy task - serves the MKR (Market Radar)
 * Privacy Policy as a plain public HTML page at `GET /privacy`, on the
 * SAME Cloudflare Worker/domain already deployed for the app's API
 * (`mkr-backend.biz2success.workers.dev`) - reuses existing infrastructure
 * rather than standing up a second Pages/Vercel project just for one
 * static page. No auth, no CORS restriction (a normal public webpage
 * load, not a cross-origin API fetch), no secrets of any kind - this file
 * is pure static markup plus one small client-side script that renders
 * the contact email as canvas pixels (see the inline comment below) so it
 * never appears as scrapable text in the page source.
 *
 * Content below is reconciled against this codebase's ACTUAL dependencies
 * and wiring as of this task (see `pubspec.yaml`): `supabase_flutter`
 * (optional account + alerts/watchlist sync), `firebase_messaging`
 * (push notification device token), Twelve Data/Alpaca via this Worker's
 * own proxy (never called directly from the app). There is no
 * `google_mobile_ads`, no `in_app_purchase`, and no analytics SDK
 * dependency anywhere in `pubspec.yaml` - the sections on advertising and
 * billing say so honestly instead of describing a real ad/payment
 * integration that does not exist yet in this build.
 */
const LAST_UPDATED = '17 September 2026';
const CONTACT_USER = 'sarayuth939';
const CONTACT_DOMAIN = 'gmail.com';

export function handlePrivacyPage(): Response {
  return new Response(PRIVACY_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MKR Privacy Policy</title>
<meta name="robots" content="index, follow">
<style>
  :root {
    color-scheme: dark;
    --bg: #111318;
    --card: #181b21;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --accent: #3ddc97;
    --ai: #9c8cff;
    --border: #262a33;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .logo-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .subtitle { color: var(--muted); font-size: 0.9rem; margin: 0 0 32px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 22px;
    margin-bottom: 16px;
  }
  h2 { font-size: 1.05rem; margin: 0 0 10px; color: var(--text); }
  h2 .ai-dot { color: var(--ai); }
  p { margin: 0 0 10px; color: var(--text); font-size: 0.95rem; }
  p:last-child { margin-bottom: 0; }
  ul { margin: 0 0 10px; padding-left: 20px; font-size: 0.95rem; }
  li { margin-bottom: 6px; }
  .muted { color: var(--muted); font-size: 0.85rem; }
  a { color: var(--accent); }
  .contact-block { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  #contact-canvas {
    cursor: pointer;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 8px;
  }
  footer { text-align: center; color: var(--muted); font-size: 0.8rem; margin-top: 32px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo-dot" aria-hidden="true"></div>
      <div>
        <h1>MKR — Market Radar Privacy Policy</h1>
        <p class="subtitle">Last updated: ${LAST_UPDATED}</p>
      </div>
    </header>

    <div class="card">
      <h2>Overview</h2>
      <p>MKR (Market Radar) is a market-tracking app published by MLabs. This policy explains what information MKR
      collects, why, and the choices you have. MKR is a practical product privacy notice for the app's current
      build — it is not a legal certification, and it will be updated as the app's features change.</p>
    </div>

    <div class="card">
      <h2>Data stored on your device (guest mode)</h2>
      <p>MKR works fully as a guest with no account required. By default, your preferences — theme, language,
      watchlist, price/market alerts, and portfolio entries — are stored locally on your device only. This local
      data is not sent to our servers unless you choose to create an account (below).</p>
    </div>

    <div class="card">
      <h2>Optional account (email &amp; password)</h2>
      <p>If you choose to create an account, MKR uses Supabase as its backend authentication and data-sync
      provider. Creating an account stores your email address and your watchlist/alerts on Supabase's
      infrastructure so they can sync across your devices. You may continue using MKR as a guest at any time
      instead — an account is never required for the app's core features.</p>
    </div>

    <div class="card">
      <h2>Push notifications</h2>
      <p>If you allow notifications, MKR registers a device push token with Firebase Cloud Messaging (FCM) so it
      can deliver price and economic-calendar alerts to your device. This token identifies your device, not you
      personally, and is only used to deliver the alerts you configure.</p>
    </div>

    <div class="card">
      <h2>Market, news, and calendar data</h2>
      <p>Quotes, charts, news, and economic-calendar content are fetched through MKR's own backend, which in turn
      queries market data providers (Twelve Data, and Alpaca as a technical standby). Your device never contacts
      these providers directly, and no personal information is sent to them — only the symbol/date data needed to
      answer your request.</p>
    </div>

    <div class="card">
      <h2><span class="ai-dot">●</span> AI features</h2>
      <p>Market briefs, asset insights, and the AI Ask assistant are generated using Cloudflare Workers AI, run
      from MKR's own backend. Only the market data needed to ground a given analysis (e.g. a symbol's current
      quote) is sent to the model — no personal account information is included in these requests.</p>
    </div>

    <div class="card">
      <h2>Advertising</h2>
      <p>This build of MKR displays placeholder/test advertising content only — no real third-party advertising
      network is integrated yet. If real advertising is enabled in a future release, this policy will be updated
      first to name the ad provider and describe what data, if any, it collects.</p>
    </div>

    <div class="card">
      <h2>Payments and subscriptions</h2>
      <p>MKR does not collect or store payment card information directly. Where a premium subscription is
      offered, purchases are intended to be processed through the app store's standard billing system. In the
      current build, no real payment integration is active and no payment is charged — premium features, where
      shown, are for preview purposes only. This section will be updated once real billing is enabled.</p>
    </div>

    <div class="card">
      <h2>Your choices</h2>
      <ul>
        <li>Use MKR entirely as a guest — no account, no email, no cloud sync.</li>
        <li>Turn off notifications at any time in your device settings to stop new FCM token registrations.</li>
        <li>Request deletion of your account and associated cloud-synced data by contacting us below.</li>
      </ul>
    </div>

    <div class="card">
      <h2>Children's privacy</h2>
      <p>MKR is a general market-information tool and is not directed at children under 13. We do not knowingly
      collect personal information from children.</p>
    </div>

    <div class="card">
      <h2>Changes to this policy</h2>
      <p>MKR is an actively developed app. Details in this policy — including which providers are used and what
      data they receive — may change as new features (such as real advertising or billing) are introduced in
      future releases. The "Last updated" date above always reflects the most recent revision.</p>
    </div>

    <div class="card">
      <h2>Contact</h2>
      <p class="muted">Shown as an image to reduce automated harvesting — tap/click to open your email app, or read
      it visually and enter it manually.</p>
      <div class="contact-block">
        <canvas id="contact-canvas" width="230" height="26" aria-label="Contact email address, rendered as an image"></canvas>
      </div>
    </div>

    <footer>MKR — Market Radar · MLabs</footer>
  </div>

  <script>
    // Assembles and draws the contact address at runtime only, so the raw
    // HTML/DOM never contains it as selectable/scrapable text - the
    // literal string is never present anywhere in this document's source.
    (function () {
      var userCodes = [115, 97, 114, 97, 121, 117, 116, 104, 57, 51, 57];
      var domainCodes = [103, 109, 97, 105, 108, 46, 99, 111, 109];
      var user = String.fromCharCode.apply(null, userCodes);
      var domain = String.fromCharCode.apply(null, domainCodes);
      var address = user + '@' + domain;

      var canvas = document.getElementById('contact-canvas');
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      canvas.width = 230 * dpr;
      canvas.height = 26 * dpr;
      canvas.style.width = '230px';
      canvas.style.height = '26px';
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '15px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(address, 2, 14);

      canvas.addEventListener('click', function () {
        window.location.href = 'mailto:' + address;
      });
    })();
  </script>
</body>
</html>
`;
