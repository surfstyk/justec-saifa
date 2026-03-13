import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig } from '../__fixtures__/test-helpers.js';
import type { AvailableSlot } from './calendar.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

// Mock Google auth and calendar API
vi.mock('./google-auth.js', () => ({
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));

// Mock fetch for calendar API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('./calendar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendar.js')>();
  return {
    ...actual,
    invalidateSlotCache: vi.fn(),
  };
});

const { createTentativeHold, deleteTentativeHold, getHeldSlot, getHoldsForSession, deleteHoldsForSession, sweepExpiredHolds } = await import('./calendar-holds.js');

const testSlot: AvailableSlot = {
  id: 'slot-abc123',
  start: '2026-03-20T10:00:00Z',
  end: '2026-03-20T11:00:00Z',
  display: { en: 'Friday 20 March, 10:00', de: 'Freitag 20. März, 10:00', pt: 'Sexta-feira 20 de março, 10:00' },
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('Calendar Holds', () => {
  it('1. create hold → event created, registered in memory', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-123' }),
    });

    const holdId = await createTentativeHold('session-1', testSlot);
    expect(holdId).toBe('event-123');
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify registered in memory
    const held = getHeldSlot('session-1', testSlot.id);
    expect(held).not.toBeNull();
    expect(held?.id).toBe(testSlot.id);
  });

  it('2. delete hold → event deleted, removed from registry', async () => {
    // Create first
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-del' }),
    });
    await createTentativeHold('session-del', { ...testSlot, id: 'slot-del' });

    // Delete
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    await deleteTentativeHold('event-del');

    const held = getHeldSlot('session-del', 'slot-del');
    expect(held).toBeNull();
  });

  it('3. delete already-deleted hold (404) → no error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(deleteTentativeHold('nonexistent')).resolves.not.toThrow();
  });

  it('4. regression: getHeldSlot returns held slot for own session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-own' }),
    });
    await createTentativeHold('session-own', { ...testSlot, id: 'slot-own' });

    const held = getHeldSlot('session-own', 'slot-own');
    expect(held).not.toBeNull();
    expect(held?.start).toBe(testSlot.start);
    expect(held?.end).toBe(testSlot.end);
  });

  it('5. getHeldSlot returns null for other session hold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-other' }),
    });
    await createTentativeHold('session-other', { ...testSlot, id: 'slot-other' });

    const held = getHeldSlot('different-session', 'slot-other');
    expect(held).toBeNull();
  });

  it('6. sweepExpiredHolds removes old holds', async () => {
    // Create a hold
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-old' }),
    });
    await createTentativeHold('session-old', { ...testSlot, id: 'slot-old' });

    // Sweep with -1ms max age (forces everything to be expired, even same-millisecond)
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    await sweepExpiredHolds(-1);

    const held = getHeldSlot('session-old', 'slot-old');
    expect(held).toBeNull();
  });

  it('7. deleteHoldsForSession cleans all holds for session', async () => {
    // Create two holds for same session
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-a' }),
    });
    await createTentativeHold('session-multi', { ...testSlot, id: 'slot-a' });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'event-b' }),
    });
    await createTentativeHold('session-multi', { ...testSlot, id: 'slot-b' });

    // Delete all
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    await deleteHoldsForSession('session-multi');

    expect(getHoldsForSession('session-multi').length).toBe(0);
  });

  it('8. hold creation fails → returns null, not thrown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    });
    const holdId = await createTentativeHold('session-fail', testSlot);
    expect(holdId).toBeNull();
  });
});
