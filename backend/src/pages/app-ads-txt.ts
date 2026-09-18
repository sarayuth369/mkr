/**
 * 2026-09-18 app-ads.txt task - serves `GET /app-ads.txt` on the same
 * already-deployed Worker origin the app already uses for everything else
 * (`mkr-backend.biz2success.workers.dev`) - no new hosting, no new domain.
 *
 * Content is the EXACT authorized-seller line the operator was shown in
 * their own AdMob console - not invented, not guessed, and not extended
 * with any other network/reseller line this task wasn't given. The
 * publisher ID (`pub-1918372113970166`) matches the AdMob Application ID
 * already wired into `android/app/src/main/AndroidManifest.xml`
 * (`ca-app-pub-1918372113970166~1172227772`) - same account, confirmed by
 * direct string comparison, not a guess.
 *
 * Per the IAB's app-ads.txt spec (and AdMob's own docs), this file MUST be
 * plain `text/plain`, publicly reachable with no auth/redirect, and served
 * from the app's declared Developer Website root - never wrapped in this
 * Worker's usual `{success, data}` JSON envelope.
 */
const APP_ADS_TXT = 'google.com, pub-1918372113970166, DIRECT, f08c47fec0942fa0\n';

export function handleAppAdsTxt(): Response {
  return new Response(APP_ADS_TXT, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
