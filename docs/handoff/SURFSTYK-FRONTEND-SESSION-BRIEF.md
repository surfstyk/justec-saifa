# Session Brief — surfstyk.com Frontend: Justec Virtual Front Desk

**Purpose**: Build the chat UI for the Justec Virtual Front Desk on surfstyk.com
**Created by**: Claw Father (surfjust-0001) — handoff to the frontend build session
**Date**: 2026-02-26

---

## What You're Building

A full-viewport chat interface on surfstyk.com that lets website visitors talk to Justec, Hendrik's AI assistant. The chat occupies the hero section (100dvh). Below the fold, the existing site content remains.

This is the **frontend only**. A separate team is building the backend middleware (`justec-public-api` — Node.js, runs on the same server at port 3100). You build against the API spec.

### What It Is NOT

- Not a chatbot widget in the corner of the page
- Not a third-party embed
- Not a separate page — it replaces the current hero section
- Not a backend project — you don't touch LLMs, scoring, or session logic

---

## Your Primary Reference: The API Specification

**The contract between you and the backend is:**

`/Users/hendrikbondzio/Documents/projects/claw-god/agents/surfjust-0001/docs/architecture/PUBLIC-JUSTEC-API-SPEC.md`

This is v0.2.0. Read it fully before starting. It defines every endpoint, every SSE event, every structured message type, and includes TypeScript implementation examples in the appendix.

**Supporting documents** (read for context, not for implementation):

| Document | Path | Why Read It |
|----------|------|-------------|
| **Framework** | `.../surfjust-0001/docs/JUSTEC-VIRTUAL-FRONT-DESK-FRAMEWORK.md` | Section 10 (UX/UI Design Principles) has the visual spec, message bubble styling, scroll behavior, mobile handling. Read this section. |
| **Architecture** | `.../surfjust-0001/docs/architecture/PUBLIC-JUSTEC-ARCHITECTURE.md` | System context — how the pieces fit together. Skim Sections 1-3 for the big picture. |
| **Persona** | `.../surfjust-0001/docs/architecture/PUBLIC-JUSTEC-PERSONA.md` | Section 8 has the pre-rendered greetings in EN/DE/PT. Useful for mocking the UI before the backend is ready. |

All paths are relative to: `/Users/hendrikbondzio/Documents/projects/claw-god/agents/`

---

## The Existing Codebase

You're working in the surfstyk subproject of the lovable-migration workspace:

```
/Users/hendrikbondzio/Documents/Sites/lovable-migration/surfstyk/
```

### Current Stack

- React 18.3 + Vite 5 + TypeScript 5.8 + Tailwind CSS v3
- shadcn/ui (individual @radix-ui/* packages)
- React Router v6 + TanStack React Query v5
- GSAP (scroll animations)
- Lucide React icons, Sonner toasts
- ESLint 9, @vitejs/plugin-react-swc

### Current Site Structure

```
src/
├── App.tsx                          ← Router: "/" → Index, "*" → NotFound
├── pages/
│   ├── Index.tsx                    ← Main page (hero + sections)
│   └── NotFound.tsx
├── components/
│   ├── Header.tsx                   ← Site header
│   ├── HeroNetworkBackground.tsx    ← Animated background
│   ├── NavLink.tsx
│   ├── sections/
│   │   ├── HeroSection.tsx          ← REPLACE THIS with the chat UI
│   │   ├── PhilosophySection.tsx    ← Below-fold content (keep)
│   │   ├── AIAgentsSection.tsx      ← Below-fold content (keep)
│   │   ├── CaseStudiesSection.tsx   ← Below-fold content (keep)
│   │   ├── AboutSection.tsx         ← Below-fold content (keep)
│   │   ├── ContactSection.tsx       ← Below-fold content (keep)
│   │   └── index.ts
│   └── ui/                          ← shadcn/ui components (51 files)
├── hooks/
├── lib/
└── assets/
```

**Key insight**: `HeroSection.tsx` is what you're replacing. The below-fold sections stay. The `Index.tsx` page structure stays — you're swapping the hero, not rebuilding the page.

### Deploy Pipeline

```bash
npm run build                        # Vite → dist/
./deploy.sh surfstyk                 # rsync to /var/www/surfstyk.com/
```

CI/CD: GitHub Actions on push to main (`.github/workflows/deploy.yml`). ~50s.

---

## The Chat UI — What to Build

### Layout (Full Viewport Hero)

```
┌──────────────────────────────────────────┐ ─── viewport top
│  [Surfstyk Limited]       [🌐 EN ▼] [≡] │ ─── minimal header
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │  Justec:                           │  │
│  │  ┌──────────────────────────┐      │  │
│  │  │ Hello, welcome to        │      │  │
│  │  │ Surfstyk Limited. I'm    │      │  │
│  │  │ Hendrik's personal       │      │  │
│  │  │ assistant. How can I     │      │  │
│  │  │ help you today?          │      │  │
│  │  └──────────────────────────┘      │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Type your message...          [➤]  │  │
│  └────────────────────────────────────┘  │
│                                          │
│           ↓ scroll for more              │ ─── subtle scroll indicator
└──────────────────────────────────────────┘ ─── viewport bottom
│                                          │
│  ═══════ BELOW THE FOLD ═════════════   │
│  (existing sections remain unchanged)    │
└──────────────────────────────────────────┘
```

### Message Bubbles

| Element | Specification |
|---------|--------------|
| **Alignment** | Visitor: right, brand color. Justec: left, neutral/white. |
| **Max width** | 70-80% of chat container width |
| **Border radius** | 16-18px (iMessage-like) |
| **Font** | System font stack, 15-16px mobile, 14-15px desktop |
| **Timestamps** | NOT on every message. Grouped by time window. On hover/tap. |

### Streaming & Loading

| Element | Specification |
|---------|--------------|
| **Typing indicator** | Three pulsing dots in a ghost bubble. Show on `processing` SSE event. Hide on first `token` event. |
| **Streaming render** | Token-by-token via SSE. Progressive markdown rendering. |
| **New message animation** | 200ms ease-out slide-up |

### Scroll Behavior

| Element | Specification |
|---------|--------------|
| **Auto-scroll** | Only if user is within ~150px of bottom. Otherwise, show "New message" pill. |
| **During streaming** | Continuously scroll to latest, unless user scrolled up. |
| **Smooth scroll** | `scrollIntoView({ behavior: 'smooth', block: 'end' })` |

### Input Area

| Element | Specification |
|---------|--------------|
| **Type** | Single-line, auto-expanding (max ~4 lines, then internal scroll) |
| **Send** | `Enter` on desktop, `Shift+Enter` for newline. Mobile send button. |
| **Placeholder** | Language-appropriate: "Type your message..." / "Schreiben Sie eine Nachricht..." / "Escreva a sua mensagem..." |
| **Send button** | Only visible/active when input has content |
| **Focus** | Auto-focus on desktop. NOT on mobile (avoids keyboard popup) |
| **Disabled** | While streaming (re-enable on `stream_end`). When session terminated. |

### Language Switcher

Minimal dropdown in the header. Three languages: EN, DE, PT. When changed, send a `language_changed` action to the backend. The backend's next response will be in the new language.

### Mobile-First

| Challenge | Solution |
|-----------|----------|
| Virtual keyboard | `visualViewport` API + CSS `100dvh` + `position: fixed` container |
| iOS Safari address bar | `viewport-fit=cover` meta tag + safe area insets |
| Notch/Dynamic Island | `env(safe-area-inset-top)` for header, `env(safe-area-inset-bottom)` for input |
| Touch targets | Minimum 44x44px for all interactive elements |

### Branding

- Use Surfstyk's existing color palette, typography, visual language
- Logo in the minimal header, not inside the chat
- No "Powered by" badges
- Premium positioning: clean, minimal, confident

---

## Structured Message Components

The backend sends structured messages via SSE that require custom UI rendering. You need components for each type:

### 1. `calendar_slots` — Time Slot Picker

Renders clickable time slot cards. On click → send `slot_selected` action.

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
          "de": "Dienstag, 4. März um 10:00 Uhr (Lissabon)"
        }
      }
    ],
    "timezone": "Europe/Lisbon",
    "duration_minutes": 60,
    "instruction": "Select a time that works for you."
  }
}
```

### 2. `payment_request` — Payment Card

Renders booking summary + payment buttons. Stripe uses embedded checkout (Stripe.js with `client_secret` — the visitor never leaves the page). PayPal uses the PayPal JS SDK inline.

### 3. `payment_confirmed` — Confirmation Card

Checkmark + booking details + confirmation text.

### 4. `phone_request` — Phone Input

Phone input field with country code detection. On submit → send `phone_submitted` action.

### 5. `link` — Link Card

Styled link preview (title, description, URL) inline in the conversation.

### 6. `conversation_end` — End Card

Styled end-of-conversation message. Optionally disables input or shows "Start New Conversation."

### 7. `consent_request` — GDPR Consent

Woven into conversation flow. Accept/decline buttons. On click → send `consent_response` action.

---

## The SSE Streaming Pattern

Every message response is a Server-Sent Events stream. The lifecycle is always:

```
processing → token* → message_complete → [metadata events] → stream_end
```

`stream_end` is **guaranteed** — even on errors. Re-enable input on this event.

The API spec appendix has a complete TypeScript `processSSEStream()` implementation. Use it as your starting point.

### Key Implementation Details

- SSE connection is **per-message** (not persistent). Each POST opens a new stream.
- Hide typing indicator on first `token`, not on `message_complete`.
- If the connection drops mid-stream (before `stream_end`), show what you have, re-enable input.
- `structured_message` events come AFTER `message_complete` — they're appended after the text response.

---

## Behavioral Signals (Frontend Collects, Backend Scores)

The frontend collects behavioral data and sends it with every message. This is for bot detection and lead qualification — the backend uses it, you just collect it.

```typescript
interface BehavioralSignals {
  typing_duration_ms: number;      // Time from first keypress to send
  keypress_count: number;          // Total keypresses (incl. corrections)
  correction_count: number;        // Backspace/delete count
  time_since_last_message_ms: number;
  mouse_movement_detected: boolean;
  viewport_scroll_depth: number;   // 0.0 = top, 1.0 = bottom
}
```

This is lightweight — no heavy fingerprinting library. Just DOM event listeners.

---

## Session Lifecycle

```typescript
// 1. Page loads → create session immediately (no user action needed)
const session = await createSession(language, turnstileToken, referrer);

// 2. Display pre-rendered greeting (no LLM call, instant)
displayMessage('justec', session.greeting.text);

// 3. Visitor types → send message with behavioral signals
await sendMessage(session.session_id, text, behavioral);

// 4. Visitor clicks UI element → send structured action
await sendAction(session.session_id, 'slot_selected', { slot_id: 'slot-2' }, behavioral);

// 5. Tab close → fire-and-forget close
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon(`/api/session/${sessionId}/close`, JSON.stringify({ reason: 'visitor_left' }));
});
```

### Queued State

If the backend returns `status: "queued"` instead of `status: "active"`, poll `GET /api/session/:id/status` every **2 seconds** until active. Show a queue message to the visitor.

---

## Cloudflare Turnstile

Required on session creation. The Turnstile token proves the visitor isn't a bot. Invisible to humans — no CAPTCHA.

You need to integrate the [Turnstile client-side widget](https://developers.cloudflare.com/turnstile/). The token goes in the `POST /api/session` request body as `turnstile_token`.

---

## What You Can Build Before the Backend Is Ready

The backend middleware is being built in parallel. You can make progress immediately:

1. **Chat UI layout** — the full-viewport hero with message bubbles, input area, scroll behavior
2. **Message rendering** — text bubbles, streaming simulation, markdown rendering
3. **Structured message components** — calendar slots, payment card, phone input, link card (render from mock data)
4. **Behavioral signal collection** — the lightweight JS that tracks typing speed, mouse movement, etc.
5. **Language switcher** — header dropdown with EN/DE/PT
6. **Mobile responsiveness** — keyboard handling, safe area insets, touch targets
7. **Scroll indicator** — subtle animated chevron at bottom of hero viewport

**Mock the backend** by creating a local stub that returns the session creation response and simulates SSE streams with hardcoded tokens. The API spec has all the response formats.

### Mock Greetings (from the Persona doc)

**English:**
> "Good [morning/afternoon], and welcome to Surfstyk Limited. I'm Justec, Hendrik's personal assistant. How can I help you today?"

**German:**
> "Guten Tag und willkommen bei Surfstyk Limited. Ich bin Justec, Hendriks persönliche Assistentin. Wie kann ich Ihnen heute behilflich sein?"

**Portuguese:**
> "Boa [tarde], bem-vindo à Surfstyk Limited. Sou a Justec, assistente pessoal do Hendrik. Como posso ajudá-lo hoje?"

---

## Build Priority

1. **Chat layout + message bubbles** — hero section replacement, bubble styling, scroll behavior
2. **Input area** — auto-expanding, send on enter, mobile keyboard handling
3. **SSE stream consumer** — connect to backend, process events, render tokens progressively
4. **Typing indicator** — pulsing dots, show on `processing`, hide on first `token`
5. **Structured message components** — calendar slots, phone input, payment card, link card, consent, conversation end
6. **Behavioral signal collection** — lightweight DOM event tracking
7. **Language switcher** — header dropdown + `language_changed` action
8. **Turnstile integration** — invisible bot check on session creation
9. **Queue handling** — queued state UI + polling
10. **Payment integration** — Stripe embedded checkout + PayPal JS SDK inline
11. **Session close** — `sendBeacon` on `beforeunload`

Steps 1-4 get you a working chat. Steps 5-7 get you the full experience. Steps 8-11 are integration polish.

---

## Coordination

- **Backend API** runs at `https://surfstyk.com/api` (Caddy reverse proxies to localhost:3100)
- **For local dev**, proxy `/api` to the backend dev server or use mocks
- **If the API spec needs changes**, tell Hendrik — the backend team owns the spec
- **Notifications channel**: The backend sends booking/lead notifications to Hendrik via Telegram. You don't need to handle this.
- **No CRM integration** on your side. The backend handles Trello, Google Calendar, etc.

---

## Key Decisions Already Made

- Session creates on **page load** (not first message)
- Tier transition is **seamless** (invisible to visitor — no UI change)
- Stripe uses **embedded checkout** (not redirect)
- Queue polling is **2 seconds** (not 5)
- `POST /close` for session end (not DELETE — for `sendBeacon` compatibility)
- Typed `action` field for UI interactions (not magic strings in text)
- `stream_end` is the terminal SSE event — always emitted, always last
