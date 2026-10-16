// Generates the MInvest icon set from an SVG defined here (original artwork, no third-party images):
//   assets/icon/{icon.svg, icon-foreground.svg, icon-1024.png, icon-foreground-1024.png, splash-logo.png}
//   android/app/src/main/res/{mipmap-*, drawable splash}
// Usage: node tools/make-icons.mjs
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const out = join(root, 'assets', 'icon');
mkdirSync(out, { recursive: true });

const BG_TOP = '#0d4a38', BG_BOTTOM = '#082d22', MINT = '#52e0b0', WHITE = '#ffffff';
// Logo = white "V" (down-stroke + short rise) and a mint upward trend line with an arrow head, inside the adaptive-icon safe zone.
const logo = `
  <g transform="translate(512 512) scale(0.95) translate(-512 -512)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M262 372 L408 652 L436 616" stroke="${WHITE}" stroke-width="86"/>
    <path d="M408 652 L560 468 L640 548 L778 372" stroke="${MINT}" stroke-width="62"/>
    <path d="M690 366 L790 360 L784 462" stroke="${MINT}" stroke-width="54"/>
  </g>`;
const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>`;
const svg = (inner, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${extra}${inner}</svg>`;
const full = svg(bg + logo);
const fg = svg(logo);
writeFileSync(join(out, 'icon.svg'), full);
writeFileSync(join(out, 'icon-foreground.svg'), fg);

const png = (s, size) => sharp(Buffer.from(s), { density: 300 }).resize(size, size).png().toBuffer();
const roundMask = (size, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);

async function masked(size, kind) {
  const base = await png(full, size);
  const r = kind === 'round' ? size / 2 : size * 0.22;
  return sharp(base).composite([{ input: roundMask(size, r), blend: 'dest-in' }]).png().toBuffer();
}

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const d of Object.keys(legacy)) {
  const dir = join(res, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ic_launcher.png'), await masked(legacy[d], 'square'));
  writeFileSync(join(dir, 'ic_launcher_round.png'), await masked(legacy[d], 'round'));
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), await png(fg, adaptive[d]));
  writeFileSync(join(dir, 'ic_launcher_background.png'), await png(svg(bg), adaptive[d])); // full-bleed gradient so the adaptive icon is green to the very edge
}
writeFileSync(join(out, 'icon-1024.png'), await png(full, 1024));
writeFileSync(join(out, 'icon-foreground-1024.png'), await png(fg, 1024));
writeFileSync(join(out, 'icon-round-512.png'), await masked(512, 'round'));

// adaptive icon definitions + background colour
const any = join(res, 'mipmap-anydpi-v26');
mkdirSync(any, { recursive: true });
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`;
writeFileSync(join(any, 'ic_launcher.xml'), adaptiveXml);
writeFileSync(join(any, 'ic_launcher_round.xml'), adaptiveXml);
writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0A3A2C</color>\n</resources>\n`);

// splash: dark background + centred logo, written over every splash.png the Capacitor template created
const splashLogo = await png(fg, 420);
writeFileSync(join(out, 'splash-logo.png'), splashLogo);
const splash = async (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: '#0A3A2C' } }).composite([{ input: await sharp(splashLogo).resize(Math.round(Math.min(w, h) * 0.5)).toBuffer(), gravity: 'centre' }]).png().toBuffer();
const splashDirs = readdirSync(res).filter((d) => /^drawable(-(land|port))?(-[a-z]+dpi)?$/.test(d) && existsSync(join(res, d, 'splash.png')));
for (const d of splashDirs) {
  const land = d.includes('land');
  const scale = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }[(d.match(/([a-z]+)dpi$/) ?? [])[0]?.replace(/^-?/, '')] ?? 1;
  const [w, h] = land ? [480, 320] : [320, 480];
  writeFileSync(join(res, d, 'splash.png'), await splash(Math.round(w * scale), Math.round(h * scale)));
}
console.log(`icons written; splash variants: ${splashDirs.length}`);
