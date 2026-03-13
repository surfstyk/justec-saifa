import { getClosedSessions } from '../queries.js';
import { layout, escapeHtml, formatTimestamp, formatDuration, classificationBadge, tierBadge } from './layout.js';

function classifyScore(score: number | null): string {
  if (score === null) return 'disqualified';
  if (score >= 70) return 'hot';
  if (score >= 45) return 'warm';
  if (score >= 25) return 'cold';
  return 'disqualified';
}

export function renderHistory(query: {
  page?: string;
  per_page?: string;
  classification?: string;
  from?: string;
}): string {
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const perPage = Math.min(100, Math.max(10, parseInt(query.per_page || '25', 10) || 25));
  const classification = query.classification || undefined;
  const from = query.from || undefined;

  const { sessions, total } = getClosedSessions({ page, perPage, classification, from });
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Build filter info
  const filters: string[] = [];
  if (classification) filters.push(`classification=${classification}`);
  if (from) filters.push(`from=${from}`);
  const filterStr = filters.length > 0 ? ` (filtered: ${filters.join(', ')})` : '';

  let rows = '';
  if (sessions.length === 0) {
    rows = '<tr><td colspan="9" style="text-align:center;color:#7f8c8d;padding:24px">No sessions found</td></tr>';
  } else {
    for (const s of sessions) {
      const duration = s.closed_at && s.created_at
        ? formatDuration(s.closed_at - s.created_at)
        : '—';
      const cls = classifyScore(s.score_final);

      rows += `
        <tr>
          <td>${formatTimestamp(s.created_at).slice(0, 10)}</td>
          <td><a href="/admin/justec/sessions/${s.id}">${s.id.slice(0, 8)}</a></td>
          <td>${duration}</td>
          <td>${tierBadge(s.tier)}</td>
          <td>${s.score_final ?? 0} ${classificationBadge(cls)}</td>
          <td>${s.visitor_name ? escapeHtml(s.visitor_name) : '—'}</td>
          <td>${s.visitor_company ? escapeHtml(s.visitor_company) : '—'}</td>
          <td>${s.booking_time ? 'Booked' : '—'}</td>
          <td>${s.payment_status || '—'}</td>
        </tr>`;
    }
  }

  // Pagination
  const baseUrl = '/admin/justec/history?per_page=' + perPage +
    (classification ? '&classification=' + classification : '') +
    (from ? '&from=' + from : '');

  let pagination = '<div class="pagination">';
  if (page > 1) {
    pagination += `<a href="${baseUrl}&page=${page - 1}">&larr; Prev</a>`;
  }
  pagination += `<span class="current">Page ${page} of ${totalPages}</span>`;
  if (page < totalPages) {
    pagination += `<a href="${baseUrl}&page=${page + 1}">Next &rarr;</a>`;
  }
  pagination += '</div>';

  const body = `
    <p style="color:#95a5a6;margin-bottom:16px">${total} closed session${total !== 1 ? 's' : ''}${filterStr}</p>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Session</th>
          <th>Duration</th>
          <th>Tier</th>
          <th>Score</th>
          <th>Name</th>
          <th>Company</th>
          <th>Booking</th>
          <th>Payment</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    ${pagination}
  `;

  return layout('History', '/admin/justec/history', body);
}
