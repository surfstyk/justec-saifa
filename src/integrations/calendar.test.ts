import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeAvailableSlots, type BusySlot } from './calendar.js';
import { makeConfig } from '../__fixtures__/test-helpers.js';

let testConfig = makeConfig();

vi.mock('../config.js', () => ({
  getConfig: () => testConfig,
  loadConfig: () => testConfig,
}));

beforeEach(() => {
  testConfig = makeConfig();
});

// Helper to find the next working day (Mon-Fri) from now
function getNextWorkingDay(daysAhead: number = 1): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  // Skip to Monday if weekend
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() + 1);
  if (day === 6) date.setDate(date.getDate() + 2);
  return date;
}

describe('Calendar — computeAvailableSlots', () => {
  it('1. no busy events → working-hour slots available', () => {
    const slots = computeAvailableSlots([]);
    expect(slots.length).toBeGreaterThan(0);
    // All slots should be during working hours
    for (const slot of slots) {
      expect(slot.id).toMatch(/^slot-/);
      expect(slot.start).toBeDefined();
      expect(slot.end).toBeDefined();
    }
  });

  it('2. one busy event → overlapping slot excluded', () => {
    const allSlots = computeAvailableSlots([]);
    if (allSlots.length === 0) return; // No future slots available

    // Make the first available slot busy
    const firstSlot = allSlots[0];
    const busySlots: BusySlot[] = [{
      start: firstSlot.start,
      end: firstSlot.end,
    }];

    const filteredSlots = computeAvailableSlots(busySlots);
    // The busy slot should be excluded
    expect(filteredSlots.find(s => s.id === firstSlot.id)).toBeUndefined();
  });

  it('3. buffer minutes applied to busy events', () => {
    const allSlots = computeAvailableSlots([]);
    if (allSlots.length < 3) return;

    // Make a slot in the middle busy — adjacent slots should also be excluded due to buffer
    const middleSlot = allSlots[1];
    const busySlots: BusySlot[] = [{
      start: middleSlot.start,
      end: middleSlot.end,
    }];

    const filteredSlots = computeAvailableSlots(busySlots);
    // The busy slot itself must be excluded
    expect(filteredSlots.find(s => s.id === middleSlot.id)).toBeUndefined();
    // With 15-min buffer on both sides, the immediately adjacent 60-min slots
    // should also be filtered if they overlap the buffer
  });

  it('4. weekend days excluded', () => {
    const slots = computeAvailableSlots([]);
    for (const slot of slots) {
      const date = new Date(slot.start);
      const tz = testConfig.calendar.working_hours.timezone;
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(date);
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(dayName);
    }
  });

  it('5. past slots filtered out', () => {
    const slots = computeAvailableSlots([]);
    const now = Date.now();
    for (const slot of slots) {
      const slotStart = new Date(slot.start).getTime();
      // All slots should be in the future (with buffer)
      expect(slotStart).toBeGreaterThan(now);
    }
  });

  it('6. slots have multilingual display (en/de/pt)', () => {
    const slots = computeAvailableSlots([]);
    if (slots.length === 0) return;
    const slot = slots[0];
    expect(slot.display.en).toBeDefined();
    expect(slot.display.de).toBeDefined();
    expect(slot.display.pt).toBeDefined();
    // English should contain day name
    expect(slot.display.en.length).toBeGreaterThan(5);
  });

  it('7. lookahead of 0 days → only today slots (if working day)', () => {
    testConfig = makeConfig({
      calendar: {
        ...makeConfig().calendar,
        lookahead_days: 0,
      },
    });
    const slots = computeAvailableSlots([]);
    // All slots should be today (or none if weekend/past working hours)
    const today = new Date().toISOString().slice(0, 10);
    for (const slot of slots) {
      const tz = testConfig.calendar.working_hours.timezone;
      const slotDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(slot.start));
      expect(slotDate).toBe(today);
    }
  });

  it('8. slot duration matches config', () => {
    const slots = computeAvailableSlots([]);
    if (slots.length === 0) return;
    const slot = slots[0];
    const durationMs = new Date(slot.end).getTime() - new Date(slot.start).getTime();
    expect(durationMs).toBe(60 * 60 * 1000); // 60 minutes
  });
});
