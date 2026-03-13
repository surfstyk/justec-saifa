import {
  getSessionsPerDay,
  getConversionFunnel,
  getScoreDistribution,
  getAvgTokensPerSession,
  getAvgMessagesPerSession,
  getAvgSessionDuration,
  getSecurityEventsPerDay,
} from '../queries.js';
import { getDailyStats } from '../stats.js';
import { layout, escapeHtml, formatDuration } from './layout.js';

export function renderPerformance(): string {
  const stats = getDailyStats();

  // Sessions per day (7-day and 30-day)
  const sessions7d = getSessionsPerDay(7);
  const sessions30d = getSessionsPerDay(30);

  // Conversion funnel (all time)
  const funnel = getConversionFunnel();

  // Score distribution
  const scoreDist = getScoreDistribution();

  // Averages
  const avgTokens = getAvgTokensPerSession();
  const avgMessages = getAvgMessagesPerSession();
  const avgDuration = getAvgSessionDuration();

  // Security events
  const secEvents7d = getSecurityEventsPerDay(7);

  const body = `
    <div class="card-grid">
      <div class="card">
        <div class="card-label">Avg Messages/Session</div>
        <div class="card-value">${avgMessages}</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Duration</div>
        <div class="card-value" style="font-size:20px">${formatDuration(avgDuration * 1000)}</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Tokens/Session</div>
        <div class="card-value" style="font-size:20px">${avgTokens.avg.toLocaleString()}</div>
        <div class="card-detail">${avgTokens.count} sessions with data</div>
      </div>
      <div class="card">
        <div class="card-label">LLM Errors Today</div>
        <div class="card-value">${stats.llm_errors}</div>
      </div>
    </div>

    <h2>Sessions Per Day (7d)</h2>
    ${renderBarChart(sessions7d)}

    <h2>Sessions Per Day (30d)</h2>
    ${renderBarChart(sessions30d)}

    <h2>Conversion Funnel (All Time)</h2>
    ${renderFunnel(funnel)}

    <h2>Score Distribution</h2>
    ${renderScoreDistribution(scoreDist)}

    <h2>Security Events (7d)</h2>
    ${renderBarChart(secEvents7d)}
  `;

  return layout('Performance', '/admin/performance', body);
}

function renderBarChart(data: Array<{ date: string; count: number }>): string {
  if (data.length === 0) {
    return '<p style="color:#7f8c8d">No data available.</p>';
  }

  const maxCount = Math.max(...data.map(d => d.count), 1);

  const bars = data.map(d => {
    const heightPct = Math.max(3, (d.count / maxCount) * 100);
    return `<div style="flex:1;text-align:center">
      <div style="height:120px;display:flex;align-items:flex-end">
        <div class="bar" style="height:${heightPct}%;width:100%" title="${d.date}: ${d.count}">
          <span style="position:absolute;top:-18px;width:100%;text-align:center;font-size:11px;color:#e0e0e0">${d.count}</span>
        </div>
      </div>
      <div class="bar-label">${d.date.slice(5)}</div>
    </div>`;
  }).join('');

  return `<div style="display:flex;gap:4px;margin-bottom:24px">${bars}</div>`;
}

function renderFunnel(funnel: {
  total_sessions: number;
  qualified: number;
  phone_captured: number;
  booked: number;
  paid: number;
}): string {
  const max = Math.max(funnel.total_sessions, 1);
  const steps = [
    { label: 'Total Sessions', value: funnel.total_sessions },
    { label: 'Qualified', value: funnel.qualified },
    { label: 'Phone Captured', value: funnel.phone_captured },
    { label: 'Booked', value: funnel.booked },
    { label: 'Paid', value: funnel.paid },
  ];

  const colors = ['#3498db', '#2ecc71', '#f39c12', '#e67e22', '#e74c3c'];

  return `<div class="funnel">${steps.map((step, i) => {
    const widthPct = Math.max(5, (step.value / max) * 100);
    const pct = funnel.total_sessions > 0 ? Math.round((step.value / funnel.total_sessions) * 100) : 0;
    return `<div class="funnel-step">
      <span class="funnel-label">${escapeHtml(step.label)}</span>
      <div class="funnel-bar" style="width:${widthPct}%;background:${colors[i]}">${step.value}</div>
      <span style="color:#7f8c8d;font-size:13px">${pct}%</span>
    </div>`;
  }).join('')}</div>`;
}

function renderScoreDistribution(data: Array<{ classification: string; count: number }>): string {
  if (data.length === 0) {
    return '<p style="color:#7f8c8d">No data available.</p>';
  }

  const colors: Record<string, string> = {
    hot: '#e74c3c',
    warm: '#f39c12',
    cold: '#3498db',
    disqualified: '#95a5a6',
  };

  const total = data.reduce((sum, d) => sum + d.count, 0);

  const bars = data.map(d => {
    const pct = Math.round((d.count / total) * 100);
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <span style="min-width:100px;text-transform:uppercase;font-size:12px;font-weight:600;color:${colors[d.classification] || '#7f8c8d'}">${escapeHtml(d.classification)}</span>
      <div style="flex:1;height:24px;background:#2a2d37;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${colors[d.classification] || '#7f8c8d'};border-radius:4px"></div>
      </div>
      <span style="min-width:80px;font-size:14px;color:#e0e0e0">${d.count} (${pct}%)</span>
    </div>`;
  }).join('');

  return `<div style="margin-bottom:24px">${bars}</div>`;
}
