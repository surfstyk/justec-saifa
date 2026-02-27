import { Router } from 'express';
import express from 'express';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { verifyWebhook } from '../integrations/stripe.js';
import { captureOrder, verifyWebhookSignature } from '../integrations/paypal.js';
import { createBookingEvent, getAvailableSlots } from '../integrations/calendar.js';
import { moveToBooked } from '../integrations/trello-cards.js';
import { notifyBookingConfirmed } from '../integrations/telegram.js';
import { getSessionStore } from '../session/store-memory.js';
import { getConfig } from '../config.js';
import type { Session, Message } from '../types.js';
import type { AvailableSlot } from '../integrations/calendar.js';

const router = Router();

// ── Stripe webhook (needs raw body) ─────────────────────

router.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    try {
      const event = verifyWebhook(req.body as Buffer, signature);

      if (event.type === 'checkout.session.completed') {
        const stripeSession = event.data.object as unknown as Record<string, unknown>;
        const metadata = stripeSession.metadata as Record<string, string>;

        console.log(`[stripe-webhook] checkout.session.completed for session ${metadata.session_id}`);

        processPaymentConfirmation({
          session_id: metadata.session_id,
          provider: 'stripe',
          payment_id: stripeSession.id as string,
          slot_id: metadata.slot_id,
          slot_start: metadata.slot_start,
          slot_end: metadata.slot_end,
          slot_display: metadata.slot_display,
          visitor_name: metadata.visitor_name,
          visitor_phone: metadata.visitor_phone,
          visitor_company: metadata.visitor_company,
        }).catch(err => console.error('[stripe-webhook] Confirmation processing error:', err));
      } else if (event.type === 'checkout.session.expired') {
        const stripeSession = event.data.object as unknown as Record<string, unknown>;
        const metadata = stripeSession.metadata as Record<string, string>;
        console.log(`[stripe-webhook] checkout.session.expired for session ${metadata.session_id}`);

        const session = findSession(metadata.session_id);
        if (session && session.payment_status === 'pending') {
          session.payment_status = 'expired';
        }
      }

      res.status(200).json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[stripe-webhook] Verification failed:', message);
      res.status(400).json({ error: 'Invalid signature' });
    }
  },
);

// ── PayPal webhook ──────────────────────────────────────

router.post(
  '/api/webhooks/paypal',
  express.json(),
  async (req, res) => {
    // Return 200 immediately to acknowledge
    res.status(200).json({ received: true });

    try {
      const config = getConfig();
      const webhookId = getPayPalWebhookId(config);

      const headers: Record<string, string> = {};
      for (const key of ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time']) {
        headers[key] = req.headers[key] as string || '';
      }

      const verified = await verifyWebhookSignature(headers, JSON.stringify(req.body), webhookId);
      if (!verified) {
        console.warn('[paypal-webhook] Signature verification failed');
        return;
      }

      const event = req.body as { event_type: string; resource: Record<string, unknown> };

      if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
        const orderId = event.resource.id as string;
        console.log(`[paypal-webhook] CHECKOUT.ORDER.APPROVED for order ${orderId}`);

        const captureResult = await captureOrder(orderId);
        if (!captureResult) {
          console.error('[paypal-webhook] Failed to capture order', orderId);
          return;
        }

        // Extract custom_id from the captured order
        const purchaseUnits = captureResult.purchase_units as Array<{ custom_id?: string }> | undefined;
        const customId = purchaseUnits?.[0]?.custom_id;
        if (!customId) {
          console.error('[paypal-webhook] No custom_id in captured order');
          return;
        }

        const data = JSON.parse(customId) as Record<string, string>;

        await processPaymentConfirmation({
          session_id: data.session_id,
          provider: 'paypal',
          payment_id: orderId,
          slot_id: data.slot_id,
          slot_start: data.slot_start,
          slot_end: data.slot_end,
          slot_display: data.slot_display,
          visitor_name: data.visitor_name,
          visitor_phone: data.visitor_phone,
          visitor_company: data.visitor_company,
        });
      }
    } catch (err) {
      console.error('[paypal-webhook] Processing error:', err);
    }
  },
);

// ── PayPal return (backup capture for redirect flow) ────

router.get('/api/paypal/return', async (req, res) => {
  const orderId = req.query.token as string;
  const sessionId = req.query.session_id as string || '';
  const returnBase = getConfig().payment.return_base_url ?? 'https://surfstyk.com';
  const sessionParam = sessionId ? `&session_id=${sessionId}` : '';

  if (!orderId) {
    res.redirect(`${returnBase}?payment=cancelled${sessionParam}`);
    return;
  }

  try {
    const captureResult = await captureOrder(orderId);
    if (!captureResult) {
      console.error('[paypal-return] Capture failed for order', orderId);
      res.redirect(`${returnBase}?payment=cancelled${sessionParam}`);
      return;
    }

    const status = captureResult.status as string;
    if (status === 'COMPLETED') {
      const purchaseUnits = captureResult.purchase_units as Array<{ custom_id?: string }> | undefined;
      const customId = purchaseUnits?.[0]?.custom_id;

      if (customId) {
        const data = JSON.parse(customId) as Record<string, string>;
        await processPaymentConfirmation({
          session_id: data.session_id,
          provider: 'paypal',
          payment_id: orderId,
          slot_id: data.slot_id,
          slot_start: data.slot_start,
          slot_end: data.slot_end,
          slot_display: data.slot_display,
          visitor_name: data.visitor_name,
          visitor_phone: data.visitor_phone,
          visitor_company: data.visitor_company,
        });
      }
    }

    res.redirect(`${returnBase}?payment=success${sessionParam}`);
  } catch (err) {
    console.error('[paypal-return] Error:', err);
    res.redirect(`${returnBase}?payment=cancelled${sessionParam}`);
  }
});

// ── Shared payment confirmation ─────────────────────────

interface PaymentConfirmationData {
  session_id: string;
  provider: string;
  payment_id: string;
  slot_id: string;
  slot_start: string;
  slot_end: string;
  slot_display: string;
  visitor_name: string;
  visitor_phone?: string;
  visitor_company?: string;
}

async function processPaymentConfirmation(data: PaymentConfirmationData): Promise<void> {
  console.log(`[payment] Processing confirmation: provider=${data.provider}, payment=${data.payment_id}, session=${data.session_id}`);

  const session = findSession(data.session_id);

  // Update session if still in memory
  if (session) {
    session.payment_status = 'completed';
    session.payment_provider = data.provider;
    session.payment_id = data.payment_id;
    session.booking_time = data.slot_start;
  } else {
    console.warn(`[payment] Session ${data.session_id} not found in memory — proceeding with metadata`);
  }

  // Create calendar event
  try {
    const slot = await resolveSlot(data);

    const visitorInfo = {
      name: data.visitor_name || null,
      company: data.visitor_company || null,
      phone: data.visitor_phone || undefined,
    };

    const { eventId } = await createBookingEvent(
      slot,
      visitorInfo,
      `Payment: ${data.provider} (${data.payment_id})`,
    );
    console.log(`[payment] Calendar event created: ${eventId}`);
  } catch (err) {
    console.error('[payment] Failed to create calendar event:', err);
  }

  // Push booking confirmation into session history so the frontend sees it on reconnect
  if (session) {
    const config = getConfig();
    const confirmationMessage: Message = {
      role: config.persona.assistant_role,
      content: null,
      structured: [
        {
          type: 'booking_confirmed',
          payload: {
            date: data.slot_display,
            slot_start: data.slot_start,
            slot_end: data.slot_end,
            duration: config.services.duration_display,
            with: config.client.owner,
            payment_provider: data.provider,
            deposit_amount: config.payment.deposit_amount,
            currency: config.payment.currency,
            display_amount: `${config.payment.currency_symbol}${(config.payment.deposit_amount / 100).toFixed(2)}`,
            deposit_credited: config.payment.deposit_credited,
          },
        },
      ],
      timestamp: new Date().toISOString(),
    };
    session.history.push(confirmationMessage);
    console.log(`[payment] Booking confirmation added to session ${data.session_id} history`);

    // Move Trello card
    moveToBooked(session).catch(err =>
      console.error('[payment] Trello move failed:', err),
    );

    // Telegram notification
    notifyBookingConfirmed({
      visitor_name: data.visitor_name,
      visitor_company: data.visitor_company,
      visitor_phone: data.visitor_phone,
      slot_display: data.slot_display,
      provider: data.provider,
      deposit_amount: config.payment.deposit_amount,
      currency: config.payment.currency,
    });
  }
}

// Build an AvailableSlot from confirmation data
async function resolveSlot(data: PaymentConfirmationData): Promise<AvailableSlot> {
  // Try to find the slot in current availability (for display data)
  try {
    const slots = await getAvailableSlots();
    const found = slots.find(s => s.id === data.slot_id);
    if (found) return found;
  } catch {
    // Fall through to synthetic slot
  }

  // Build synthetic slot from stored metadata
  return {
    id: data.slot_id,
    start: data.slot_start,
    end: data.slot_end,
    display: {
      en: data.slot_display,
      de: data.slot_display,
      pt: data.slot_display,
    },
  };
}

function findSession(sessionId: string): Session | undefined {
  const store = getSessionStore();
  return store.get(sessionId);
}

function getPayPalWebhookId(config: ReturnType<typeof getConfig>): string {
  try {
    const idPath = resolve(config.credentials_path, 'paypal_webhook_id');
    return readFileSync(idPath, 'utf-8').trim();
  } catch {
    console.warn('[paypal-webhook] No webhook ID file found — skipping verification');
    return '';
  }
}

export default router;
