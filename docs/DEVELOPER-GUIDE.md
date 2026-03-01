# SAIFA Developer Guide

> SAIFA (Surfstyk Agent Internet Frontdesk Adapter) — an installation-agnostic Node.js/TypeScript middleware that powers virtual front desk chat experiences.

This guide covers the internal architecture, module responsibilities, data flows, and conventions you need to work on the codebase.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Request Lifecycle](#request-lifecycle)
4. [Module Reference](#module-reference)
5. [LLM Adapter Pattern](#llm-adapter-pattern)
6. [Prompt Assembly Pipeline](#prompt-assembly-pipeline)
7. [Tool Call Loop](#tool-call-loop)
8. [SSE Streaming Protocol](#sse-streaming-protocol)
9. [Security Pipeline](#security-pipeline)
10. [Scoring & Tier Escalation](#scoring--tier-escalation)
11. [Calendar Hold System](#calendar-hold-system)
12. [Payment Flow](#payment-flow)
13. [Session Lifecycle](#session-lifecycle)
14. [Gemini Quirks & Mitigations](#gemini-quirks--mitigations)
15. [Adding a New LLM Provider](#adding-a-new-llm-provider)
16. [Adding a New Tool](#adding-a-new-tool)
17. [Testing](#testing)
18. [Conventions](#conventions)

---

## Quick Start

```bash
npm install
CONFIG_PATH=config/surfstyk.json npm run dev   # Dev server on :3100
npm run build                                   # Compile to dist/
npm run lint                                    # ESLint
npm test                                        # Vitest
```

Requirements: Node.js >= 20.0.0. No Python, no pip.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Express Server                            │
│                                                                  │
│  routes/session.ts    POST /api/session                          │
│  routes/message.ts    POST /api/session/:id/message  (core)      │
│  routes/consent.ts    POST /api/session/:id/consent              │
│  routes/close.ts      POST /api/session/:id/close               │
│  routes/webhooks.ts   POST /api/webhooks/stripe|paypal           │
│  routes/health.ts     GET  /api/health                           │
│  routes/status.ts     GET  /api/session/:id/status               │
│  routes/state.ts      GET  /api/session/:id/state                │
│  routes/history.ts    GET  /api/session/:id/history              │
│  routes/language.ts   POST /api/session/:id/language             │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐      │
│  │  llm/   │  │  tools/  │  │ scoring/ │  │  security/   │      │
│  │ adapter │  │ handler  │  │  engine  │  │    guard     │      │
│  │ gemini  │  │ calendar │  │ explicit │  │ input-filter │      │
│  │ router  │  │ payment  │  │behavioral│  │output-filter │      │
│  │         │  │ phone    │  │          │  │ rate-limiter │      │
│  │         │  │ signal   │  │          │  │ ip-blocklist │      │
│  └─────────┘  └──────────┘  └──────────┘  └──────────────┘      │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐       │
│  │ persona/ │  │  sse/    │  │     integrations/        │       │
│  │  loader  │  │  writer  │  │  calendar, calendar-holds│       │
│  │  lobby   │  │sanitizer │  │  stripe, paypal          │       │
│  │ meeting  │  │          │  │  trello, trello-cards    │       │
│  │  room    │  │          │  │  telegram, google-auth   │       │
│  └──────────┘  └──────────┘  └──────────────────────────┘       │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐       │
│  │ session/ │  │   db/    │  │     middleware/           │       │
│  │ manager  │  │  sqlite  │  │  session-lookup           │       │
│  │  store   │  │  convos  │  │  validate-request         │       │
│  │  budget  │  │          │  │                            │       │
│  └──────────┘  └──────────┘  └──────────────────────────┘       │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  config.ts + types.ts                                            │
│  DEFAULTS ← config/surfstyk.json (or CONFIG_PATH)                │
└──────────────────────────────────────────────────────────────────┘
```

### Key design principles

- **Model agnostic** — LLM adapter interface (`llm/adapter.ts`). Never hardcode a provider.
- **Installation agnostic** — All identity lives in config + prompt templates. No hardcoded business names in source.
- **Secrets never in code** — Credentials loaded from filesystem path (default `/etc/justec-public/credentials/`).
- **In-memory sessions, SQLite for logs** — Sessions are fast (HashMap), conversation persistence only happens when GDPR consent is granted.
- **SSE streaming** — Every message response is a Server-Sent Events stream with a guaranteed lifecycle.

---

## Request Lifecycle

The message endpoint (`POST /api/session/:id/message`) is the core of the system. Here is the full processing pipeline:

```
Visitor message
     │
     ├── 0. IP blocklist check
     ├── 1. Rate limiting (per-session + per-IP)
     ├── 2. Validate: text XOR action (not both, not neither)
     ├── 3. Action translation (slot_selected → text, phone_submitted → text)
     ├── 4. Input filter (injection, hostility, profanity detection)
     ├── 5. Guard evaluation (state machine: continue / redirect / terminate / block)
     ├── 6. Token budget check
     ├── 7. Store visitor message in session history
     │
     ├── 8. Setup SSE, write "processing" event
     ├── 9. Build prompt (lobby or meeting_room tier)
     ├── 10. Inject guard redirect if applicable
     ├── 11. Resolve LLM model + adapter
     │
     ├── 12. LLM CALL LOOP (up to 3 rounds):
     │       ├── Stream tokens → sanitize → emit SSE
     │       ├── Collect tool calls
     │       ├── Capture report_signals (qualification)
     │       ├── Execute ONE action tool per round
     │       ├── Dedup calendar checks per turn
     │       ├── Defer excess tools with instruction
     │       └── Inject continuation if no text produced
     │
     ├── 13. Empty response fallback (if no text and no structured messages)
     ├── 14. Output filter (prompt leakage scan)
     ├── 15. Store assistant message in history
     ├── 16. Consume tokens from budget
     ├── 17. Update qualification scores
     ├── 18. Check tier escalation (lobby → meeting_room)
     └── 19. Write stream_end
```

---

## Module Reference

### Entry Point

**`src/index.ts`** — Express app setup. Registers routes, starts expiry timer, periodic security cleanup (5-min interval), graceful shutdown on SIGTERM/SIGINT. Webhook routes registered before body parser (need raw body for Stripe signature verification).

### Routes (`src/routes/`)

| File | Endpoint | Purpose |
|------|----------|---------|
| `session.ts` | `POST /api/session` | Create session; returns greeting + consent_request + post_consent |
| `message.ts` | `POST /api/session/:id/message` | Core message handler — LLM + tools + SSE streaming |
| `consent.ts` | `POST /api/session/:id/consent` | Set consent to `granted` or `declined` |
| `close.ts` | `POST /api/session/:id/close` | Close session with reason |
| `language.ts` | `POST /api/session/:id/language` | Change session language (en/de/pt) |
| `status.ts` | `GET /api/session/:id/status` | Quick status (id, status, tier, count, consent) |
| `state.ts` | `GET /api/session/:id/state` | Full state dump (scores, visitor info, budget, etc.) |
| `history.ts` | `GET /api/session/:id/history` | Conversation history array |
| `health.ts` | `GET /api/health` | Public health check; `/detailed` localhost-only |
| `webhooks.ts` | `POST /api/webhooks/stripe` | Stripe checkout.session.completed/expired |
|  | `POST /api/webhooks/paypal` | PayPal CHECKOUT.ORDER.APPROVED |

### Config (`src/config.ts`, `src/types.ts`)

Config is loaded once from `CONFIG_PATH` env var (defaults to `config/surfstyk.json`). Missing fields fall back to the `DEFAULTS` object in `config.ts`. The merge is shallow per top-level section — e.g. `{ ...DEFAULTS.client, ...parsed.client }`.

Key config sections: `client`, `persona`, `services`, `llm`, `scoring`, `budgets`, `rate_limits`, `calendar`, `payment`, `trello`, `notification`, `greetings`, `consent_messages`, `post_consent_messages`, `conversation_end_messages`, `security`, `credentials_path`, `database_path`.

### LLM (`src/llm/`)

| File | Export | Purpose |
|------|--------|---------|
| `adapter.ts` | `LLMAdapter` interface | Contract: `chat(request): AsyncGenerator<LLMEvent>` |
| `gemini.ts` | `GeminiAdapter` class | Google Gemini implementation with streaming |
| `router.ts` | `resolveModel(session)` | Returns `{ adapter, config }` based on session tier |

The router caches adapter singletons per `provider:model` key.

### Tools (`src/tools/`)

| File | Export | Purpose |
|------|--------|---------|
| `handler.ts` | `handleToolCall(session, name, args)` | Central dispatcher → specific handlers |
| `calendar-tools.ts` | `handleCheckAvailability`, `handleBookAppointment` | Slot discovery (1 per call) + tentative holds |
| `payment-tools.ts` | `handleRequestPayment` | Stripe/PayPal checkout with slot recovery fallback |
| `phone-tools.ts` | `handleRequestPhone` | Returns phone input widget config |
| `signal-tool.ts` | `SIGNAL_TOOL`, `handleReportSignals` | Qualification extraction schema (no-op handler) |

### Persona (`src/persona/`)

| File | Export | Purpose |
|------|--------|---------|
| `loader.ts` | `buildSystemPrompt(tier)` | Two-layer template engine (placeholders + variables) |
| `lobby.ts` | `buildLobbyPrompt(session)` | Lobby prompt + windowed history (last 5 exchanges) + signal tool only |
| `meeting-room.ts` | `buildMeetingRoomPrompt(session)` | Meeting room prompt + full history + gated tools |

Tool gating in meeting room: `request_phone` always available → `check_calendar_availability` after phone captured → `request_payment` after slots offered.

### SSE (`src/sse/`)

| File | Export | Purpose |
|------|--------|---------|
| `writer.ts` | SSE helper functions | `setupSSE`, `writeProcessing`, `writeToken`, `writeStructuredMessage`, `writeStreamEnd`, etc. |
| `tool-call-sanitizer.ts` | `ToolCallSanitizer` class | State machine that strips leaked tool call XML/text from the token stream |

### Security (`src/security/`)

| File | Export | Purpose |
|------|--------|---------|
| `guard.ts` | `evaluateGuard(session, threatLevel)` | One-way state machine (levels 0-4). Actions: continue, inject_redirect, terminate, block |
| `input-filter.ts` | `filterInput(text, sessionId, ipHash)` | Regex-based injection, hostility, profanity detection |
| `output-filter.ts` | `filterOutput(text)` | Scans LLM output for prompt leakage, methodology keywords, internal keywords |
| `rate-limiter.ts` | `checkSessionLimit`, `checkIpLimit` | Per-session message quota + per-IP hourly quota |
| `ip-blocklist.ts` | `blockIp`, `isBlocked` | In-memory IP blocklist with TTL |

### Scoring (`src/scoring/`)

| File | Export | Purpose |
|------|--------|---------|
| `engine.ts` | `updateScore(session, behavioral, qualification)` | Weighted composite: explicit (0.40) + behavioral (0.35) + fit (0.25). Returns classification + shouldEscalate |
| `explicit.ts` | `scoreExplicit(signals)` | Scores 6 qualification dimensions (0-10 each) from report_signals. Also computes fit score |
| `behavioral.ts` | `scoreBehavioral(signals, messageCount)` | Scores human engagement from frontend telemetry (typing speed, corrections, mouse, etc.) |

### Session (`src/session/`)

| File | Export | Purpose |
|------|--------|---------|
| `manager.ts` | `createSession`, `getSession`, `updateSession`, `closeSession`, `startExpiryTimer` | Full session lifecycle. Consent gate on persistence. Queue promotion on close |
| `store-memory.ts` | `getSessionStore`, `getQueue`, `addToQueue`, `promoteFromQueue` | In-memory HashMap + FIFO queue |
| `budget.ts` | `getBudget`, `canAfford`, `consume` | Tiered token budgets (anonymous → engaged → qualified → post_booking) |

### Database (`src/db/`)

| File | Export | Purpose |
|------|--------|---------|
| `sqlite.ts` | `getDb`, `closeDb` | Lazy singleton SQLite connection. In-memory for dev, file for prod |
| `conversations.ts` | `persistSession`, `persistMessage`, `logSecurityEvent` | Write sessions/messages to SQLite (consent-gated). Security events always logged |

### Integrations (`src/integrations/`)

| File | Purpose |
|------|---------|
| `google-auth.ts` | OAuth2 token refresh + caching for Google APIs |
| `calendar.ts` | Google Calendar: busy queries, slot computation, booking event creation. 5-min slot cache |
| `calendar-holds.ts` | Tentative `[HOLD]` events. In-memory registry. Cleanup on close/payment/sweep |
| `stripe.ts` | Embedded checkout sessions. Webhook signature verification |
| `paypal.ts` | Order creation, capture, webhook verification (credentials not provisioned) |
| `trello.ts` | Low-level Trello API: board/list resolution, card CRUD |
| `trello-cards.ts` | High-level: `createLeadCard`, `moveToPhoneCaptured`, `moveToBooked` |
| `telegram.ts` | Fire-and-forget notifications: qualified leads, bookings, security incidents |

### Middleware (`src/middleware/`)

| File | Purpose |
|------|---------|
| `session-lookup.ts` | Validates session ID, loads session, rejects closed sessions (410) |
| `validate-request.ts` | UUID format validation, Content-Type checks |

---

## LLM Adapter Pattern

The adapter interface is defined in `src/llm/adapter.ts`:

```typescript
interface LLMAdapter {
  chat(request: LLMChatRequest): AsyncGenerator<LLMEvent>;
}
```

`LLMEvent` is a discriminated union:
- `{ type: 'token', text }` — streaming text chunk
- `{ type: 'tool_call', id, name, args, thought_signature? }` — tool invocation
- `{ type: 'done', usage: { input_tokens, output_tokens } }` — completion
- `{ type: 'error', message }` — failure

The router (`src/llm/router.ts`) selects the adapter based on session tier (lobby vs meeting_room) and caches instances per `provider:model`.

### To add a new provider

1. Create `src/llm/your-provider.ts` implementing `LLMAdapter`
2. Add a case to `createAdapter()` in `router.ts`
3. Update config with the new provider name

---

## Prompt Assembly Pipeline

Two-layer templating in `src/persona/loader.ts`:

**Layer 1 — Structural Placeholders** (assembly time):
```
[SHARED_PERSONA]           → prompts/shared-persona.md
[KNOWLEDGE_BASE]           → prompts/knowledge-base.md
[SECURITY_INSTRUCTIONS]    → prompts/security-instructions.md
[LANGUAGE_INSTRUCTIONS]    → prompts/language-instructions.md
[QUALIFICATION_EXTRACTION] → prompts/qualification-extraction.md
```

Tier files (`lobby.md`, `meeting-room.md`) contain these placeholders. The loader reads each referenced file and inlines it.

**Layer 2 — Identity Variables** (runtime):
```
{{owner}}          ← client.owner
{{company}}        ← client.company
{{persona_name}}   ← persona.name
{{services_name}}  ← services.name
...etc
```

All `{{variables}}` are resolved from the app config. Unresolved variables trigger a console warning.

Prompt files are cached after first load. Call `clearPromptCache()` to invalidate.

---

## Tool Call Loop

The message handler runs up to `MAX_TOOL_ROUNDS` (3) iterations:

```
Round N:
  1. Send chat request to LLM (system + messages + tools)
  2. Stream tokens → sanitize → emit to client
  3. Collect tool calls
  4. If no tool calls → break (done)
  5. Separate report_signals from action tools
  6. Capture report_signals data
  7. If only report_signals + no text → inject continuation, loop
  8. If multiple action tools → execute FIRST only, defer rest
  9. Per-turn dedup: suppress duplicate check_calendar_availability
  10. Execute tool → get result + optional structured message
  11. Emit structured message to frontend
  12. Append tool call + result to message history
  13. If text already produced → break (done)
  14. If no text → inject continuation instruction, loop
```

Key constraints enforced:
- **One action tool per round** — prevents dumping phone + calendar + payment simultaneously
- **Per-turn calendar dedup** — `calendarCheckUsedThisTurn` flag
- **Continuation injection** — forces text after tool-only rounds
- **Empty response fallback** — graceful message if all rounds produce nothing

---

## SSE Streaming Protocol

Every message response follows this lifecycle:

```
event: processing     ← always first
data: {"tier":"lobby"}

event: token          ← zero or more
data: {"text":"Hello"}

event: structured_message  ← zero or more (calendar_slots, payment_request, phone_request, etc.)
data: {"type":"calendar_slots","payload":{...}}

event: message_complete    ← always (after all content)
data: {"tokens_used":150,"tokens_remaining":29850}

event: tier_change         ← conditional
event: budget_warning      ← conditional
event: budget_exhausted    ← conditional

event: stream_end          ← always last
data: {}
```

The `ToolCallSanitizer` (`sse/tool-call-sanitizer.ts`) runs as a state machine on the token stream, detecting and stripping three leak patterns:
1. XML tags: `<tool_call:report_signals .../>`
2. Function calls: `report_signals(qualification={...})`
3. Preamble lines: `Tagged calls:\n`

It holds back partial matches at chunk boundaries and flushes incomplete buffers at end-of-stream.

---

## Security Pipeline

### Input Filter (`security/input-filter.ts`)

Pre-LLM validation. Checks (in order):
1. Length > 2000 chars → threat level 1
2. Rapid-fire (< 3s between messages) → flagged
3. Injection patterns (prompt resets, jailbreaks, `[INST]`, etc.) → threat level 2
4. Hostility (threats, violence) → threat level 3
5. Profanity (en/de/pt) → threat level 1

### Guard State Machine (`security/guard.ts`)

One-way escalation (never decreases):

| Guard Level | Trigger | Action |
|-------------|---------|--------|
| 0 → 1 | Threat level 1 | `inject_redirect` (soft nudge appended to system prompt) |
| 1 → 2 | Threat level 1 again, or level 2 | `inject_redirect` (stronger warning) |
| 2 → 3 | Threat level 2+, or third offense | `terminate` (session killed, localized message) |
| 3 → 4 | Threat level 3 | `block` (IP blocklisted + terminate) |

### Output Filter (`security/output-filter.ts`)

Post-LLM scan. Detects leaked prompt keywords, sales methodology names, architecture terms, tool call remnants, scoring field names, and configurable internal keywords. On failure: replaces response with generic fallback and escalates guard by 1 level.

---

## Scoring & Tier Escalation

Three scoring components combined via weighted average:

| Component | Weight | Source | Range |
|-----------|--------|--------|-------|
| Explicit | 0.40 | `report_signals` tool (6 dimensions × 10) | 0-100 |
| Behavioral | 0.35 | Frontend telemetry (typing, mouse, corrections) | 0-100 |
| Fit | 0.25 | need_alignment + authority_level + budget_indicator | 0-100 |

**Classification thresholds** (configurable):
- `hot` — composite >= 70 (qualified threshold)
- `warm` — composite >= 45
- `cold` — composite >= 25
- `disqualified` — below 25

**Escalation** triggers on first crossing of the qualified threshold while in lobby tier. On escalation:
1. Session tier → `meeting_room`
2. Trello lead card created
3. Telegram notification sent
4. `tier_change` SSE event emitted

---

## Calendar Hold System

Tentative holds prevent double-booking while the visitor decides:

1. **Slot IDs are deterministic**: `sha256(startIso).slice(0,8)` — same time always gets same ID
2. When `check_calendar_availability` reveals a slot, a tentative Google Calendar event is created (`status: 'tentative'`, `transparency: 'opaque'`, summary prefixed `[HOLD]`)
3. Opaque events block the slot in `queryBusySlots()` — other visitors can't see it
4. **Own-hold recognition**: Before declaring a slot unavailable, tools call `getHeldSlot(sessionId, slotId)` to check if the hold belongs to the current session
5. Hold metadata stored in `session.metadata.slot_holds` (maps slotId → holdEventId)
6. **Multi-slot recovery** (in payment-tools): If a slot is genuinely gone, deletes stale hold, fetches alternatives, creates new holds, returns slot card

### Cleanup triggers

- Session close (fire-and-forget)
- Payment confirmation (specific hold + all remaining)
- 60-second periodic sweep (safety net)

---

## Payment Flow

```
Visitor agrees to book
     │
     ├── request_phone → phone_request widget
     │   └── Visitor submits phone → stored in session.metadata.phone
     │
     ├── check_calendar_availability → calendar_slots widget (1 slot)
     │   └── Visitor selects slot → slot_selected action
     │
     ├── request_payment
     │   ├── Verify slot still available (or own-hold)
     │   ├── If slot gone → fetch alternatives, return calendar_slots
     │   ├── If available → create Stripe + PayPal checkout sessions
     │   └── Return payment_request widget (embedded checkout)
     │
     └── Stripe webhook: checkout.session.completed
         ├── Confirm hold → create booking event on Google Calendar
         ├── Delete all remaining holds for session
         ├── Move Trello card to "Booked"
         ├── Send Telegram notification
         └── Push booking_confirmed to session history
```

Stripe uses embedded mode (`ui_mode: 'embedded'`). Card/Apple Pay/Google Pay complete in-page. Redirect-based methods (iDEAL, Bancontact) fall back to `return_url`.

---

## Session Lifecycle

```
createSession()
     │
     ├── status: active (or queued if max_concurrent reached)
     ├── tier: lobby
     ├── consent: pending
     ├── guard_level: 0
     │
     ├── Consent granted → session.consent = 'granted' (enables persistence)
     │
     ├── Messages exchanged → scoring updated → possible escalation to meeting_room
     │
     └── closeSession()
         ├── Reasons: visitor_left, new_session, timeout, security, budget_exhausted
         ├── If consent granted → persist to SQLite
         ├── Delete calendar holds
         └── Promote next queued session
```

Session expiry runs every 60 seconds, closing sessions that exceed `session_ttl_minutes`.

---

## Gemini Quirks & Mitigations

The current LLM is Gemini 3 Flash Preview. Known issues and their mitigations:

| Issue | Mitigation | Location |
|-------|-----------|----------|
| **Thinking-only responses** — produces thinking tokens with zero visible text | Bumped `maxOutputTokens` (lobby 4096, meeting room 8192) | `config.ts`, `gemini.ts` |
| **thinkingConfig breaks model** — setting `thinkingConfig: { thinkingBudget: N }` causes zero output | Never use `thinkingConfig` with this model | `gemini.ts` |
| **report_signals loops** — calls report_signals twice without producing text | Stronger continuation prompt + loop detection (bail after round > 0) | `message.ts` |
| **Tool call XML leakage** — emits `<tool_call:.../>` as raw text | `ToolCallSanitizer` strips in streaming; output-filter as safety net | `tool-call-sanitizer.ts`, `output-filter.ts` |
| **Empty response after action tools** — zero text after calendar/payment/phone | Inject system continuation instruction when no text produced | `message.ts` |
| **Empty response fallback** — no text after all rounds, no structured messages | Graceful generic response | `message.ts` |

---

## Adding a New LLM Provider

1. Create `src/llm/your-provider.ts`:
   ```typescript
   import type { LLMAdapter, LLMChatRequest, LLMEvent } from './adapter.js';

   export class YourProviderAdapter implements LLMAdapter {
     async *chat(request: LLMChatRequest): AsyncGenerator<LLMEvent> {
       // Stream tokens, tool calls, done event
     }
   }
   ```

2. Register in `src/llm/router.ts` — add a case to `createAdapter()`.

3. Add config:
   ```json
   {
     "llm": {
       "lobby": { "provider": "your-provider", "model": "model-name", "max_tokens": 1024 }
     }
   }
   ```

4. Store credentials in `credentials_path/your_api_key`.

---

## Adding a New Tool

1. Create handler in `src/tools/your-tool.ts`:
   ```typescript
   export function handleYourTool(session: Session, args: Record<string, unknown>): ToolCallResult {
     return {
       result: { /* JSON returned to LLM */ },
       structured: { type: 'your_widget', payload: { /* sent to frontend */ } },  // optional
     };
   }
   ```

2. Add tool definition (follows Gemini function declaration format):
   ```typescript
   export const YOUR_TOOL: ToolDefinition = {
     name: 'your_tool',
     description: '...',
     parameters: { type: 'object', properties: { ... } },
   };
   ```

3. Register in `src/tools/handler.ts` — add case to the switch.

4. Include tool in prompt builder (`persona/lobby.ts` or `persona/meeting-room.ts`).

5. If the tool emits structured messages, add the type to the SSE contract (`docs/SSE-STRUCTURED-MESSAGES-CONTRACT.md`) and coordinate with frontend.

---

## Testing

Test framework: Vitest. Currently zero test files — tests to be added.

```bash
npm test           # vitest run
```

---

## Conventions

- **Commit format**: `[saifa] Description of change`
- **Never commit secrets** — credentials are filesystem-loaded
- **ES modules** — all imports use `.js` extension
- **Strict TypeScript** — `strict: true` in tsconfig
- **Fire-and-forget pattern** — Trello card moves, Telegram notifications, hold cleanup on close use `.catch()` handlers without blocking
- **No inline business identity** — company names, owner names, persona names come from config or prompt templates
- **One action tool per round** — enforced in message.ts, not just a convention
- **Output scanning** — never trust LLM output to be clean; sanitize and filter

---

## Related Documentation

- [SSE Structured Messages Contract](./SSE-STRUCTURED-MESSAGES-CONTRACT.md) — Frontend/middleware streaming protocol
- [API Specification](./architecture/PUBLIC-JUSTEC-API-SPEC.md) — REST + SSE endpoint contract
- [Admin Guide](./ADMIN-GUIDE.md) — Configuration, deployment, and troubleshooting
