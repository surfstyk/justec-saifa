# SAIFA v2.0 — Roadmap & Implementation Specification

**Date**: 2026-03-13
**Version**: 2.0.0 (starting point)
**Author**: Hendrik Bondzio / Claude Opus 4.6

---

## Context

SAIFA v1 shipped in two weeks (Feb 27 – Mar 12): 36 commits, ~6,300 lines of TypeScript, a working qualification funnel, booking flow, and five integrations. The system works — it qualifies leads, books sessions, processes payments.

What's missing: **visibility**. The operator has no way to see what SAIFA is doing without SSH + console logs. The message pipeline is a 521-line monolith that's difficult to test or instrument. There are zero automated tests.

v2.0 addresses this in four phases, ordered by dependency and value.

---

## Phase 1: Admin Dashboard

**Goal**: A single place for the operator to see what SAIFA is doing, how it's performing, and how it's configured.

### Architecture

Server-rendered HTML served by the existing Express server at `/admin/*`. No SPA framework, no new npm dependencies. Basic HTTP auth from a credentials file.

```
Browser → /admin/* → Basic Auth middleware → Admin route handlers →
  ├─ Server-rendered HTML (template literals, no engine dependency)
  ├─ In-memory session store (read-only access)
  ├─ SQLite (historical data + aggregates)
  └─ Config + prompt files (read-only display)
```

### Why server-rendered, not a SPA

- Zero additional dependencies
- No separate build step
- Single user (the operator) — no need for rich interactivity
- Ships faster, maintains easier
- Progressive enhancement with htmx later if needed

### Authentication

HTTP Basic Auth. Credentials loaded from `{credentials_path}/admin_password` (format: `username:bcrypt_hash`). Falls back to a dev-mode default if `config.dev_mode` is true.

### New Files

```
src/
  admin/
    middleware.ts      — Basic auth + dev-mode bypass
    routes.ts          — All /admin/* route handlers
    templates/
      layout.ts        — Shared HTML shell (head, nav, styles)
      overview.ts      — Dashboard overview
      sessions.ts      — Active sessions table
      session-detail.ts — Single session timeline
      prompts.ts       — Prompt viewer
      config.ts        — Config viewer (credentials redacted)
      history.ts       — Closed session history (paginated)
      performance.ts   — Aggregate metrics + trends
    queries.ts         — SQLite aggregate queries for dashboard
    stats.ts           — In-memory counters (daily stats, reset at midnight)
```

### Screens

#### 1. Overview (`/admin/`)

Live operational snapshot. Auto-refreshes every 30 seconds.

| Section | Data Source |
|---------|------------|
| Active sessions (count, per-tier, oldest) | In-memory store |
| Queue depth + estimated wait | In-memory queue |
| Today's counters: sessions, messages, escalations, bookings | In-memory stats |
| Blocked IPs, guard escalations today | IP blocklist + security_events |
| System: uptime, Node version, LLM model, config loaded, version | Process info + config |

#### 2. Active Sessions (`/admin/sessions`)

Table: session ID (truncated), tier, language, message count, composite score + classification, time active, last message age, phone/slot/payment status. Click-through to detail.

#### 3. Session Detail (`/admin/sessions/:id`)

For active sessions (from memory) and closed sessions (from SQLite):

- **Timeline**: Every message (visitor + assistant + tool calls), structured messages, guard events
- **Scoring panel**: Composite with dimension breakdown (explicit 6 dimensions, behavioral, fit)
- **Visitor info**: Extracted name, company, role, phone
- **Budget bar**: Tokens used / total, visual indicator
- **Security**: Guard level, filter triggers

#### 4. Prompt Viewer (`/admin/prompts`)

- List of all prompt files with content (syntax-highlighted markdown)
- **Assembled view**: The complete system prompt for lobby and meeting_room tiers, post-template resolution — shows exactly what the LLM sees
- **Variable table**: `{{variable}}` → resolved value from config

This directly addresses the "how do I parameterize the LLM" question.

#### 5. Config Viewer (`/admin/config`)

Read-only display of loaded config, organized by section. Credential values replaced with `[REDACTED]`. Shows:

- LLM settings (model, max_tokens, temperature per tier)
- Scoring weights and thresholds
- Rate limits and budgets
- Calendar configuration
- Payment settings

#### 6. History (`/admin/history`)

Paginated table of closed sessions from SQLite. Columns: date, duration, tier reached, final score, classification, visitor info (if consented), booking/payment status. Click-through to full conversation.

Query params: `?page=1&per_page=25&classification=hot&from=2026-03-01`

#### 7. Performance (`/admin/performance`)

Aggregate metrics computed from SQLite + in-memory counters:

- Sessions per day (7-day and 30-day trend)
- Conversion funnel: sessions → qualified → phone captured → booked → paid
- Average messages to qualification
- Average session duration
- Score distribution (histogram by classification)
- Token consumption per session (avg, p50, p95)
- Security events trend (daily)
- LLM error rate

### Supporting Changes

**Session store** — expose `getAll(): Session[]` and `getStats()` methods on the in-memory store (currently only has `get(id)` and `set(id, session)`).

**In-memory stats counter** — lightweight daily counter object: sessions_created, messages_processed, escalations, bookings, security_events. Resets at midnight. Survives in-memory but not process restarts (acceptable — SQLite has the durable data).

**SQLite aggregate queries** — new query module with functions like `getSessionsByDay(days)`, `getConversionFunnel(from, to)`, `getScoreDistribution()`, etc. All read-only.

### What This Does NOT Include

- Real-time WebSocket updates (polling/refresh is sufficient for single user)
- Prompt editing (edit in your editor, deploy via `deploy.sh`)
- User management (single admin user)
- Log streaming (SSH + `journalctl -u justec-public` is fine)
- Mobile-responsive layout (desktop admin tool)

---

## Phase 2: Pipeline Refactor

**Goal**: Extract the message processing monolith (`src/routes/message.ts`, 521 lines) into a testable, instrumentable pipeline.

### Current State

`message.ts` does everything sequentially in one function: validation → input filtering → guard evaluation → budget check → prompt assembly → LLM streaming → tool dispatch → output filtering → scoring → tier escalation → token tracking → SSE emission. It works but is untestable and opaque.

### Target State

```
src/
  pipeline/
    index.ts            — MessagePipeline class, orchestrates stages
    stages/
      validate.ts       — Input validation + rate limiting
      security-in.ts    — Input filter + guard evaluation
      budget-check.ts   — Pre-flight budget verification
      prompt-build.ts   — Tier-aware prompt assembly
      llm-stream.ts     — LLM call + tool dispatch loop
      security-out.ts   — Output filter + leakage detection
      score-update.ts   — Scoring + tier escalation
      budget-consume.ts — Token consumption + exhaustion check
    types.ts            — PipelineContext, StageResult interfaces
```

Each stage:
- Receives a `PipelineContext` (session, request, accumulated state)
- Returns a `StageResult` (continue/halt + updated context)
- Can emit telemetry events (for dashboard stats)
- Is independently unit-testable

The route handler (`message.ts`) becomes thin: create context → run pipeline → handle SSE emission.

### Why Before Tests

You can't effectively unit-test a 521-line function. The refactor creates the seams that tests hook into. The pipeline stages also naturally emit the telemetry that feeds the dashboard's performance metrics.

### Migration Strategy

1. Extract stages one at a time (validate first, then security, etc.)
2. Each extraction is a standalone commit
3. After each extraction: verify manually that the chat still works end-to-end
4. Once all stages extracted: the route handler is just orchestration
5. No behavioral changes — pure refactor

---

## Phase 3: Tests

**Goal**: Automated test coverage for core business logic and the pipeline.

### Test Targets (Priority Order)

| Module | Why | Type |
|--------|-----|------|
| `scoring/engine.ts` | Core business logic — classification thresholds, composite calculation | Unit |
| `scoring/explicit.ts` | Signal-to-score mapping | Unit |
| `scoring/behavioral.ts` | Frontend signal interpretation | Unit |
| `security/input-filter.ts` | Injection detection, profanity, hostility patterns | Unit |
| `security/output-filter.ts` | Leakage detection patterns | Unit |
| `security/guard.ts` | State machine escalation logic | Unit |
| `sse/tool-call-sanitizer.ts` | Streaming state machine (complex, bug-prone) | Unit |
| `session/budget.ts` | Budget tier calculation, consumption | Unit |
| `persona/loader.ts` | Template resolution, variable substitution | Unit |
| Pipeline stages (from Phase 2) | Each stage in isolation | Unit |
| Message pipeline end-to-end | Full request with mocked LLM | Integration |

### Test Infrastructure

Already configured: Vitest in `package.json`. Just needs test files.

Tests go in `src/__tests__/` or colocated as `*.test.ts`.

LLM mocking: Create a `MockAdapter` implementing `LLMAdapter` that yields predetermined responses. Useful for pipeline integration tests without hitting Gemini.

### What We Don't Test

- External integrations (Google Calendar, Stripe, Trello, Telegram) — these are HTTP calls to third parties, mock at the boundary
- Express route handling — tested implicitly through pipeline integration tests
- HTML templates (Phase 1) — visual, not worth testing

---

## Phase 4: Token Accuracy

**Goal**: Replace `charCount / 4` estimation with actual API token counts.

### Current State

The Gemini adapter captures a `usage` object in the `done` event:
```typescript
{ type: 'done', usage: { input_tokens, output_tokens } }
```

But `budget.consume()` uses `(inputChars + outputChars) / 4` instead of the actual counts.

### Changes

1. Pass `usage` from the LLM `done` event through the pipeline to `budget.consume()`
2. Store actual token counts on message records (for dashboard display)
3. Update SESSION-ECONOMICS.md cost estimates with real data
4. Dashboard performance screen shows actual vs. estimated (initially, for calibration)

Small change, but depends on dashboard existing to display the data meaningfully.

---

## Sequence & Dependencies

```
Phase 1: Dashboard ──────────────────────────────────
   ↓ (provides visibility into system behavior)
Phase 2: Pipeline Refactor ──────────────────────────
   ↓ (creates testable seams + telemetry hooks)
Phase 3: Tests ──────────────────────────────────────
   ↓ (confidence for further changes)
Phase 4: Token Accuracy ─────────────────────────────
```

Each phase is independently deployable and valuable. The operator gets visibility (Phase 1) before any internal refactoring happens.

---

## Not In Scope

- Frontend changes (the chat widget is a separate project)
- New LLM providers (Gemini adapter is working)
- New tools or integrations
- Session persistence overhaul (in-memory + SQLite consent model is sound)
- Multi-tenant / multi-user admin

---

## Version Mapping

| Version | Milestone |
|---------|-----------|
| 2.0.0 | Repository cleanup, version sync (current) |
| 2.1.0 | Admin dashboard live |
| 2.2.0 | Pipeline refactored |
| 2.3.0 | Test suite in place |
| 2.4.0 | Token accuracy |
