# Public Justec — System Architecture

**Project**: Justec Virtual Front Desk
**Owner**: Agent/Backend Team (Claw Father — surfjust-0001)
**Version**: v0.1.0
**Date**: 2026-02-26
**Status**: Draft — Pending Approval
**Companion Documents**: [Framework](../JUSTEC-VIRTUAL-FRONT-DESK-FRAMEWORK.md) | [API Spec](./PUBLIC-JUSTEC-API-SPEC.md) | [Persona](./PUBLIC-JUSTEC-PERSONA.md)

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.1.0 | 2026-02-26 | Initial draft — architecture, component model, feasibility assessment |

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Component Model](#2-component-model)
3. [System Architecture](#3-system-architecture)
4. [Middleware Design](#4-middleware-design)
5. [Google Workspace Bridge](#5-google-workspace-bridge)
6. [Lead Management (Trello)](#6-lead-management-trello)
7. [LLM Adapter Layer](#7-llm-adapter-layer)
8. [Model Routing & Tier Transitions](#8-model-routing--tier-transitions)
9. [Qualification Scoring Engine](#9-qualification-scoring-engine)
10. [Session Management](#10-session-management)
11. [Security Architecture](#11-security-architecture)
12. [Payment Integration](#12-payment-integration)
13. [Notification Flow](#13-notification-flow)
14. [Infrastructure & Deployment](#14-infrastructure--deployment)
15. [Data Model](#15-data-model)
16. [Productization Path](#16-productization-path)
17. [Feasibility Assessment](#17-feasibility-assessment)
18. [Cost Projections](#18-cost-projections)
19. [Risk Register](#19-risk-register)

---

## 1. Design Principles

1. **Model agnostic.** The system abstracts the LLM provider. Switching from Gemini to Claude to OpenAI is a config change, not a code change.
2. **Component-based.** Every piece is reusable. A future client with an OpenClaw PA can add the public persona as a service.
3. **Google Workspace is the bridge.** Private Justec (Telegram PA) and public Justec (website chat) share awareness through Google Calendar, Sheets, and Gmail. No direct integration between the two systems.
4. **No new platforms unless unavoidable.** Google Calendar for scheduling (not Cal.com, not Calendly). Trello for lead management (not HubSpot). Stripe + PayPal for payments. Everything else is custom.
5. **Cost control by design.** Unqualified visitors cost near-zero. The tiered architecture is the cost strategy.
6. **Seamless experience.** Tier transitions (Lobby → Meeting Room) are invisible to the visitor. The quality elevates; the UI doesn't change.
7. **Security is layered.** Five layers: perimeter, behavioral, prompt, budget, guard. Each layer operates independently.
8. **POC-first, productize later.** Build for Surfstyk. Generalize after validation.

---

## 2. Component Model

The system consists of four reusable components. Each is independently deployable and configurable per client.

```
┌─────────────────────────────────────────────────────────────┐
│                    COMPONENT MODEL                           │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  CHAT UI    │  │ PUBLIC       │  │ OPENCLAW PA      │  │
│  │  FRONTEND   │  │ PERSONA API  │  │ (Private)        │  │
│  │             │  │ (Middleware)  │  │                  │  │
│  │  React SPA  │  │  Node.js     │  │  Existing agent  │  │
│  │  Per-client │  │  Per-client  │  │  Per-client      │  │
│  │  branding   │  │  config      │  │  Telegram/cron   │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                │                    │             │
│         │    REST + SSE  │                    │             │
│         └───────────────►│                    │             │
│                          │                    │             │
│                    ┌─────┴────────────────────┴──────┐     │
│                    │     WORKSPACE BRIDGE             │     │
│                    │     (Google Workspace / Trello)  │     │
│                    │                                  │     │
│                    │  Shared data layer:              │     │
│                    │  • Google Calendar (r/w)         │     │
│                    │  • Google Sheets (r/w)           │     │
│                    │  • Trello Board (r/w)            │     │
│                    │  • Gmail (read-only)             │     │
│                    └─────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Reuse Story |
|-----------|---------------|-------------|
| **Chat UI Frontend** | Full-viewport chat interface, streaming render, mobile UX, below-fold content, payment/calendar UI, language detection, branding | Configurable React component. Per-client: colors, logo, persona name, greetings, languages. |
| **Public Persona API** | Justec's public-facing brain. Session management, model routing, qualification scoring, tool calls (calendar, payment, Trello), conversation memory, security enforcement | Deployed per-client as a Node.js service. Configured with: persona prompt, scoring weights, model config, OAuth credentials, Trello/Stripe keys. |
| **OpenClaw PA** | Private assistant. Telegram, cron, full workspace access, personal knowledge. Already exists per-agent. | Standard Claw God genesis product. Unchanged. |
| **Workspace Bridge** | Google Workspace + Trello as shared data layer. Both Public Persona API and OpenClaw PA read/write the same Calendar, Sheets, and Trello board. | Configuration, not code. Same OAuth credentials, same board/spreadsheet IDs. |

### Why Public Justec Is NOT an OpenClaw Sub-Agent

OpenClaw is designed for **channel-based delivery** (Telegram, CLI) with persistent JSONL session files. It is not an HTTP API backend. Specific limitations:

| Capability Needed | OpenClaw Support |
|-------------------|-----------------|
| HTTP REST API for web clients | No — no HTTP API surface |
| Concurrent sessions (10+ simultaneous visitors) | No — JSONL session model doesn't support concurrency |
| Per-session model routing (Flash → Pro mid-conversation) | No — model is set at agent level |
| Per-session token budgets | No — no budget management mechanism |
| Queue management ("all lines busy") | No — no concept of session limits |
| Behavioral scoring engine | No — would need custom middleware anyway |

The Public Persona API is a **separate middleware** that talks directly to LLM APIs and Google Workspace APIs. It shares the persona DNA (system prompt, knowledge boundary, behavioral rules) with private Justec but shares no infrastructure.

---

## 3. System Architecture

### Full System Diagram

```
                    VISITOR BROWSER
                         │
                         │ HTTPS
                         ▼
              ┌─────────────────────┐
              │   CLOUDFLARE CDN    │  Layer 1: Perimeter
              │   • DDoS protection │
              │   • Turnstile       │
              │   • Geo headers     │
              │   • Rate limiting   │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   CADDY (Hetzner)   │  46.225.188.5
              │   surfstyk.com      │
              │                     │
              │   /        → SPA    │  Static React app
              │   /api/*   → :3100  │  Reverse proxy
              └──────┬──────┬───────┘
                     │      │
           static    │      │  /api/*
           files     │      │
                     ▼      ▼
              ┌──────────────────────────────────────┐
              │    PUBLIC PERSONA API (middleware)     │  Port 3100
              │    Node.js · systemd service           │
              │                                        │
              │  ┌────────────────────────────────┐   │
              │  │ Session Manager                 │   │
              │  │ • In-memory sessions (POC)      │   │
              │  │ • SQLite conversation log        │   │
              │  │ • Token budget tracking          │   │
              │  └────────────────────────────────┘   │
              │                                        │
              │  ┌────────────────────────────────┐   │
              │  │ Qualification Scoring Engine    │   │
              │  │ • Behavioral signals (from FE)  │   │
              │  │ • Explicit signals (from LLM)   │   │
              │  │ • Composite score               │   │
              │  └────────────────────────────────┘   │
              │                                        │
              │  ┌────────────────────────────────┐   │
              │  │ LLM Adapter (model agnostic)   │   │
              │  │ • Gemini / Claude / OpenAI      │   │
              │  │ • Model routing (Lobby/Meeting) │   │
              │  │ • Streaming (SSE passthrough)   │   │
              │  └────────────────────────────────┘   │
              │                                        │
              │  ┌────────────────────────────────┐   │
              │  │ Tool Handlers                   │   │
              │  │ • Google Calendar (availability) │   │
              │  │ • Trello (lead cards)            │   │
              │  │ • Stripe / PayPal (payments)    │   │
              │  │ • Telegram (notifications)       │   │
              │  └────────────────────────────────┘   │
              │                                        │
              │  ┌────────────────────────────────┐   │
              │  │ Security Engine                  │   │
              │  │ • Input pre-processing           │   │
              │  │ • Output post-processing          │   │
              │  │ • Rate limiting (per-session)    │   │
              │  │ • Security guard state machine   │   │
              │  └────────────────────────────────┘   │
              └───┬────────┬────────┬────────┬────────┘
                  │        │        │        │
                  ▼        ▼        ▼        ▼
            ┌────────┐ ┌────────┐ ┌──────┐ ┌──────────┐
            │ Google │ │ Trello │ │Stripe│ │ Telegram  │
            │Workspace│ │  API  │ │PayPal│ │   API    │
            │  APIs  │ │       │ │ APIs │ │(@justec) │
            └────────┘ └────────┘ └──────┘ └──────────┘
```

### Request Flow: Visitor Sends a Message

```
1. Frontend POST /api/session/:id/message
   Body: { text, behavioral_signals, consent_state }

2. Middleware receives request
   ├── Security Engine: input pre-processing (injection patterns, profanity)
   ├── Session Manager: load session, check token budget
   ├── Scoring Engine: update behavioral score from frontend signals
   │
   ├── Build LLM request:
   │   ├── Select system prompt (Lobby or Meeting Room based on score)
   │   ├── Select model (based on tier config)
   │   ├── Include conversation history
   │   ├── Include tool definitions (if Meeting Room)
   │   └── Request structured output for qualification signals
   │
   ├── Call LLM via adapter → stream response
   │   ├── If tool call requested by LLM:
   │   │   ├── Execute tool (Calendar query, etc.)
   │   │   └── Return result to LLM, continue streaming
   │   └── Stream tokens to frontend via SSE
   │
   ├── Post-processing:
   │   ├── Security Engine: output scan (prompt leakage, off-brand)
   │   ├── Scoring Engine: extract explicit signals from LLM structured output
   │   ├── Check for tier transition (score crossed threshold)
   │   ├── Check for termination triggers
   │   └── Update session state
   │
   └── If score crossed threshold (70+):
       ├── Next message uses Meeting Room model + prompt
       ├── SSE metadata signals tier change to frontend (optional)
       └── Create Trello card (qualified lead)

3. Frontend receives SSE stream
   ├── Render tokens progressively
   ├── Handle structured messages (calendar slots, payment link)
   └── Handle metadata (tier change, budget warning, termination)
```

---

## 4. Middleware Design

### Technology Choice

**Node.js (TypeScript)** for the middleware. Rationale:
- Same language as the frontend team's stack (React/TypeScript)
- Native SSE/streaming support
- Excellent Google API client libraries
- Runs well on the existing Hetzner server alongside Caddy
- Matches the "gold standard stack" direction (TypeScript ecosystem)

### Module Structure

```
public-justec-api/
├── src/
│   ├── index.ts                    # Entry point, Express/Fastify setup
│   ├── config.ts                   # Configuration loader
│   │
│   ├── routes/
│   │   ├── session.ts              # POST /api/session (create)
│   │   ├── message.ts              # POST /api/session/:id/message (SSE)
│   │   ├── consent.ts              # POST /api/session/:id/consent
│   │   └── health.ts               # GET /api/health
│   │
│   ├── llm/
│   │   ├── adapter.ts              # LLMAdapter interface
│   │   ├── gemini.ts               # Google Gemini implementation
│   │   ├── anthropic.ts            # Anthropic Claude implementation
│   │   ├── openai.ts               # OpenAI implementation
│   │   └── router.ts               # Model routing (tier → provider/model)
│   │
│   ├── scoring/
│   │   ├── engine.ts               # Composite scoring engine
│   │   ├── behavioral.ts           # Behavioral signal scoring
│   │   ├── explicit.ts             # LLM-extracted signal scoring
│   │   └── thresholds.ts           # Score → action mapping
│   │
│   ├── security/
│   │   ├── input-filter.ts         # Pre-LLM input processing
│   │   ├── output-filter.ts        # Post-LLM output processing
│   │   ├── rate-limiter.ts         # Per-session + per-IP rate limiting
│   │   └── guard.ts                # Security guard state machine
│   │
│   ├── tools/
│   │   ├── calendar.ts             # Google Calendar: availability, booking
│   │   ├── trello.ts               # Trello: lead card management
│   │   ├── stripe.ts               # Stripe: payment session creation
│   │   ├── paypal.ts               # PayPal: payment session creation
│   │   └── telegram.ts             # Telegram: notifications via @justec bot
│   │
│   ├── session/
│   │   ├── manager.ts              # Session lifecycle (create, load, update, expire)
│   │   ├── store-memory.ts         # In-memory session store (POC)
│   │   ├── store-redis.ts          # Redis session store (future)
│   │   └── budget.ts               # Token budget tracking per session
│   │
│   ├── persona/
│   │   ├── loader.ts               # Load system prompt + knowledge base
│   │   ├── lobby.ts                # Lobby tier prompt builder
│   │   └── meeting-room.ts         # Meeting Room tier prompt builder
│   │
│   └── db/
│       ├── sqlite.ts               # SQLite connection
│       └── conversations.ts        # Conversation log persistence
│
├── config/
│   ├── default.json                # Default configuration
│   └── surfstyk.json               # Surfstyk-specific overrides
│
├── prompts/
│   ├── shared-persona.md           # Shared persona foundation
│   ├── lobby.md                    # Lobby system prompt
│   ├── meeting-room.md             # Meeting Room system prompt
│   └── knowledge-base.md           # Public knowledge about Surfstyk
│
├── package.json
├── tsconfig.json
└── Dockerfile                      # Optional — for containerized deployment
```

### Configuration Schema

```jsonc
{
  // Per-client configuration
  "client": {
    "name": "surfstyk",
    "company": "Surfstyk Limited",
    "company_pt": "Surfstyk LDA",
    "owner": "Hendrik Bondzio",
    "timezone": "Europe/Lisbon",
    "languages": ["en", "de", "pt"],
    "phone": "+351 XXX XXX XXX"
  },

  // LLM configuration (model agnostic)
  "llm": {
    "lobby": {
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "max_tokens": 1024
    },
    "meeting_room": {
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "max_tokens": 2048
    }
  },

  // Qualification scoring
  "scoring": {
    "weights": {
      "explicit": 0.40,
      "behavioral": 0.35,
      "fit": 0.25
    },
    "thresholds": {
      "qualified": 70,
      "warm": 45,
      "cold": 25
    }
  },

  // Token budgets per session tier
  "budgets": {
    "anonymous": 5000,
    "engaged": 8000,
    "qualified": 25000,
    "post_booking": 50000
  },

  // Rate limiting
  "rate_limits": {
    "messages_per_session": 15,
    "messages_per_ip_per_hour": 20,
    "max_concurrent_sessions": 10,
    "session_ttl_minutes": 60
  },

  // Calendar configuration
  "calendar": {
    "working_hours": {
      "days": [1, 2, 3, 4, 5],
      "start": "09:00",
      "end": "17:00",
      "timezone": "Europe/Lisbon"
    },
    "slot_duration_minutes": 60,
    "lookahead_days": 14,
    "buffer_minutes": 15
  },

  // Payment configuration
  "payment": {
    "deposit_amount": 5000,
    "currency": "eur",
    "providers": ["stripe", "paypal"],
    "deposit_credited": true
  },

  // Trello lead management
  "trello": {
    "board_name": "Website Leads",
    "lists": {
      "lobby": "Lobby",
      "meeting_room": "Meeting Room",
      "phone_captured": "Phone Captured",
      "booked": "Booked",
      "completed": "Completed"
    }
  },

  // Notification
  "notification": {
    "telegram_bot_token_path": "/path/to/justec_bot.token",
    "admin_chat_id": "1465455370"
  }
}
```

---

## 5. Google Workspace Bridge

### The Principle

Private Justec and public Justec share awareness through Google Workspace — not through direct communication. Both systems read and write the same Calendar, Sheets, and Gmail. The data IS the bridge.

### Shared Access Matrix

| Resource | Private Justec (OpenClaw) | Public Justec (Middleware) |
|----------|--------------------------|---------------------------|
| **Google Calendar** | Read (morning briefing, upcoming) + Write (create events for Hendrik) | Read (availability queries) + Write (create booking events) |
| **Google Sheets** | Read/Write (task tracker, reports) | Write (conversation summaries — optional) |
| **Gmail** | Read (inbox, search) + Draft | Read-only (if needed for context — v2) |
| **Trello** | Read/Write (via Trello skill) | Write (create/update lead cards) + Read (board state) |

### OAuth Credentials

Both systems use the same Google Cloud project and OAuth credentials. Two options:

| Approach | How It Works | Trade-off |
|----------|-------------|-----------|
| **Same refresh token** | Copy `google_oauth.json` from private Justec's server to surfstyk.com server | Simplest. Risk: if one system's token refresh race-conditions the other, both break. Low risk in practice — OAuth2 refresh tokens survive concurrent use. |
| **Two refresh tokens, same project** | Authorize a second OAuth flow from the same Google Cloud project. Two tokens, same scopes, same project. | Cleaner isolation. Slightly more setup. Independent token lifecycle. |

**Recommendation for POC:** Same refresh token (copy credentials). If token issues arise, generate a second one.

### Calendar Availability Logic

The middleware computes available slots by:

1. **Read config:** working hours (Mon–Fri 09:00–17:00 Lisbon), slot duration (60 min), buffer (15 min), lookahead (14 days)
2. **Query Google Calendar API:** `events.list()` for the next 14 days, filtering for events that block time (not "free" events)
3. **Subtract busy slots** from working hours grid
4. **Exclude past times** and apply buffer between slots
5. **Return available slots** with timezone conversion for the visitor

This is the same logic that Cal.com and Calendly provide — but without the third-party dependency.

### Booking Flow

```
1. Visitor confirms a time slot in chat
2. Middleware creates Google Calendar event:
   - Title: "Strategy Session — [Visitor Name]"
   - Description: Conversation summary, qualification score, contact info
   - Time: Selected slot in Europe/Lisbon
   - Attendee: Hendrik's email (sends calendar invite)
   - Color: Distinctive (e.g., purple = website booking)
3. Middleware creates/updates Trello card → "Booked" list
4. Middleware sends Telegram notification via @surfstykjustec_bot
5. Middleware returns confirmation to visitor in chat
```

Private Justec sees the new calendar event in her morning briefing. No integration needed.

---

## 6. Lead Management (Trello)

### Board Structure

```
Website Leads (Trello Board)

| Lobby       | Meeting Room | Phone Captured | Booked     | Completed | Lost |
|-------------|-------------|----------------|------------|-----------|------|
```

### Card Schema

Each qualified visitor becomes a Trello card:

| Field | Trello Feature | Populated When |
|-------|---------------|----------------|
| **Title** | Card name | `"[Name/Anonymous] — [Company/Unknown]"` |
| **Description** | Card description | Conversation summary (auto-generated) |
| **Score** | Custom field or label | Qualification score at time of card creation |
| **Language** | Label (EN/DE/PT) | Detected language |
| **Phone** | Description or custom field | When captured |
| **Booking date** | Due date | When booked |
| **Payment status** | Label (Paid/Pending) | When payment completes |
| **Source** | Label (Direct/Ad/Referral) | From referrer metadata |
| **Conversation ID** | Description | For log lookup |

### When Cards Are Created/Moved

| Event | Action |
|-------|--------|
| Score crosses 70 (qualified) | Create card in "Meeting Room" list |
| Phone number captured | Move to "Phone Captured", add phone to card |
| Booking confirmed + payment | Move to "Booked", set due date, add payment label |
| Hendrik completes session | Manual move to "Completed" |
| Lead goes cold | Manual move to "Lost" |

**Note:** Cards are only created for qualified leads (score ≥ 70). Lobby-only visitors don't generate Trello cards — this keeps the board clean and the cost zero for unqualified traffic.

### Trello Credentials

Same pattern as private Justec's Trello skill: API key + token stored in a config file on the surfstyk.com server at a secure path (chmod 600). Not in the codebase.

---

## 7. LLM Adapter Layer

### Interface

```typescript
interface LLMAdapter {
  /**
   * Send a chat completion request and stream the response.
   * Model agnostic — implementations handle provider-specific formats.
   */
  chat(request: ChatRequest): AsyncGenerator<ChatEvent>;
}

interface ChatRequest {
  system: string;              // System prompt
  messages: Message[];         // Conversation history
  tools?: ToolDefinition[];    // Available tools (calendar, etc.)
  max_tokens: number;          // Response token limit
  temperature?: number;        // Default: 0.7
}

type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; args: object }
  | { type: "tool_result"; id: string; result: object }
  | { type: "metadata"; data: object }  // Qualification signals, etc.
  | { type: "done"; usage: TokenUsage }
  | { type: "error"; message: string };

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}
```

### Implementations

| Provider | API | Streaming | Tool Calling | Notes |
|----------|-----|-----------|-------------|-------|
| **Google Gemini** | `generativelanguage.googleapis.com` | SSE via `streamGenerateContent` | `functionDeclarations` | Primary for POC. Free tier available. |
| **Anthropic Claude** | `api.anthropic.com/v1/messages` | SSE native | `tools` array | Best persona consistency. Higher cost. |
| **OpenAI** | `api.openai.com/v1/chat/completions` | SSE via `stream: true` | `tools` array | Widest model selection. |

### Model Router

The router selects provider + model based on the session's current tier:

```typescript
function resolveModel(session: Session, config: Config): { provider: string; model: string } {
  if (session.tier === "meeting_room") {
    return config.llm.meeting_room;
  }
  return config.llm.lobby;
}
```

Tier transitions happen between messages (never mid-stream). When the scoring engine promotes a session to "meeting_room" after processing a message, the *next* message uses the Meeting Room model and system prompt.

---

## 8. Model Routing & Tier Transitions

### Tier Definitions

| Tier | Trigger | Model (default) | System Prompt | Token Budget | Tools Available |
|------|---------|-----------------|---------------|-------------|-----------------|
| **Lobby** | Default for all sessions | Gemini 3 Flash | Qualification-focused, concise | 5,000–8,000 | None (pure conversation) |
| **Meeting Room** | Score ≥ 70 | Gemini 3 Flash (or upgrade via config) | Full sales capability, Challenger teach | 15,000–25,000 | Calendar, Payment |

### Transition Mechanics

The transition is **seamless** — invisible to the visitor:

1. After each visitor message, the scoring engine computes the composite score
2. If the score crosses 70 for the first time:
   a. Session tier updates to `meeting_room`
   b. Trello card is created (qualified lead)
   c. The LLM request for the *next response* uses the Meeting Room prompt and model
   d. An SSE metadata event signals the tier change to the frontend (for analytics; no UI change)
3. The conversation continues without interruption. The visitor notices only that the responses become richer and more strategically insightful.

### Why Seamless Works

The visitor doesn't know (or care) about model tiers. What they experience is a conversation that gets progressively more valuable as they engage more deeply. This maps naturally to human conversation: a receptionist who realizes you're a VIP starts giving you more attention and better information — without announcing it.

The alternative (theatrical transition with "Let me take you to the meeting room") creates a break in flow that risks losing engagement. It also reveals the qualification system, which undermines the naturalness of the experience.

### Future: Starting Both Tiers on the Same Model

If Gemini 3 Flash handles the persona well at both tiers (which is plausible given its 49.4% Toolathlon score), both tiers can run on the same model with different system prompts. The Lobby prompt is shorter and qualification-focused; the Meeting Room prompt is richer with sales methodology and tool access. The cost difference comes from prompt length and tool usage, not model pricing.

This is the ideal outcome: model routing becomes *prompt routing*, and the entire cost structure simplifies.

---

## 9. Qualification Scoring Engine

### Architecture

Scoring is split between the frontend (behavioral signals) and the middleware (explicit + fit signals). The LLM does NOT compute scores — it extracts structured data that the scoring engine uses.

```
Frontend                          Middleware
────────                          ──────────
Behavioral signals:               LLM structured output:
• Typing speed variance           • Role/title mentioned
• Time to first message           • Company size indicator
• Message lengths                 • Problem specificity (0-10)
• Inter-message timing            • Timeline urgency (0-10)
• Mouse/touch patterns            • Need alignment (0-10)
• Scroll behavior                 • Authority signal (0-10)
        │                                │
        └──────────┐    ┌────────────────┘
                   ▼    ▼
            ┌─────────────────┐
            │  Scoring Engine │
            │  (middleware)   │
            │                 │
            │  Behavioral: 35%│
            │  Explicit:  40% │
            │  Fit:       25% │
            │                 │
            │  → Composite    │
            │    score (0-100)│
            └────────┬────────┘
                     │
                     ▼
            Score → Action mapping
            ≥70: Meeting Room
            45-69: Continue Lobby
            25-44: Graceful exit
            <25: Disqualify
```

### LLM Structured Output

After each visitor message, the LLM response includes structured qualification data. This is requested via the system prompt (not tool calling — to keep it lightweight):

```
At the end of every response, include a JSON block with qualification signals:

```json
{
  "signals": {
    "problem_specificity": 7,
    "authority_level": 8,
    "timeline_urgency": 5,
    "need_alignment": 9,
    "budget_indicator": 6,
    "engagement_depth": 7
  },
  "visitor_info": {
    "name": "Marcus",
    "company": "LogiTech GmbH",
    "role": "Head of Operations",
    "language": "de"
  }
}
```

The middleware strips this JSON block before streaming the response to the frontend.

### Behavioral Scoring (from Frontend)

The frontend collects behavioral signals and sends them with each message:

```json
{
  "behavioral": {
    "typing_speed_wpm": 45,
    "typing_variance": 0.3,
    "time_to_first_message_ms": 12500,
    "avg_response_time_ms": 8200,
    "message_length_chars": 156,
    "mouse_movement_detected": true,
    "scroll_depth_percent": 0,
    "messages_sent": 3
  }
}
```

These are scored against human-like patterns (see Framework Section 11, Layer 2).

---

## 10. Session Management

### Session Lifecycle

```
CREATE ──► ACTIVE (Lobby) ──► ACTIVE (Meeting Room) ──► CLOSED
  │              │                    │                      │
  │         [score check]        [score check]          [reasons:]
  │              │                    │                 • booking complete
  │              ▼                    ▼                 • token budget exhausted
  │         DISQUALIFIED         BOOKING               • security guard L4
  │              │                    │                 • session timeout
  │              ▼                    ▼                 • visitor leaves
  │           CLOSED              CLOSED
  │
  └──► QUEUED (if max concurrent sessions reached)
           │
           ▼
        ACTIVE (when slot opens)
```

### Session Data (In-Memory, POC)

```typescript
interface Session {
  id: string;                    // UUID
  created_at: number;            // Unix timestamp
  updated_at: number;
  tier: "lobby" | "meeting_room";
  status: "active" | "queued" | "closed";
  close_reason?: string;

  // Conversation
  messages: Message[];           // Full history (for LLM context)
  message_count: number;
  tokens_used: number;           // Running total
  token_budget: number;          // Tier-dependent cap

  // Visitor
  language: string;              // Detected language code
  ip: string;                    // For rate limiting (hashed)
  consent: boolean;              // GDPR consent state
  fingerprint?: string;          // Behavioral fingerprint (if consented)

  // Qualification
  score: number;                 // Composite score (0-100)
  behavioral_score: number;
  explicit_score: number;
  fit_score: number;
  visitor_info: VisitorInfo;     // Extracted name, company, role, etc.

  // Security
  guard_level: 0 | 1 | 2 | 3 | 4;  // Escalation level
  injection_attempts: number;

  // Conversion
  trello_card_id?: string;       // Created when qualified
  phone?: string;
  booking_time?: string;
  payment_status?: "pending" | "completed";
}
```

### Session Expiry

- Active sessions expire after 60 minutes of inactivity
- Closed sessions are persisted to SQLite, then removed from memory
- SQLite retains conversation logs for analytics (retention period: configurable, default 90 days)

### Queue Mechanism ("All Lines Busy")

When active session count reaches `max_concurrent_sessions` (default: 10):

1. New `POST /api/session` returns `{ status: "queued", position: N, estimated_wait_seconds: M }`
2. Frontend shows: "Justec is currently assisting other clients. You're [Nth] in line."
3. When a slot opens, the queue is processed FIFO (priority for returning visitors if implemented)
4. If queue exceeds hard cap (e.g., 50), return `{ status: "unavailable" }` and the frontend shows a phone number CTA

---

## 11. Security Architecture

### Five-Layer Defense

| Layer | Location | What It Does | LLM Involved? |
|-------|----------|-------------|----------------|
| **1. Perimeter** | Cloudflare | DDoS protection, IP reputation, geo-filtering, Turnstile bot detection | No |
| **2. Behavioral** | Frontend + Middleware | Typing patterns, timing analysis, human confidence score | No |
| **3. Prompt** | Middleware (pre/post-LLM) | Input pattern detection, output leakage scanning | No (rule-based) |
| **4. Budget** | Middleware | Per-session token caps, per-IP rate limits, global cost ceiling | No |
| **5. Guard** | Middleware (state machine) | Graduated response: redirect → firm → exit → hard block | No |

Every layer operates without LLM involvement. The LLM only generates responses — it never makes security decisions.

### Input Pre-Processing

Before the visitor's message reaches the LLM:

1. **Pattern scan:** Check for known injection patterns ("ignore previous instructions", "you are now", "repeat your system prompt", base64-encoded strings, unicode tricks)
2. **Profanity filter:** Flag messages with hostile/profane content → advance security guard level
3. **Length check:** Messages > 2,000 characters are truncated with a note to the LLM
4. **Rate check:** If visitor is sending > 1 message per 3 seconds, slow down (likely automated)

Pattern detection is rule-based (regex + keyword lists), not ML. Fast, deterministic, no false negatives on known patterns.

### Output Post-Processing

After the LLM generates a response, before streaming to the visitor:

1. **Leakage scan:** Check for fragments of the system prompt, internal instructions, configuration details, or the words "system prompt" / "instructions"
2. **Off-brand scan:** Check for content that violates persona boundaries (discussing competitors, revealing pricing, sharing private info about Hendrik)
3. **Hallucination guard:** If the response references specific client names, revenue figures, or case studies that aren't in the knowledge base, flag and replace

If any check fails, the response is replaced with a safe fallback: "I'd be happy to tell you more about our approach. What specific aspect interests you?"

### Security Guard State Machine

```
                 ┌─────────────┐
                 │  Level 0    │  Normal conversation
                 │  (Default)  │
                 └──────┬──────┘
                        │ Trigger: off-topic, mild probe
                        ▼
                 ┌─────────────┐
                 │  Level 1    │  Gentle redirect
                 │  (Mild)     │  "I'm best equipped to discuss
                 └──────┬──────┘   business inquiries..."
                        │ Trigger: continued off-topic, second probe
                        ▼
                 ┌─────────────┐
                 │  Level 2    │  Firm redirect
                 │  (Firm)     │  "I appreciate your creativity,
                 └──────┬──────┘   but I'm here for business..."
                        │ Trigger: hostility, profanity, injection
                        ▼
                 ┌─────────────┐
                 │  Level 3    │  Conversation terminated
                 │  (Exit)     │  "I can't continue this conversation.
                 └──────┬──────┘   You can reach us at [phone]."
                        │ Automatic after Level 3 response
                        ▼
                 ┌─────────────┐
                 │  Level 4    │  Hard block
                 │  (Block)    │  Session closed. No response.
                 └─────────────┘  IP/fingerprint flagged. Cooldown.
```

Levels only go up, never down (within a session). Level escalation is triggered by the middleware's pattern detection, not by the LLM's judgment.

### GDPR Consent State Machine

```
                 ┌─────────────┐
                 │  PENDING    │  Session just created.
                 │             │  No consent asked yet.
                 └──────┬──────┘
                        │ First visitor message triggers consent question
                        │ (woven into Justec's first response)
                        ▼
                 ┌─────────────┐
           ┌─────│  ASKED      │─────┐
           │     └─────────────┘     │
    Accepts│                          │Declines
           ▼                          ▼
    ┌─────────────┐           ┌─────────────┐
    │  CONSENTED  │           │  DECLINED   │
    │             │           │             │
    │  Full       │           │  Stateless  │
    │  features   │           │  mode       │
    └─────────────┘           └─────────────┘
```

**Consented mode:** Session persisted, conversation logged, behavioral fingerprint collected, returning visitor recognition possible (v2).

**Declined mode:** Conversation works but is not persisted. No cookies beyond the functional session cookie. No fingerprinting. No Trello card (no data stored). Session data deleted on close.

---

## 12. Payment Integration

### Stripe (Primary)

```
Visitor confirms booking
        │
        ▼
Middleware: Stripe Checkout Session
  → stripe.checkout.sessions.create({
       mode: 'payment',
       line_items: [{ price: DEPOSIT_PRICE_ID, quantity: 1 }],
       metadata: { session_id, visitor_name, booking_time },
       success_url: 'https://surfstyk.com?booking=success&session={CHECKOUT_SESSION_ID}',
       cancel_url: 'https://surfstyk.com?booking=cancelled'
     })
        │
        ▼
Middleware returns checkout URL to frontend via structured message
        │
        ▼
Frontend: Opens Stripe Checkout (redirect or embedded)
        │
        ▼
Visitor completes payment
        │
        ▼
Stripe webhook → POST /api/webhooks/stripe
  → Middleware: verify webhook signature
  → Update session: payment_status = "completed"
  → Create Google Calendar event
  → Update Trello card → "Booked" list
  → Send Telegram notification via @surfstykjustec_bot
  → Push confirmation to frontend via SSE (if session still open)
```

### PayPal (Secondary)

Same flow pattern, different provider SDK. The frontend presents both options: "Pay with Card" (Stripe) and "Pay with PayPal." The backend creates the appropriate checkout session for each.

### Payment Adapter

```typescript
interface PaymentAdapter {
  createCheckoutSession(details: BookingDetails): Promise<CheckoutSession>;
  verifyWebhook(payload: Buffer, signature: string): boolean;
}

// Implementations: StripeAdapter, PayPalAdapter
// Selected based on visitor's choice or config
```

---

## 13. Notification Flow

### When the Middleware Notifies Hendrik

| Event | Notification via | Message Format |
|-------|-----------------|----------------|
| **Qualified lead** (score ≥ 70) | `@surfstykjustec_bot` Telegram | "New qualified lead: [Name] from [Company]. Score: [X]. Language: [Y]. Summary: [2 sentences]." |
| **Booking confirmed + paid** | `@surfstykjustec_bot` Telegram | "Booking confirmed: [Name], [Date/Time]. €50 deposit received. Calendar event created. Conversation summary: [link or inline]." |
| **Security incident** (Level 3+ guard) | `@surfstykjustec_bot` Telegram | "Security: conversation terminated with visitor from [IP/country]. Reason: [injection/hostility]. [X] messages exchanged." |

### How Notifications Work

The middleware calls the Telegram Bot API directly (same pattern as the escalation skill):

```
POST https://api.telegram.org/bot<JUSTEC_BOT_TOKEN>/sendMessage
{
  "chat_id": "1465455370",
  "text": "...",
  "parse_mode": "Markdown"
}
```

No OpenClaw involvement. No gateway. Direct HTTP call from the middleware to Telegram.

**Private Justec's awareness:** Justec sees the Google Calendar events and Trello cards in her morning briefing. She doesn't need real-time notification — Hendrik gets the instant alert. If Hendrik asks Justec "any new leads?", she can check the Trello board via her existing skill.

---

## 14. Infrastructure & Deployment

### Server Architecture (POC)

```
Hetzner VPS — 46.225.188.5 (existing surfstyk.com server)
├── Caddy (existing)
│   ├── surfstyk.com → /var/www/surfstyk.com/ (static SPA)
│   ├── surfstyk.com/api/* → localhost:3100 (reverse proxy to middleware)
│   ├── gripandtraction.com → /var/www/gripandtraction.com/
│   └── HTTPS: automatic via Let's Encrypt
│
├── Public Persona API (new)
│   ├── Node.js process on port 3100
│   ├── Managed by systemd (justec-public.service)
│   ├── SQLite database at /var/lib/justec-public/conversations.db
│   ├── Config at /etc/justec-public/config.json
│   └── Credentials at /etc/justec-public/credentials/ (chmod 600)
│       ├── google_oauth.json
│       ├── trello_credentials.json
│       ├── gemini_api_key
│       ├── stripe_secret_key
│       ├── paypal_credentials.json
│       └── justec_bot_token
│
└── Firewall (existing UFW)
    └── Ports: 22, 80, 443 (no change needed)
```

### Caddy Config Addition

```caddyfile
surfstyk.com {
    # API reverse proxy (new)
    handle /api/* {
        reverse_proxy localhost:3100
    }

    # Stripe/PayPal webhooks (new)
    handle /api/webhooks/* {
        reverse_proxy localhost:3100
    }

    # Static SPA (existing)
    handle {
        root * /var/www/surfstyk.com
        try_files {path} /index.html
        file_server
    }
}
```

### systemd Service

```ini
[Unit]
Description=Justec Public Persona API
After=network.target

[Service]
Type=simple
User=hendrik
Group=hendrik
WorkingDirectory=/opt/justec-public
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=CONFIG_PATH=/etc/justec-public/config.json

[Install]
WantedBy=default.target
```

### Deployment Pipeline

The middleware follows the same pattern as the existing sites:

1. Build locally: `npm run build` → `dist/`
2. Rsync to server: `rsync -avz dist/ hendrik@46.225.188.5:/opt/justec-public/dist/`
3. Restart service: `ssh hendrik@46.225.188.5 "sudo systemctl restart justec-public"`

CI/CD via GitHub Actions (same pattern as surfstyk/kongquant repos).

### Resource Requirements

The existing Hetzner VPS should handle this without upgrade:

| Component | Memory | CPU | Disk |
|-----------|--------|-----|------|
| Caddy | ~30 MB | Minimal | — |
| Node.js middleware | ~50-100 MB | Burst on LLM calls | — |
| SQLite | ~1 MB + data | Minimal | ~10 MB/month at scale |
| **Total added** | **~100-150 MB** | Low | Negligible |

If the VPS is already tight on resources, a monitoring check is warranted. But a Node.js API handling < 50 concurrent sessions is lightweight.

---

## 15. Data Model

### SQLite Schema (Conversation Persistence)

```sql
-- Conversation sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    close_reason TEXT,
    tier TEXT NOT NULL DEFAULT 'lobby',
    language TEXT NOT NULL DEFAULT 'en',
    consent BOOLEAN NOT NULL DEFAULT FALSE,

    -- Scoring
    score_final INTEGER,
    score_behavioral INTEGER,
    score_explicit INTEGER,
    score_fit INTEGER,

    -- Visitor info (extracted)
    visitor_name TEXT,
    visitor_company TEXT,
    visitor_role TEXT,
    visitor_phone TEXT,

    -- Conversion
    trello_card_id TEXT,
    booking_time TEXT,
    payment_provider TEXT,
    payment_status TEXT,
    payment_id TEXT,

    -- Metadata
    ip_hash TEXT,
    referrer TEXT,
    user_agent TEXT,
    messages_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    guard_level INTEGER DEFAULT 0
);

-- Individual messages (for analytics and conversation replay)
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,           -- 'visitor' or 'justec'
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at INTEGER NOT NULL,
    metadata TEXT                 -- JSON: tool calls, scoring signals, etc.
);

-- Security incidents
CREATE TABLE security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id),
    event_type TEXT NOT NULL,     -- 'injection_attempt', 'hostility', 'rate_limit'
    details TEXT,
    ip_hash TEXT,
    created_at INTEGER NOT NULL
);

-- Rate limiting state (supplement to in-memory)
CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,          -- 'ip:hash' or 'session:id'
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
);
```

### Data Retention

| Data | Retention | Reason |
|------|-----------|--------|
| Consented conversations | 90 days | Analytics, quality review |
| Non-consented conversations | 0 (not stored) | GDPR compliance |
| Security events | 180 days | Threat pattern analysis |
| Rate limit counters | 24 hours | Operational |

---

## 16. Productization Path

### What's Per-Client Configurable (Today)

| Component | Configuration |
|-----------|--------------|
| **Persona** | Name, personality traits, company info, knowledge base, greeting templates |
| **Qualification** | Scoring weights, thresholds, disqualification triggers, question banks |
| **Models** | Provider, model names per tier, temperature, max tokens |
| **Languages** | Supported languages, cultural tone per language |
| **Calendar** | Working hours, slot duration, buffer, lookahead, timezone |
| **Payment** | Provider(s), deposit amount, currency |
| **Lead management** | Trello board name, list names, card schema |
| **Branding** | Colors, fonts, logo (frontend config) |
| **Security** | Rate limits, token budgets, guard thresholds |
| **Notification** | Telegram bot token, admin chat ID |

### Client Onboarding Flow (Future)

```
1. Client already has OpenClaw PA (deployed via Claw God)
2. Client requests "Public Persona" add-on
3. Claw God generates public persona config:
   - Persona prompt (based on PA's SOUL.md, filtered for public info)
   - Qualification criteria (based on client's business)
   - Calendar config (client's working hours)
4. Deploy middleware instance (per-client or multi-tenant)
5. Deploy/configure frontend (per-client branding)
6. Set up shared Google Workspace bridge (same OAuth)
7. Set up Trello board for leads
8. Configure Stripe/PayPal
9. Go live
```

### Multi-Tenant vs. Per-Client Instances

**POC (now):** Single instance for Surfstyk. One middleware, one config.

**Scale (future):** Two options:
- **Per-client instances:** Each client gets their own middleware process. Simpler isolation, per-client scaling, easier debugging. More ops overhead.
- **Multi-tenant:** Single middleware serves multiple clients, routed by domain. Shared infrastructure, lower ops. More complex code.

For the first 5-10 clients, per-client instances are fine. Multi-tenant is a v3 concern.

---

## 17. Feasibility Assessment

### What Works as Designed in the Framework

| Feature | Assessment |
|---------|-----------|
| Full-viewport chat hero section | Straightforward frontend work. No backend concerns. |
| Tiered model architecture | Clean implementation via middleware model router. |
| Behavioral qualification scoring | Split between frontend (signals) and middleware (engine). |
| Sales methodology (SPIN + Gap + Challenger) | Encoded in system prompts. Quality depends on prompt engineering + model capability. |
| Multilingual (EN/DE/PT) | Gemini 3 Flash handles this well. System prompt instructs language matching. |
| Seamless tier transition | Config change, not code change. Invisible to visitor. |
| Security guard protocol | State machine in middleware. Deterministic, no LLM dependency. |
| GDPR conversational consent | Elegant. Woven into Justec's first response. Two-mode operation. |
| "All Lines Busy" queue | Simple counter in middleware. Frontend shows queue position. |
| Pre-rendered greetings | Static text per language. No LLM call. Instant load. |

### What I've Adjusted from the Framework

| Framework Says | Architecture Says | Why |
|---------------|-------------------|-----|
| Public Justec runs through OpenClaw | Separate middleware | OpenClaw lacks HTTP API, concurrent sessions, per-session model routing, and token budgets. Not designed for web traffic. |
| Opus-class for Meeting Room | Start with Gemini 3 Flash for both tiers | Opus is 5-10x costlier for marginal improvement in a sales conversation. Upgrade via config if needed. |
| Cal.com for scheduling | Google Calendar direct | Hendrik already has Calendar integration via private Justec. No new platform needed. |
| CRM (HubSpot/Airtable) | Trello board | Visual Kanban for ~12 leads/year. Already integrated. No overhead of a dedicated CRM. |
| FingerprintJS for anti-abuse | Cloudflare Turnstile | FingerprintJS has GDPR tension. Turnstile is invisible, requires no consent for bot detection. |
| Canary tokens in system prompt | Output post-processing | Canary tokens don't work with hosted model APIs. Rule-based output scanning is more practical. |
| Separate Redis for sessions | In-memory (POC) | < 50 concurrent sessions doesn't justify Redis. Add later if needed. |
| PostgreSQL for conversation logs | SQLite | File-based, no server process, survives restarts, trivial to backup. Sufficient for POC scale. |

### POC Scope Decisions

| Feature | Decision | Rationale |
|---------|----------|-----------|
| Returning visitor recognition | **Deferred** | Adds database complexity. Fresh start per visit is fine for POC. |
| Theatrical tier transition | **Skipped** | Seamless is the right default. Theatrical can be A/B tested later. |
| CRM integration | **Skipped** | Trello replaces this. |
| A/B testing framework | **Deferred** | Premature optimization. Log data now, test later. |
| Voice/video | **Deferred** | Future enhancement. |
| WordPress blog integration | **Deferred** | Non-critical for launch. Existing REST API integration can be ported later. |
| Crypto payments | **Deferred to v2** | Complexity vs. value for POC. |

---

## 18. Cost Projections

### Per-Conversation Cost (Gemini 3 Flash)

Gemini 3 Flash pricing (Google AI Studio, Tier 1):

| Metric | Free Tier | Paid Tier |
|--------|-----------|-----------|
| Input | 15 RPM, 1M TPM free | $0.10 / 1M tokens |
| Output | Included | $0.40 / 1M tokens |

At these prices:

| Conversation Type | Input Tokens | Output Tokens | Cost |
|-------------------|-------------|---------------|------|
| **Unqualified** (3 messages, Lobby only) | ~2,000 | ~500 | $0.0004 (effectively free) |
| **Qualified** (8 messages, Lobby + Meeting Room) | ~8,000 | ~3,000 | $0.002 |
| **Full booking** (10 messages + tool calls) | ~12,000 | ~5,000 | $0.003 |

**With Gemini 3 Flash, the LLM cost is negligible.** Even 1,000 conversations/month would cost < $3.

### If Upgrading Meeting Room to a Premium Model

| Model | Cost per Meeting Room Conversation (~20K tokens) |
|-------|--------------------------------------------------|
| Gemini 2.5 Pro | ~$0.10–0.20 |
| Claude Sonnet 4.5 | ~$0.20–0.40 |
| Claude Opus 4 | ~$1.50–2.50 |
| GPT-4o | ~$0.15–0.30 |

Even at premium pricing, the framework's targets (< $0.50 unqualified, < $2.00 qualified) are met with any model except Opus.

### Monthly Infrastructure Cost

| Component | Cost | Notes |
|-----------|------|-------|
| Hetzner VPS (existing) | €0 additional | Already running surfstyk.com |
| Gemini API | < €5/month | At expected traffic (< 500 conversations) |
| Trello | €0 | Free tier (10 boards, unlimited cards) |
| Stripe | 1.4% + €0.25 per transaction | Only on successful bookings |
| PayPal | ~2.5% per transaction | Only on successful bookings |
| Cloudflare | €0 | Free tier sufficient for POC |
| **Total additional** | **< €10/month** (excluding payment fees) | |

### Framework's Target vs. Reality

| Metric | Framework Target | Projected |
|--------|-----------------|-----------|
| Cost per unqualified conversation | < $0.50 | < $0.001 |
| Cost per qualified conversation | < $2.00 | < $0.01 (Flash) / < $0.50 (premium model) |
| Monthly total | Part of €50/month PA budget | < €10 additional |

Cost is not a concern with Gemini 3 Flash. The entire public persona system could run within the existing Gemini API budget.

---

## 19. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| 1 | **Gemini 3 Flash can't maintain premium persona quality** | Visitors perceive Justec as generic/robotic. Brand damage. | Medium | Extensive prompt testing before launch. Fallback: upgrade Meeting Room to 2.5 Pro (config change). |
| 2 | **Prompt injection succeeds despite defenses** | System prompt leaked. Brand damage. Potential misuse. | Low–Medium | 5-layer defense. No single point of failure. Output post-processing catches leakage. Red-team testing before launch. |
| 3 | **Google OAuth token race condition** | Private and public Justec compete for token refresh, one breaks | Low | Use separate refresh tokens from the same Google Cloud project (recommended in Section 5). |
| 4 | **Hetzner VPS runs out of resources** | Middleware + Caddy + 3 static sites overwhelm the VPS | Low | Monitor with `htop`/alerts. Node.js middleware is lightweight (~100 MB). Upgrade VPS if needed (~€4 → €8). |
| 5 | **Stripe/PayPal accounts inactive** | Payment integration fails at launch | Medium | Test both integrations well before launch. Reactivate accounts early. |
| 6 | **Gemini API rate limits hit during traffic spike** | Visitors see errors or slow responses | Low–Medium | Queue mechanism + concurrent session limit + Gemini free tier has 15 RPM (sufficient for POC). Paid tier is higher. |
| 7 | **Qualification scoring miscalibrated** | Good leads get disqualified or bad leads get through | Medium | Start with generous thresholds. Log all scores. Tune after 50+ conversations. Manual review in early weeks. |
| 8 | **Portuguese business visitors don't accept English sessions** | Lose Portuguese leads | Low | Framework handles this well — transparent handoff. Target audience speaks English. Monitor and adjust. |
| 9 | **Conversation quality degrades with long chats** | Context window fills up, coherence drops | Low | Token budgets limit conversation length. Meeting Room budget (25K tokens) supports ~15 substantive exchanges — more than enough. |
| 10 | **Competitor copies the approach** | First-mover advantage erodes | High (inevitable) | Not a risk per se. Execution quality and the Surfstyk brand are the moat. The framework itself acknowledges "AI selling AI" is table stakes. |

---

*This document is version-controlled. Updated as implementation decisions are made.*
