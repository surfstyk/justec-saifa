import Stripe from 'stripe';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';

let _stripe: Stripe | null = null;
let _webhookSecret: string | null = null;

function loadStripeKey(): string {
  const config = getConfig();
  const keyPath = resolve(config.credentials_path, 'stripe_secret_key');
  return readFileSync(keyPath, 'utf-8').trim();
}

function loadWebhookSecret(): string {
  const config = getConfig();
  const secretPath = resolve(config.credentials_path, 'stripe_webhook_secret');
  return readFileSync(secretPath, 'utf-8').trim();
}

function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(loadStripeKey());
  }
  return _stripe;
}

function getWebhookSecret(): string {
  if (!_webhookSecret) {
    _webhookSecret = loadWebhookSecret();
  }
  return _webhookSecret;
}

export interface CheckoutParams {
  session_id: string;
  slot_id: string;
  slot_start: string;
  slot_end: string;
  slot_display: string;
  visitor_name: string;
  visitor_phone?: string;
  visitor_company?: string;
}

export async function createCheckoutSession(
  params: CheckoutParams,
): Promise<{ checkout_url: string; stripe_session_id: string } | null> {
  const config = getConfig();

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: config.payment.currency,
            unit_amount: config.payment.deposit_amount,
            product_data: {
              name: config.payment.product_name,
              description: config.payment.product_description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        session_id: params.session_id,
        slot_id: params.slot_id,
        slot_start: params.slot_start,
        slot_end: params.slot_end,
        slot_display: params.slot_display,
        visitor_name: params.visitor_name,
        visitor_phone: params.visitor_phone || '',
        visitor_company: params.visitor_company || '',
      },
      success_url: `${config.payment.return_base_url ?? 'https://surfstyk.com'}?payment=success&session_id=${params.session_id}`,
      cancel_url: `${config.payment.return_base_url ?? 'https://surfstyk.com'}?payment=cancelled&session_id=${params.session_id}`,
    });

    if (!session.url) {
      console.error('[stripe] Checkout session created but no URL returned');
      return null;
    }

    return {
      checkout_url: session.url,
      stripe_session_id: session.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[stripe] Failed to create checkout session:', message);
    return null;
  }
}

export function verifyWebhook(
  rawBody: Buffer,
  signature: string,
): Stripe.Event {
  const stripe = getStripe();
  const secret = getWebhookSecret();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
