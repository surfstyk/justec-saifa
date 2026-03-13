import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeSession } from '../__fixtures__/test-helpers.js';

// Mock all external dependencies
vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

vi.mock('../db/conversations.js', () => ({
  persistSession: vi.fn(),
  persistMessage: vi.fn(),
}));

vi.mock('../integrations/calendar-holds.js', () => ({
  deleteHoldsForSession: vi.fn().mockResolvedValue(undefined),
  sweepExpiredHolds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../admin/stats.js', () => ({
  recordSessionCreated: vi.fn(),
  recordMessage: vi.fn(),
}));

// Need to import after mocks are set up
const { createSession, getSession, closeSession, updateSession } = await import('./manager.js');
const { getSessionStore, getActiveSessionCount } = await import('./store-memory.js');
const { persistSession } = await import('../db/conversations.js');

beforeEach(() => {
  // Clear the session store between tests
  const store = getSessionStore();
  store.clear();
});

describe('Session Manager', () => {
  it('1. create session → initialized with cold classification, empty scores', () => {
    const { session, status } = createSession({
      language: 'en',
      ipHash: 'abc123',
    });
    expect(session.status).toBe('active');
    expect(session.tier).toBe('lobby');
    expect(session.classification).toBe('cold');
    expect(session.score_composite).toBe(0);
    expect(session.tokens_used).toBe(0);
    expect(session.history).toEqual([]);
    expect(status).toBe('active');
  });

  it('2. create session at capacity → status = queued', () => {
    // Fill to capacity (max_concurrent_sessions = 10)
    for (let i = 0; i < 10; i++) {
      createSession({ language: 'en', ipHash: `ip${i}` });
    }
    const { session, status, queuePosition } = createSession({
      language: 'en',
      ipHash: 'overflow',
    });
    expect(status).toBe('queued');
    expect(session.status).toBe('queued');
    expect(queuePosition).toBeGreaterThan(0);
  });

  it('3. close session with consent → persistence called', () => {
    const { session } = createSession({ language: 'en', ipHash: 'abc' });
    session.consent = 'granted';
    session.history.push({
      role: 'visitor',
      content: 'Hello',
      structured: [],
      timestamp: new Date().toISOString(),
    });
    closeSession(session.id, 'visitor_left');
    expect(persistSession).toHaveBeenCalled();
  });

  it('4. close session without consent → no persistence', () => {
    vi.mocked(persistSession).mockClear();
    const { session } = createSession({ language: 'en', ipHash: 'abc' });
    session.consent = 'declined';
    closeSession(session.id, 'visitor_left');
    expect(persistSession).not.toHaveBeenCalled();
  });

  it('5. close active session → removed from store', () => {
    const { session } = createSession({ language: 'en', ipHash: 'abc' });
    const id = session.id;
    closeSession(id, 'visitor_left');
    expect(getSession(id)).toBeUndefined();
  });

  it('6. update session → last_activity refreshed', () => {
    const { session } = createSession({ language: 'en', ipHash: 'abc' });
    const before = session.last_activity;
    // Small delay to ensure timestamp differs
    session.last_activity = before - 1000;
    updateSession(session);
    expect(session.last_activity).toBeGreaterThan(before - 1000);
  });

  it('7. get nonexistent session → returns undefined', () => {
    expect(getSession('nonexistent-id')).toBeUndefined();
  });

  it('8. session has correct visitor_info defaults', () => {
    const { session } = createSession({ language: 'de', ipHash: 'abc' });
    expect(session.visitor_info.language).toBe('de');
    expect(session.visitor_info.name).toBeNull();
    expect(session.visitor_info.company).toBeNull();
  });
});
