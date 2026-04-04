import { buildSystemPrompt } from './loader.js';
import { SIGNAL_TOOL } from '../tools/signal-tool.js';
import { PRESENT_PRODUCT_TOOL } from '../tools/product-tools.js';
import { getConfig } from '../config.js';
import type { Session, LLMMessage, ToolDefinition } from '../types.js';

function getMeetingRoomTools(): ToolDefinition[] {
  const config = getConfig();
  const ownerFirst = config.client.owner.split(' ')[0];
  const serviceName = config.services.name.toLowerCase();

  return [
    {
      name: 'check_calendar_availability',
      description: `Check available time slots for a ${serviceName} with ${ownerFirst}. Call this when the visitor wants to book a meeting or asks about availability.`,
      parameters: {
        type: 'object',
        properties: {
          start_date: {
            type: 'string',
            description: 'Start date for availability search (ISO 8601). Defaults to today if not provided.',
          },
          end_date: {
            type: 'string',
            description: 'End date for availability search (ISO 8601). Defaults to 14 days from start if not provided.',
          },
          timezone: {
            type: 'string',
            description: `Visitor timezone (IANA format, e.g. "Europe/Berlin"). Defaults to ${config.calendar.working_hours.timezone}.`,
          },
        },
      },
    },
    {
      name: 'request_phone',
      description: 'Request the visitor\'s phone number. Call this when booking is progressing and you need their contact number for the appointment.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'request_payment',
      description: `Request a deposit payment for the ${serviceName}. Call this after the visitor has selected a time slot.`,
      parameters: {
        type: 'object',
        properties: {
          slot_id: {
            type: 'string',
            description: 'The ID of the selected time slot.',
          },
          visitor_name: {
            type: 'string',
            description: 'The visitor\'s name for the payment.',
          },
        },
        required: ['slot_id', 'visitor_name'],
      },
    },
  ];
}

export function buildMeetingRoomPrompt(session: Session): {
  system: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
} {
  let system = buildSystemPrompt('meeting_room');

  // Inject payment/booking state so the LLM knows what has already happened
  if (session.payment_status === 'completed') {
    const config = getConfig();
    const ownerFirst = config.client.owner.split(' ')[0];
    const bookingLine = session.booking_time
      ? ` Booking confirmed for ${session.booking_time}.`
      : '';
    system += `\n\n[SESSION STATE: Payment completed via ${session.payment_provider || 'unknown'}.${bookingLine} Do NOT ask about payment, deposits, or booking again. The visitor's session is fully secured. If they ask about their booking, confirm the details. Focus on wrapping up warmly or answering any remaining questions. ${ownerFirst} will review the conversation before the meeting.]`;
  }

  // Full history for meeting room (visitor has earned it)
  const messages: LLMMessage[] = session.history
    .filter(msg => msg.content !== null)
    .map(msg => ({
      role: msg.role === 'visitor' ? 'user' as const : 'assistant' as const,
      content: msg.content!,
    }));

  // Gate booking tools based on session progress — enforce sequential booking flow
  const tools: ToolDefinition[] = [SIGNAL_TOOL, PRESENT_PRODUCT_TOOL];

  if (session.payment_status !== 'completed') {
    const hasHolds = !!session.metadata?.slot_holds
      && Object.keys(session.metadata.slot_holds as Record<string, string>).length > 0;

    for (const tool of getMeetingRoomTools()) {
      switch (tool.name) {
        case 'check_calendar_availability':
          // Always available — first booking step after agreement
          tools.push(tool);
          break;
        case 'request_payment':
          // Only after calendar slots have been held
          if (hasHolds) tools.push(tool);
          break;
        case 'request_phone':
          // Always available — post-payment contact capture or fallback for non-bookers
          tools.push(tool);
          break;
      }
    }
  }

  return { system, messages, tools };
}
