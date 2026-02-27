import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';

interface PayPalCredentials {
  client_id: string;
  client_secret: string;
  mode: 'sandbox' | 'live';
}

let _credentials: PayPalCredentials | null = null;
let _accessToken: string | null = null;
let _tokenExpiry = 0;

function loadCredentials(): PayPalCredentials {
  if (_credentials) return _credentials;
  const config = getConfig();
  const credPath = resolve(config.credentials_path, 'paypal_credentials.json');
  const raw = readFileSync(credPath, 'utf-8');
  _credentials = JSON.parse(raw) as PayPalCredentials;
  return _credentials;
}

function getBaseUrl(): string {
  const creds = loadCredentials();
  return creds.mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry) {
    return _accessToken;
  }

  const creds = loadCredentials();
  const auth = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');

  const response = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[paypal] Token request failed (${response.status}): ${body}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  _accessToken = data.access_token;
  // Expire 60s early to avoid edge cases
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _accessToken;
}

export interface PayPalOrderParams {
  session_id: string;
  slot_id: string;
  slot_start: string;
  slot_end: string;
  slot_display: string;
  visitor_name: string;
  visitor_phone?: string;
  visitor_company?: string;
}

export async function createOrder(
  params: PayPalOrderParams,
): Promise<{ order_id: string; approve_url: string } | null> {
  const config = getConfig();
  const amount = (config.payment.deposit_amount / 100).toFixed(2);
  const currency = config.payment.currency.toUpperCase();
  const returnBase = config.payment.return_base_url ?? 'https://surfstyk.com';

  const customData = JSON.stringify({
    session_id: params.session_id,
    slot_id: params.slot_id,
    slot_start: params.slot_start,
    slot_end: params.slot_end,
    slot_display: params.slot_display,
    visitor_name: params.visitor_name,
    visitor_phone: params.visitor_phone || '',
    visitor_company: params.visitor_company || '',
  });

  try {
    const token = await getAccessToken();

    const response = await fetch(`${getBaseUrl()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: currency, value: amount },
            description: config.payment.product_description,
            custom_id: customData,
          },
        ],
        application_context: {
          return_url: `${config.client.website}/api/paypal/return?session_id=${params.session_id}`,
          cancel_url: `${returnBase}?payment=cancelled&session_id=${params.session_id}`,
          brand_name: config.client.company,
          user_action: 'PAY_NOW',
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[paypal] Order creation failed (${response.status}):`, body);
      return null;
    }

    const data = await response.json() as {
      id: string;
      links: Array<{ rel: string; href: string }>;
    };

    const approveLink = data.links.find(l => l.rel === 'approve');
    if (!approveLink) {
      console.error('[paypal] No approve link in order response');
      return null;
    }

    return {
      order_id: data.id,
      approve_url: approveLink.href,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[paypal] Failed to create order:', message);
    return null;
  }
}

export async function captureOrder(
  orderId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const token = await getAccessToken();

    const response = await fetch(`${getBaseUrl()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[paypal] Capture failed (${response.status}):`, body);
      return null;
    }

    return await response.json() as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[paypal] Capture error:', message);
    return null;
  }
}

export async function verifyWebhookSignature(
  headers: Record<string, string>,
  body: string,
  webhookId: string,
): Promise<boolean> {
  try {
    const token = await getAccessToken();

    const response = await fetch(`${getBaseUrl()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: JSON.parse(body),
      }),
    });

    if (!response.ok) return false;

    const data = await response.json() as { verification_status: string };
    return data.verification_status === 'SUCCESS';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[paypal] Webhook verification failed:', message);
    return false;
  }
}
