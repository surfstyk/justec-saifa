import { getDb } from '../db/sqlite.js';

interface SessionRow {
  id: string;
  created_at: number;
  closed_at: number | null;
  close_reason: string | null;
  tier: string;
  language: string;
  consent: number;
  score_final: number | null;
  score_behavioral: number | null;
  score_explicit: number | null;
  score_fit: number | null;
  visitor_name: string | null;
  visitor_company: string | null;
  visitor_role: string | null;
  visitor_phone: string | null;
  trello_card_id: string | null;
  booking_time: string | null;
  payment_provider: string | null;
  payment_status: string | null;
  payment_id: string | null;
  ip_hash: string | null;
  messages_count: number;
  tokens_used: number;
  guard_level: number;
}

export function getClosedSessions(opts: {
  page: number;
  perPage: number;
  classification?: string;
  from?: string;
}): { sessions: SessionRow[]; total: number } {
  const db = getDb();

  const conditions: string[] = ['closed_at IS NOT NULL'];
  const params: unknown[] = [];

  if (opts.from) {
    conditions.push('created_at >= ?');
    params.push(new Date(opts.from).getTime());
  }

  if (opts.classification) {
    // Map classification to score ranges
    const thresholds: Record<string, [number, number]> = {
      hot: [70, 100],
      warm: [45, 69],
      cold: [25, 44],
      disqualified: [0, 24],
    };
    const range = thresholds[opts.classification];
    if (range) {
      conditions.push('score_final >= ? AND score_final <= ?');
      params.push(range[0], range[1]);
    }
  }

  const where = conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE ${where}`).get(...params) as { count: number };

  const offset = (opts.page - 1) * opts.perPage;
  params.push(opts.perPage, offset);

  const sessions = db.prepare(
    `SELECT * FROM sessions WHERE ${where} ORDER BY closed_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as SessionRow[];

  return { sessions, total: countRow.count };
}

export function getSessionById(id: string): SessionRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function getSessionsPerDay(days: number): Array<{ date: string; count: number }> {
  const db = getDb();
  const since = Date.now() - days * 86400000;

  const rows = db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch') as date, COUNT(*) as count
    FROM sessions
    WHERE created_at >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(since) as Array<{ date: string; count: number }>;

  return rows;
}

export function getConversionFunnel(fromTs?: number, toTs?: number): {
  total_sessions: number;
  qualified: number;
  phone_captured: number;
  booked: number;
  paid: number;
} {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (fromTs) {
    conditions.push('created_at >= ?');
    params.push(fromTs);
  }
  if (toTs) {
    conditions.push('created_at <= ?');
    params.push(toTs);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as c FROM sessions ${where}`).get(...params) as { c: number }).c;
  const qualified = (db.prepare(`SELECT COUNT(*) as c FROM sessions ${where} ${where ? 'AND' : 'WHERE'} tier = 'meeting_room'`).get(...params) as { c: number }).c;
  const phone = (db.prepare(`SELECT COUNT(*) as c FROM sessions ${where} ${where ? 'AND' : 'WHERE'} visitor_phone IS NOT NULL`).get(...params) as { c: number }).c;
  const booked = (db.prepare(`SELECT COUNT(*) as c FROM sessions ${where} ${where ? 'AND' : 'WHERE'} booking_time IS NOT NULL`).get(...params) as { c: number }).c;
  const paid = (db.prepare(`SELECT COUNT(*) as c FROM sessions ${where} ${where ? 'AND' : 'WHERE'} payment_status = 'completed'`).get(...params) as { c: number }).c;

  return {
    total_sessions: total,
    qualified,
    phone_captured: phone,
    booked,
    paid,
  };
}

export function getScoreDistribution(): Array<{ classification: string; count: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT
      CASE
        WHEN score_final >= 70 THEN 'hot'
        WHEN score_final >= 45 THEN 'warm'
        WHEN score_final >= 25 THEN 'cold'
        ELSE 'disqualified'
      END as classification,
      COUNT(*) as count
    FROM sessions
    WHERE closed_at IS NOT NULL
    GROUP BY classification
    ORDER BY
      CASE classification
        WHEN 'hot' THEN 1
        WHEN 'warm' THEN 2
        WHEN 'cold' THEN 3
        ELSE 4
      END
  `).all() as Array<{ classification: string; count: number }>;
}

export function getAvgTokensPerSession(): { avg: number; count: number } {
  const db = getDb();
  const row = db.prepare(`
    SELECT AVG(tokens_used) as avg, COUNT(*) as count
    FROM sessions
    WHERE closed_at IS NOT NULL AND tokens_used > 0
  `).get() as { avg: number | null; count: number };

  return { avg: Math.round(row.avg ?? 0), count: row.count };
}

export function getAvgMessagesPerSession(): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT AVG(messages_count) as avg
    FROM sessions
    WHERE closed_at IS NOT NULL AND messages_count > 0
  `).get() as { avg: number | null };

  return Math.round(row.avg ?? 0);
}

export function getAvgSessionDuration(): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT AVG(closed_at - created_at) as avg_ms
    FROM sessions
    WHERE closed_at IS NOT NULL
  `).get() as { avg_ms: number | null };

  return Math.round((row.avg_ms ?? 0) / 1000); // seconds
}

export function getSecurityEventsPerDay(days: number): Array<{ date: string; count: number }> {
  const db = getDb();
  const since = Date.now() - days * 86400000;

  return db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch') as date, COUNT(*) as count
    FROM security_events
    WHERE created_at >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(since) as Array<{ date: string; count: number }>;
}

export function getSecurityEventsToday(): number {
  const db = getDb();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const row = db.prepare(`
    SELECT COUNT(*) as count FROM security_events WHERE created_at >= ?
  `).get(todayStart.getTime()) as { count: number };

  return row.count;
}
