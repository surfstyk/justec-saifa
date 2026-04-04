import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';

const testConfig = makeConfig();

vi.mock('../config.js', () => ({
  getConfig: () => testConfig,
  loadConfig: () => testConfig,
}));

const { persistSession } = await import('./conversations.js');
const { getDb, closeDb } = await import('./sqlite.js');

describe('persistSession — phone persistence', () => {
  beforeEach(() => {
    // Force a fresh in-memory DB for each test
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  function getPersistedPhone(sessionId: string): string | null {
    const row = getDb().prepare('SELECT visitor_phone FROM sessions WHERE id = ?').get(sessionId) as
      { visitor_phone: string | null } | undefined;
    return row?.visitor_phone ?? null;
  }

  it('persists phone for qualified lead (meeting_room tier)', () => {
    const session = makeSession({
      id: 'phone-qualified',
      tier: 'meeting_room',
      metadata: { phone: '+31634476279' },
    });
    persistSession(session);
    expect(getPersistedPhone('phone-qualified')).toBe('+31634476279');
  });

  it('does NOT persist phone for unqualified lead (lobby tier)', () => {
    const session = makeSession({
      id: 'phone-lobby',
      tier: 'lobby',
      metadata: { phone: '+31634476279' },
    });
    persistSession(session);
    expect(getPersistedPhone('phone-lobby')).toBeNull();
  });

  it('persists null when no phone in metadata (meeting_room)', () => {
    const session = makeSession({
      id: 'no-phone-mr',
      tier: 'meeting_room',
    });
    persistSession(session);
    expect(getPersistedPhone('no-phone-mr')).toBeNull();
  });

  it('persists null when metadata is undefined (meeting_room)', () => {
    const session = makeSession({
      id: 'no-meta-mr',
      tier: 'meeting_room',
      metadata: undefined,
    });
    persistSession(session);
    expect(getPersistedPhone('no-meta-mr')).toBeNull();
  });
});
