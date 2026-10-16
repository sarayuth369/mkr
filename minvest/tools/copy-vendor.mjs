// Copies the pinned Chart.js UMD bundle into public/vendor (served from our own origin; CSP forbids CDNs).
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../public/vendor/', import.meta.url), { recursive: true });
copyFileSync(new URL('../node_modules/chart.js/dist/chart.umd.js', import.meta.url), new URL('../public/vendor/chart.umd.js', import.meta.url));
console.log('vendor/chart.umd.js updated');
