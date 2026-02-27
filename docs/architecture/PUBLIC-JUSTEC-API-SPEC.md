# SAIFA Public API Spec

**Version**: 0.4.0
**Base URL**: `https://{domain}/api`

---

## Authentication

Sessions are created via `POST /api/session` with a Cloudflare Turnstile token. All subsequent requests use the `session_id` path parameter.

---

## Endpoints

### `POST /api/session`

Create a new chat session.

**Request body**:
```json
{
  "turnstile_token": "string",
  "language": "en" | "de" | "pt",
  "referrer": "string (optional)",
  "user_agent": "string (optional)"
}
```

**Response** (`200`):
```json
{
  "session_id": "string",
  "greeting": "string",
  "tier": "lobby",
  "language": "en"
}
```

### `POST /api/session/:id/message`

Send a message or action. Response is a **Server-Sent Events** stream.

**Request body**:
```json
{
  "text": "string (mutually exclusive with action)",
  "action": {
    "type": "slot_selected" | "phone_submitted" | "payment_provider_selected" | "consent_response" | "language_changed",
    "payload": { ... }
  },
  "behavioral": {
    "typing_duration_ms": 0,
    "keypress_count": 0,
    "correction_count": 0,
    "time_since_last_message_ms": 0,
    "mouse_movement_detected": false,
    "viewport_scroll_depth": 0
  }
}
```

### `GET /api/session/:id/state`

Get current session state (tier, score, budget remaining).

### `GET /api/session/:id/history`

Get conversation history for session reconnection.

### `POST /api/session/:id/consent`

Submit consent response.

**Request body**:
```json
{
  "consent": "granted" | "declined"
}
```

### `POST /api/session/:id/language`

Change session language.

**Request body**:
```json
{
  "language": "en" | "de" | "pt"
}
```

### `POST /api/session/:id/close`

Close session (uses POST for `sendBeacon` compatibility).

### `GET /api/health`

Health check.

---

## SSE Event Lifecycle

Every `POST /api/session/:id/message` response follows this lifecycle:

```
processing → [token]* → message_complete → [structured_message]* → [budget_warning | budget_exhausted] → stream_end
```

Guard termination short-circuits:
```
processing → [token]? → session_terminated → [conversation_end] → stream_end
```

### SSE Event Types

#### `processing`
```json
{}
```

#### `token`
```json
{ "text": "string" }
```

#### `message_complete`
```json
{
  "tokens_used": 150,
  "session_tokens_remaining": 29850
}
```

#### `structured_message`
```json
{
  "type": "calendar_slots | phone_request | payment_request | booking_confirmed | consent_request | conversation_end",
  "payload": { ... }
}
```

#### `tier_change`
```json
{
  "from": "lobby",
  "to": "meeting_room",
  "score": 72
}
```

#### `budget_warning`
```json
{
  "tokens_remaining": 3000,
  "budget_total": 30000,
  "message": "approaching_limit"
}
```

#### `budget_exhausted`
```json
{
  "tokens_used": 30000,
  "budget_total": 30000
}
```

#### `session_terminated`
```json
{
  "reason": "security",
  "guard_level": 3,
  "message": "string"
}
```

`reason` is always `"security"` (the internal guard action name is not exposed).

#### `consent_state`
```json
{
  "consent": "granted" | "declined"
}
```

#### `error`
```json
{
  "code": "llm_error | internal_error | rate_limited",
  "message": "string"
}
```

#### `stream_end`
```json
{}
```

---

## Structured Message Types

### `calendar_slots`

Emitted when the LLM calls `check_availability`. Displays available time slots.

```json
{
  "type": "calendar_slots",
  "payload": {
    "slots": [
      {
        "id": "slot_2026-03-03T10:00:00",
        "start": "2026-03-03T10:00:00+00:00",
        "end": "2026-03-03T11:00:00+00:00",
        "display": { "en": "Monday, March 3 at 10:00 AM", "de": "...", "pt": "..." }
      }
    ],
    "language": "en",
    "timezone": "Europe/Lisbon",
    "duration_minutes": 60,
    "instruction": "Select a time that works for you."
  }
}
```

**Frontend**: Render slot buttons. On click, send `action: { type: "slot_selected", payload: { slot_id, display } }`.

### `phone_request`

Emitted when the LLM calls `request_phone`. Displays a phone number input.

```json
{
  "type": "phone_request",
  "payload": {
    "language": "en",
    "prompt": "Please enter your phone number so we can reach you.",
    "preferred_messenger": "WhatsApp",
    "placeholder": "+1 555 000 0000"
  }
}
```

**Frontend**: Render phone input with placeholder. On submit, send `action: { type: "phone_submitted", payload: { phone } }`.

### `payment_request`

Emitted when the LLM calls `request_payment`. Displays payment options.

```json
{
  "type": "payment_request",
  "payload": {
    "amount": 5000,
    "currency": "eur",
    "display_amount": "\u20ac50.00",
    "description": "60-minute strategy session — credited toward your first engagement",
    "providers": {
      "stripe": {
        "client_secret": "cs_xxx_secret_xxx",
        "publishable_key": "pk_live_xxx"
      },
      "paypal": {
        "approve_url": "https://www.sandbox.paypal.com/checkoutnow?token=xxx",
        "order_id": "ORDER-xxx",
        "client_id": "xxx"
      }
    },
    "booking_summary": {
      "date": "Monday, March 3 at 10:00 AM",
      "duration": "60-minute",
      "with": "Hendrik Bondzio"
    }
  }
}
```

**Frontend — Stripe**: Use `client_secret` + `publishable_key` to mount Stripe Embedded Checkout inline. The visitor stays in the chat UI.

**Frontend — PayPal**: Either redirect to `approve_url` or use `client_id` + `order_id` with the PayPal JS SDK for inline checkout.

Provider keys are only present if that provider's session was created successfully.

### `booking_confirmed`

Emitted after a successful booking (via direct booking or post-payment webhook).

```json
{
  "type": "booking_confirmed",
  "payload": {
    "event_id": "string",
    "slot": {
      "id": "slot_xxx",
      "start": "2026-03-03T10:00:00+00:00",
      "end": "2026-03-03T11:00:00+00:00",
      "display": { "en": "...", "de": "...", "pt": "..." }
    },
    "visitor_name": "string"
  }
}
```

### `consent_request`

Emitted after the first assistant response when consent is `pending`.

```json
{
  "type": "consent_request",
  "payload": {
    "text": "We store this conversation to improve our service. Your data is processed in accordance with our privacy policy.",
    "privacy_url": "https://surfstyk.com/privacy",
    "options": {
      "accept": "I agree",
      "decline": "No thanks"
    }
  }
}
```

**Frontend**: Render consent banner/modal. On response, send `action: { type: "consent_response", payload: { consent: "granted" | "declined" } }` or call `POST /api/session/:id/consent`.

### `conversation_end`

Emitted when the conversation is permanently ended (budget exhaustion or security termination).

```json
{
  "type": "conversation_end",
  "payload": {
    "reason": "budget_exhausted" | "security",
    "message": "This conversation has reached its limit. Please contact us directly for further assistance.",
    "show_contact": true,
    "phone": "+351 XXX XXX XXX"
  }
}
```

**Frontend**: Disable the input. Display the `message`. If `show_contact` is true, show the `phone` number as a contact option.

---

## Token Budget Tiers

| Classification | Budget (tokens) |
|----------------|----------------|
| Anonymous | 30,000 |
| Engaged | 60,000 |
| Qualified | 150,000 |
| Post-booking | 300,000 |

Budget tier is determined by qualification scoring. The visitor is never told their tier or score.

---

## Action Types

| Action | Payload | Trigger |
|--------|---------|---------|
| `slot_selected` | `{ slot_id: string, display?: string }` | Visitor clicks a calendar slot |
| `phone_submitted` | `{ phone: string }` | Visitor submits phone number |
| `payment_provider_selected` | `{ provider: "stripe" \| "paypal" }` | Visitor selects payment method |
| `consent_response` | `{ consent: "granted" \| "declined" }` | Visitor responds to consent banner |
| `language_changed` | `{ language: "en" \| "de" \| "pt" }` | Visitor changes language |

---

## Webhooks (Server-to-Server)

### `POST /api/webhooks/stripe`

Stripe sends `checkout.session.completed` and `checkout.session.expired` events. Raw body verification with Stripe signature.

### `POST /api/webhooks/paypal`

PayPal sends `CHECKOUT.ORDER.APPROVED` events. Verified via PayPal webhook signature API.

### `GET /api/paypal/return`

Backup capture for PayPal redirect flow. Redirects visitor back to chat with payment status query params.
