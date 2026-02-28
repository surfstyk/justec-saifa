# Justec SAIFA — API Specification

**Project**: Justec Virtual Front Desk (powered by SAIFA)
**Owner**: Backend Team
**Version**: v0.5.2
**Date**: 2026-02-28
**Status**: Active — verified against codebase

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.1.0 | 2026-02-26 | Initial draft — all 9 integration points defined |
| v0.2.0 | 2026-02-26 | Fix: explicit stream_end event, typed action field (replaces magic strings), POST /close (replaces DELETE), structured messages in history replay, processing event for typing indicator, language switch endpoint, session creation on page load, Stripe embedded checkout, 2s queue polling |
| v0.3.0 | 2026-02-27 | Full audit against codebase: corrected payment flow (redirect URLs, not embedded), fixed structured message payloads (calendar_slots, phone_request, booking_confirmed), removed unimplemented types (link, conversation_end, consent_request), documented PayPal return endpoint, corrected session_terminated payload, fixed error codes, updated budget tiers to match config, corrected rate limit messages, added payment/booking fields to state endpoint |
| v0.4.0 | 2026-02-27 | Second audit: fixed payment_request payload (nested `providers` object, not flat URLs), restored consent_request and conversation_end structured messages (both implemented), fixed session_terminated reason (always `"security"`), added missing calendar_slots fields (timezone, duration_minutes, instruction), added missing phone_request fields (prompt, preferred_messenger, placeholder), fixed score classification example value, corrected status/state endpoint status values (never `"closed"`), fixed rate limit retry_after_seconds values, documented conversation_end in termination/exhaustion streams |
| v0.5.0 | 2026-02-28 | GDPR consent moved to session creation: `consent_request` now included in `POST /api/session` response. Greeting text updated to lead into consent naturally. Consent-after-first-message retained as fallback. |
| v0.5.1 | 2026-02-28 | Added `post_consent` to session creation response — localized follow-up messages for accept (enables chat) and decline (explains site unusable, chat stays disabled). |
| v0.5.2 | 2026-02-28 | Removed `consent_request` structured message fallback — consent handled exclusively at session creation. Removed inline LLM consent question from prompts. |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Base URL & Transport](#2-base-url--transport)
3. [Authentication & Security](#3-authentication--security)
4. [Session Initiation](#4-session-initiation)
5. [Message Exchange](#5-message-exchange)
6. [Tier Escalation Signals](#6-tier-escalation-signals)
7. [Qualification State](#7-qualification-state)
8. [Structured Message Types](#8-structured-message-types)
9. [Budget & Rate Limit Signals](#9-budget--rate-limit-signals)
10. [GDPR Consent](#10-gdpr-consent)
11. [Language Switching](#11-language-switching)
12. [Session Persistence](#12-session-persistence)
13. [Conversation Termination](#13-conversation-termination)
14. [Payment Flow & Webhooks](#14-payment-flow--webhooks)
15. [Health & Status](#15-health--status)
16. [Error Handling](#16-error-handling)
17. [SSE Event Reference](#17-sse-event-reference)

---

## 1. Overview

This document defines the API contract between the **Chat UI Frontend** and the **Justec SAIFA API** (middleware). The frontend team builds against this spec. The backend team implements and maintains it.

### Design Principles

- **REST + SSE**: Standard HTTP for commands, Server-Sent Events for streaming responses
- **JSON everywhere**: Request and response bodies are JSON
- **Stateful sessions**: Each conversation has a server-side session identified by a session ID
- **Structured messages**: The backend returns typed message blocks (text, calendar_slots, payment_request, etc.) that the frontend renders as appropriate UI components
- **In-band metadata**: Tier changes, budget warnings, and termination signals are delivered as SSE events within the message stream — no separate polling needed

### Who Calls What

| Direction | Transport | Use Case |
|-----------|-----------|----------|
| Frontend → Backend | HTTP POST/GET | Create sessions, send messages, update consent |
| Backend → Frontend | SSE (within POST response) | Streamed response tokens, structured messages, metadata events |
| Stripe/PayPal → Backend | HTTP POST (webhook) | Payment confirmations |

---

## 2. Base URL & Transport

```
Base URL: https://surfstyk.com/api
Transport: HTTPS only (TLS 1.2+)
Content-Type: application/json (requests)
Accept: text/event-stream (message endpoint), application/json (all others)
```

### CORS

The API accepts requests from configured origins. In production:

```
Access-Control-Allow-Origin: https://surfstyk.com, https://www.surfstyk.com
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Session-ID, X-Turnstile-Token
```

In dev mode (`dev_mode: true`), CORS is open to all origins.

---

## 3. Authentication & Security

### No User Authentication

The API serves anonymous visitors. There are no API keys, bearer tokens, or user accounts on the frontend side. Security is enforced through:

1. **Origin check**: Requests must originate from configured CORS origins
2. **Turnstile token**: First request (session creation) must include a valid Cloudflare Turnstile token (skipped in dev mode)
3. **Session ID**: All subsequent requests include the session ID returned at creation
4. **Rate limiting**: Per-IP and per-session limits enforced server-side

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `X-Session-ID` | After session creation | Session identifier (also accepted via URL parameter) |
| `X-Turnstile-Token` | On session creation | Cloudflare Turnstile verification token (alternative to body field) |

---

## 4. Session Initiation

Creates a new conversation session. **Called on page load** — the frontend creates the session immediately when the page renders, before the visitor types anything. This ensures the greeting is displayed instantly and the Turnstile verification happens upfront (not blocking the first message).

### `POST /api/session`

#### Request

```json
{
  "language": "de",
  "referrer": "https://google.com/search?q=ai+agent+consulting",
  "turnstile_token": "0.AXgB...",
  "metadata": {
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "ai-agents-de"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `language` | string | No | Language code (`en`, `de`, `pt`). Defaults to `en` if missing or invalid. Frontend determines this from `Accept-Language`, `navigator.languages`, or geo-IP headers. |
| `referrer` | string | No | The HTTP referrer URL. For analytics and scoring. |
| `turnstile_token` | string | Production only | Cloudflare Turnstile verification token. Also accepted via `X-Turnstile-Token` header. Skipped in dev mode. |
| `metadata` | object | No | Arbitrary metadata (UTM parameters, landing page variant, etc.). Stored but not processed by the backend. |

#### Response — Success (200)

```json
{
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "active",
  "greeting": {
    "language": "de",
    "text": "Willkommen bei Surfstyk Limited — ich bin Justec, Hendriks persönliche Assistentin. Bevor wir loslegen, eine kurze Formalität:"
  },
  "consent_request": {
    "text": "Wir speichern dieses Gespräch zur Verbesserung unseres Service. Ihre Daten werden gemäß unserer Datenschutzrichtlinie verarbeitet.",
    "privacy_url": "https://surfstyk.com/privacy",
    "options": {
      "accept": "Einverstanden",
      "decline": "Nein danke"
    }
  },
  "post_consent": {
    "accepted": "Wunderbar, vielen Dank — wie kann ich Ihnen heute helfen?",
    "declined": "Vollkommen verständlich — Ihre Privatsphäre hat Vorrang. Da diese Website auf Dienste wie Google Fonts und Cloudflare angewiesen ist, die Ihre Zustimmung erfordern, kann ich das Gespräch leider nicht fortsetzen. Sie sind jederzeit willkommen, wenn Sie Ihre Meinung ändern."
  },
  "config": {
    "max_message_length": 2000,
    "languages": ["en", "de", "pt"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string (UUID) | Unique session identifier. Frontend must include this in all subsequent requests. |
| `status` | string | `"active"` or `"queued"` (see below). |
| `greeting` | object | Pre-rendered greeting in the detected language. **No LLM call is made.** The frontend renders this as Justec's first message. The text naturally leads into the consent request below. |
| `greeting.language` | string | The language the backend chose for the greeting. |
| `greeting.text` | string | The greeting text. Ends with a lead-in to the consent (e.g. "...a quick formality:"). |
| `consent_request` | object | GDPR consent data. Frontend should render this directly below the greeting as a consent banner/card. When the visitor responds, call `POST /api/session/:id/consent`. **The frontend should block chat input until consent is handled.** |
| `consent_request.text` | string | Localized consent explanation text. |
| `consent_request.privacy_url` | string | URL to the privacy policy. |
| `consent_request.options.accept` | string | Localized label for the accept button. |
| `consent_request.options.decline` | string | Localized label for the decline button. |
| `post_consent` | object | Localized follow-up messages for after the visitor responds to the consent banner. The frontend renders the appropriate message based on the outcome. |
| `post_consent.accepted` | string | Message to display when consent is granted. Renders as Justec's next message, then chat input is enabled. |
| `post_consent.declined` | string | Message to display when consent is declined. Renders as Justec's final message. **Chat input stays disabled** — the site requires consent for third-party services (Google Fonts, Cloudflare) and cannot operate without it. |
| `config` | object | Session configuration the frontend may need. |
| `config.max_message_length` | number | Maximum characters per message (2000). Frontend should enforce this. |
| `config.languages` | string[] | Supported languages for the language switcher. |

#### Response — Queued (202)

When the maximum concurrent sessions limit is reached:

```json
{
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued",
  "queue": {
    "position": 3,
    "estimated_wait_seconds": 45
  },
  "config": {
    "max_message_length": 2000,
    "languages": ["en", "de", "pt"]
  }
}
```

The frontend displays a queue message. The frontend polls `GET /api/session/:id/status` every **2 seconds** until `status` becomes `"active"`, then renders the greeting and enables input.

#### Response — Bot Detected (403)

If the Turnstile token is invalid or missing (production only):

```json
{
  "error": "verification_failed",
  "message": "We couldn't verify your request. Please refresh and try again."
}
```

#### Response — IP Blocked (403)

```json
{
  "error": "blocked",
  "message": "Access denied."
}
```

---

## 5. Message Exchange

The core interaction: visitor sends a message, Justec responds via streaming.

### `POST /api/session/:id/message`

#### Request

**Text message** (visitor typing):

```json
{
  "text": "Ich leite ein Logistikunternehmen mit ca. 200 Mitarbeitern und wir haben massive Probleme mit manuellen Prozessen.",
  "behavioral": {
    "typing_duration_ms": 12400,
    "keypress_count": 97,
    "correction_count": 3,
    "time_since_last_message_ms": 15200,
    "mouse_movement_detected": true,
    "viewport_scroll_depth": 0.0
  }
}
```

**Structured action** (visitor clicked a UI element):

```json
{
  "action": {
    "type": "slot_selected",
    "payload": { "slot_id": "slot-2", "display": "Thursday, March 6 at 2:00 PM" }
  },
  "behavioral": { ... }
}
```

A message contains EITHER `text` (visitor typed something) OR `action` (visitor clicked a UI element). Never both.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | One of `text` or `action` required | The visitor's typed message. Max length: 2000 characters. |
| `action` | object | One of `text` or `action` required | A structured action triggered by the visitor clicking a UI component. |
| `action.type` | string | If `action` present | Action type. See **Action Types** below. |
| `action.payload` | object | If `action` present | Action-specific data. |
| `behavioral` | object | No | Behavioral signals collected by the frontend. Used for scoring and bot detection. If omitted, behavioral scoring uses defaults. |

**Action Types:**

| Type | Payload | Triggered By |
|------|---------|-------------|
| `slot_selected` | `{ "slot_id": "slot-2", "display": "Thursday, March 6 at 2:00 PM" }` | Visitor clicks a calendar slot from `calendar_slots` structured message |
| `phone_submitted` | `{ "phone": "+491701234567" }` | Visitor submits phone number from `phone_request` structured message |

> **Note:** `consent_response` and `language_changed` actions should use their dedicated endpoints (`POST /api/session/:id/consent` and `POST /api/session/:id/language`). Sending them as message actions will pass through to the LLM but is not the intended flow.

**Behavioral signals reference:**

| Signal | Type | Description |
|--------|------|-------------|
| `typing_duration_ms` | number | Time from first keypress to send |
| `keypress_count` | number | Total keypresses (including corrections) |
| `correction_count` | number | Backspace/delete count |
| `time_since_last_message_ms` | number | Time since the previous visitor message was sent |
| `mouse_movement_detected` | boolean | Whether mouse/touch events were detected since last message |
| `viewport_scroll_depth` | number | 0.0 = top, 1.0 = bottom of page |

#### Response — SSE Stream

The response is a **Server-Sent Events** stream. The `Content-Type` header is `text/event-stream`.

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Session-Tier: lobby
X-RateLimit-Remaining: 11
X-RateLimit-Limit: 15
X-RateLimit-Reset: 1709042400

event: processing
data: {}

event: token
data: {"text": "Das"}

event: token
data: {"text": " ist"}

event: token
data: {"text": " ein"}

event: token
data: {"text": " Bereich"}

...

event: token
data: {"text": "."}

event: message_complete
data: {"tokens_used": 847, "session_tokens_remaining": 4153}

event: stream_end
data: {}

```

**Stream lifecycle:**

1. **`processing`** — Sent immediately when the backend begins handling the request (before any LLM call). The frontend shows the typing indicator (three pulsing dots) on this event. This eliminates dead air between the POST and first token.
2. **`token`** — Streamed response tokens. Frontend hides the typing indicator on the first `token` event and begins rendering text.
3. **`structured_message`** — Rich UI components (calendar slots, phone input, payment, etc.). These can appear mid-stream when tool calls complete, or after `message_complete` for metadata messages (conversation end).
4. **`message_complete`** — End of Justec's text response. May be followed by metadata events.
5. **Metadata events** — `conversation_end`, `tier_change`, `budget_warning`, etc. Zero or more.
6. **`stream_end`** — **Terminal event.** The stream is complete. The frontend MUST stop reading on this event. The HTTP response body closes immediately after. Always the last event in every stream — including error streams and termination streams.

Each SSE event has an `event` type and a JSON `data` payload. See [Section 17: SSE Event Reference](#17-sse-event-reference) for the complete event catalog.

**Response Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | `text/event-stream` |
| `Cache-Control` | `no-cache` |
| `Connection` | `keep-alive` |
| `X-Session-Tier` | Current tier: `lobby` or `meeting_room` |
| `X-RateLimit-Remaining` | Messages remaining in current window |
| `X-RateLimit-Limit` | Per-session message limit |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when limit resets |

#### Response — Session Not Found (404)

```json
{
  "error": "session_not_found",
  "message": "Session not found or expired"
}
```

#### Response — Session Closed (410)

If the session has been terminated (security guard, timeout, budget exhausted):

```json
{
  "error": "session_closed",
  "message": "This conversation has been ended."
}
```

#### Response — Rate Limited (429)

Per-session limit:
```json
{
  "error": "rate_limited",
  "message": "Too many messages. Please wait before sending another.",
  "retry_after_seconds": 60
}
```

Per-IP limit:
```json
{
  "error": "rate_limited",
  "message": "Too many requests from your network. Please try again later.",
  "retry_after_seconds": 1800
}
```

> **Note:** The per-IP `retry_after_seconds` is calculated dynamically based on the remaining time in the 1-hour sliding window. The value shown above is illustrative.

Token budget exhausted (pre-stream check):
```json
{
  "error": "rate_limited",
  "message": "Token budget exhausted",
  "retry_after_seconds": 0
}
```

#### Response — IP Blocked (403)

```json
{
  "error": "blocked",
  "message": "Access denied."
}
```

#### Response — Invalid Request (400)

```json
{
  "error": "invalid_request",
  "message": "Message must include text or action"
}
```

or

```json
{
  "error": "invalid_request",
  "message": "Message cannot include both text and action"
}
```

---

## 6. Tier Escalation Signals

When the qualification score crosses the threshold (default: 70), the session tier changes from `lobby` to `meeting_room`. This is signaled **in-band** via the SSE stream.

### SSE Event: `tier_change`

```
event: tier_change
data: {"from": "lobby", "to": "meeting_room", "score": 72}
```

This event is emitted **once**, at the end of the message that triggered the escalation (after `message_complete`, before `stream_end`).

### Frontend Behavior

For the **seamless transition** (POC), the frontend does nothing visible when it receives `tier_change`. It may:
- Log the event for analytics
- Update internal state
- Show a subtle visual cue (optional, e.g., a barely perceptible border color shift)

For a **theatrical transition** (future), the frontend could:
- Animate a UI transition
- Display "Let me take you to a more comfortable setting..."
- Shift background color, typography weight, or other ambient cues

### Response Header

Every SSE response includes a `X-Session-Tier` header indicating the current tier at the time the stream starts:

```
X-Session-Tier: lobby
```
or
```
X-Session-Tier: meeting_room
```

---

## 7. Qualification State

### `GET /api/session/:id/state`

Returns the full session state. Useful for the frontend to check status after reconnection or for debug purposes.

#### Response (200)

```json
{
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "active",
  "tier": "meeting_room",
  "language": "de",
  "consent": true,
  "score": {
    "composite": 72,
    "behavioral": 25,
    "explicit": 32,
    "fit": 15,
    "classification": "hot"
  },
  "visitor": {
    "name": "Marcus",
    "company": "LogiTech GmbH",
    "role": "Head of Operations"
  },
  "budget": {
    "tokens_used": 4200,
    "tokens_remaining": 20800,
    "messages_sent": 4,
    "messages_limit": 15
  },
  "payment": {
    "status": "completed",
    "provider": "stripe"
  },
  "booking_time": "2026-03-06T14:00:00+00:00",
  "guard_level": 0,
  "created_at": "2026-02-26T14:32:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Session UUID |
| `status` | string | `"active"` or `"queued"` (closed sessions return 410 before reaching this endpoint) |
| `tier` | string | `"lobby"` or `"meeting_room"` |
| `language` | string | Current session language (`en`, `de`, `pt`) |
| `consent` | boolean | Whether GDPR consent has been granted |
| `score` | object | Current qualification scores |
| `score.composite` | number | Overall composite score (0–100) |
| `score.behavioral` | number | Behavioral sub-score |
| `score.explicit` | number | Explicit qualification sub-score |
| `score.fit` | number | Fit sub-score |
| `score.classification` | string | `"hot"`, `"warm"`, `"cold"`, or `"disqualified"` |
| `visitor` | object | Extracted visitor information |
| `visitor.name` | string \| null | Visitor's name (if mentioned) |
| `visitor.company` | string \| null | Visitor's company (if mentioned) |
| `visitor.role` | string \| null | Visitor's role (if mentioned) |
| `budget` | object | Token and message budget status |
| `budget.tokens_used` | number | Tokens consumed so far |
| `budget.tokens_remaining` | number | Tokens remaining before budget exhaustion |
| `budget.messages_sent` | number | Messages sent in this session |
| `budget.messages_limit` | number | Per-session message limit |
| `payment` | object | Payment status |
| `payment.status` | string \| null | `"pending"`, `"completed"`, `"expired"`, or `null` |
| `payment.provider` | string \| null | `"stripe"`, `"paypal"`, or `null` |
| `booking_time` | string \| null | ISO 8601 timestamp of booked appointment, or `null` |
| `guard_level` | number | Security guard escalation level (0–4) |
| `created_at` | string | ISO 8601 timestamp of session creation |

### Score Classification Values

| Classification | Score Range | Meaning |
|----------------|------------|---------|
| `"hot"` | 70–100 | Qualified lead. In Meeting Room. |
| `"warm"` | 45–69 | Engaging but not yet qualified. |
| `"cold"` | 25–44 | Low engagement. Graceful exit territory. |
| `"disqualified"` | 0–24 | Not a fit. |

---

## 8. Structured Message Types

The LLM can trigger tool calls that result in **structured message blocks** within the SSE stream. These are not plain text — they carry typed data that the frontend renders as rich UI components.

Additionally, the backend emits metadata structured messages (`conversation_end`) after `message_complete` based on session state.

### SSE Event: `structured_message`

```
event: structured_message
data: {"type": "calendar_slots", "payload": { ... }}
```

The frontend checks the `type` field and renders the appropriate component.

### Type: `calendar_slots`

Presented when Justec offers booking times. **Slot scarcity**: only 1 slot is revealed per check, up to 3 total per session.

```json
{
  "type": "calendar_slots",
  "payload": {
    "slots": [
      {
        "id": "slot-1",
        "start": "2026-03-04T10:00:00+00:00",
        "end": "2026-03-04T11:00:00+00:00",
        "display": {
          "en": "Tuesday, March 4 at 10:00 AM (Lisbon)",
          "de": "Dienstag, 4. März um 10:00 Uhr (Lissabon)",
          "pt": "Terça-feira, 4 de março às 10:00 (Lisboa)"
        }
      }
    ],
    "language": "en",
    "timezone": "Europe/Lisbon",
    "duration_minutes": 60,
    "instruction": "Select a time that works for you."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `slots` | array | Array of available time slots (typically 1 per call) |
| `slots[].id` | string | Unique slot identifier. Pass this back in `slot_selected` action. |
| `slots[].start` | string | ISO 8601 start time |
| `slots[].end` | string | ISO 8601 end time |
| `slots[].display` | object | Localized display strings keyed by language code |
| `language` | string | Current session language |
| `timezone` | string | IANA timezone (e.g., `"Europe/Lisbon"`) |
| `duration_minutes` | number | Slot duration in minutes (e.g., `60`) |
| `instruction` | string | Localized instruction text for the visitor |

**Frontend renders:** Clickable time slot cards/buttons. Use `slots[].display[language]` for the visible text. When the visitor selects a slot, send a structured action:

```json
{
  "action": {
    "type": "slot_selected",
    "payload": { "slot_id": "slot-1", "display": "Tuesday, March 4 at 10:00 AM (Lisbon)" }
  }
}
```

> **Tip:** Include the `display` field so the LLM can reference the slot naturally in its response.

### Type: `payment_request`

Presented when Justec requests the booking deposit. The backend creates payment sessions with both providers and returns their credentials.

```json
{
  "type": "payment_request",
  "payload": {
    "amount": 5000,
    "currency": "eur",
    "display_amount": "€50.00",
    "description": "Strategy session deposit — credited toward your first engagement",
    "providers": {
      "stripe": {
        "client_secret": "pi_xxx_secret_xxx",
        "publishable_key": "pk_live_xxx"
      },
      "paypal": {
        "approve_url": "https://www.paypal.com/checkoutnow?token=ORDER-ABC123",
        "order_id": "ORDER-ABC123",
        "client_id": "AaBbCcDd..."
      }
    },
    "booking_summary": {
      "date": "Thursday, March 6 at 2:00 PM (Lisbon)",
      "duration": "60 minutes",
      "with": "Hendrik Bondzio"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `amount` | number | Deposit amount in minor units (cents). 5000 = €50.00. |
| `currency` | string | ISO currency code (`eur`) |
| `display_amount` | string | Formatted amount for display (e.g., `"€50.00"`) |
| `description` | string | Payment description |
| `providers` | object | Available payment providers. Each key is present only if that provider is available. |
| `providers.stripe` | object \| absent | Stripe payment credentials |
| `providers.stripe.client_secret` | string | Stripe PaymentIntent client secret for embedded checkout |
| `providers.stripe.publishable_key` | string | Stripe publishable key |
| `providers.paypal` | object \| absent | PayPal payment credentials |
| `providers.paypal.approve_url` | string | PayPal approval redirect URL |
| `providers.paypal.order_id` | string | PayPal order ID |
| `providers.paypal.client_id` | string | PayPal client ID (for JS SDK initialization, may be absent) |
| `booking_summary` | object | Summary of the appointment being booked |
| `booking_summary.date` | string | Display date of the booking (localized) |
| `booking_summary.duration` | string | Duration display (e.g., `"60 minutes"`) |
| `booking_summary.with` | string | Name of the person the meeting is with |

**Frontend renders:** A styled payment card with booking summary and payment options:
- **Stripe**: Use the `client_secret` and `publishable_key` with Stripe.js for embedded checkout, or redirect to Stripe Checkout
- **PayPal**: Open `approve_url` (redirect to PayPal) or use the PayPal JS SDK with `client_id` and `order_id`

After payment, the visitor is redirected back (see [Section 14: Payment Flow](#14-payment-flow--webhooks)).

### Type: `phone_request`

When Justec asks for a mobile number (typically at booking time).

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

| Field | Type | Description |
|-------|------|-------------|
| `language` | string | Current session language |
| `prompt` | string | Localized prompt text for the phone input |
| `preferred_messenger` | string | Preferred messaging platform (e.g., `"WhatsApp"`) — display as hint |
| `placeholder` | string | Localized placeholder for the phone input field |

**Frontend renders:** A phone input field with the `placeholder` text, a label using `prompt`, and optionally a note about the `preferred_messenger`. When submitted:

```json
{
  "action": {
    "type": "phone_submitted",
    "payload": { "phone": "+491701234567" }
  }
}
```

### Type: `booking_confirmed`

Sent when a booking is successfully completed — either directly via calendar tool or after payment webhook fires.

**From calendar tool (direct booking):**

```json
{
  "type": "booking_confirmed",
  "payload": {
    "event_id": "abc123",
    "slot": {
      "id": "slot-1",
      "start": "2026-03-04T10:00:00+00:00",
      "end": "2026-03-04T11:00:00+00:00",
      "display": {
        "en": "Tuesday, March 4 at 10:00 AM (Lisbon)",
        "de": "Dienstag, 4. März um 10:00 Uhr (Lissabon)",
        "pt": "Terça-feira, 4 de março às 10:00 (Lisboa)"
      }
    },
    "visitor_name": "Marcus"
  }
}
```

**From payment webhook (after successful payment):**

```json
{
  "type": "booking_confirmed",
  "payload": {
    "date": "Thursday, March 6 at 2:00 PM (Lisbon)",
    "slot_start": "2026-03-06T14:00:00+00:00",
    "slot_end": "2026-03-06T15:00:00+00:00",
    "duration": "60 minutes",
    "with": "Hendrik Bondzio",
    "payment_provider": "stripe",
    "deposit_amount": 5000,
    "currency": "eur",
    "display_amount": "€50.00",
    "deposit_credited": "Deposit will be credited toward your first engagement"
  }
}
```

**Frontend renders:** A confirmation card with a checkmark, booking details, and payment summary (if from payment flow).

> **Note:** The two `booking_confirmed` shapes have different fields. The frontend should handle both: check for `slot` (direct booking) or `slot_start` (payment flow) to determine the variant.

### Type: `consent_request` (Removed)

> **Removed in v0.5.2.** Consent is now handled exclusively at session creation via the `consent_request` and `post_consent` fields in the `POST /api/session` response. The backend no longer emits `consent_request` as a structured message during the conversation. See [Section 4](#4-session-initiation) and [Section 10](#10-gdpr-consent).

### Type: `conversation_end`

Emitted when the conversation is forcibly ended — either by security guard termination or budget exhaustion. This appears alongside `session_terminated` or `budget_exhausted` events.

```json
{
  "type": "conversation_end",
  "payload": {
    "reason": "security",
    "message": "If you'd like to reach us, you can call our office.",
    "show_contact": true,
    "phone": "+351 XXX XXX XXX"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `reason` | string | `"security"` or `"budget_exhausted"` |
| `message` | string | Localized end-of-conversation message |
| `show_contact` | boolean | Whether to display contact information |
| `phone` | string | Phone number for direct contact |

**Frontend renders:** A conversation-ended card with the message and (if `show_contact` is true) the phone number as a clickable `tel:` link.

---

## 9. Budget & Rate Limit Signals

### Token Budget Tiers

The token budget increases as the session progresses:

| Tier | Budget (tokens) | Trigger |
|------|----------------|---------|
| `anonymous` | 30,000 | Session created, no messages yet |
| `engaged` | 60,000 | After 2+ messages sent |
| `qualified` | 150,000 | Tier escalated to meeting_room |
| `post_booking` | 300,000 | After payment completed |

### In-Stream Budget Warning

When the session drops below 15% of its token budget remaining, a warning is sent via SSE:

```
event: budget_warning
data: {"tokens_remaining": 4500, "budget_total": 30000, "message": "approaching_limit"}
```

The frontend may show a subtle indicator. This is primarily for the frontend to prepare graceful degradation — Justec's next response will naturally wrap up the conversation.

### Budget Exhausted

When the budget is fully consumed:

```
event: budget_exhausted
data: {"tokens_used": 30012, "budget_total": 30000}
```

This is immediately followed by a `conversation_end` structured message (see [Section 8](#type-conversation_end)) and then `stream_end`. After this, further message requests will receive a 429 response.

### Rate Limit Headers

Every message response includes rate limit headers:

```
X-RateLimit-Remaining: 11
X-RateLimit-Limit: 15
X-RateLimit-Reset: 1709042400
```

| Header | Description |
|--------|-------------|
| `X-RateLimit-Remaining` | Messages remaining in current window |
| `X-RateLimit-Limit` | Per-session message limit (default: 15) |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the limit resets |

---

## 10. GDPR Consent

### Consent Flow

1. **Session creation**: The `POST /api/session` response includes `greeting`, `consent_request`, and `post_consent`. The greeting text leads naturally into the consent ("...a quick formality:"). The frontend renders the greeting message followed by the consent banner/card. **Chat input should be blocked until consent is resolved.**
2. **Consent decision**: When the visitor accepts or declines, the frontend calls `POST /api/session/:id/consent`.
3. **After consent — accepted**: The frontend renders `post_consent.accepted` as Justec's next message and enables chat input. The conversation begins.
4. **After consent — declined**: The frontend renders `post_consent.declined` as Justec's final message. **Chat input stays disabled.** The site relies on third-party services (Google Fonts, Cloudflare) that require consent — without it, the visitor cannot use the site. The message is a polite closure.

> **Note**: Consent is handled exclusively at session creation. The backend does **not** emit a `consent_request` structured message during the conversation. The frontend must render the consent banner from the session creation response before enabling chat.

### `POST /api/session/:id/consent`

#### Request

```json
{
  "consent": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `consent` | boolean | Yes | `true` = consented, `false` = declined |

#### Response (200)

```json
{
  "status": "ok",
  "consent": true,
  "mode": "full"
}
```

| `mode` Value | Meaning |
|-------------|---------|
| `"full"` | Consent granted. Full features: conversation logging, behavioral fingerprint. |
| `"stateless"` | Consent declined. No persistence. Conversation not logged. Session data deleted on close. |

#### Error Responses

```json
{
  "error": "invalid_request",
  "message": "consent must be a boolean"
}
```

### Backend Behavior by Consent State

| Feature | Consented | Declined |
|---------|-----------|---------|
| Chat enabled | Yes | **No** — site requires consent for third-party services |
| Conversation logged to SQLite | Yes | No |
| Trello card created (if qualified) | Yes | No |
| Qualification scoring | Yes | No |
| Booking still possible | Yes | No |

---

## 11. Language Switching

The frontend detects the visitor's language at session creation. From that point, language can change in two ways:

### Implicit: Visitor Types in a Different Language

The LLM detects the language switch and responds naturally. The backend updates the session language via the `report_signals` tool. No API call needed.

### Explicit: Visitor Uses the Language Switcher

Use the dedicated endpoint (recommended) to switch without triggering an LLM response:

### `POST /api/session/:id/language`

#### Request

```json
{
  "language": "de"
}
```

#### Response (200)

```json
{
  "status": "ok",
  "language": "de",
  "greeting": "Guten Tag und willkommen bei Surfstyk Limited. Ich bin Justec, Hendriks persönliche Assistentin. Wie kann ich Ihnen heute behilflich sein?"
}
```

This updates the session language and returns the greeting in the new language (for the frontend to optionally re-render the initial greeting). Does NOT trigger an LLM call or create a message in the conversation history.

#### Error Responses

```json
{
  "error": "invalid_request",
  "message": "language must be one of: en, de, pt"
}
```

**Valid language codes:** `en`, `de`, `pt`

---

## 12. Session Persistence

### POC Approach (No Returning Visitors)

For the POC, sessions are not persisted across browser sessions:
- Session ID is stored in `sessionStorage` (cleared when tab closes)
- If the visitor refreshes the page, a new session is created
- The greeting is re-rendered (no "welcome back")

### Session Reconnection (Same Tab)

If the SSE connection drops mid-conversation (network hiccup), the frontend can reconnect:

### `GET /api/session/:id/status`

Returns the current session status. If the session is still active, the frontend can resume by sending the next message normally. Conversation history is server-side.

#### Response (200)

```json
{
  "session_id": "a1b2c3d4-...",
  "status": "active",
  "tier": "lobby",
  "messages_count": 4,
  "last_message_role": "justec",
  "consent": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Session UUID |
| `status` | string | `"active"` or `"queued"` (closed sessions return 410 before reaching this endpoint) |
| `tier` | string | `"lobby"` or `"meeting_room"` |
| `messages_count` | number | Total messages in conversation |
| `last_message_role` | string \| null | Role of the last message (`"visitor"` or `"justec"`). `null` if no messages yet. |
| `consent` | boolean | Whether consent has been granted |

### `GET /api/session/:id/history`

If the frontend needs to re-render the conversation after reconnection:

#### Response (200)

```json
{
  "messages": [
    {
      "role": "justec",
      "content": "Guten Tag und willkommen bei Surfstyk Limited...",
      "timestamp": "2026-02-26T14:32:00Z",
      "structured": []
    },
    {
      "role": "visitor",
      "content": "Ich leite ein Logistikunternehmen mit ca. 200 Mitarbeitern...",
      "timestamp": "2026-02-26T14:32:45Z",
      "structured": []
    },
    {
      "role": "justec",
      "content": "Das ist ein Bereich, in dem wir besonders viel Erfahrung haben...",
      "timestamp": "2026-02-26T14:33:02Z",
      "structured": [
        {
          "type": "calendar_slots",
          "payload": {
            "slots": [
              {
                "id": "slot-1",
                "start": "2026-03-04T10:00:00+00:00",
                "end": "2026-03-04T11:00:00+00:00",
                "display": { "de": "Dienstag, 4. März um 10:00 Uhr (Lissabon)" }
              }
            ],
            "language": "de",
            "timezone": "Europe/Lisbon",
            "duration_minutes": 60,
            "instruction": "Wählen Sie eine passende Zeit aus."
          }
        }
      ]
    },
    {
      "role": "visitor",
      "action": { "type": "slot_selected", "payload": { "slot_id": "slot-1" } },
      "content": null,
      "timestamp": "2026-02-26T14:33:15Z",
      "structured": []
    }
  ]
}
```

**Key points for history replay:**
- Every message has a `structured` array (empty `[]` if no structured content). The frontend re-renders each structured message type as the appropriate UI component.
- Visitor messages that were **structured actions** (slot selection, phone submission) have `action` set and `content: null`. The frontend renders these as the visitor's action (e.g., "Selected: Tuesday, March 4 at 10:00 AM").
- Visitor messages that were **text** have `content` set and no `action` field.
- Calendar slots in history replay should render as **non-interactive** (already selected or expired).
- Payment requests in history should show the final state (confirmed/pending/expired), not a live checkout button.

---

## 13. Conversation Termination

### Termination Sources

| Source | Trigger | Signal |
|--------|---------|--------|
| **Security guard** | Guard level reaches 3 (terminate) or 4 (block) | SSE `session_terminated` + `conversation_end` events |
| **Budget exhausted** | Token budget consumed | SSE `budget_exhausted` + `conversation_end` events, then 429 on next request |
| **Session timeout** | 60 minutes of inactivity | Session expires server-side |
| **Visitor leaves** | Tab close / navigate away | Frontend sends `POST /close` |

### SSE Event: `session_terminated`

For security guard termination (Level 3 or 4):

```
event: processing
data: {}

event: token
data: {"text": "I don't think I'm able to help you today. If you'd like to reach us, you can call our office. Take care."}

event: session_terminated
data: {"reason": "security", "guard_level": 3, "message": "I don't think I'm able to help you today. If you'd like to reach us, you can call our office. Take care."}

event: structured_message
data: {"type": "conversation_end", "payload": {"reason": "security", "message": "...", "show_contact": true, "phone": "+351 XXX XXX XXX"}}

event: stream_end
data: {}
```

| Field | Type | Description |
|-------|------|-------------|
| `reason` | string | Always `"security"` |
| `guard_level` | number | The guard level that triggered termination (3 or 4) |
| `message` | string | The canned termination message (localized to session language) |

**Frontend behavior on `session_terminated`:**
1. Display Justec's final message (already streamed via `token` events)
2. Render the `conversation_end` structured message (contact info)
3. Disable the input field
4. Show a "Session ended" indicator
5. Optionally show a "Start New Conversation" button (but NOT if `guard_level` is 4 — hard block means the IP is blocked)

**Canned termination messages by language:**
- **en**: "I don't think I'm able to help you today. If you'd like to reach us, you can call our office. Take care."
- **de**: "Ich glaube, ich kann Ihnen heute leider nicht weiterhelfen. Wenn Sie uns erreichen möchten, können Sie uns telefonisch kontaktieren. Alles Gute."
- **pt**: "Infelizmente, não creio que possa ajudá-lo hoje. Se desejar contactar-nos, pode ligar para o nosso escritório. Cuide-se."

### `POST /api/session/:id/close`

Frontend calls this when the visitor navigates away or closes the tab. This is a cleanup signal — the backend marks the session as closed and frees resources.

**Why POST, not DELETE:** `navigator.sendBeacon()` — the most reliable way to fire a request on page unload — only supports POST. Using POST ensures session cleanup happens even when the visitor closes the tab abruptly.

```javascript
// Frontend: on page unload
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon(
    `/api/session/${sessionId}/close`,
    JSON.stringify({ reason: 'visitor_left' })
  );
});
```

#### Request

Accepts both `application/json` and `text/plain` Content-Type (sendBeacon compatibility).

```json
{
  "reason": "visitor_left"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Optional close reason. Defaults to `"visitor_left"`. |

#### Response (200)

```json
{
  "status": "closed",
  "reason": "visitor_left"
}
```

> **Note:** This endpoint is graceful — it returns 200 even if the session is already closed or not found.

---

## 14. Payment Flow & Webhooks

### Payment Flow Overview

1. LLM triggers `request_payment` tool → backend creates Stripe PaymentIntent + PayPal order
2. Backend emits `payment_request` structured message with provider credentials
3. Frontend renders payment card → visitor initiates payment → completes via Stripe embedded checkout or PayPal redirect
4. Visitor completes payment
5. Provider sends webhook to backend → backend creates calendar event, updates Trello, sends Telegram notification
6. Visitor returns to chat page (PayPal redirect via `/api/paypal/return`, or Stripe redirect via configured success URL)
7. Booking confirmation is pushed into session history for reconnection

### Stripe Payment Flow

The `payment_request` structured message includes Stripe's `client_secret` and `publishable_key`. The frontend can:
- Use Stripe.js embedded checkout with the client secret
- Or redirect to a Stripe-hosted checkout page

After payment, Stripe redirects to the configured success URL (e.g., `https://surfstyk.com/chat?payment=success&session_id={session_id}`). On cancellation, redirects to the cancel URL.

### PayPal Payment Flow

The `payment_request` structured message includes PayPal's `approve_url`. The frontend redirects the visitor to this URL. After approval, PayPal redirects to:

### `GET /api/paypal/return`

This endpoint captures the PayPal order and redirects the visitor back to the chat.

| Query Parameter | Description |
|----------------|-------------|
| `token` | PayPal order ID |
| `session_id` | Session ID (optional, for context) |

**Redirects to:**
- Success: `{configured_base_url}?payment=success&session_id={session_id}`
- Failure: `{configured_base_url}?payment=cancelled&session_id={session_id}`

### `POST /api/webhooks/stripe`

Receives Stripe webhook events. Verified using Stripe's webhook signature.

**Required Headers:**
- `stripe-signature`: Stripe webhook signature

**Handled events:**
- `checkout.session.completed` — Payment successful. Triggers: calendar event creation, Trello card update, Telegram notification, booking confirmation in session history.
- `checkout.session.expired` — Payment abandoned. Updates payment status.

**Response (200):**
```json
{
  "received": true
}
```

**Error Responses:**
- `400 { error: "Missing stripe-signature header" }`
- `400 { error: "Invalid signature" }`

### `POST /api/webhooks/paypal`

Receives PayPal webhook events.

**Handled events:**
- `CHECKOUT.ORDER.APPROVED` — Payment approved. Triggers capture + confirmation flow.

**Response (200):**
```json
{
  "received": true
}
```

### Webhook Security

| Provider | Verification Method |
|----------|-------------------|
| Stripe | `stripe.webhooks.constructEvent()` with endpoint secret |
| PayPal | Webhook signature verification via PayPal API headers |

Webhook endpoints do NOT require the session ID header. They are authenticated by the payment provider's signature.

---

## 15. Health & Status

### `GET /api/health`

Public health check endpoint (no authentication).

#### Response (200)

```json
{
  "status": "ok",
  "version": "0.1.0",
  "active_sessions": 0,
  "queue_length": 0,
  "uptime_seconds": 86400
}
```

### `GET /api/health/detailed`

Detailed health check (restricted to localhost — for monitoring scripts only).

#### Response (200)

```json
{
  "status": "ok",
  "version": "0.1.0",
  "active_sessions": 0,
  "queue_length": 0,
  "uptime_seconds": 86400,
  "llm": {
    "provider": "google",
    "model": "gemini-3-flash-preview",
    "last_call_ms": null,
    "errors_last_hour": 0
  },
  "database": {
    "status": "ok"
  }
}
```

#### Response — Forbidden (403)

If accessed from a non-localhost IP:

```json
{
  "error": "forbidden",
  "message": "Detailed health is localhost only"
}
```

---

## 16. Error Handling

### Error Response Format

All non-SSE error responses follow a consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

### Error Codes

| HTTP Status | Error Code | Meaning | Frontend Action |
|-------------|------------|---------|-----------------|
| 400 | `invalid_request` | Malformed request body or invalid parameters | Show generic error |
| 403 | `verification_failed` | Turnstile token invalid | Show "refresh and try again" |
| 403 | `blocked` | IP is hard-blocked (guard level 4) | Show "session ended", disable all interaction |
| 404 | `session_not_found` | Session ID doesn't exist or expired | Start new session |
| 410 | `session_closed` | Session was terminated | Show final message, disable input |
| 429 | `rate_limited` | Too many requests or token budget exhausted | Show "please wait", use `retry_after_seconds` |
| 500 | `internal_error` | Server error | Show "something went wrong", offer retry |

### In-Stream Errors

LLM errors are delivered as SSE events within the stream (not as HTTP error status codes):

```
event: error
data: {"code": "llm_error", "message": "We're experiencing a technical issue. Please try again."}

event: stream_end
data: {}
```

| SSE Error Code | Meaning |
|----------------|---------|
| `llm_error` | LLM provider returned an error |
| `internal_error` | Server error during stream processing |

### Retry Strategy

The frontend should implement exponential backoff for retriable errors (500):
- First retry: 1 second
- Second retry: 3 seconds
- Third retry: give up and show error with phone number fallback

For 429 errors, use the `retry_after_seconds` value from the response.

---

## 17. SSE Event Reference

Complete catalog of all Server-Sent Events emitted by the message endpoint.

### Response Events (during message streaming)

| Event | Data Schema | Description | Frontend Action |
|-------|------------|-------------|-----------------|
| `processing` | `{}` | Request received, LLM processing starting | Show typing indicator (three pulsing dots) |
| `token` | `{"text": "..."}` | A text token in Justec's response | Hide typing indicator (on first token), append to displayed message |
| `message_complete` | `{"tokens_used": N, "session_tokens_remaining": N}` | End of Justec's text response | Finalize message display |
| `structured_message` | `{"type": "...", "payload": {...}}` | Rich UI component (see Section 8) | Render appropriate component |
| `tier_change` | `{"from": "...", "to": "...", "score": N}` | Qualification tier changed | Log for analytics (no visible change in POC) |
| `budget_warning` | `{"tokens_remaining": N, "budget_total": N, "message": "approaching_limit"}` | Approaching token budget limit | Optional: show subtle indicator |
| `budget_exhausted` | `{"tokens_used": N, "budget_total": N}` | Token budget consumed | Prepare for conversation wrap-up |
| `session_terminated` | `{"reason": "security", "guard_level": N, "message": "..."}` | Session forcibly ended by security guard | Display message, disable input |
| `error` | `{"code": "...", "message": "..."}` | Error during streaming | Show error, offer retry |
| `stream_end` | `{}` | **Terminal event.** Stream is complete. | Stop reading. Close reader. Re-enable input. |

### Structured Message Types

| Type | When | Section |
|------|------|---------|
| `calendar_slots` | Justec offers booking times (tool call) | [Section 8](#type-calendar_slots) |
| `payment_request` | Justec requests booking deposit (tool call) | [Section 8](#type-payment_request) |
| `phone_request` | Justec asks for phone number (tool call) | [Section 8](#type-phone_request) |
| `booking_confirmed` | Booking completed — direct or post-payment (tool call / webhook) | [Section 8](#type-booking_confirmed) |
| `conversation_end` | Session terminated by security or budget exhaustion (automatic) | [Section 8](#type-conversation_end) |

### Event Ordering (Typical Message)

```
1. event: processing              (immediate — before LLM call)
2. event: token                   (repeated for each token)
3. event: token
4. ...
5. event: structured_message      (0 or more, mid-stream when tools produce UI data)
6. event: token                   (LLM continues after tool calls)
7. ...
8. event: message_complete
9. event: budget_exhausted        (0 or 1, if budget consumed)
10. event: structured_message      (0 or 1, conversation_end — if budget exhausted)
11. event: budget_warning          (0 or 1, if approaching limit — mutually exclusive with exhausted)
12. event: tier_change             (0 or 1, if score threshold crossed)
13. event: stream_end              (ALWAYS last — frontend stops reading here)
```

> **Note:** Tool-triggered `structured_message` events (calendar_slots, phone_request, payment_request, booking_confirmed) appear mid-stream between token events. Metadata `structured_message` events (`conversation_end`) appear after `message_complete`.

**Guaranteed:** `stream_end` is ALWAYS emitted, even on errors or termination. The sequence is always: `processing` → [content] → `stream_end`. The frontend can rely on `stream_end` to know when to re-enable the input field and stop the reader.

### Error Stream

If an error occurs during LLM processing:

```
event: processing
data: {}

event: error
data: {"code": "llm_error", "message": "We're experiencing a technical issue. Please try again."}

event: stream_end
data: {}
```

### Security Termination Stream

```
event: processing
data: {}

event: token
data: {"text": "I don't think I'm able to help you today..."}

event: session_terminated
data: {"reason": "security", "guard_level": 3, "message": "I don't think I'm able to help you today..."}

event: structured_message
data: {"type": "conversation_end", "payload": {"reason": "security", "message": "...", "show_contact": true, "phone": "+351 XXX XXX XXX"}}

event: stream_end
data: {}
```

### Budget Exhaustion Stream

```
event: processing
data: {}

event: token
data: {"text": "..."}

event: message_complete
data: {"tokens_used": 350, "session_tokens_remaining": 0}

event: budget_exhausted
data: {"tokens_used": 30012, "budget_total": 30000}

event: structured_message
data: {"type": "conversation_end", "payload": {"reason": "budget_exhausted", "message": "...", "show_contact": true, "phone": "+351 XXX XXX XXX"}}

event: stream_end
data: {}
```

### SSE Connection Management

- The SSE connection is **per-message** (not persistent). Each `POST /api/session/:id/message` opens a new SSE stream that closes after `stream_end`.
- The frontend MUST stop reading on `stream_end`. The HTTP response body closes immediately after this event.
- If the connection drops mid-stream (before `stream_end`), the frontend should show what was received so far, re-enable input, and allow the visitor to send a new message (the backend will generate a fresh response with full context).
- There is no `Last-Event-ID` replay mechanism. If needed, the frontend can call `GET /api/session/:id/history` to reconstruct state.

---

## Appendix: Frontend Implementation Notes

These are non-normative suggestions for the frontend team based on the API design.

### Recommended Fetch Pattern (Text Message)

```typescript
async function sendMessage(sessionId: string, text: string, behavioral: BehavioralSignals) {
  const response = await fetch(`/api/session/${sessionId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ text, behavioral }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new APIError(error);
  }

  await processSSEStream(response);
}
```

### Recommended Fetch Pattern (Structured Action)

```typescript
async function sendAction(sessionId: string, type: string, payload: object, behavioral: BehavioralSignals) {
  const response = await fetch(`/api/session/${sessionId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ action: { type, payload }, behavioral }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new APIError(error);
  }

  await processSSEStream(response);
}
```

### SSE Stream Processing

```typescript
async function processSSEStream(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEBuffer(buffer);
    // buffer retains any incomplete event

    for (const event of events) {
      switch (event.type) {
        case 'processing':
          showTypingIndicator();
          break;
        case 'token':
          hideTypingIndicator();  // on first token
          appendToken(event.data.text);
          break;
        case 'structured_message':
          renderStructuredMessage(event.data);
          break;
        case 'message_complete':
          finalizeMessage(event.data);
          break;
        case 'tier_change':
          logAnalytics('tier_change', event.data);
          break;
        case 'budget_warning':
          showBudgetWarning(event.data);
          break;
        case 'budget_exhausted':
          handleBudgetExhausted(event.data);
          break;
        case 'session_terminated':
          handleTermination(event.data);
          break;
        case 'stream_end':
          enableInput();
          reader.cancel();  // done reading
          return;
        case 'error':
          handleStreamError(event.data);
          break;
      }
    }
  }
}
```

### Structured Message Rendering

```typescript
function renderStructuredMessage(data: { type: string; payload: any }) {
  switch (data.type) {
    case 'calendar_slots':
      renderCalendarSlots(data.payload);
      break;
    case 'payment_request':
      renderPaymentCard(data.payload);
      break;
    case 'phone_request':
      renderPhoneInput(data.payload);
      break;
    case 'booking_confirmed':
      renderBookingConfirmation(data.payload);
      break;
    case 'consent_request':
      renderConsentBanner(data.payload);
      break;
    case 'conversation_end':
      renderConversationEnd(data.payload);
      break;
  }
}
```

### Action Helpers

```typescript
// Calendar slot selected
function selectSlot(slotId: string, display: string) {
  sendAction(sessionId, 'slot_selected', { slot_id: slotId, display }, collectBehavioral());
}

// Phone number submitted
function submitPhone(phone: string) {
  sendAction(sessionId, 'phone_submitted', { phone }, collectBehavioral());
}

// GDPR consent (use dedicated endpoint)
async function respondConsent(consented: boolean) {
  await fetch(`/api/session/${sessionId}/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
    body: JSON.stringify({ consent: consented }),
  });
}

// Language switch (use dedicated endpoint)
async function switchLanguage(language: 'en' | 'de' | 'pt') {
  const res = await fetch(`/api/session/${sessionId}/language`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
    body: JSON.stringify({ language }),
  });
  const data = await res.json();
  // Optionally re-render greeting with data.greeting
}
```

### Session Lifecycle

```typescript
// 1. Create session on page load (immediately)
const session = await createSession(language, turnstileToken, referrer);
sessionStorage.setItem('justec_session_id', session.session_id);

// 2. Display greeting + consent (pre-rendered, no LLM call)
displayMessage('justec', session.greeting.text);
renderConsentBanner(session.consent_request);
disableChatInput(); // Block input until consent is resolved

// 3. On consent response
async function handleConsent(accepted: boolean) {
  await respondConsent(accepted);
  if (accepted) {
    displayMessage('justec', session.post_consent.accepted);
    enableChatInput();
  } else {
    displayMessage('justec', session.post_consent.declined);
    // Chat stays disabled — site requires consent for third-party services
  }
}

// 4. On visitor text message
await sendMessage(session.session_id, text, behavioral);

// 4. On visitor structured action (slot click, phone submit, etc.)
await sendAction(session.session_id, actionType, payload, behavioral);

// 5. On payment return (check URL params)
const params = new URLSearchParams(window.location.search);
if (params.get('payment') === 'success') {
  const sid = params.get('session_id');
  // Restore session, show confirmation
}

// 6. On tab close / navigate away
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon(
    `/api/session/${sessionId}/close`,
    JSON.stringify({ reason: 'visitor_left' })
  );
});
```

---

*This document is the contract between the frontend and backend teams. Changes to this spec require agreement from both sides.*
