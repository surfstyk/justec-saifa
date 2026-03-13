import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMeetingRoomPrompt } from './meeting-room.js';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

describe('Meeting Room Prompt Builder', () => {
  it('1. regression: payment_status = completed → [SESSION STATE] block injected', () => {
    const session = makeSession({
      tier: 'meeting_room',
      payment_status: 'completed',
      payment_provider: 'stripe',
      booking_time: '2026-03-20T10:00:00Z',
      history: [
        { role: 'visitor', content: 'Hello', structured: [], timestamp: '2026-03-13T10:00:00Z' },
      ],
    });
    const { system } = buildMeetingRoomPrompt(session);
    expect(system).toContain('[SESSION STATE');
    expect(system).toContain('Payment completed');
    expect(system).toContain('Do NOT ask about payment');
  });

  it('2. regression: payment_status = completed → booking tools stripped', () => {
    const session = makeSession({
      tier: 'meeting_room',
      payment_status: 'completed',
      history: [],
    });
    const { tools } = buildMeetingRoomPrompt(session);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('request_payment');
    expect(toolNames).not.toContain('check_calendar_availability');
    expect(toolNames).not.toContain('request_phone');
    // Signal and product tools should remain
    expect(toolNames).toContain('report_signals');
    expect(toolNames).toContain('present_product');
  });

  it('3. regression: payment_status != completed → booking tools present', () => {
    const session = makeSession({
      tier: 'meeting_room',
      metadata: { phone: '+1234567890', slot_holds: { 'slot-1': 'hold-1' } },
      history: [],
    });
    const { tools } = buildMeetingRoomPrompt(session);
    const toolNames = tools.map(t => t.name);
    // With phone + holds: all booking tools available
    expect(toolNames).toContain('request_phone');
    expect(toolNames).toContain('check_calendar_availability');
    expect(toolNames).toContain('request_payment');
  });

  it('4. phone not captured → request_phone available, calendar locked', () => {
    const session = makeSession({
      tier: 'meeting_room',
      metadata: {},
      history: [],
    });
    const { tools } = buildMeetingRoomPrompt(session);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('request_phone');
    expect(toolNames).not.toContain('check_calendar_availability');
    expect(toolNames).not.toContain('request_payment');
  });

  it('5. phone captured → calendar available, payment locked', () => {
    const session = makeSession({
      tier: 'meeting_room',
      metadata: { phone: '+1234567890' },
      history: [],
    });
    const { tools } = buildMeetingRoomPrompt(session);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('request_phone');
    expect(toolNames).toContain('check_calendar_availability');
    expect(toolNames).not.toContain('request_payment');
  });

  it('6. phone + slot held → payment available', () => {
    const session = makeSession({
      tier: 'meeting_room',
      metadata: { phone: '+1234567890', slot_holds: { 'slot-abc': 'event-123' } },
      history: [],
    });
    const { tools } = buildMeetingRoomPrompt(session);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('request_payment');
  });

  it('7. history windowing: meeting room uses full history', () => {
    const session = makeSession({
      tier: 'meeting_room',
      history: Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'visitor' : 'testbot',
        content: `Message ${i}`,
        structured: [] as [],
        timestamp: new Date().toISOString(),
      })),
    });
    const { messages } = buildMeetingRoomPrompt(session);
    // Meeting room gets full history, all 20 messages
    expect(messages.length).toBe(20);
  });
});
