import { describe, expect, it } from 'vitest';
import { handleDeveloperWebsite } from '../src/pages/developer-website-page';

// 2026-09-18 app-ads.txt + Developer Website task - this page exists so
// Play Console has a real "Developer Website" for AdMob's app-ads.txt
// crawler to trust; it must stay distinct from the separate Admin Web
// deployment (mkr-admin.pages.dev) and link to /privacy rather than
// duplicating it.
describe('GET / (Developer Website)', () => {
  it('returns HTTP 200 with an HTML content type', async () => {
    const res = handleDeveloperWebsite();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('identifies the app and links to the Privacy Policy', async () => {
    const html = await handleDeveloperWebsite().text();
    expect(html).toContain('MKR');
    expect(html).toContain('Market Radar');
    expect(html).toContain('href="/privacy"');
  });

  it('never links to or mentions the separate Admin Web deployment', async () => {
    const html = await handleDeveloperWebsite().text();
    expect(html).not.toContain('mkr-admin.pages.dev');
  });

  it('never embeds the contact email as literal, scrapable text in the HTML source', async () => {
    const html = await handleDeveloperWebsite().text();
    expect(html).not.toContain('sarayuth939@gmail.com');
    expect(html).toContain('String.fromCharCode');
  });

  it('never exposes an actual credential value', async () => {
    const html = await handleDeveloperWebsite().text();
    expect(html).not.toMatch(/[A-Za-z0-9_-]{24,}/);
    expect(html).not.toMatch(/TWELVE_DATA_API_KEY|ALPACA_API_KEY_ID|ALPACA_API_SECRET_KEY|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
