export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/admin/' },
  { label: 'Sessions', href: '/admin/sessions' },
  { label: 'History', href: '/admin/history' },
  { label: 'Prompts', href: '/admin/prompts' },
  { label: 'Config', href: '/admin/config' },
  { label: 'Performance', href: '/admin/performance' },
];

export function layout(title: string, activePath: string, body: string): string {
  const nav = NAV_ITEMS.map(item => {
    const active = item.href === activePath;
    return `<a href="${item.href}" class="nav-link${active ? ' active' : ''}">${item.label}</a>`;
  }).join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — SAIFA Admin</title>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="logo">SAIFA <span class="logo-sub">Admin</span></div>
      <nav>
        ${nav}
      </nav>
    </div>
  </header>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function classificationBadge(classification: string): string {
  const colors: Record<string, string> = {
    hot: '#e74c3c',
    warm: '#f39c12',
    cold: '#3498db',
    disqualified: '#95a5a6',
  };
  const color = colors[classification] || '#95a5a6';
  return `<span class="badge" style="background:${color}">${escapeHtml(classification)}</span>`;
}

export function tierBadge(tier: string): string {
  const color = tier === 'meeting_room' ? '#27ae60' : '#7f8c8d';
  const label = tier === 'meeting_room' ? 'Meeting Room' : 'Lobby';
  return `<span class="badge" style="background:${color}">${label}</span>`;
}

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f1117;
    color: #e0e0e0;
    line-height: 1.5;
  }

  header {
    background: #1a1d27;
    border-bottom: 1px solid #2a2d37;
    padding: 0 24px;
  }

  .header-inner {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    height: 56px;
    gap: 32px;
  }

  .logo {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 1px;
  }

  .logo-sub {
    font-weight: 400;
    color: #7f8c8d;
    font-size: 14px;
  }

  nav { display: flex; gap: 4px; }

  .nav-link {
    color: #95a5a6;
    text-decoration: none;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 14px;
    transition: background 0.15s, color 0.15s;
  }

  .nav-link:hover { background: #2a2d37; color: #fff; }
  .nav-link.active { background: #2a2d37; color: #fff; font-weight: 600; }

  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 32px 24px;
  }

  h1 {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 24px;
    color: #fff;
  }

  h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 24px 0 12px;
    color: #bdc3c7;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }

  .card {
    background: #1a1d27;
    border: 1px solid #2a2d37;
    border-radius: 8px;
    padding: 20px;
  }

  .card-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #7f8c8d;
    margin-bottom: 4px;
  }

  .card-value {
    font-size: 28px;
    font-weight: 700;
    color: #fff;
  }

  .card-detail {
    font-size: 13px;
    color: #95a5a6;
    margin-top: 4px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: #1a1d27;
    border: 1px solid #2a2d37;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 24px;
  }

  th {
    text-align: left;
    padding: 10px 14px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #7f8c8d;
    background: #14161e;
    border-bottom: 1px solid #2a2d37;
  }

  td {
    padding: 10px 14px;
    font-size: 14px;
    border-bottom: 1px solid #1f222c;
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1f222c; }

  a { color: #3498db; text-decoration: none; }
  a:hover { text-decoration: underline; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section { margin-bottom: 32px; }

  .pagination {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    margin: 16px 0;
  }

  .pagination a, .pagination span {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 14px;
  }

  .pagination a {
    background: #1a1d27;
    border: 1px solid #2a2d37;
    color: #e0e0e0;
  }

  .pagination a:hover { background: #2a2d37; text-decoration: none; }
  .pagination .current { background: #2a2d37; color: #fff; font-weight: 600; }

  .prompt-content {
    background: #14161e;
    border: 1px solid #2a2d37;
    border-radius: 8px;
    padding: 16px;
    font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-x: auto;
    margin-bottom: 16px;
    color: #bdc3c7;
  }

  .config-section {
    background: #1a1d27;
    border: 1px solid #2a2d37;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .config-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #1f222c;
    font-size: 14px;
  }

  .config-row:last-child { border-bottom: none; }

  .config-key { color: #7f8c8d; }
  .config-val { color: #e0e0e0; font-family: monospace; }

  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 120px;
    padding: 8px 0;
  }

  .bar {
    flex: 1;
    background: #3498db;
    border-radius: 2px 2px 0 0;
    min-width: 12px;
    position: relative;
  }

  .bar-label {
    font-size: 10px;
    color: #7f8c8d;
    text-align: center;
    margin-top: 4px;
  }

  .timeline-entry {
    padding: 12px 16px;
    border-left: 3px solid #2a2d37;
    margin-left: 8px;
    margin-bottom: 8px;
  }

  .timeline-entry.visitor { border-left-color: #3498db; }
  .timeline-entry.assistant { border-left-color: #27ae60; }
  .timeline-entry.tool { border-left-color: #f39c12; }
  .timeline-entry.security { border-left-color: #e74c3c; }

  .timeline-meta {
    font-size: 12px;
    color: #7f8c8d;
    margin-bottom: 4px;
  }

  .timeline-content {
    font-size: 14px;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .budget-bar {
    width: 100%;
    height: 8px;
    background: #2a2d37;
    border-radius: 4px;
    overflow: hidden;
    margin: 8px 0;
  }

  .budget-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
  }

  .score-panel {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    margin: 12px 0;
  }

  .score-item {
    background: #14161e;
    padding: 8px 12px;
    border-radius: 6px;
    text-align: center;
  }

  .score-item .label { font-size: 11px; color: #7f8c8d; text-transform: uppercase; }
  .score-item .value { font-size: 20px; font-weight: 700; color: #fff; }

  .auto-refresh { font-size: 12px; color: #7f8c8d; float: right; }

  .funnel { margin: 16px 0; }

  .funnel-step {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .funnel-bar {
    height: 28px;
    background: #3498db;
    border-radius: 4px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    min-width: 40px;
  }

  .funnel-label {
    font-size: 14px;
    color: #95a5a6;
    min-width: 120px;
  }
`;
