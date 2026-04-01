# SSE & Structured Messages — Frontend/Middleware Contract

**Version:** 1.4.0
**Date:** 2026-03-31
**Status:** Active — aligns with deployed middleware

---

## Changelog

| Version | Date       | Changes                                                        |
|---------|------------|----------------------------------------------------------------|
| 1.4.0   | 2026-03-31 | **Breaking:** Session token authorization. `POST /api/session` now returns `session_token`. All session-bound endpoints require `Authorization: Bearer <token>` header. Close endpoint accepts token in body for sendBeacon. New `403 consent_required` error enforces consent before messaging. New `403 invalid_token` error for missing/wrong token. Updated Sections 1, 7, 8 and action matrix. |
| 1.3.1   | 2026-03-13 | Fixed Section 3.3: `payment_request` payload now shows actual `providers` nested structure (Stripe embedded checkout + PayPal SDK), not outdated redirect URLs. Fixed action matrix: replaced non-existent `connection_error` with actual SSE error codes. |
| 1.3.0   | 2026-03-13 | Added Section 7: HTTP Error Responses — complete error contract with status codes, triggers, frontend implementation details, and action matrix. |
| 1.2.0   | 2026-03-12 | Added `product_link` structured message type for self-service product referrals (MemberMagix, KongQuant). Display-only — no action flows back. Available in both lobby and meeting room tiers via `present_product` tool. |
| 1.1.0   | 2026-02-26 | Added `payment_request` structured message (Phase 10). Updated booking flow: payment required before calendar event creation. Added payment fields to state endpoint. |
| 1.0.0   | 2026-02-26 | Initial contract. Covers core SSE lifecycle, 3 structured message types (calendar_slots, phone_request, booking_confirmed), 5 action types, budget events. |

---

## 1. SSE Connection

**Endpoint:** `POST /api/session/:id/message`

**Required request header:**
```
Authorization: Bearer <session_token>
```

The `session_token` is returned in the `POST /api/session` response (see Section 8). It must be included on **every** session-bound request (`/message`, `/state`, `/history`, `/consent`, `/language`, `/close`). Requests without a valid token receive `403 invalid_token`.

**Request body** (one of):
```json
{ "text": "Hello", "behavioral": { ... } }
```
```json
{ "action": { "type": "<action_type>", "payload": { ... } }, "behavioral": { ... } }
```

- Must have **either** `text` or `action`, never both, never neither.
- `behavioral` is optional on all messages.
- **Consent must be granted** before sending messages. Requests with `pending` or `declined` consent receive `403 consent_required`.

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
    "description": "60-minute strategy session — credited toward your first engagement",
    "providers": {
      "stripe": {
        "client_secret": "cs_live_secret_...",
        "publishable_key": "pk_live_..."
      },
      "paypal": {
        "approve_url": "https://www.paypal.com/checkoutnow?token=...",
        "order_id": "ORDER-ABC123",
        "client_id": "AaBbCc..."
      }
    },
    "booking_summary": {
      "date": "Thursday 27 February, 14:00",
      "duration": "60-minute",
      "with": "Hendrik Bondzio"
    }
  }
}
```

**Field notes:**
- `providers` — object with one or both keys (`stripe`, `paypal`). If a provider fails to initialize, its key is absent. If both fail, no structured message is emitted.
- `providers.stripe.client_secret` — Stripe Checkout Session client secret for **embedded checkout** (Stripe.js `initEmbeddedCheckout`). This is NOT a redirect URL.
- `providers.stripe.publishable_key` — Stripe publishable key needed to initialize Stripe.js.
- `providers.paypal.approve_url` — PayPal approval URL. Opens in new tab or PayPal SDK popup.
- `providers.paypal.order_id` — PayPal order ID for SDK integration.
- `providers.paypal.client_id` — PayPal client ID for SDK initialization.

**Rendering:** Payment card showing the booking summary and deposit amount. Render a button for each provider present in `providers`:
- **Stripe:** "Pay with Card" — initialize Stripe.js embedded checkout using `client_secret` and `publishable_key`
- **PayPal:** "Pay with PayPal" — use PayPal SDK with `client_id` and `order_id`, or redirect to `approve_url`

**After payment:** Payment confirmation is handled by webhooks from Stripe/PayPal to the middleware, which creates the calendar event and moves the Trello card automatically. The frontend should:
1. Poll `GET /api/session/:id/state` to confirm `payment.status === "completed"`
2. On confirmation, fetch `GET /api/session/:id/history` to display the booking confirmation message that the webhook injected into the conversation

**No action required from the frontend to the middleware** — the payment lifecycle is fully webhook-driven.

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

## 7. HTTP Error Responses

All HTTP errors return JSON:

```json
{
  "error": "error_code",
  "message": "Human-readable message",
  "retry_after_seconds": 60
}
```

`retry_after_seconds` is only present on `429` responses.

### 400 — Bad Request (`invalid_request`)

| Trigger | Endpoints |
|---|---|
| Invalid or missing session ID (not UUID v4) | All `/api/session/:id/*` routes |
| Content-Type is not `application/json` or `text/plain` | All POST routes |
| Message contains neither `text` nor `action` | `POST /api/session/:id/message` |
| Message contains both `text` and `action` | `POST /api/session/:id/message` |
| Consent field is not a boolean | `POST /api/session/:id/consent` |
| Language is not `en`, `de`, or `pt` | `POST /api/session/:id/language` |

**Frontend implementation:** Shows localized message — EN: "Something went wrong. Please refresh the page." Input remains enabled. No retry or "New conversation" button. Typically indicates a frontend bug.

### 403 — Forbidden

**`invalid_token`** — Missing, malformed, or wrong `Authorization: Bearer <token>` header.

```json
{ "error": "invalid_token", "message": "Missing or malformed authorization." }
```

Endpoints: All `/api/session/:id/*` routes (except `/close` which also accepts token in body)

**Frontend implementation:** This indicates the stored session token is missing or corrupted. Show "Your session has ended. Would you like to start a new conversation?" with a "New conversation" button. Clear stored session state including `session_token`.

**`consent_required`** — Message sent before consent was granted, or after consent was declined.

```json
{ "error": "consent_required", "consent_state": "pending" | "declined", "message": "Consent is required before sending messages." }
```

Endpoints: `POST /api/session/:id/message`

**Frontend implementation:** This should not occur if the consent dialog is shown correctly. If `consent_state` is `"pending"`, re-show the consent dialog. If `"declined"`, input should already be disabled. No retry.

**`blocked`** — Visitor's IP has been blocklisted after repeated security violations (guard level 4).

```json
{ "error": "blocked", "message": "Access denied." }
```

Endpoints: `POST /api/session`, `POST /api/session/:id/message`

**Frontend implementation:** The entire chat interface (MessageList + ChatInput) is hidden. Only a centered "Access denied." message is shown. No retry, no "New conversation" button. Same behavior when an SSE `session_terminated` event arrives with `guard_level >= 4`.

**`verification_failed`** — Cloudflare Turnstile token missing, invalid, or expired.

```json
{ "error": "verification_failed", "message": "We couldn't verify your request. Please refresh and try again." }
```

Endpoints: `POST /api/session`

**Frontend implementation:** Shows localized message — EN: "Verification failed. Please refresh the page." with a "Try again" button. Input remains enabled. Retry clears the error and re-triggers session creation (which re-requests a Turnstile token).

### 404 — Session Not Found (`session_not_found`)

```json
{ "error": "session_not_found", "message": "Session not found or expired" }
```

Endpoints: All `/api/session/:id/*` routes

**Triggers:**
- Session expired (default TTL: 60 minutes of inactivity)
- Server was restarted (sessions are in-memory)
- Session ID doesn't exist

**Frontend implementation:** Shows localized message — EN: "Your session has ended. Would you like to start a new conversation?" with a "New conversation" button. Input is disabled. The button calls `startNewConversation()` which clears all chat state (messages, session, error) and creates a fresh session. **Does not show a generic error** — this is a normal state that users will encounter.

### 410 — Session Closed (`session_closed`)

```json
{ "error": "session_closed", "message": "This conversation has been ended." }
```

Endpoints: All `/api/session/:id/*` routes

**Triggers:** Session was closed by budget exhaustion, security termination, or explicit close.

**Frontend implementation:** Shows localized message — EN: "This conversation has ended." with a "New conversation" button. Input is disabled permanently. The button calls `startNewConversation()` to clear state and start fresh.

### 429 — Rate Limited (`rate_limited`)

```json
{ "error": "rate_limited", "message": "Too many messages. Please wait before sending another.", "retry_after_seconds": 60 }
```

Endpoints: `POST /api/session/:id/message`

**Triggers:**
- Per-session message limit exceeded (default: 25/session)
- Per-IP hourly limit exceeded (default: 40/IP/hour)
- Token budget exhausted (`retry_after_seconds: 0`)

**Frontend implementation:** Input area is replaced with a disabled bar showing localized "Please wait (Xs)" with a live countdown from `retry_after_seconds`. When the countdown reaches zero, the error auto-clears and input is re-enabled. If `retry_after_seconds` is `0`, treated as permanent — input stays disabled, a "New conversation" button is shown (same as 410).

### 500 — Internal Server Error (`internal_error`)

```json
{ "error": "internal_error", "message": "Something went wrong. Please try again." }
```

**Frontend implementation:** Shows localized message — EN: "We're experiencing a technical issue. Please try again." with a "Try again" button. A retry counter (`retryCountRef`) tracks attempts — on first failure, "Try again" is shown. If the retry also fails, the "Try again" button is replaced with a "New conversation" button. Input remains enabled throughout. The counter resets on any successful message send.

### Frontend Action Matrix (implemented)

| Condition | Disable Input | Allow Retry | Show "New Conversation" |
|---|---|---|---|
| **400** `invalid_request` | No | No | No |
| **403** `invalid_token` | Yes | No | **Yes** |
| **403** `consent_required` (pending) | Yes | No | No (re-show consent dialog) |
| **403** `consent_required` (declined) | Yes | No | No |
| **403** `blocked` | Yes (chat hidden) | No | No |
| **403** `verification_failed` | No | Yes | No |
| **404** `session_not_found` | Yes | No | **Yes** |
| **410** `session_closed` | Yes | No | **Yes** |
| **429** `rate_limited` | Yes (countdown) | Auto (after countdown) | If `retry_after_seconds` is 0 |
| **500** `internal_error` | No | Yes (once) | If retry fails |
| SSE `error` (`llm_error`, `internal_error`) | No | Yes | No |
| SSE `session_terminated` | Yes | No | Only if `guard_level < 4` |
| SSE `session_terminated` (guard ≥ 4) | Yes (chat hidden) | No | No |
| SSE `budget_exhausted` | Yes | No | **Yes** |
| Network error (no response) | No | Yes | No |

---

## 8. Session Endpoints Reference

| Method | Endpoint                        | Purpose                   | Auth |
|--------|---------------------------------|---------------------------|------|
| POST   | `/api/session`                  | Create session (requires Turnstile token) | None |
| POST   | `/api/session/:id/message`      | Send message / action (SSE response) | Bearer token |
| GET    | `/api/session/:id/state`        | Get session state, scores, budget | Bearer token |
| GET    | `/api/session/:id/history`      | Get conversation history   | Bearer token |
| POST   | `/api/session/:id/consent`      | Grant/decline consent      | Bearer token |
| POST   | `/api/session/:id/language`     | Change language            | Bearer token |
| POST   | `/api/session/:id/close`        | Close session (sendBeacon) | Bearer token (header or body) |
| GET    | `/api/health`                   | Health check               | None |
| GET    | `/api/status`                   | System status              | None |
| POST   | `/api/webhooks/stripe`          | Stripe webhook (internal)  | Stripe signature |
| POST   | `/api/webhooks/paypal`          | PayPal webhook (internal)  | PayPal signature |
| GET    | `/api/paypal/return`            | PayPal redirect capture (internal) | None |

### Session creation response

`POST /api/session` now returns `session_token` alongside `session_id`:

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_token": "dGhpcyBpcyBhIGJhc2U2NHVybCB0b2tlbg...",
  "status": "active",
  "greeting": { ... },
  "consent_request": { ... },
  "post_consent": { ... },
  "config": { ... }
}
```

**The `session_token` is only returned once at creation.** Store it securely (sessionStorage recommended, not localStorage). Include it on every subsequent request:

```
Authorization: Bearer <session_token>
```

### Close endpoint (sendBeacon)

Since `navigator.sendBeacon()` cannot set custom headers, the close endpoint also accepts the token in the request body:

```json
{ "reason": "visitor_left", "session_token": "<token>" }
```

The `Authorization` header is also accepted for non-sendBeacon callers.
