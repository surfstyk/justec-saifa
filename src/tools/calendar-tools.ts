import { getAvailableSlots, createBookingEvent } from '../integrations/calendar.js';
import { createTentativeHold } from '../integrations/calendar-holds.js';
import { moveToBooked } from '../integrations/trello-cards.js';
import { getConfig } from '../config.js';
import type { Session, StructuredMessage } from '../types.js';
import type { AvailableSlot } from '../integrations/calendar.js';

export interface ToolCallResult {
  result: Record<string, unknown>;
  structured?: StructuredMessage;
}

export async function handleCheckAvailability(
  session: Session,
  _args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const config = getConfig();
    const maxOffered = config.calendar.max_offered_slots;
    const ownerFirst = config.client.owner.split(' ')[0];
    const slots = await getAvailableSlots();
    const lang = session.visitor_info.language || session.language || 'en';

    // Filter out already-offered slots
    const fresh = slots.filter(s => !session.offered_slot_ids.includes(s.id));

    // Check if we've hit the cap
    if (session.offered_slot_ids.length >= maxOffered) {
      return {
        result: {
          available_slots: [],
          message: `No additional slots available this week. Suggest the visitor contact ${ownerFirst} directly to arrange a custom time.`,
        },
      };
    }

    // Reveal 1 new slot
    const nextSlot = fresh[0];
    if (!nextSlot) {
      return {
        result: {
          available_slots: [],
          message: `No more slots available this week. Suggest the visitor contact ${ownerFirst} directly.`,
        },
      };
    }

    session.offered_slot_ids.push(nextSlot.id);

    // Create tentative hold on Google Calendar (non-fatal)
    try {
      const holdEventId = await createTentativeHold(session.id, nextSlot);
      if (holdEventId) {
        if (!session.metadata) session.metadata = {};
        const slotHolds = (session.metadata.slot_holds as Record<string, string>) || {};
        slotHolds[nextSlot.id] = holdEventId;
        session.metadata.slot_holds = slotHolds;
      }
    } catch (err) {
      console.warn('[calendar-tools] Failed to create tentative hold:', err);
    }

    const remaining = maxOffered - session.offered_slot_ids.length;

    const slotSummary = {
      id: nextSlot.id,
      display: nextSlot.display[lang],
      start: nextSlot.start,
      end: nextSlot.end,
    };

    const slotInstructions: Record<string, string> = {
      en: 'Select a time that works for you.',
      de: 'Wählen Sie eine passende Zeit aus.',
      pt: 'Selecione um horário que lhe convenha.',
    };

    const structured: StructuredMessage = {
      type: 'calendar_slots',
      payload: {
        slots: [{
          id: nextSlot.id,
          start: nextSlot.start,
          end: nextSlot.end,
          display: nextSlot.display,
        }],
        language: lang,
        timezone: config.calendar.working_hours.timezone,
        duration_minutes: config.calendar.slot_duration_minutes,
        instruction: slotInstructions[lang] || slotInstructions.en,
      },
    };

    return {
      result: {
        available_slots: [slotSummary],
        slots_offered_so_far: session.offered_slot_ids.length,
        can_offer_more: remaining > 0,
        note: remaining > 0
          ? `If this doesn't work, you can check again — ${remaining} more option${remaining > 1 ? 's' : ''} available.`
          : 'This is the last available option this week.',
      },
      structured,
    };
  } catch (err) {
    const config = getConfig();
    const ownerFirst = config.client.owner.split(' ')[0];
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[calendar-tools] Availability check failed:', message);
    return {
      result: {
        error: true,
        message: `Unable to check calendar availability at this time. Please suggest the visitor contact ${ownerFirst} directly.`,
      },
    };
  }
}

export async function handleBookAppointment(
  session: Session,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const slotId = args.slot_id as string;
  const notes = (args.notes as string) || '';

  if (!slotId) {
    return {
      result: { error: true, message: 'No slot_id provided. Ask the visitor to select a time slot first.' },
    };
  }

  try {
    // Get fresh slots to find the selected one
    const slots = await getAvailableSlots();
    const selectedSlot = slots.find((s: AvailableSlot) => s.id === slotId);

    if (!selectedSlot) {
      return {
        result: { error: true, message: 'The selected time slot is no longer available. Please check availability again.' },
      };
    }

    const visitorInfo = {
      name: session.visitor_info.name,
      company: session.visitor_info.company,
      phone: session.metadata?.phone as string | undefined,
    };

    const { eventId, htmlLink } = await createBookingEvent(selectedSlot, visitorInfo, notes);
    const lang = session.visitor_info.language || session.language || 'en';

    session.booking_time = selectedSlot.start;
    if (session.trello_card_id) {
      moveToBooked(session).catch(e => console.error('[trello] Booked move failed:', e));
    }

    return {
      result: {
        success: true,
        event_id: eventId,
        booked_slot: {
          id: selectedSlot.id,
          display: selectedSlot.display[lang],
          start: selectedSlot.start,
          end: selectedSlot.end,
        },
        calendar_link: htmlLink,
      },
      structured: {
        type: 'booking_confirmed',
        payload: {
          event_id: eventId,
          slot: {
            id: selectedSlot.id,
            start: selectedSlot.start,
            end: selectedSlot.end,
            display: selectedSlot.display,
          },
          visitor_name: session.visitor_info.name,
        },
      },
    };
  } catch (err) {
    const config = getConfig();
    const ownerFirst = config.client.owner.split(' ')[0];
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[calendar-tools] Booking failed:', message);
    return {
      result: {
        error: true,
        message: `Failed to create the booking. Please try again or suggest the visitor contact ${ownerFirst} directly.`,
      },
    };
  }
}
