import { getAccessToken } from './google-auth.js';
import { invalidateSlotCache } from './calendar.js';
import { getConfig } from '../config.js';
import type { AvailableSlot } from './calendar.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// ── Types ────────────────────────────────────────────────

export interface TentativeHold {
  holdEventId: string;
  sessionId: string;
  slotId: string;
  slotStart: string;
  slotEnd: string;
  slotDisplay: Record<string, string>;
  createdAt: number;
}

// ── In-memory registry ───────────────────────────────────

const holds = new Map<string, TentativeHold>(); // keyed by holdEventId

// ── Create tentative hold ────────────────────────────────

export async function createTentativeHold(
  sessionId: string,
  slot: AvailableSlot,
): Promise<string | null> {
  const token = await getAccessToken();
  const config = getConfig();
  const tz = config.calendar.working_hours.timezone;

  const event = {
    summary: `[HOLD] ${config.services.name} — Tentative`,
    description: `Tentative hold by ${config.persona.system_name} (session ${sessionId.slice(0, 8)}…)`,
    status: 'tentative',
    transparency: 'opaque',
    start: { dateTime: slot.start, timeZone: tz },
    end: { dateTime: slot.end, timeZone: tz },
  };

  const response = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[calendar-holds] Failed to create hold (${response.status}): ${body}`);
    return null;
  }

  const data = await response.json() as { id: string };

  holds.set(data.id, {
    holdEventId: data.id,
    sessionId,
    slotId: slot.id,
    slotStart: slot.start,
    slotEnd: slot.end,
    slotDisplay: slot.display,
    createdAt: Date.now(),
  });

  invalidateSlotCache();
  console.log(`[calendar-holds] Created hold ${data.id} for slot ${slot.id} (session ${sessionId.slice(0, 8)})`);

  return data.id;
}

// ── Delete a single hold ─────────────────────────────────

export async function deleteTentativeHold(holdEventId: string): Promise<void> {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events/${holdEventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok && response.status !== 404 && response.status !== 410) {
      console.warn(`[calendar-holds] Delete hold ${holdEventId} returned ${response.status}`);
    }
  } catch (err) {
    console.warn(`[calendar-holds] Delete hold ${holdEventId} failed:`, err);
  }

  holds.delete(holdEventId);
  invalidateSlotCache();
}

// ── Delete all holds for a session ───────────────────────

export async function deleteHoldsForSession(sessionId: string): Promise<void> {
  const sessionHolds = [...holds.values()].filter(h => h.sessionId === sessionId);
  if (sessionHolds.length === 0) return;

  console.log(`[calendar-holds] Cleaning up ${sessionHolds.length} hold(s) for session ${sessionId.slice(0, 8)}`);

  await Promise.all(sessionHolds.map(h => deleteTentativeHold(h.holdEventId)));
}

// ── Get holds for a session (debugging) ──────────────────

export function getHoldsForSession(sessionId: string): TentativeHold[] {
  return [...holds.values()].filter(h => h.sessionId === sessionId);
}

// ── Resolve a held slot back to AvailableSlot ────────────

export function getHeldSlot(sessionId: string, slotId: string): AvailableSlot | null {
  const hold = [...holds.values()].find(h => h.sessionId === sessionId && h.slotId === slotId);
  if (!hold) return null;

  return {
    id: hold.slotId,
    start: hold.slotStart,
    end: hold.slotEnd,
    display: hold.slotDisplay as AvailableSlot['display'],
  };
}

// ── Sweep expired holds (safety net) ─────────────────────

export async function sweepExpiredHolds(maxAgeMs: number): Promise<void> {
  const now = Date.now();
  const expired = [...holds.values()].filter(h => (now - h.createdAt) > maxAgeMs);
  if (expired.length === 0) return;

  console.log(`[calendar-holds] Sweeping ${expired.length} expired hold(s)`);
  await Promise.all(expired.map(h => deleteTentativeHold(h.holdEventId)));
}
