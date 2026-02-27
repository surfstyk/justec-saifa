import { getDb } from './sqlite.js';
import type { Session, Message } from '../types.js';

export function persistSession(session: Session): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, created_at, closed_at, close_reason, tier, language, consent,
      score_final, score_behavioral, score_explicit, score_fit,
      visitor_name, visitor_company, visitor_role, visitor_phone,
      trello_card_id, booking_time, payment_provider, payment_status, payment_id,
      ip_hash, referrer, user_agent, messages_count, tokens_used, guard_level
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).run(
    session.id, session.created_at, session.closed_at ?? null, session.close_reason ?? null,
    session.tier, session.language, session.consent === 'granted' ? 1 : 0,
    session.score_composite, session.score_behavioral, session.score_explicit, session.score_fit,
    session.visitor_info.name, session.visitor_info.company, session.visitor_info.role, null,
    session.trello_card_id ?? null, session.booking_time ?? null,
    session.payment_provider ?? null, session.payment_status ?? null, session.payment_id ?? null,
    session.ip_hash, session.referrer ?? null, session.user_agent ?? null,
    session.messages_count, session.tokens_used, session.guard_level,
  );
}

export function persistMessage(sessionId: string, message: Message): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO messages (session_id, role, content, action_json, structured_json, tokens, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    message.role,
    message.content,
    message.action ? JSON.stringify(message.action) : null,
    message.structured.length > 0 ? JSON.stringify(message.structured) : null,
    message.tokens ?? null,
    Date.now(),
    message.metadata ? JSON.stringify(message.metadata) : null,
  );
}

export function getSessionMessages(sessionId: string): Message[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT role, content, action_json, structured_json, tokens, created_at, metadata FROM messages WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId) as Array<{
    role: string;
    content: string | null;
    action_json: string | null;
    structured_json: string | null;
    tokens: number | null;
    created_at: number;
    metadata: string | null;
  }>;

  return rows.map(row => ({
    role: row.role as string,
    content: row.content,
    action: row.action_json ? JSON.parse(row.action_json) : undefined,
    structured: row.structured_json ? JSON.parse(row.structured_json) : [],
    timestamp: new Date(row.created_at).toISOString(),
    tokens: row.tokens ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

export function logSecurityEvent(
  sessionId: string | null,
  eventType: string,
  details: string,
  ipHash: string,
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO security_events (session_id, event_type, details, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, eventType, details, ipHash, Date.now());
}
