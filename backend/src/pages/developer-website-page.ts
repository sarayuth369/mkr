/**
 * 2026-09-18 app-ads.txt + Developer Website task - a small, professional
 * public landing page served at the Worker root (`GET /`), on the SAME
 * already-deployed origin (`mkr-backend.biz2success.workers.dev`) every
 * other MKR public page/API already uses - no new hosting, no new domain.
 *
 * This exists specifically to be a real "Developer Website" Google Play
 * Console (and AdMob's app-ads.txt crawler) can point at: Google requires
 * app-ads.txt to be reachable from the app's DECLARED developer website
 * root, and a bare API root previously returned this Worker's JSON 404
 * envelope for `GET /` - not a valid public website for that purpose.
 *
 * Deliberately separate from:
 * - the Admin Web panel (`mkr-admin.pages.dev`, a different deployment
 *   entirely - never linked from here, never mentioned to end users)
 * - `/privacy` (unchanged, linked FROM here, not merged into this page)
 *
 * Copy below is the SAME already-approved "About" copy already shipping
 * in the app itself (`lib/l10n/app_en.arb`'s `about*` keys) - never
 * invented marketing claims for this page specifically.
 */
export function handleDeveloperWebsite(): Response {
  return new Response(DEVELOPER_WEBSITE_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

const DEVELOPER_WEBSITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MKR — Market Radar</title>
<meta name="description" content="MKR (Market Radar) — a market intelligence app for Gold, equities, crypto, forex and major indices, with AI-powered insights.">
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
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  .subtitle { color: var(--muted); font-size: 0.95rem; margin: 0 0 32px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 22px;
    margin-bottom: 16px;
  }
  h2 { font-size: 1.05rem; margin: 0 0 10px; color: var(--text); }
  p { margin: 0 0 10px; color: var(--text); font-size: 0.95rem; }
  p:last-child { margin-bottom: 0; }
  ul.features { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  ul.features li { font-size: 0.9rem; display: flex; align-items: center; gap: 8px; }
  ul.features li::before { content: "●"; color: var(--accent); font-size: 0.6rem; }
  .links { display: flex; flex-wrap: wrap; gap: 10px 20px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: var(--muted); font-size: 0.85rem; }
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
        <h1>MKR — Market Radar</h1>
        <p class="subtitle">Your Global Market Intelligence</p>
      </div>
    </header>

    <div class="card">
      <h2>About</h2>
      <p>MKR — Market Radar is a market intelligence app designed to help you understand what matters in
      financial markets at a glance.</p>
      <p>Track Gold, equities, crypto, forex and major market indices, follow high-impact economic events,
      discover market-moving news, and receive concise AI-powered insights in one place.</p>
      <p>MKR is built for investors and market watchers who want a clear view of the market without unnecessary
      complexity.</p>
    </div>

    <div class="card">
      <h2>Features</h2>
      <ul class="features">
        <li>Modern market dashboard</li>
        <li>AI Market Assistant</li>
        <li>Real-time market data</li>
        <li>Smart alerts</li>
        <li>Global market coverage</li>
        <li>Premium tools</li>
      </ul>
    </div>

    <div class="card">
      <h2>Links</h2>
      <div class="links">
        <a href="/privacy">Privacy Policy</a>
      </div>
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
    // HTML/DOM never contains it as selectable/scrapable text - matches
    // the same technique already used on the /privacy page.
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
