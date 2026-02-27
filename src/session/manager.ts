import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { getConfig } from '../config.js';
import { getSessionStore, getActiveSessionCount, getQueueLength, addToQueue, removeFromQueue, promoteFromQueue } from './store-memory.js';
import { persistSession, persistMessage } from '../db/conversations.js';
import type { Session, Language, CloseReason, Message, SessionStatus } from '../types.js';

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip + 'justec-salt').digest('hex').slice(0, 16);
}

export function createSession(opts: {
  language: Language;
  ipHash: string;
  referrer?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): { session: Session; status: SessionStatus; queuePosition?: number } {
  const config = getConfig();
  const store = getSessionStore();
  const activeCount = getActiveSessionCount();

  const session: Session = {
    id: uuidv4(),
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
    return { session, status: 'queued', queuePosition: position };
  }

  store.set(session.id, session);
  return { session, status: 'active' };
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
  }, 60_000);
}

export function stopExpiryTimer(): void {
  if (_expiryInterval) {
    clearInterval(_expiryInterval);
    _expiryInterval = null;
  }
}
