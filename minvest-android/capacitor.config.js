// MInvest Android shell. The app is a thin WebView around the production web app: no backend, no secrets, no Native bridge for web content.
// CAP_TEST_URL (local testing only, never set for the delivered APK) points a TEST build at a local dev server over cleartext.
const test = process.env.CAP_TEST_URL;
const url = test || 'https://minvest.biz2success.workers.dev/';
const host = new URL(url).hostname;

/** @type {import('@capacitor/cli').CapacitorConfig} */
module.exports = {
  appId: 'com.biz2success.minvest',
  appName: 'MInvest',
  webDir: 'www',
  server: {
    url,
    cleartext: Boolean(test),
    allowNavigation: [host],     // the only host the app may navigate to; everything else is blocked in MainActivity
    errorPath: 'error.html',      // bundled page shown when the site cannot be reached (message + retry)
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#111815',
    appendUserAgent: 'MInvestApp/1.0',
    webContentsDebuggingEnabled: false,
    captureInput: true,
  },
};
