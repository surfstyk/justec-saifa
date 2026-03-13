import { getSessionStore } from '../../session/store-memory.js';
import { layout, escapeHtml, formatDuration, classificationBadge, tierBadge } from './layout.js';
import type { Session } from '../../types.js';

export function renderSessions(): string {
  const store = getSessionStore();
  const sessions: Session[] = [];

  for (const session of store.values()) {
    if (session.status === 'active' || session.status === 'queued') {
      sessions.push(session);
    }
  }

  // Sort by last activity descending
  sessions.sort((a, b) => b.last_activity - a.last_activity);

  const now = Date.now();

  let rows = '';
  if (sessions.length === 0) {
    rows = '<tr><td colspan="9" style="text-align:center;color:#7f8c8d;padding:24px">No active sessions</td></tr>';
  } else {
    for (const s of sessions) {
      const lastMsgAge = formatDuration(now - s.last_activity);
      const timeActive = formatDuration(now - s.created_at);
      const phoneStatus = s.visitor_info.name ? 'captured' : '—';
      const slotStatus = s.offered_slot_ids.length > 0 ? `${s.offered_slot_ids.length} offered` : '—';
      const paymentStatus = s.payment_status || '—';

      rows += `
        <tr>
          <td><a href="/admin/justec/sessions/${s.id}">${s.id.slice(0, 8)}</a></td>
          <td>${tierBadge(s.tier)}</td>
          <td>${s.language}</td>
          <td>${s.messages_count}</td>
          <td>${s.score_composite} ${classificationBadge(s.classification)}</td>
          <td>${timeActive}</td>
          <td>${lastMsgAge} ago</td>
          <td>${escapeHtml(phoneStatus)}</td>
          <td>${escapeHtml(paymentStatus)}</td>
        </tr>`;
    }
  }

  const body = `
    <p style="color:#95a5a6;margin-bottom:16px">${sessions.length} active/queued session${sessions.length !== 1 ? 's' : ''}</p>
    <table>
      <thead>
        <tr>
          <th>Session</th>
          <th>Tier</th>
          <th>Lang</th>
          <th>Msgs</th>
          <th>Score</th>
          <th>Active</th>
          <th>Last Msg</th>
          <th>Phone</th>
          <th>Payment</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  return layout('Active Sessions', '/admin/justec/sessions', body);
}
