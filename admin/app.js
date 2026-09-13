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
  { path: 'users', label: 'Users', render: renderUsers },
  { path: 'alerts', label: 'Alerts', render: renderAlerts },
  { path: 'push', label: 'Push', render: renderPush },
  { path: 'notification-logs', label: 'Notification Logs', render: renderNotificationLogs },
  { path: 'subscriptions', label: 'Subscriptions', render: renderSubscriptions },
  { path: 'health', label: 'System Health', render: renderHealth },
  { path: 'logs', label: 'Audit Logs', render: renderLogs },
  { path: 'settings', label: 'Settings', render: renderSettings },
];

function currentPath() {
  return (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
}

function currentQuery() {
  const [, qs] = location.hash.split('?');
  return new URLSearchParams(qs || '');
}

/** Consistent "external service not wired up yet" card - Supabase-backed
 * pages all render this instead of an empty/broken table when the backend
 * reports `{ configured: false }`. */
function notConfiguredCard(title, service = 'Supabase') {
  return `
    <h2>${title}</h2>
    <div class="card">
      <p class="warn-text">${service} is not configured on this deployment yet.</p>
      <p class="muted">See docs/MKR-EXTERNAL-INTEGRATIONS.md for what the product owner needs to supply to enable this page.</p>
    </div>
  `;
}

function renderNav() {
  const active = currentPath();
  nav.innerHTML = PAGES.map((p) => `<a href="#/${p.path}" class="${p.path === active ? 'active' : ''}">${p.label}</a>`).join('');
}

async function renderRoute() {
  renderNav();
  const path = currentPath();
  const userDetailId = path === 'users' ? currentQuery().get('id') : null;
  const page = PAGES.find((p) => p.path === path) || PAGES[0];
  content.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (userDetailId) await renderUserDetail(userDetailId);
    else await page.render();
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

// ---- Users ------------------------------------------------------------
function userStatusBadges(u) {
  const parts = [u.suspended ? statusBadge('unhealthy') : statusBadge('healthy')];
  return `${u.suspended ? 'Suspended' : 'Active'} ${parts[0]}${u.emailConfirmed ? '' : ` <span class="badge badge-disabled">Email unconfirmed</span>`}`;
}

async function renderUsers() {
  const q = currentQuery();
  const filters = {
    page: Number(q.get('page')) || 1,
    q: q.get('q') || '',
    status: q.get('status') || '',
    emailConfirmed: q.get('emailConfirmed') || '',
    sort: q.get('sort') || 'created_desc',
  };
  const params = {};
  if (filters.page > 1) params.page = filters.page;
  if (filters.q) params.q = filters.q;
  if (filters.status) params.status = filters.status;
  if (filters.emailConfirmed) params.emailConfirmed = filters.emailConfirmed;
  if (filters.sort !== 'created_desc') params.sort = filters.sort;

  const data = await api.usersGet(params);
  if (!data.configured) return void (content.innerHTML = notConfiguredCard('Users'));

  content.innerHTML = `
    <h2>Users</h2>
    <div class="grid">
      <div class="card"><div class="stat-label">Total${data.scanned ? ' (matching filter)' : ''}</div><div class="stat-value">${data.totals.total}</div></div>
      <div class="card"><div class="stat-label">Active (30d)</div><div class="stat-value">${data.totals.active}</div></div>
      <div class="card"><div class="stat-label">New (30d)</div><div class="stat-value">${data.totals.newLast30Days}</div></div>
      <div class="card"><div class="stat-label">Pro</div><div class="stat-value">${data.totals.pro}</div></div>
    </div>
    <p class="muted">"Guest" browsing is a client-side concept only - every row below is a real registered account.</p>
    <div class="card">
      <div class="form-row"><label>Search by email</label><input id="user-search" type="text" value="${escapeHtml(filters.q)}" placeholder="name@example.com" /></div>
      <div class="form-row">
        <label>Status</label>
        <select id="user-status-filter">
          <option value="" ${filters.status === '' ? 'selected' : ''}>All</option>
          <option value="active" ${filters.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="suspended" ${filters.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select>
      </div>
      <div class="form-row">
        <label>Email confirmation</label>
        <select id="user-confirmed-filter">
          <option value="" ${filters.emailConfirmed === '' ? 'selected' : ''}>All</option>
          <option value="true" ${filters.emailConfirmed === 'true' ? 'selected' : ''}>Confirmed</option>
          <option value="false" ${filters.emailConfirmed === 'false' ? 'selected' : ''}>Unconfirmed</option>
        </select>
      </div>
      <div class="form-row">
        <label>Sort by</label>
        <select id="user-sort">
          <option value="created_desc" ${filters.sort === 'created_desc' ? 'selected' : ''}>Newest first</option>
          <option value="created_asc" ${filters.sort === 'created_asc' ? 'selected' : ''}>Oldest first</option>
          <option value="lastSignIn_desc" ${filters.sort === 'lastSignIn_desc' ? 'selected' : ''}>Last sign-in (recent first)</option>
          <option value="lastSignIn_asc" ${filters.sort === 'lastSignIn_asc' ? 'selected' : ''}>Last sign-in (oldest first)</option>
        </select>
      </div>
      ${data.scanned ? '<p class="muted">Search/filter/sort scans a bounded recent window of users, not the entire user base - see docs/MKR-PHASE2-ARCHITECTURE.md.</p>' : ''}
      <div class="actions">
        <button class="primary" id="apply-user-filters">Apply</button>
        <button class="secondary" id="refresh-users">Refresh</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Email</th><th>Status</th><th>Plan</th><th>Created</th><th>Last sign-in</th><th>Alerts</th><th>Devices</th></tr></thead>
        <tbody>
          ${data.users
            .map(
              (u) => `<tr class="row-link" data-id="${escapeHtml(u.id)}">
                <td>${escapeHtml(u.email ?? '—')}</td>
                <td>${userStatusBadges(u)}</td>
                <td>${escapeHtml(u.plan)}</td>
                <td>${new Date(u.createdAt).toLocaleDateString()}</td>
                <td>${u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : 'never'}</td>
                <td>${u.alertCount}</td>
                <td>${u.deviceCount}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${data.users.length === 0 ? '<p class="muted">No users match this filter.</p>' : ''}
      <div class="actions" style="margin-top:12px;">
        <button class="secondary" id="user-prev-page" ${filters.page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
        <span class="muted">Page ${data.page}</span>
        <button class="secondary" id="user-next-page" ${data.hasMore ? '' : 'disabled'}>Next &rarr;</button>
      </div>
    </div>
  `;

  function goToUsers(nextFilters) {
    const merged = { ...filters, ...nextFilters };
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(merged).filter(([k, v]) => v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'created_desc'))),
    );
    location.hash = `#/users${qs.toString() ? `?${qs}` : ''}`;
  }

  document.getElementById('apply-user-filters').addEventListener('click', () =>
    goToUsers({
      page: 1,
      q: document.getElementById('user-search').value.trim(),
      status: document.getElementById('user-status-filter').value,
      emailConfirmed: document.getElementById('user-confirmed-filter').value,
      sort: document.getElementById('user-sort').value,
    }),
  );
  document.getElementById('refresh-users').addEventListener('click', () => renderUsers());
  document.getElementById('user-prev-page').addEventListener('click', () => goToUsers({ page: filters.page - 1 }));
  document.getElementById('user-next-page').addEventListener('click', () => goToUsers({ page: filters.page + 1 }));

  for (const row of content.querySelectorAll('.row-link')) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => (location.hash = `#/users?id=${encodeURIComponent(row.dataset.id)}`));
  }
}

async function renderUserDetail(id) {
  const data = await api.userDetail(id);
  if (!data.configured) return void (content.innerHTML = notConfiguredCard('User Detail'));
  if (!data.found) return void (content.innerHTML = '<h2>User Detail</h2><div class="card"><p class="error">User not found.</p></div>');

  const { auth, profile, watchlistItemCount, activeAlerts, devices, subscription } = data;
  content.innerHTML = `
    <h2>User Detail</h2>
    <p><a href="#/users">&larr; Back to Users</a></p>
    <div class="grid">
      <div class="card"><div class="stat-label">Status</div><div class="stat-value">${userStatusBadges(auth)}</div></div>
      <div class="card"><div class="stat-label">Watchlist items</div><div class="stat-value">${watchlistItemCount}</div></div>
      <div class="card"><div class="stat-label">Active alerts</div><div class="stat-value">${activeAlerts.length}</div></div>
      <div class="card"><div class="stat-label">Devices</div><div class="stat-value">${devices.length}</div></div>
    </div>
    <div class="card">
      <h3>Account</h3>
      <p>User ID: <code>${escapeHtml(auth.id)}</code></p>
      <p>Email: ${escapeHtml(auth.email ?? '—')}</p>
      <p>Created: ${new Date(auth.createdAt).toLocaleString()}</p>
      <p>Last sign-in: ${auth.lastSignInAt ? new Date(auth.lastSignInAt).toLocaleString() : 'never'}</p>
      ${Object.keys(auth.userMetadata || {}).length > 0 ? `<p>User metadata: <code>${escapeHtml(JSON.stringify(auth.userMetadata))}</code></p>` : ''}
      <p class="muted">Plan: ${escapeHtml(profile.plan)} · Display name: ${escapeHtml(profile.display_name ?? '—')} · Member since ${new Date(profile.created_at).toLocaleDateString()}</p>
    </div>
    <div class="card">
      <h3>Edit account</h3>
      <div class="form-row"><label>Email</label><input id="edit-email" type="email" value="${escapeHtml(auth.email ?? '')}" /></div>
      <p class="muted">Changing the email always requires the user to reconfirm the new address - it is never treated as pre-verified.</p>
      <div class="form-row"><label>Display name</label><input id="edit-display-name" value="${escapeHtml(profile.display_name ?? '')}" /></div>
      <div class="actions"><button class="primary" id="save-user-edit">Save</button><span id="user-edit-msg" class="save-msg" hidden></span></div>
    </div>
    <div class="card">
      <h3>Suspension</h3>
      <p class="muted">Suspending sets Supabase Auth's own ban - a suspended user is rejected on sign-in, not just hidden here.</p>
      ${
        auth.suspended
          ? '<div class="actions"><button class="secondary" id="unsuspend-user">Unsuspend</button><span id="suspend-msg" class="save-msg" hidden></span></div>'
          : `<div class="toggle-row"><span>I understand this immediately blocks this user from signing in</span><input type="checkbox" id="confirm-suspend" /></div>
             <div class="actions"><button class="secondary" id="suspend-user">Suspend</button><span id="suspend-msg" class="save-msg" hidden></span></div>`
      }
    </div>
    <div class="card">
      <h3>Active alerts</h3>
      ${
        activeAlerts.length === 0
          ? '<p class="muted">None.</p>'
          : `<table><thead><tr><th>Symbol</th><th>Condition</th><th>Target</th></tr></thead><tbody>${activeAlerts
              .map((a) => `<tr><td>${escapeHtml(a.symbol)}</td><td>${escapeHtml(a.condition_type)}</td><td>${a.target_value}</td></tr>`)
              .join('')}</tbody></table>`
      }
    </div>
    <div class="card">
      <h3>Devices</h3>
      ${
        devices.length === 0
          ? '<p class="muted">None.</p>'
          : `<table><thead><tr><th>Platform</th><th>Active</th><th>Updated</th></tr></thead><tbody>${devices
              .map((d) => `<tr><td>${escapeHtml(d.platform)}</td><td>${statusBadge(d.active ? 'healthy' : 'disabled')}</td><td>${new Date(d.updated_at).toLocaleString()}</td></tr>`)
              .join('')}</tbody></table>`
      }
    </div>
    <div class="card">
      <h3>Subscription</h3>
      <p class="muted">No billing/auth secrets are ever shown here.</p>
      ${subscription ? `<p>${escapeHtml(subscription.plan)} - ${statusBadge(subscription.status === 'active' ? 'healthy' : 'disabled')} ${subscription.expires_at ? `(expires ${new Date(subscription.expires_at).toLocaleDateString()})` : ''}</p>` : '<p class="muted">No subscription record.</p>'}
    </div>
    <div class="card">
      <h3>Delete account</h3>
      <p class="warn-text">Delete user permanently? This removes the Auth account and cascades to their profile, watchlists, alerts, devices, preferences, subscriptions, and notification history. This cannot be undone.</p>
      <div class="form-row"><label>Type the user's email to confirm (${escapeHtml(auth.email ?? '')})</label><input id="delete-confirm-email" type="text" placeholder="${escapeHtml(auth.email ?? '')}" /></div>
      <div class="actions"><button class="danger" id="delete-user">Delete user permanently</button><span id="delete-msg" class="save-msg" hidden></span></div>
    </div>
  `;

  document.getElementById('save-user-edit').addEventListener('click', async () => {
    const msg = document.getElementById('user-edit-msg');
    try {
      const email = document.getElementById('edit-email').value.trim();
      const displayName = document.getElementById('edit-display-name').value.trim();
      const patch = {};
      if (email && email !== auth.email) patch.email = email;
      if (displayName !== (profile.display_name ?? '')) patch.displayName = displayName;
      if (Object.keys(patch).length === 0) {
        msg.textContent = 'Nothing changed.';
      } else {
        await api.userUpdate(id, patch);
        msg.textContent = 'Saved.';
        setTimeout(() => renderUserDetail(id), 600);
      }
    } catch (err) {
      msg.textContent = err.message;
    }
    msg.hidden = false;
  });

  const suspendBtn = document.getElementById('suspend-user');
  if (suspendBtn) {
    suspendBtn.addEventListener('click', async () => {
      const msg = document.getElementById('suspend-msg');
      if (!document.getElementById('confirm-suspend').checked) {
        msg.textContent = 'Check the confirmation box first.';
        msg.hidden = false;
        return;
      }
      try {
        await api.userSuspend(id);
        renderUserDetail(id);
      } catch (err) {
        msg.textContent = err.message;
        msg.hidden = false;
      }
    });
  }
  const unsuspendBtn = document.getElementById('unsuspend-user');
  if (unsuspendBtn) {
    unsuspendBtn.addEventListener('click', async () => {
      try {
        await api.userUnsuspend(id);
        renderUserDetail(id);
      } catch (err) {
        const msg = document.getElementById('suspend-msg');
        msg.textContent = err.message;
        msg.hidden = false;
      }
    });
  }

  document.getElementById('delete-user').addEventListener('click', async () => {
    const msg = document.getElementById('delete-msg');
    const typed = document.getElementById('delete-confirm-email').value.trim();
    if (!typed || typed.toLowerCase() !== (auth.email ?? '').toLowerCase()) {
      msg.textContent = "Type the user's exact email to confirm.";
      msg.hidden = false;
      return;
    }
    try {
      await api.userDelete(id, typed);
      location.hash = '#/users';
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
}

// ---- Alerts (Phase 2.4 - user-created price alerts, not admin config) --
async function renderAlerts() {
  const query = currentQuery();
  const status = query.get('status') || '';
  const symbol = query.get('symbol') || '';
  const data = await api.alertsGet({ ...(status ? { status } : {}), ...(symbol ? { symbol } : {}) });
  if (!data.configured) return void (content.innerHTML = notConfiguredCard('Alerts'));

  content.innerHTML = `
    <h2>Alerts</h2>
    <div class="card">
      <div class="form-row">
        <label>Filter by status</label>
        <select id="alert-status-filter">
          <option value="" ${status === '' ? 'selected' : ''}>All</option>
          <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
          <option value="triggered" ${status === 'triggered' ? 'selected' : ''}>Triggered at least once</option>
          <option value="disabled" ${status === 'disabled' ? 'selected' : ''}>Disabled</option>
        </select>
      </div>
      <div class="form-row">
        <label>Filter by symbol</label>
        <input id="alert-symbol-filter" type="text" value="${escapeHtml(symbol)}" placeholder="e.g. XAU/USD" />
      </div>
      <div class="actions"><button class="secondary" id="apply-alert-filters">Apply</button></div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Symbol</th><th>Condition</th><th>Target</th><th>Enabled</th><th>Last triggered</th><th></th></tr></thead>
        <tbody>
          ${data.alerts
            .map(
              (a) => `<tr data-id="${escapeHtml(a.id)}">
                <td>${escapeHtml(a.symbol)}</td>
                <td>${escapeHtml(a.condition_type)}</td>
                <td>${a.target_value}</td>
                <td><input type="checkbox" class="alert-enabled" ${a.enabled ? 'checked' : ''} /></td>
                <td>${a.last_triggered_at ? new Date(a.last_triggered_at).toLocaleString() : 'never'}</td>
                <td><button class="secondary alert-save" data-id="${escapeHtml(a.id)}">Save</button></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${data.alerts.length === 0 ? '<p class="muted">No alerts match this filter.</p>' : ''}
      <span id="alerts-msg" class="save-msg" hidden>Saved.</span>
    </div>
  `;
  document.getElementById('apply-alert-filters').addEventListener('click', () => {
    const s = document.getElementById('alert-status-filter').value;
    const sym = document.getElementById('alert-symbol-filter').value.trim();
    location.hash = `#/alerts?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(sym ? { symbol: sym } : {}) }).toString()}`;
  });
  for (const btn of content.querySelectorAll('.alert-save')) {
    btn.addEventListener('click', async () => {
      const row = content.querySelector(`tr[data-id="${btn.dataset.id}"]`);
      const enabled = row.querySelector('.alert-enabled').checked;
      await api.alertToggle(btn.dataset.id, enabled);
      flash('alerts-msg');
    });
  }
}

// ---- Push ------------------------------------------------------------
async function renderPush() {
  content.innerHTML = `
    <h2>Push Notifications</h2>
    <div class="card">
      <h3>Send test notification</h3>
      <div class="form-row"><label>Device ID</label><input id="push-device-id" type="text" placeholder="device row id" /></div>
      <div class="form-row"><label>Title</label><input id="push-test-title" type="text" placeholder="MKR test notification" /></div>
      <div class="form-row"><label>Body</label><input id="push-test-body" type="text" placeholder="This is a test." /></div>
      <div class="actions"><button class="primary" id="send-test-push">Send test push</button><span id="push-test-msg" class="save-msg" hidden></span></div>
    </div>
    <div class="card">
      <h3>Send announcement</h3>
      <p class="warn-text">This sends a real push to every matching device. This cannot be undone.</p>
      <div class="form-row">
        <label>Audience</label>
        <select id="push-audience">
          <option value="all">All registered users</option>
          <option value="pro">Pro users only</option>
        </select>
      </div>
      <div class="form-row"><label>Title</label><input id="push-title" type="text" /></div>
      <div class="form-row"><label>Body</label><input id="push-body" type="text" /></div>
      <div class="toggle-row"><span>I understand this sends a real push to real users right now</span><input type="checkbox" id="push-confirm" /></div>
      <div class="actions"><button class="primary" id="send-announcement">Send announcement</button><span id="push-announce-msg" class="save-msg" hidden></span></div>
    </div>
  `;
  document.getElementById('send-test-push').addEventListener('click', async () => {
    const msg = document.getElementById('push-test-msg');
    try {
      const result = await api.pushTest({
        deviceId: document.getElementById('push-device-id').value.trim(),
        title: document.getElementById('push-test-title').value.trim() || undefined,
        body: document.getElementById('push-test-body').value.trim() || undefined,
      });
      msg.textContent = result.configured === false ? 'Push is not configured on this deployment.' : result.success ? 'Sent.' : `Failed: ${result.error}`;
    } catch (err) {
      msg.textContent = err.message;
    }
    msg.hidden = false;
  });
  document.getElementById('send-announcement').addEventListener('click', async () => {
    const msg = document.getElementById('push-announce-msg');
    if (!document.getElementById('push-confirm').checked) {
      msg.textContent = 'Check the confirmation box first.';
      msg.hidden = false;
      return;
    }
    try {
      const result = await api.pushAnnouncement({
        audience: document.getElementById('push-audience').value,
        title: document.getElementById('push-title').value.trim(),
        body: document.getElementById('push-body').value.trim(),
        confirm: true,
      });
      msg.textContent =
        result.configured === false ? 'Push is not configured on this deployment.' : `Sent to ${result.sentCount} / ${result.targetCount} devices.`;
    } catch (err) {
      msg.textContent = err.message;
    }
    msg.hidden = false;
  });
}

// ---- Notification logs ------------------------------------------------------------
async function renderNotificationLogs() {
  const data = await api.notificationLogs(100);
  if (!data.configured) return void (content.innerHTML = notConfiguredCard('Notification Logs'));

  content.innerHTML = `
    <h2>Notification Logs</h2>
    <div class="card">
      <table>
        <thead><tr><th>Time</th><th>Title</th><th>Body</th><th>Status</th><th>Provider</th></tr></thead>
        <tbody>
          ${data.logs
            .map(
              (l) => `<tr>
                <td>${new Date(l.sent_at).toLocaleString()}</td>
                <td>${escapeHtml(l.title)}</td>
                <td>${escapeHtml(l.body)}</td>
                <td>${statusBadge(l.status === 'sent' ? 'healthy' : 'unhealthy')}</td>
                <td>${escapeHtml(l.provider)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${data.logs.length === 0 ? '<p class="muted">No notifications sent yet.</p>' : ''}
    </div>
  `;
}

// ---- Subscriptions ------------------------------------------------------------
async function renderSubscriptions() {
  const data = await api.subscriptionsGet();
  if (!data.configured) return void (content.innerHTML = notConfiguredCard('Subscriptions'));

  content.innerHTML = `
    <h2>Subscriptions</h2>
    <p class="muted">Provider-agnostic subscription state (Free/Pro). Google Play Billing is not wired up yet - this reflects whatever subscription rows exist.</p>
    <div class="card">
      <div class="stat-label">Total subscription records</div>
      <div class="stat-value">${data.total}</div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Plan / Status</th><th>Count</th></tr></thead>
        <tbody>
          ${Object.entries(data.counts)
            .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
            .join('')}
        </tbody>
      </table>
      ${Object.keys(data.counts).length === 0 ? '<p class="muted">No subscription records yet.</p>' : ''}
    </div>
  `;
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
          <tr><td>Supabase (Users/Alerts/Push/Subscriptions)</td><td>${statusBadge(data.secrets.supabase === 'configured' ? 'healthy' : 'disabled')}</td></tr>
          <tr><td>Firebase Cloud Messaging</td><td>${statusBadge(data.secrets.fcm === 'configured' ? 'healthy' : 'disabled')}</td></tr>
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
