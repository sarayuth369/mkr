// Repo hygiene: the Apps Script manifest must stay a valid manifest (it was once overwritten with personal notes),
// and tracked files must not contain credential-shaped strings or personal financial exports.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = () => {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '.'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
};

describe('appsscript.json manifest', () => {
  const m = JSON.parse(readFileSync(join(root, 'apps-script', 'appsscript.json'), 'utf8'));
  it('is a plain manifest with the minimum scope and nothing else', () => {
    expect(Object.keys(m).sort()).toEqual(['exceptionLogging', 'oauthScopes', 'runtimeVersion', 'timeZone', 'webapp']);
    expect(m.oauthScopes).toEqual(['https://www.googleapis.com/auth/spreadsheets']);
    expect(m.timeZone).toBe('Asia/Bangkok');
    expect(m.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  });
});

describe('no secrets or personal data in the repo (tracked + not-ignored files)', () => {
  const files = tracked();
  const textFiles = files.filter((f) => /\.(ts|js|mjs|gs|json|toml|md|html|css|txt)$/i.test(f) && !/package-lock\.json$/.test(f) && !f.startsWith('public/vendor/'));
  const patterns = [
    ['Apps Script deployment id', /AKfycb[A-Za-z0-9_-]{30,}/],
    ['Cloudflare API token', /\bcfut_[A-Za-z0-9]{20,}|CLOUDFLARE_API_TOKEN\s*[=:]\s*\S{12,}/],
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['bearer token', /\bBearer\s+[A-Za-z0-9._-]{20,}/],
    ['assigned password/secret value', /\b(MINVEST_PASSWORD|MINVEST_SESSION_SECRET|MINVEST_SCRIPT_SECRET)\s*=\s*"?[^\s#<".]/], // placeholders such as <...> or ... are fine
    ['hex secret (64+)', /\b[0-9a-f]{64,}\b/i],
  ];
  it('no tracked file matches a credential pattern', () => {
    const hits = [];
    for (const f of textFiles) {
      const text = readFileSync(join(root, f), 'utf8');
      for (const [name, re] of patterns) if (re.test(text)) hits.push(`${name}: ${relative(root, join(root, f))}`);
    }
    expect(hits).toEqual([]);
  });
  it('personal exports and local secrets are not part of the repo', () => {
    const bad = files.filter((f) => /^data\//.test(f) || /\.xlsx?$/i.test(f) || /(^|\/)\.dev\.vars$/.test(f) || /OWNER-NOTES/i.test(f));
    expect(bad).toEqual([]);
  });
});
