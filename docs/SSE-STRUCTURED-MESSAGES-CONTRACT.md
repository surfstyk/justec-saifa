# SSE & Structured Messages — Frontend/Middleware Contract

**Version:** 1.2.0
**Date:** 2026-03-12
**Status:** Active — aligns with deployed middleware

---

## Changelog

| Version | Date       | Changes                                                        |
|---------|------------|----------------------------------------------------------------|
| 1.2.0   | 2026-03-12 | Added `product_link` structured message type for self-service product referrals (MemberMagix, KongQuant). Display-only — no action flows back. Available in both lobby and meeting room tiers via `present_product` tool. |
| 1.1.0   | 2026-02-26 | Added `payment_request` structured message (Phase 10). Updated booking flow: payment required before calendar event creation. Added payment fields to state endpoint. |
| 1.0.0   | 2026-02-26 | Initial contract. Covers core SSE lifecycle, 3 structured message types (calendar_slots, phone_request, booking_confirmed), 5 action types, budget events. |

---

## 1. SSE Connection

**Endpoint:** `POST /api/session/:id/message`

**Request body** (one of):
```json
{ "text": "Hello", "behavioral": { ... } }
```
```json
{ "action": { "type": "<action_type>", "payload": { ... } }, "behavioral": { ... } }
```

- Must have **either** `text` or `action`, never both, never neither.
- `behavioral` is optional on all messages.

**Response:** `Content-Type: text/event-stream`

**Headers included:**
- `X-Session-Tier`: `lobby` | `meeting_room`
- `X-RateLimit-Remaining`, `X-RateLimit-Limit`, `X-RateLimit-Reset`

---

## 2. SSE Event Lifecycle

Every message response follows this guaranteed lifecycle:

```
processing → [token]* → [structured_message]* → [token]* → message_complete → [budget_warning | budget_exhausted]? → stream_end
```

Tokens and structured messages can interleave — the LLM may emit text before and after a structured message within the same response.

### 2.1 Core Events

#### `processing`
```
event: processing
data: {}
```
Show typing indicator. Always the first event.

#### `token`
```
event: token
data: {"text":"Hello, "}
```
Append `text` to the current message bubble. Tokens arrive incrementally.

**Important:** The field name is `text`, not `token`.

#### `structured_message`
```
event: structured_message
data: {"type":"<type>","payload":{...}}
```
Render an interactive card inline in the chat flow. See Section 3 for types.

#### `message_complete`
```
event: message_complete
data: {"tokens_used":1200,"session_tokens_remaining":23800}
```
Finalize the message. **There is no `message_id` or `content` field.** The frontend must concatenate all `token` events to build the final message text.

#### `stream_end`
```
event: stream_end
data: {}
```
Always the last event. Re-enable input, hide typing indicator, close the EventSource.

### 2.2 Budget Events

#### `budget_warning`
```
event: budget_warning
data: {"tokens_remaining":455,"budget_total":5000,"message":"approaching_limit"}
```
Session is approaching its token limit. Show a subtle indicator.

#### `budget_exhausted`
```
event: budget_exhausted
data: {"tokens_used":5000,"budget_total":5000}
```
No more messages will be processed for this session.

### 2.3 Session Events

#### `tier_change`
```
event: tier_change
data: {"from":"lobby","to":"meeting_room","score":72}
```
Visitor qualified and was promoted. **This transition is invisible to the visitor** — no UI change. The frontend may use this to enable features internally (e.g., anticipate structured messages).

#### `session_terminated`
```
event: session_terminated
data: {"reason":"security","guard_level":3,"message":"This conversation has been ended."}
```
Session was closed by the security guard. Display the message and disable input.

#### `error`
```
event: error
data: {"code":"llm_error","message":"We're experiencing a technical issue. Please try again."}
```
Display error inline in chat. Codes: `llm_error`, `internal_error`.

---

## 3. Structured Message Types

### 3.1 `calendar_slots` — Time Slot Picker

**Trigger:** LLM calls `check_calendar_availability` tool (meeting room tier only).

**Payload:**
```json
{
  "type": "calendar_slots",
  "payload": {
    "slots": [
      {
        "id": "slot-1",
        "start": "2026-02-27T10:00:00.000Z",
        "end": "2026-02-27T11:00:00.000Z",
        "display": {
          "en": "Thursday 27 February, 10:00",
          "de": "Donnerstag 27. Februar, 10:00",
          "pt": "quinta-feira 27 de fevereiro, 10:00"
        }
      },
      {
        "id": "slot-2",
        "start": "2026-02-27T11:00:00.000Z",
        "end": "2026-02-27T12:00:00.000Z",
        "display": {
          "en": "Thursday 27 February, 11:00",
          "de": "Donnerstag 27. Februar, 11:00",
          "pt": "quinta-feira 27 de fevereiro, 11:00"
        }
      }
    ],
    "language": "en"
  }
}
```

**Rendering:** Clickable slot cards. Use `display[language]` for the label. Up to 10 slots.

**User action:**
```json
{
  "action": {
    "type": "slot_selected",
    "payload": {
      "slot_id": "slot-1",
      "display": "Thursday 27 February, 10:00"
    }
  }
}
```

### 3.2 `phone_request` — Phone Number Input

**Trigger:** LLM calls `request_phone` tool during booking flow.

**Payload:**
```json
{
  "type": "phone_request",
  "payload": {
    "language": "en"
  }
}
```

**Rendering:** Inline phone input field with submit button.

**User action:**
```json
{
  "action": {
    "type": "phone_submitted",
    "payload": {
      "phone": "+491701234567"
    }
  }
}
```

### 3.3 `payment_request` — Payment Checkout Card

**Trigger:** LLM calls `request_payment` tool after visitor selects a slot and provides their phone number.

**Payload:**
```json
{
  "type": "payment_request",
  "payload": {
    "amount": 8000,
    "currency": "eur",
    "display_amount": "€80.00",
    "description": "Strategy session deposit — credited toward your first engagement",
    "stripe_checkout_url": "https://checkout.stripe.com/c/pay/cs_live_...",
    "paypal_approve_url": "https://www.paypal.com/checkoutnow?token=...",
    "booking_summary": {
      "date": "Thursday, 27 February at 14:00 (Lisbon)",
      "duration": "60 minutes",
      "with": "Hendrik Bondzio"
    }
  }
}
```

**Field notes:**
- `stripe_checkout_url` — may be `null` if Stripe session creation failed
- `paypal_approve_url` — may be `null` if PayPal is not configured or order creation failed
- At least one URL will always be present (if both fail, no structured message is emitted)

**Rendering:** Payment card showing the booking summary and deposit amount, with up to two buttons:
- "Pay with Card" → opens `stripe_checkout_url` in a new tab/window
- "Pay with PayPal" → opens `paypal_approve_url` in a new tab/window

Only render buttons for non-null URLs. Both links open Stripe/PayPal hosted checkout pages — no card details are collected on our site.

**After payment:** The visitor completes payment on the external page and is redirected back to `https://surfstyk.com/?payment=success` (or `?payment=cancelled`). The frontend should:
1. Detect `?payment=success` in the URL on page load
2. Poll `GET /api/session/:id/state` to confirm `payment.status === "completed"`
3. Show a confirmation state in the chat

**No action required from the frontend to the middleware** — the payment confirmation is handled entirely by webhooks from Stripe/PayPal to the middleware, which then creates the calendar event and moves the Trello card automatically.

### 3.4 `booking_confirmed` — Confirmation Card

**Trigger:** Calendar event successfully created after slot selection (legacy — in the current flow, booking is created by the payment webhook, not inline during the chat).

**Payload:**
```json
{
  "type": "booking_confirmed",
  "payload": {
    "event_id": "abc123googleeventid",
    "slot": {
      "id": "slot-1",
      "start": "2026-02-27T10:00:00.000Z",
      "end": "2026-02-27T11:00:00.000Z",
      "display": {
        "en": "Thursday 27 February, 10:00",
        "de": "Donnerstag 27. Februar, 10:00",
        "pt": "quinta-feira 27 de fevereiro, 10:00"
      }
    },
    "visitor_name": "Max Mueller"
  }
}
```

**Rendering:** Confirmation card with checkmark and booking details. **No action required.**

### 3.5 `product_link` — Product Referral CTA

**Trigger:** LLM calls `present_product` tool (available in both lobby and meeting room tiers).

**Payload:**
```json
{
  "type": "product_link",
  "payload": {
    "product": "kongquant",
    "links": [
      {
        "url": "https://kongquant.com/?utm_source=justec&utm_medium=chat&utm_campaign=referral&utm_content=product-link",
        "label": { "en": "Visit KongQuant", "de": "KongQuant besuchen", "pt": "Visitar KongQuant" },
        "primary": true
      },
      {
        "url": "https://x.com/kongquant",
        "label": { "en": "Follow on X", "de": "Auf X folgen", "pt": "Seguir no X" },
        "primary": false
      },
      {
        "url": "https://tiktok.com/@kongquant",
        "label": { "en": "Follow on TikTok", "de": "Auf TikTok folgen", "pt": "Seguir no TikTok" },
        "primary": false
      }
    ],
    "language": "en"
  }
}
```

**Field notes:**
- `product` — slug identifying the product (`"membermagix"` or `"kongquant"`)
- `links[].primary` — `true` renders as a prominent CTA button, `false` renders as secondary text link
- `links[].label` — i18n labels keyed by language code; fall back to `label.en` if visitor language unavailable
- All links open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`)

**Rendering:** Product name as header (mapped from slug → display name). Primary links as full-width CTA buttons. Secondary links as small text links separated by `·`.

**No action required.** Display-only — no action flows back to the middleware.

---

## 4. Action Types Reference

All actions are sent to `POST /api/session/:id/message` with the `action` field.

| Action Type                  | Payload                                    | Context                        |
|------------------------------|--------------------------------------------|--------------------------------|
| `slot_selected`              | `{ "slot_id": "slot-1", "display": "..." }` | After `calendar_slots` rendered |
| `phone_submitted`            | `{ "phone": "+491701234567" }`             | After `phone_request` rendered  |
| `payment_provider_selected`  | `{ "provider": "stripe" \| "paypal" }`     | Optional — frontend can send this to inform the LLM which provider was chosen |
| `consent_response`           | `{ "consented": true \| false }`           | Via `POST /api/session/:id/consent` (dedicated endpoint) |
| `language_changed`           | `{ "language": "en" \| "de" \| "pt" }`    | Via `POST /api/session/:id/language` or action |

---

## 5. Rendering Model

Structured messages arrive **inline during the token stream**. The recommended rendering approach:

1. Accumulate `token` events into a text buffer.
2. When a `structured_message` arrives, flush the current text buffer as a text bubble segment, then render the structured card.
3. Continue accumulating any subsequent `token` events as a new text segment.
4. On `message_complete`, finalize.

This produces a message like:
```
┌─────────────────────────────────────────┐
│ Let me check Hendrik's availability...  │  ← tokens before
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │  📅 Thursday 27 February, 10:00    │ │  ← structured card
│ │  📅 Thursday 27 February, 11:00    │ │
│ │  📅 Friday 28 February, 10:00     │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Which time works best for you?          │  ← tokens after
└─────────────────────────────────────────┘
```

If splitting the message bubble is too complex for the initial build, an acceptable alternative is rendering the structured card immediately below the full message bubble.

---

## 6. Payment Flow — Full Sequence

The booking flow with payment is:

```
1. Visitor qualifies → promoted to meeting_room (invisible)
2. LLM calls check_calendar_availability → calendar_slots structured message
3. Visitor selects slot → slot_selected action
4. LLM calls request_phone → phone_request structured message
5. Visitor submits phone → phone_submitted action
6. LLM calls request_payment → payment_request structured message
7. Visitor clicks "Pay with Card" or "Pay with PayPal" → opens external checkout
8. Visitor completes payment on Stripe/PayPal hosted page
9. Stripe/PayPal sends webhook to middleware → calendar event created, Trello card moved
10. Visitor redirected to surfstyk.com/?payment=success
11. Frontend polls GET /api/session/:id/state → payment.status: "completed"
```

### State endpoint — payment fields

`GET /api/session/:id/state` now includes:

```json
{
  "payment": {
    "status": "pending" | "completed" | "expired" | null,
    "provider": "stripe" | "paypal" | null
  },
  "booking_time": "2026-02-27T14:00:00.000Z" | null
}
```

- `payment.status` transitions: `null` → `"pending"` (after `request_payment` tool) → `"completed"` (after webhook) or `"expired"` (if checkout session expires)
- `booking_time` is set when payment completes — this is the ISO 8601 start time of the booked slot

### Handling the return redirect

When the visitor returns to `surfstyk.com/?payment=success`:
1. Parse the `payment` query parameter
2. If `payment=success` and a session ID is stored (localStorage), poll state every 2s (max 30s) until `payment.status === "completed"`
3. Show a confirmation message in the chat (e.g., "Your booking is confirmed!")
4. If `payment=cancelled`, show a message like "Payment was cancelled. You can try again."
5. Clean the query parameter from the URL

### Dropped types

The following types from the original API spec v0.2.0 have been **dropped**:
- `payment_confirmed` — not emitted as a structured message; frontend detects completion via state polling
- `consent_request` — consent is handled at session creation (`POST /api/session` response) + dedicated endpoint
- `link` — not needed
- `conversation_end` — covered by `session_terminated` and `budget_exhausted` events

---

## 7. Session Endpoints Reference

| Method | Endpoint                        | Purpose                   |
|--------|---------------------------------|---------------------------|
| POST   | `/api/session`                  | Create session (requires Turnstile token) |
| POST   | `/api/session/:id/message`      | Send message / action (SSE response) |
| GET    | `/api/session/:id/state`        | Get session state, scores, budget |
| GET    | `/api/session/:id/history`      | Get conversation history   |
| POST   | `/api/session/:id/consent`      | Grant/decline consent      |
| POST   | `/api/session/:id/language`     | Change language            |
| POST   | `/api/session/:id/close`        | Close session (sendBeacon) |
| GET    | `/api/health`                   | Health check               |
| GET    | `/api/status`                   | System status              |
| POST   | `/api/webhooks/stripe`          | Stripe webhook (internal)  |
| POST   | `/api/webhooks/paypal`          | PayPal webhook (internal)  |
| GET    | `/api/paypal/return`            | PayPal redirect capture (internal) |
