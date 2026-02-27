import { getAvailableSlots } from '../integrations/calendar.js';
import { createTentativeHold, deleteTentativeHold, getHeldSlot } from '../integrations/calendar-holds.js';
import { createCheckoutSession } from '../integrations/stripe.js';
import { createOrder, getPayPalClientId } from '../integrations/paypal.js';
import { getConfig } from '../config.js';
import type { Session, StructuredMessage } from '../types.js';
import type { ToolCallResult } from './calendar-tools.js';

export async function handleRequestPayment(
  session: Session,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const slotId = args.slot_id as string;
  const visitorName = args.visitor_name as string;

  if (!slotId) {
    return {
      result: { error: true, message: 'No slot_id provided. Ask the visitor to select a time slot first.' },
    };
  }

  if (!visitorName) {
    return {
      result: { error: true, message: 'No visitor_name provided. Ask for the visitor\'s name first.' },
    };
  }

  try {
    // Verify slot is still available (check available slots, then our own holds)
    const slots = await getAvailableSlots();
    let selectedSlot = slots.find(s => s.id === slotId);

    // If not in available slots, check if this session owns a hold for it
    // (our own tentative hold makes it appear "busy" to getAvailableSlots)
    if (!selectedSlot) {
      selectedSlot = getHeldSlot(session.id, slotId) ?? undefined;
      if (selectedSlot) {
        console.log(`[payment-tools] Slot ${slotId} resolved from session hold`);
      }
    }

    if (!selectedSlot) {
      // Genuinely unavailable — delete stale hold
      const slotHolds = (session.metadata?.slot_holds as Record<string, string>) || {};
      if (slotHolds[slotId]) {
        deleteTentativeHold(slotHolds[slotId]).catch(e =>
          console.warn('[payment-tools] Stale hold cleanup failed:', e),
        );
        delete slotHolds[slotId];
        if (session.metadata) session.metadata.slot_holds = slotHolds;
      }

      // Fetch 1-2 alternative fresh slots
      const config = getConfig();
      const lang = session.visitor_info.language || session.language || 'en';
      const freshSlots = slots
        .filter(s => !session.offered_slot_ids.includes(s.id))
        .slice(0, 2);

      if (freshSlots.length === 0) {
        const ownerFirst = config.client.owner.split(' ')[0];
        return {
          result: {
            error: true,
            message: `The selected slot is no longer available and no alternatives remain. Please suggest the visitor contact ${ownerFirst} directly.`,
          },
        };
      }

      // Create tentative holds for alternatives
      for (const alt of freshSlots) {
        session.offered_slot_ids.push(alt.id);
        try {
          const holdId = await createTentativeHold(session.id, alt);
          if (holdId) {
            if (!session.metadata) session.metadata = {};
            const holds = (session.metadata.slot_holds as Record<string, string>) || {};
            holds[alt.id] = holdId;
            session.metadata.slot_holds = holds;
          }
        } catch (err) {
          console.warn('[payment-tools] Failed to create hold for alternative:', err);
        }
      }

      // Return a single calendar_slots card with all alternatives
      const structured: StructuredMessage = {
        type: 'calendar_slots',
        payload: {
          slots: freshSlots.map(s => ({
            id: s.id,
            start: s.start,
            end: s.end,
            display: s.display,
          })),
          language: lang,
          timezone: config.calendar.working_hours.timezone,
          duration_minutes: config.calendar.slot_duration_minutes,
          instruction: {
            en: 'The previously selected slot is no longer available. Please choose an alternative:',
            de: 'Der zuvor gewählte Termin ist nicht mehr verfügbar. Bitte wählen Sie eine Alternative:',
            pt: 'O horário anteriormente selecionado já não está disponível. Por favor escolha uma alternativa:',
          }[lang] || 'The previously selected slot is no longer available. Please choose an alternative:',
        },
      };

      return {
        result: {
          error: true,
          slot_unavailable: true,
          alternatives_shown: freshSlots.length,
          message: `The selected slot is no longer available. ${freshSlots.length} alternative(s) have been shown to the visitor in a slot picker. Ask them to choose one — do NOT call check_calendar_availability.`,
        },
        structured,
      };
    }

    const config = getConfig();
    const lang = session.visitor_info.language || session.language || 'en';

    // Store pending payment data on session
    if (!session.metadata) session.metadata = {};
    session.metadata.pending_slot = {
      id: selectedSlot.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      display: selectedSlot.display[lang],
    };
    session.payment_status = 'pending';

    const checkoutParams = {
      session_id: session.id,
      slot_id: selectedSlot.id,
      slot_start: selectedSlot.start,
      slot_end: selectedSlot.end,
      slot_display: selectedSlot.display[lang],
      visitor_name: visitorName,
      visitor_phone: session.metadata.phone as string | undefined,
      visitor_company: session.visitor_info.company || undefined,
    };

    // Create both checkout sessions in parallel
    const [stripeResult, paypalResult] = await Promise.all([
      createCheckoutSession(checkoutParams),
      createOrder(checkoutParams),
    ]);

    // Store provider IDs on session
    if (stripeResult) session.metadata.stripe_session_id = stripeResult.stripe_session_id;
    if (paypalResult) session.metadata.paypal_order_id = paypalResult.order_id;

    if (!stripeResult && !paypalResult) {
      session.payment_status = undefined;
      return {
        result: { error: true, message: `Unable to create payment sessions. Please suggest the visitor contact ${config.client.owner.split(' ')[0]} directly to arrange payment.` },
      };
    }

    const amount = config.payment.deposit_amount;
    const currency = config.payment.currency;
    const displayAmount = `${config.payment.currency_symbol}${(amount / 100).toFixed(2)}`;

    const providers: Record<string, Record<string, unknown>> = {};
    if (stripeResult) {
      providers.stripe = {
        client_secret: stripeResult.client_secret,
        publishable_key: stripeResult.publishable_key,
      };
    }
    if (paypalResult) {
      try {
        providers.paypal = {
          approve_url: paypalResult.approve_url,
          order_id: paypalResult.order_id,
          client_id: getPayPalClientId(),
        };
      } catch {
        providers.paypal = {
          approve_url: paypalResult.approve_url,
          order_id: paypalResult.order_id,
        };
      }
    }

    const structured: StructuredMessage = {
      type: 'payment_request',
      payload: {
        amount,
        currency,
        display_amount: displayAmount,
        description: config.payment.product_description,
        providers,
        booking_summary: {
          date: selectedSlot.display[lang],
          duration: config.services.duration_display,
          with: config.client.owner,
        },
      },
    };

    return {
      result: {
        success: true,
        message: 'Checkout widget displayed to visitor. Do not repeat payment details in your response.',
      },
      structured,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[payment-tools] Payment request failed:', message);
    return {
      result: {
        error: true,
        message: `Failed to initiate payment. Please try again or suggest the visitor contact ${getConfig().client.owner.split(' ')[0]} directly.`,
      },
    };
  }
}
