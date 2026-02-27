import { getAvailableSlots } from '../integrations/calendar.js';
import { createCheckoutSession } from '../integrations/stripe.js';
import { createOrder } from '../integrations/paypal.js';
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
    // Verify slot is still available
    const slots = await getAvailableSlots();
    const selectedSlot = slots.find(s => s.id === slotId);

    if (!selectedSlot) {
      return {
        result: { error: true, message: 'The selected time slot is no longer available. Please check availability again.' },
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

    const structured: StructuredMessage = {
      type: 'payment_request',
      payload: {
        amount,
        currency,
        display_amount: displayAmount,
        description: config.payment.product_description,
        stripe_checkout_url: stripeResult?.checkout_url || null,
        paypal_approve_url: paypalResult?.approve_url || null,
        booking_summary: {
          date: selectedSlot.display[lang],
          duration: '60 minutes',
          with: config.client.owner,
        },
      },
    };

    return {
      result: {
        success: true,
        amount,
        currency,
        display_amount: displayAmount,
        providers: {
          stripe: { available: !!stripeResult },
          paypal: { available: !!paypalResult },
        },
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
