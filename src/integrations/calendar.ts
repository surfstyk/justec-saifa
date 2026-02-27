import { getAccessToken } from './google-auth.js';
import { getConfig } from '../config.js';
import type { Language } from '../types.js';

export interface BusySlot {
  start: string; // ISO 8601
  end: string;
}

export interface AvailableSlot {
  id: string;
  start: string; // ISO 8601
  end: string;
  display: Record<Language, string>;
}

interface SlotCache {
  slots: AvailableSlot[];
  expires_at: number;
}

const SLOT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const slotCaches = new Map<string, SlotCache>();

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// ── Query busy slots from Google Calendar ────────────────

export async function queryBusySlots(startDate: string, endDate: string): Promise<BusySlot[]> {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    timeMin: new Date(startDate).toISOString(),
    timeMax: new Date(endDate).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    fields: 'items(start,end,transparency)',
  });

  const response = await fetch(
    `${CALENDAR_API}/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[calendar] Events query failed (${response.status}): ${body}`);
  }

  const data = await response.json() as {
    items: Array<{
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      transparency?: string;
    }>;
  };

  return data.items
    .filter(event => event.transparency !== 'transparent') // Skip free/transparent events
    .map(event => ({
      start: event.start.dateTime || event.start.date!,
      end: event.end.dateTime || event.end.date!,
    }));
}

// ── Compute available 60-min slots ───────────────────────

export function computeAvailableSlots(busySlots: BusySlot[]): AvailableSlot[] {
  const config = getConfig();
  const { working_hours, slot_duration_minutes, lookahead_days, buffer_minutes } = config.calendar;
  const tz = working_hours.timezone;
  const now = new Date();
  const slots: AvailableSlot[] = [];
  let slotIndex = 1;

  for (let dayOffset = 0; dayOffset <= lookahead_days; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);

    // Check if this day is a working day
    const dayInTz = getDayOfWeekInTz(date, tz);
    if (!working_hours.days.includes(dayInTz)) continue;

    // Build day start/end in the target timezone
    const dayStr = formatDateInTz(date, tz);
    const dayStart = parseTzTime(dayStr, working_hours.start, tz);
    const dayEnd = parseTzTime(dayStr, working_hours.end, tz);

    // Generate slot grid
    let cursor = dayStart.getTime();
    const slotMs = slot_duration_minutes * 60_000;
    const bufferMs = buffer_minutes * 60_000;

    while (cursor + slotMs <= dayEnd.getTime()) {
      const slotStart = cursor;
      const slotEnd = cursor + slotMs;

      // Check if slot is in the past (with buffer)
      if (slotStart < now.getTime() + bufferMs) {
        cursor += slotMs;
        continue;
      }

      // Check for conflicts with busy slots (including buffer)
      const bufferedStart = slotStart - bufferMs;
      const bufferedEnd = slotEnd + bufferMs;
      const conflicts = busySlots.some(busy => {
        const busyStart = new Date(busy.start).getTime();
        const busyEnd = new Date(busy.end).getTime();
        return bufferedStart < busyEnd && bufferedEnd > busyStart;
      });

      if (!conflicts) {
        const startDt = new Date(slotStart);
        const endDt = new Date(slotEnd);

        slots.push({
          id: `slot-${slotIndex}`,
          start: startDt.toISOString(),
          end: endDt.toISOString(),
          display: {
            en: formatSlotDisplay(startDt, 'en', tz),
            de: formatSlotDisplay(startDt, 'de', tz),
            pt: formatSlotDisplay(startDt, 'pt', tz),
          },
        });
        slotIndex++;
      }

      cursor += slotMs;
    }
  }

  return slots;
}

// ── Cached availability query ────────────────────────────

export async function getAvailableSlots(): Promise<AvailableSlot[]> {
  const cacheKey = 'primary';
  const cached = slotCaches.get(cacheKey);
  if (cached && Date.now() < cached.expires_at) {
    return cached.slots;
  }

  const config = getConfig();
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + config.calendar.lookahead_days);

  const busySlots = await queryBusySlots(now.toISOString(), endDate.toISOString());
  const slots = computeAvailableSlots(busySlots);

  slotCaches.set(cacheKey, { slots, expires_at: Date.now() + SLOT_CACHE_TTL });

  return slots;
}

// ── Create booking event ─────────────────────────────────

export async function createBookingEvent(
  slot: AvailableSlot,
  visitorInfo: { name: string | null; company: string | null; phone?: string },
  notes: string,
): Promise<{ eventId: string; htmlLink: string }> {
  const token = await getAccessToken();
  const config = getConfig();

  const visitorName = visitorInfo.name || 'Website Visitor';
  const company = visitorInfo.company ? ` (${visitorInfo.company})` : '';
  const phone = visitorInfo.phone ? `\nPhone: ${visitorInfo.phone}` : '';

  const event = {
    summary: `${config.services.name} — ${visitorName}${company}`,
    description: [
      `Booked via ${config.persona.system_name}`,
      `Visitor: ${visitorName}${company}${phone}`,
      notes ? `\nNotes:\n${notes}` : '',
    ].join('\n'),
    start: {
      dateTime: slot.start,
      timeZone: config.calendar.working_hours.timezone,
    },
    end: {
      dateTime: slot.end,
      timeZone: config.calendar.working_hours.timezone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'email', minutes: 60 },
      ],
    },
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
    throw new Error(`[calendar] Event creation failed (${response.status}): ${body}`);
  }

  const data = await response.json() as { id: string; htmlLink: string };

  // Invalidate slot cache after booking
  slotCaches.delete('primary');

  return { eventId: data.id, htmlLink: data.htmlLink };
}

// ── Timezone helpers ─────────────────────────────────────

function getDayOfWeekInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[weekday!] ?? date.getDay();
}

function formatDateInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function parseTzTime(dateStr: string, time: string, tz: string): Date {
  // dateStr = 'YYYY-MM-DD', time = 'HH:MM'
  // Create a date in the target timezone by constructing an ISO string and adjusting
  const isoStr = `${dateStr}T${time}:00`;
  // Get the offset by comparing a known Date in the timezone
  const testDate = new Date(isoStr + 'Z');
  const tzStr = testDate.toLocaleString('en-US', { timeZone: tz });
  const tzDate = new Date(tzStr);
  const offset = testDate.getTime() - tzDate.getTime();
  return new Date(new Date(isoStr).getTime() + offset);
}

function formatSlotDisplay(date: Date, lang: Language, tz: string): string {
  const locale = lang === 'de' ? 'de-DE' : lang === 'pt' ? 'pt-PT' : 'en-GB';

  const datePart = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tz,
  }).format(date);

  const timePart = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
    hour12: false,
  }).format(date);

  return `${datePart}, ${timePart}`;
}
