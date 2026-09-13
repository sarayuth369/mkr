import { api, clearToken, getBackendUrl, isLoggedIn, login, setBackendUrl } from './api.js';

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const backendUrlInput = document.getElementById('backend-url');
const nav = document.getElementById('nav');
const content = document.getElementById('content');

const PAGES = [
  { path: 'dashboard', label: 'Dashboard', render: renderDashboard },
  { path: 'providers', label: 'Providers', render: renderProviders },
  { path: 'symbols', label: 'Symbols', render: renderSymbols },
  { path: 'cache', label: 'Cache', render: renderCache },
  { path: 'rate-limits', label: 'Rate Limits', render: renderRateLimits },
  { path: 'features', label: 'Feature Flags', render: renderFeatures },
  { path: 'health', label: 'System Health', render: renderHealth },
  { path: 'logs', label: 'Audit Logs', render: renderLogs },
  { path: 'settings', label: 'Settings', render: renderSettings },
];

function currentPath() {
  return (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
}

function renderNav() {
  const active = currentPath();
  nav.innerHTML = PAGES.map((p) => `<a href="#/${p.path}" class="${p.path === active ? 'active' : ''}">${p.label}</a>`).join('');
}

async function renderRoute() {
  renderNav();
  const page = PAGES.find((p) => p.path === currentPath()) || PAGES[0];
  content.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await page.render();
  } catch (err) {
    content.innerHTML = `<div class="card"><p class="error">${escapeHtml(err.message)}</p></div>`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusBadge(status) {
  const cls = { healthy: 'badge-healthy', unhealthy: 'badge-unhealthy', disabled: 'badge-disabled', unknown: 'badge-unknown' }[status] || 'badge-unknown';
  return `<span class="badge ${cls}">${status}</span>`;
}

// ---- Dashboard ----------------------------------------------------------
async function renderDashboard() {
  const data = await api.dashboard();
  const { config, providerHealth, symbolCount, enabledSymbolCount } = data;
  content.innerHTML = `
    <h2>Dashboard</h2>
    <div class="grid">
      <div class="card"><div class="stat-label">Primary provider</div><div class="stat-value">${config.primaryProvider}</div></div>
      <div class="card"><div class="stat-label">Secondary provider</div><div class="stat-value">${config.secondaryProvider ?? '—'} ${statusBadge(config.secondaryEnabled ? 'healthy' : 'disabled')}</div></div>
      <div class="card"><div class="stat-label">Symbols</div><div class="stat-value">${enabledSymbolCount} / ${symbolCount} enabled</div></div>
      <div class="card"><div class="stat-label">Maintenance mode</div><div class="stat-value">${config.featureFlags.maintenanceMode ? 'ON' : 'off'}</div></div>
    </div>
    <div class="card">
      <h3>Provider health</h3>
      ${renderProviderHealthTable(providerHealth)}
    </div>
  `;
}

function renderProviderHealthTable(health) {
  const rows = [health.primary, health.secondary].filter(Boolean);
  if (rows.length === 0) return '<p class="muted">No providers configured.</p>';
  return `
    <table>
      <thead><tr><th>Provider</th><th>Status</th><th>Latency</th><th>Last success</th><th>Errors</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td>${r.provider}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${r.latencyMs != null ? r.latencyMs + ' ms' : '—'}</td>
              <td>${r.lastSuccessAt ? new Date(r.lastSuccessAt).toLocaleString() : 'never'}</td>
              <td>${r.errorCount}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

// ---- Providers ------------------------------------------------------------
async function renderProviders() {
  const data = await api.providersGet();
  content.innerHTML = `
    <h2>Providers</h2>
    <div class="card">
      <h3>Twelve Data (primary)</h3>
      <p>Secret: ${data.configured.twelve_data ? '<span class="badge badge-healthy">Configured</span>' : '<span class="badge badge-unhealthy">Not configured</span>'}</p>
      ${data.health.primary ? renderProviderHealthTable({ primary: data.health.primary, secondary: null }) : ''}
    </div>
    <div class="card">
      <h3>Alpaca (secondary / standby)</h3>
      <p>Secret: ${data.configured.alpaca ? '<span class="badge badge-healthy">Configured</span>' : '<span class="badge badge-unhealthy">Not configured</span>'}</p>
      <p class="warn-text">Alpaca's commercial redistribution rights have not been confirmed - keep disabled unless that has been resolved.</p>
      <div class="toggle-row">
        <span>Enable Alpaca as secondary</span>
        <input type="checkbox" id="secondary-enabled" ${data.secondaryEnabled ? 'checked' : ''} />
      </div>
      <div class="actions">
        <button class="primary" id="save-providers">Save</button>
        <span id="providers-msg" class="save-msg" hidden>Saved.</span>
      </div>
    </div>
  `;
  document.getElementById('save-providers').addEventListener('click', async () => {
    const secondaryEnabled = document.getElementById('secondary-enabled').checked;
    await api.providersUpdate({ secondaryEnabled });
    flash('providers-msg');
  });
}

// ---- Symbols ------------------------------------------------------------
async function renderSymbols() {
  const symbols = await api.symbolsGet();
  content.innerHTML = `
    <h2>Symbols</h2>
    <div class="card">
      <table>
        <thead><tr><th>Symbol</th><th>Name</th><th>Category</th><th>Enabled</th><th>Featured</th></tr></thead>
        <tbody>
          ${symbols
            .map(
              (s) => `<tr data-symbol="${escapeHtml(s.symbol)}">
                <td>${escapeHtml(s.symbol)}</td>
                <td>${escapeHtml(s.display_name)}</td>
                <td>${escapeHtml(s.category)}</td>
                <td><input type="checkbox" class="sym-enabled" ${s.enabled ? 'checked' : ''} /></td>
                <td><input type="checkbox" class="sym-featured" ${s.featured ? 'checked' : ''} /></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="actions" style="margin-top:14px;">
        <button class="primary" id="save-symbols">Save changes</button>
        <span id="symbols-msg" class="save-msg" hidden>Saved.</span>
      </div>
    </div>
  `;
  document.getElementById('save-symbols').addEventListener('click', async () => {
    const rows = [...content.querySelectorAll('tbody tr')];
    for (const row of rows) {
      const symbol = row.dataset.symbol;
      const enabled = row.querySelector('.sym-enabled').checked;
      const featured = row.querySelector('.sym-featured').checked;
      await api.symbolsUpdate({ symbol, enabled, featured });
    }
    flash('symbols-msg');
  });
}

// ---- Cache ----------------------------------------------------------------
async function renderCache() {
  const ttls = await api.cacheGet();
  content.innerHTML = `
    <h2>Cache Settings</h2>
    <div class="card">
      <p class="muted">Cloudflare KV rejects any TTL under 60 seconds, so 60s is the practical floor here.</p>
      ${ttlField('quoteSeconds', 'Quote TTL (seconds)', ttls.quoteSeconds, 60)}
      ${ttlField('candleIntradaySeconds', 'Intraday candle TTL (seconds)', ttls.candleIntradaySeconds, 60)}
      ${ttlField('candleDailySeconds', 'Daily/weekly candle TTL (seconds)', ttls.candleDailySeconds, 60)}
      ${ttlField('statusSeconds', 'Market status TTL (seconds)', ttls.statusSeconds, 60)}
      ${ttlField('staleThresholdSeconds', 'Stale threshold (seconds)', ttls.staleThresholdSeconds, 60)}
      <div class="actions">
        <button class="primary" id="save-cache">Save</button>
        <span id="cache-msg" class="save-msg" hidden>Saved.</span>
      </div>
    </div>
  `;
  document.getElementById('save-cache').addEventListener('click', async () => {
    const patch = {};
    for (const key of ['quoteSeconds', 'candleIntradaySeconds', 'candleDailySeconds', 'statusSeconds', 'staleThresholdSeconds']) {
      patch[key] = Number(document.getElementById(`field-${key}`).value);
    }
    await api.cacheUpdate(patch);
    flash('cache-msg');
  });
}

function ttlField(key, label, value, min = 1) {
  return `<div class="form-row"><label for="field-${key}">${label}</label><input id="field-${key}" type="number" min="${min}" max="86400" value="${value}" /></div>`;
}

// ---- Rate limits ------------------------------------------------------------
async function renderRateLimits() {
  const limits = await api.rateLimitsGet();
  content.innerHTML = `
    <h2>Rate Limits</h2>
    <div class="card">
      ${ttlField('publicPerMinute', 'Public API requests / minute / client', limits.publicPerMinute)}
      ${ttlField('adminPerMinute', 'Admin API requests / minute', limits.adminPerMinute)}
      ${ttlField('wsMaxConnections', 'Max concurrent WebSocket connections', limits.wsMaxConnections)}
      <p class="warn-text">Values above 10,000 require confirmation below to avoid accidentally disabling protection.</p>
      <div class="toggle-row"><span>I understand this may reduce abuse protection</span><input type="checkbox" id="confirm-limits" /></div>
      <div class="actions">
        <button class="primary" id="save-limits">Save</button>
        <span id="limits-msg" class="save-msg" hidden>Saved.</span>
      </div>
    </div>
  `;
  document.getElementById('save-limits').addEventListener('click', async () => {
    const patch = { confirm: document.getElementById('confirm-limits').checked };
    for (const key of ['publicPerMinute', 'adminPerMinute', 'wsMaxConnections']) {
      patch[key] = Number(document.getElementById(`field-${key}`).value);
    }
    await api.rateLimitsUpdate(patch);
    flash('limits-msg');
  });
}

// ---- Feature flags ------------------------------------------------------------
async function renderFeatures() {
  const flags = await api.featuresGet();
  const keys = Object.keys(flags);
  content.innerHTML = `
    <h2>Feature Flags</h2>
    <div class="card">
      ${keys.map((k) => `<div class="toggle-row"><span>${k}</span><input type="checkbox" class="flag" data-key="${k}" ${flags[k] ? 'checked' : ''} /></div>`).join('')}
      <div class="actions">
        <button class="primary" id="save-flags">Save</button>
        <span id="flags-msg" class="save-msg" hidden>Saved.</span>
      </div>
    </div>
  `;
  document.getElementById('save-flags').addEventListener('click', async () => {
    const patch = {};
    for (const el of content.querySelectorAll('.flag')) patch[el.dataset.key] = el.checked;
    await api.featuresUpdate(patch);
    flash('flags-msg');
  });
}

// ---- Health ------------------------------------------------------------
async function renderHealth() {
  const data = await api.health();
  content.innerHTML = `
    <h2>System Health</h2>
    <div class="card">
      <h3>Storage</h3>
      <p>D1: ${statusBadge(data.storage.d1 ? 'healthy' : 'unhealthy')} &nbsp; KV: ${statusBadge(data.storage.kv ? 'healthy' : 'unhealthy')}</p>
    </div>
    <div class="card">
      <h3>Providers</h3>
      ${renderProviderHealthTable(data.providers)}
    </div>
  `;
}

// ---- Logs ------------------------------------------------------------
async function renderLogs() {
  const logs = await api.logs(100);
  content.innerHTML = `
    <h2>Audit Logs</h2>
    <p class="muted">The most recent admin configuration changes. Never shows secret values.</p>
    <div class="card">
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>
          ${logs
            .map(
              (l) => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${escapeHtml(l.actor)}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.target ?? '—')}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${logs.length === 0 ? '<p class="muted">No changes recorded yet.</p>' : ''}
    </div>
  `;
}

// ---- Settings ------------------------------------------------------------
async function renderSettings() {
  const data = await api.settings();
  content.innerHTML = `
    <h2>Settings</h2>
    <div class="card">
      <h3>Secrets</h3>
      <p class="muted">Values are never shown - only whether each is configured. Set them with <code>wrangler secret put</code>.</p>
      <table>
        <tbody>
          <tr><td>Twelve Data API key</td><td>${statusBadge(data.secrets.twelveDataApiKey === 'configured' ? 'healthy' : 'unhealthy')}</td></tr>
          <tr><td>Alpaca credentials</td><td>${statusBadge(data.secrets.alpacaCredentials === 'configured' ? 'healthy' : 'disabled')}</td></tr>
          <tr><td>Admin password</td><td>${statusBadge(data.secrets.adminPassword === 'configured' ? 'healthy' : 'unhealthy')}</td></tr>
          <tr><td>Admin session secret</td><td>${statusBadge(data.secrets.adminSessionSecret === 'configured' ? 'healthy' : 'unhealthy')}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Backend connection</h3>
      <div class="form-row">
        <label>Backend URL</label>
        <input id="settings-backend-url" type="url" value="${escapeHtml(getBackendUrl())}" />
      </div>
      <div class="actions">
        <button class="secondary" id="save-backend-url">Update</button>
        <span id="backend-url-msg" class="save-msg" hidden>Saved.</span>
      </div>
    </div>
  `;
  document.getElementById('save-backend-url').addEventListener('click', () => {
    setBackendUrl(document.getElementById('settings-backend-url').value);
    flash('backend-url-msg');
  });
}

function flash(id) {
  const el = document.getElementById(id);
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2000);
}

// ---- Boot / auth ------------------------------------------------------------
function showApp() {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  renderRoute();
}

function showLogin() {
  appScreen.hidden = true;
  loginScreen.hidden = false;
  backendUrlInput.value = getBackendUrl();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  setBackendUrl(backendUrlInput.value);
  try {
    await login(document.getElementById('password').value);
    showApp();
  } catch (err) {
    loginError.textContent = err.message || 'Login failed.';
    loginError.hidden = false;
  }
});

document.getElementById('logout').addEventListener('click', () => {
  clearToken();
  showLogin();
});

window.addEventListener('hashchange', () => {
  if (isLoggedIn()) renderRoute();
});

if (isLoggedIn()) showApp();
else showLogin();
