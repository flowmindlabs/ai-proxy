import { getStats } from './usage-log.js';

export function registerDashboardRoutes(app) {
  app.get('/dashboard/stats', (req, res) => {
    res.json(getStats());
  });

  app.get('/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(dashboardHTML());
  });
}

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Proxy Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #1a1a1a;
      min-height: 100vh;
    }
    header {
      background: #1a1a1a;
      color: #fff;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    header h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.3px; }
    .live-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #aaa;
    }
    .live-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
    main { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
    section { margin-bottom: 32px; }
    h2 { font-size: 14px; font-weight: 600; color: #666; text-transform: uppercase;
         letter-spacing: 0.5px; margin-bottom: 12px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    .stat-card {
      background: #fff;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .stat-card .label { font-size: 12px; color: #888; margin-bottom: 6px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #1a1a1a; }
    .stat-card .value.warning { color: #f59e0b; }
    .model-row {
      background: #fff;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .model-row-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .model-name { font-weight: 600; }
    .model-tokens { color: #666; }
    .bar-track {
      background: #f0f0f0;
      border-radius: 4px;
      height: 6px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      transition: width 0.4s ease;
    }
    .provider-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .provider-chip {
      background: #fff;
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 13px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .provider-chip span { font-weight: 700; margin-left: 6px; }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      font-size: 13px;
    }
    th {
      background: #f9f9f9;
      padding: 10px 14px;
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      white-space: nowrap;
    }
    td {
      padding: 10px 14px;
      border-top: 1px solid #f0f0f0;
      white-space: nowrap;
    }
    tr.error td   { background: #fff5f5; }
    tr.fallback td { background: #fffbeb; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge.ok       { background: #dcfce7; color: #166534; }
    .badge.err      { background: #fee2e2; color: #991b1b; }
    .badge.fallback { background: #fef9c3; color: #854d0e; }
    .empty { color: #aaa; font-size: 14px; padding: 32px 0; text-align: center; }
    footer {
      text-align: center;
      padding: 24px;
      font-size: 12px;
      color: #bbb;
    }
  </style>
</head>
<body>
  <header>
    <h1>AI Proxy</h1>
    <div class="live-badge">
      <div class="live-dot"></div>
      Auto-refreshing every 10s
    </div>
  </header>
  <main>
    <section>
      <h2>Overview</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Requests Today</div>
          <div class="value" id="requestsToday">—</div>
        </div>
        <div class="stat-card">
          <div class="label">Tokens In</div>
          <div class="value" id="tokensIn">—</div>
        </div>
        <div class="stat-card">
          <div class="label">Tokens Out</div>
          <div class="value" id="tokensOut">—</div>
        </div>
        <div class="stat-card">
          <div class="label">Fallbacks</div>
          <div class="value" id="fallbacks">—</div>
        </div>
      </div>
    </section>

    <section>
      <h2>Tokens by Model</h2>
      <div id="modelRows"><div class="empty">No requests yet</div></div>
    </section>

    <section>
      <h2>Requests by Provider</h2>
      <div class="provider-list" id="providerList"><div class="empty">No requests yet</div></div>
    </section>

    <section>
      <h2>Recent Requests</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Model</th>
              <th>Provider</th>
              <th>Tokens In</th>
              <th>Tokens Out</th>
              <th>Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="requestTable"><tr><td colspan="7" class="empty">No requests yet</td></tr></tbody>
        </table>
      </div>
    </section>
  </main>
  <footer>Data resets on restart — in-memory only</footer>

  <script>
    function fmt(n) { return (n || 0).toLocaleString(); }
    function fmtLatency(ms) {
      if (!ms) return '—';
      return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
    }
    function fmtTime(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleTimeString();
    }
    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }

    async function refresh() {
      let data;
      try {
        const r = await fetch('/dashboard/stats');
        data = await r.json();
      } catch { return; }

      document.getElementById('requestsToday').textContent = fmt(data.requestsToday);
      document.getElementById('tokensIn').textContent      = fmt(data.totalTokensIn);
      document.getElementById('tokensOut').textContent     = fmt(data.totalTokensOut);

      const fb = document.getElementById('fallbacks');
      fb.textContent = fmt(data.fallbackCount);
      fb.className   = 'value' + (data.fallbackCount > 0 ? ' warning' : '');

      // Tokens by model
      const modelDiv  = document.getElementById('modelRows');
      const modelKeys = Object.keys(data.tokensByModel || {});
      const maxTokens = modelKeys.reduce((m, k) => Math.max(m, (data.tokensByModel[k].in || 0) + (data.tokensByModel[k].out || 0)), 1);

      if (modelKeys.length === 0) {
        modelDiv.innerHTML = '<div class="empty">No requests yet</div>';
      } else {
        modelDiv.innerHTML = modelKeys.map(model => {
          const t   = data.tokensByModel[model];
          const tot = (t.in || 0) + (t.out || 0);
          const pct = Math.round((tot / maxTokens) * 100);
          return \`<div class="model-row">
            <div class="model-row-header">
              <span class="model-name">\${esc(model)}</span>
              <span class="model-tokens">\${fmt(t.in)} in / \${fmt(t.out)} out</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:\${pct}%"></div></div>
          </div>\`;
        }).join('');
      }

      // Provider breakdown
      const provDiv   = document.getElementById('providerList');
      const provKeys  = Object.keys(data.requestsByProvider || {});
      if (provKeys.length === 0) {
        provDiv.innerHTML = '<div class="empty">No requests yet</div>';
      } else {
        provDiv.innerHTML = provKeys.map(p =>
          \`<div class="provider-chip">\${esc(p)}<span>\${fmt(data.requestsByProvider[p])}</span></div>\`
        ).join('');
      }

      // Recent requests table
      const tbody = document.getElementById('requestTable');
      const rows  = (data.recentRequests || []);
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No requests yet</td></tr>';
      } else {
        tbody.innerHTML = rows.map(r => {
          const cls     = r.status >= 400 ? 'error' : r.fallback ? 'fallback' : '';
          const badge   = r.status >= 400
            ? \`<span class="badge err">\${r.status}</span>\`
            : r.fallback
            ? \`<span class="badge fallback">fallback</span>\`
            : \`<span class="badge ok">\${r.status || 200}</span>\`;
          return \`<tr class="\${cls}">
            <td>\${fmtTime(r.timestamp)}</td>
            <td>\${esc(r.model || '—')}</td>
            <td>\${esc(r.provider || '—')}</td>
            <td>\${fmt(r.tokensIn)}</td>
            <td>\${fmt(r.tokensOut)}</td>
            <td>\${fmtLatency(r.latencyMs)}</td>
            <td>\${badge}</td>
          </tr>\`;
        }).join('');
      }
    }

    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
}
