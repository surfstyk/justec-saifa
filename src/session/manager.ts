import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { getConfig } from '../config.js';
import { getSessionStore, getActiveSessionCount, getQueueLength, addToQueue, removeFromQueue, promoteFromQueue } from './store-memory.js';
import { persistSession, persistMessage } from '../db/conversations.js';
import { deleteHoldsForSession, sweepExpiredHolds } from '../integrations/calendar-holds.js';
import { recordSessionCreated } from '../admin/stats.js';
import type { Session, Language, CloseReason, SessionStatus } from '../types.js';

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip + 'justec-salt').digest('hex').slice(0, 16);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifySessionToken(session: Session, token: string): boolean {
  const presented = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(session.token_hash, 'hex');
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

export function createSession(opts: {
  language: Language;
  ipHash: string;
  referrer?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): { session: Session; status: SessionStatus; sessionToken: string; queuePosition?: number } {
  const config = getConfig();
  const store = getSessionStore();
  const activeCount = getActiveSessionCount();

  const sessionToken = randomBytes(32).toString('base64url');

  const session: Session = {
    id: uuidv4(),
    token_hash: hashToken(sessionToken),
    status: 'active',
    tier: 'lobby',
    language: opts.language,
    consent: 'pending',
    guard_level: 0,
    ip_hash: opts.ipHash,
    referrer: opts.referrer,
    user_agent: opts.userAgent,
    metadata: opts.metadata,
    score_composite: 0,
    score_behavioral: 0,
    score_explicit: 0,
    score_fit: 0,
    classification: 'cold',
    visitor_info: {
      name: null,
      company: null,
      role: null,
      company_size: null,
      industry: null,
      language: opts.language,
    },
    tokens_used: 0,
    messages_count: 0,
    offered_slot_ids: [],
    history: [],
    created_at: Date.now(),
    last_activity: Date.now(),
  };

  // Check if we need to queue
  if (activeCount >= config.rate_limits.max_concurrent_sessions) {
    session.status = 'queued';
    store.set(session.id, session);
    const position = addToQueue(session.id);
    return { session, status: 'queued', sessionToken, queuePosition: position };
  }

  store.set(session.id, session);
  recordSessionCreated();
  return { session, status: 'active', sessionToken };
}

export function getSession(id: string): Session | undefined {
  return getSessionStore().get(id);
}

export function updateSession(session: Session): void {
  session.last_activity = Date.now();
  getSessionStore().set(session.id, session);
}

export function closeSession(id: string, reason: CloseReason = 'visitor_left'): Session | undefined {
  const store = getSessionStore();
  const session = store.get(id);
  if (!session) return undefined;

  session.status = 'closed';
  session.closed_at = Date.now();
  session.close_reason = reason;

  // Persist if consented
  if (session.consent === 'granted') {
    persistSession(session);
    for (const msg of session.history) {
      persistMessage(session.id, msg);
    }
  }

  // Clean up any tentative calendar holds (fire-and-forget)
  deleteHoldsForSession(id).catch(err =>
    console.warn('[session] Hold cleanup failed for', id.slice(0, 8), err),
  );

  // Remove from queue if queued
  removeFromQueue(id);

  // Remove from active store
  store.delete(id);

  // Promote next queued session
  processQueue();

  return session;
}

export function processQueue(): void {
  const config = getConfig();
  const store = getSessionStore();
  const activeCount = getActiveSessionCount();

  while (activeCount + getQueueLength() > activeCount && getActiveSessionCount() < config.rate_limits.max_concurrent_sessions) {
    const nextId = promoteFromQueue();
    if (!nextId) break;

    const session = store.get(nextId);
    if (session && session.status === 'queued') {
      session.status = 'active';
      session.last_activity = Date.now();
    }
  }
}

// Run every 60 seconds to expire stale sessions
let _expiryInterval: ReturnType<typeof setInterval> | null = null;

export function startExpiryTimer(): void {
  if (_expiryInterval) return;

  _expiryInterval = setInterval(() => {
    const config = getConfig();
    const store = getSessionStore();
    const ttlMs = config.rate_limits.session_ttl_minutes * 60 * 1000;
    const now = Date.now();

    for (const [id, session] of store) {
      if (session.status !== 'closed' && (now - session.last_activity) > ttlMs) {
        closeSession(id, 'timeout');
      }
    }

    // Sweep expired tentative holds (safety net)
    const holdTtlMs = (config.calendar.hold_ttl_minutes ?? 30) * 60 * 1000;
    sweepExpiredHolds(holdTtlMs).catch(err =>
      console.warn('[session] Hold sweep failed:', err),
    );
  }, 60_000);
}

export function stopExpiryTimer(): void {
  if (_expiryInterval) {
    clearInterval(_expiryInterval);
    _expiryInterval = null;
  }
}
