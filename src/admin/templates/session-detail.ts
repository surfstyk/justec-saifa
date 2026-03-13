import { getSessionStore } from '../../session/store-memory.js';
import { getBudget } from '../../session/budget.js';
import { getConfig } from '../../config.js';
import { getSessionById } from '../queries.js';
import { getSessionMessages } from '../../db/conversations.js';
import { layout, escapeHtml, formatTimestamp, formatDuration, classificationBadge, tierBadge } from './layout.js';
import type { Session, Message } from '../../types.js';

function calculateCost(messages: Message[]): { input: number; output: number; total: number; currency: string } | null {
  const pricing = getConfig().llm.pricing;
  if (!pricing) return null;

  let totalInput = 0;
  let totalOutput = 0;
  for (const msg of messages) {
    if (msg.tokens_input) totalInput += msg.tokens_input;
    if (msg.tokens_output) totalOutput += msg.tokens_output;
  }

  if (totalInput === 0 && totalOutput === 0) return null;

  const inputCost = (totalInput / 1_000_000) * pricing.input_per_million;
  const outputCost = (totalOutput / 1_000_000) * pricing.output_per_million;

  return { input: inputCost, output: outputCost, total: inputCost + outputCost, currency: pricing.currency };
}

function formatCost(cost: { input: number; output: number; total: number; currency: string }): string {
  const fmt = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
  return `${fmt(cost.total)} (in: ${fmt(cost.input)}, out: ${fmt(cost.output)})`;
}

export function renderSessionDetail(id: string): string {
  // Try in-memory first (active session), then SQLite (closed session)
  const store = getSessionStore();
  const memSession = store.get(id);

  if (memSession) {
    return renderFromSession(memSession, memSession.history, true);
  }

  // Try SQLite
  const dbSession = getSessionById(id);
  if (dbSession) {
    const messages = getSessionMessages(id);
    return renderFromDb(dbSession, messages);
  }

  return layout('Session Not Found', '/admin/justec/sessions', `
    <p style="color:#95a5a6">Session <code>${escapeHtml(id)}</code> not found in memory or database.</p>
    <p><a href="/admin/justec/sessions">Back to active sessions</a> | <a href="/admin/justec/history">Check history</a></p>
  `);
}

function renderFromSession(s: Session, messages: Message[], isActive: boolean): string {
  const budget = getBudget(s);
  const budgetPct = Math.min(100, Math.round((s.tokens_used / budget) * 100));
  const budgetColor = budgetPct > 85 ? '#e74c3c' : budgetPct > 60 ? '#f39c12' : '#27ae60';
  const now = Date.now();

  const body = `
    <p><a href="/admin/justec/sessions">&larr; Back to sessions</a></p>

    <div class="card-grid" style="margin-top:16px">
      <div class="card">
        <div class="card-label">Status</div>
        <div class="card-value" style="font-size:18px">${s.status}</div>
      </div>
      <div class="card">
        <div class="card-label">Tier</div>
        <div class="card-value" style="font-size:18px">${tierBadge(s.tier)}</div>
      </div>
      <div class="card">
        <div class="card-label">Language</div>
        <div class="card-value">${s.language}</div>
      </div>
      <div class="card">
        <div class="card-label">Duration</div>
        <div class="card-value" style="font-size:18px">${formatDuration((s.closed_at || now) - s.created_at)}</div>
      </div>
      <div class="card">
        <div class="card-label">Messages</div>
        <div class="card-value">${s.messages_count}</div>
      </div>
      <div class="card">
        <div class="card-label">Guard Level</div>
        <div class="card-value">${s.guard_level}</div>
      </div>
    </div>

    <h2>Score</h2>
    <div class="score-panel">
      <div class="score-item">
        <div class="label">Composite</div>
        <div class="value">${s.score_composite}</div>
      </div>
      <div class="score-item">
        <div class="label">Explicit</div>
        <div class="value">${s.score_explicit}</div>
      </div>
      <div class="score-item">
        <div class="label">Behavioral</div>
        <div class="value">${s.score_behavioral}</div>
      </div>
      <div class="score-item">
        <div class="label">Fit</div>
        <div class="value">${s.score_fit}</div>
      </div>
      <div class="score-item">
        <div class="label">Classification</div>
        <div class="value">${classificationBadge(s.classification)}</div>
      </div>
    </div>

    <h2>Visitor</h2>
    <div class="config-section">
      ${infoRow('Name', s.visitor_info.name)}
      ${infoRow('Company', s.visitor_info.company)}
      ${infoRow('Role', s.visitor_info.role)}
      ${infoRow('Company Size', s.visitor_info.company_size)}
      ${infoRow('Industry', s.visitor_info.industry)}
    </div>

    <h2>Budget</h2>
    <div class="card" style="margin-bottom:24px">
      <div class="card-label">Token Usage: ${s.tokens_used.toLocaleString()} / ${budget.toLocaleString()} (${budgetPct}%)</div>
      <div class="budget-bar">
        <div class="budget-fill" style="width:${budgetPct}%;background:${budgetColor}"></div>
      </div>
    </div>

    ${s.payment_status ? `
    <h2>Conversion</h2>
    <div class="config-section">
      ${infoRow('Booking Time', s.booking_time)}
      ${infoRow('Payment Status', s.payment_status)}
      ${infoRow('Payment Provider', s.payment_provider)}
    </div>
    ` : ''}

    <h2>Timeline (${messages.length} messages)</h2>
    ${renderTimeline(messages)}

    <h2>Meta</h2>
    <div class="config-section">
      ${infoRow('Session ID', s.id)}
      ${infoRow('Created', formatTimestamp(s.created_at))}
      ${isActive ? infoRow('Last Activity', formatTimestamp(s.last_activity)) : ''}
      ${s.closed_at ? infoRow('Closed', formatTimestamp(s.closed_at)) : ''}
      ${s.close_reason ? infoRow('Close Reason', s.close_reason) : ''}
      ${infoRow('IP Hash', s.ip_hash)}
      ${infoRow('Consent', s.consent)}
      ${(() => { const c = calculateCost(messages); return c ? infoRow('LLM Cost', formatCost(c)) : ''; })()}
    </div>
  `;

  return layout(`Session ${s.id.slice(0, 8)}`, '/admin/justec/sessions', body);
}

function renderFromDb(dbSession: {
  id: string;
  created_at: number;
  closed_at: number | null;
  close_reason: string | null;
  tier: string;
  language: string;
  score_final: number | null;
  score_behavioral: number | null;
  score_explicit: number | null;
  score_fit: number | null;
  visitor_name: string | null;
  visitor_company: string | null;
  visitor_role: string | null;
  visitor_phone: string | null;
  booking_time: string | null;
  payment_provider: string | null;
  payment_status: string | null;
  ip_hash: string | null;
  messages_count: number;
  tokens_used: number;
  guard_level: number;
}, messages: Message[]): string {
  // Reconstruct a minimal session-like view from DB row
  const body = `
    <p><a href="/admin/justec/history">&larr; Back to history</a></p>

    <div class="card-grid" style="margin-top:16px">
      <div class="card">
        <div class="card-label">Status</div>
        <div class="card-value" style="font-size:18px">closed</div>
      </div>
      <div class="card">
        <div class="card-label">Tier</div>
        <div class="card-value" style="font-size:18px">${tierBadge(String(dbSession.tier || 'lobby'))}</div>
      </div>
      <div class="card">
        <div class="card-label">Language</div>
        <div class="card-value">${escapeHtml(String(dbSession.language || 'en'))}</div>
      </div>
      <div class="card">
        <div class="card-label">Duration</div>
        <div class="card-value" style="font-size:18px">${
          dbSession.closed_at && dbSession.created_at
            ? formatDuration(Number(dbSession.closed_at) - Number(dbSession.created_at))
            : '—'
        }</div>
      </div>
      <div class="card">
        <div class="card-label">Messages</div>
        <div class="card-value">${dbSession.messages_count ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">Guard Level</div>
        <div class="card-value">${dbSession.guard_level ?? 0}</div>
      </div>
    </div>

    <h2>Score</h2>
    <div class="score-panel">
      <div class="score-item">
        <div class="label">Final</div>
        <div class="value">${dbSession.score_final ?? 0}</div>
      </div>
      <div class="score-item">
        <div class="label">Explicit</div>
        <div class="value">${dbSession.score_explicit ?? 0}</div>
      </div>
      <div class="score-item">
        <div class="label">Behavioral</div>
        <div class="value">${dbSession.score_behavioral ?? 0}</div>
      </div>
      <div class="score-item">
        <div class="label">Fit</div>
        <div class="value">${dbSession.score_fit ?? 0}</div>
      </div>
    </div>

    <h2>Visitor</h2>
    <div class="config-section">
      ${infoRow('Name', dbSession.visitor_name as string | null)}
      ${infoRow('Company', dbSession.visitor_company as string | null)}
      ${infoRow('Role', dbSession.visitor_role as string | null)}
      ${infoRow('Phone', dbSession.visitor_phone as string | null)}
    </div>

    ${dbSession.payment_status ? `
    <h2>Conversion</h2>
    <div class="config-section">
      ${infoRow('Booking Time', dbSession.booking_time as string | null)}
      ${infoRow('Payment Status', dbSession.payment_status as string | null)}
      ${infoRow('Payment Provider', dbSession.payment_provider as string | null)}
    </div>
    ` : ''}

    <h2>Timeline (${messages.length} messages)</h2>
    ${renderTimeline(messages)}

    <h2>Meta</h2>
    <div class="config-section">
      ${infoRow('Session ID', String(dbSession.id))}
      ${dbSession.created_at ? infoRow('Created', formatTimestamp(Number(dbSession.created_at))) : ''}
      ${dbSession.closed_at ? infoRow('Closed', formatTimestamp(Number(dbSession.closed_at))) : ''}
      ${infoRow('Close Reason', dbSession.close_reason as string | null)}
      ${infoRow('IP Hash', dbSession.ip_hash as string | null)}
      ${infoRow('Tokens Used', String(dbSession.tokens_used ?? 0))}
      ${(() => { const c = calculateCost(messages); return c ? infoRow('LLM Cost', formatCost(c)) : ''; })()}
    </div>
  `;

  return layout(`Session ${String(dbSession.id).slice(0, 8)}`, '/admin/justec/sessions', body);
}

function renderTimeline(messages: Message[]): string {
  if (messages.length === 0) {
    return '<p style="color:#7f8c8d">No messages recorded.</p>';
  }

  return messages.map(msg => {
    const role = msg.role === 'visitor' ? 'visitor' : 'assistant';
    const cssClass = role;
    const label = role === 'visitor' ? 'Visitor' : 'Assistant';
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-GB') : '';

    let content = escapeHtml(msg.content || '');

    // Show structured messages
    if (msg.structured && msg.structured.length > 0) {
      for (const sm of msg.structured) {
        content += `\n<span style="color:#f39c12">[structured: ${escapeHtml(sm.type)}]</span>`;
      }
    }

    // Show actions
    if (msg.action) {
      content += `\n<span style="color:#9b59b6">[action: ${escapeHtml(msg.action.type)}]</span>`;
    }

    return `
      <div class="timeline-entry ${cssClass}">
        <div class="timeline-meta">${label} &middot; ${time}${msg.tokens ? ` &middot; ${msg.tokens} tokens${msg.tokens_input ? ` (in: ${msg.tokens_input}, out: ${msg.tokens_output ?? 0})` : ''}${(() => { const p = getConfig().llm.pricing; if (!p || !msg.tokens_input) return ''; const c = ((msg.tokens_input / 1e6) * p.input_per_million) + (((msg.tokens_output ?? 0) / 1e6) * p.output_per_million); return ` &middot; $${c < 0.01 ? c.toFixed(4) : c.toFixed(3)}`; })()}` : ''}</div>
        <div class="timeline-content">${content}</div>
      </div>`;
  }).join('');
}

function infoRow(label: string, value: string | null | undefined): string {
  return `<div class="config-row">
    <span class="config-key">${escapeHtml(label)}</span>
    <span class="config-val">${value ? escapeHtml(String(value)) : '<span style="color:#555">—</span>'}</span>
  </div>`;
}
