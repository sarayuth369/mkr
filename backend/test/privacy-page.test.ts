import { describe, expect, it } from 'vitest';
import { handlePrivacyPage } from '../src/pages/privacy-page';

// 2026-09-17 Hosted Privacy Policy task - the page is a plain public HTML
// response (no D1/KV/Env dependency at all), so this test needs no fake
// environment - it just confirms the handler returns a real, well-formed
// HTML document with no secrets and the required disclosures.
describe('GET /privacy', () => {
  it('returns HTTP 200 with an HTML content type', async () => {
    const res = handlePrivacyPage();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('reconciles with the app\'s actual implementation - mentions Supabase, Firebase Cloud Messaging, and the market data providers', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('Supabase');
    expect(html).toContain('Firebase Cloud Messaging');
    expect(html).toContain('Twelve Data');
    expect(html).toContain('Alpaca');
  });

  it('reconciles with the real AdMob + Google Play Billing integration (2026-09-17 AdMob + Billing task) - describes what is real, never overclaims a live production state', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toContain('Google AdMob');
    // Honest about the test-ads-by-default safety switch, not a claim of full production ad serving.
    expect(html.toLowerCase()).toContain('test ads');
    expect(html).toContain('Google Play');
    expect(html.toLowerCase()).toContain('does not collect or store payment card information');
  });

  it('states an effective/last-updated date', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).toMatch(/Last updated:/);
  });

  it('never embeds the contact email as literal, scrapable text in the HTML source', async () => {
    const html = await handlePrivacyPage().text();
    expect(html).not.toContain('sarayuth939@gmail.com');
    // assembled via character codes client-side instead
    expect(html).toContain('String.fromCharCode');
  });

  it('never exposes an actual credential value (API key, bearer token, connection string)', async () => {
    // Not a bare word-ban (this page legitimately discusses account
    // "email & password" as a UI concept) - looks for the SHAPE of a real
    // secret value instead: a long opaque alphanumeric token, or an
    // env-var-style ALL_CAPS name for a known credential.
    const html = await handlePrivacyPage().text();
    expect(html).not.toMatch(/[A-Za-z0-9_-]{24,}/); // no long opaque token anywhere
    expect(html).not.toMatch(/TWELVE_DATA_API_KEY|ALPACA_API_KEY_ID|ALPACA_API_SECRET_KEY|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
