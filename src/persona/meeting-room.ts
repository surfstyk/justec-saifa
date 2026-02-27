import { buildSystemPrompt } from './loader.js';
import { SIGNAL_TOOL } from '../tools/signal-tool.js';
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
      description: `Request a deposit payment for the ${serviceName}. Call this after the visitor has selected a time slot and provided their contact details.`,
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
  const system = buildSystemPrompt('meeting_room');

  // Full history for meeting room (visitor has earned it)
  const messages: LLMMessage[] = session.history
    .filter(msg => msg.content !== null)
    .map(msg => ({
      role: msg.role === 'visitor' ? 'user' as const : 'assistant' as const,
      content: msg.content!,
    }));

  return { system, messages, tools: [...getMeetingRoomTools(), SIGNAL_TOOL] };
}
