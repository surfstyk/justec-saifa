# Maren Integration Target Architecture

Date: 2026-03-31
Context: SAIFA repository integration plan for Maren as `src/interview/`
Goal: implement Maren inside SAIFA now without blocking future extraction into a standalone product

## Purpose

This document defines the target architecture for integrating Maren into the current SAIFA codebase.

It is intentionally pragmatic:

- no plugin system
- no generic dependency-injection framework
- no rewrite of SAIFA core

But it also rejects the idea that Maren should directly couple to every existing SAIFA internal. The objective is:

1. deliver Maren as an in-repo module
2. keep the integration fast enough for MVP
3. establish enough boundary now that standalone extraction remains realistic later

## Architectural Position

Maren should be implemented as a **bounded feature module** inside SAIFA:

- code lives in `src/interview/`
- SAIFA owns HTTP lifecycle, sessions, pipeline orchestration, and base security enforcement
- Maren owns interview behavior, blueprint state progression, proposal generation triggers, and interview-specific policy

This is not a plugin.
This is not a separate app.
This is a bounded subsystem inside the current service.

## Key Design Rule

Maren must not depend directly on arbitrary SAIFA internals.

Instead, SAIFA should provide Maren with a narrow bridge contract covering:

- conversation context
- persistence
- event emission
- security policy
- model execution

That bridge is the seam that preserves extractability.

## Recommended High-Level Shape

```text
src/
  interview/
    index.ts

    core/
      types.ts
      blueprint.ts
      rounds.ts
      escalation.ts
      prompt.ts
      tools.ts
      policy.ts
      handover.ts

    application/
      service.ts
      resume.ts
      proposal-orchestrator.ts

    ports/
      runtime.ts
      repository.ts
      events.ts
      llm.ts
      jobs.ts

    adapters/
      saifa-runtime.ts
      sqlite-repository.ts
      saifa-events.ts
      saifa-llm.ts
      queue-jobs.ts
      routes.ts

    proposal/
      generator.ts
      template.ts
      pdf.ts

    portrait/
      generator.ts

    follow-up/
      generator.ts
      brevo.ts
```

## What Belongs Where

### `core/`

Pure Maren domain logic. No Express, no SQLite, no SSE writer, no direct config reads.

This layer should own:

- Blueprint schema and validation
- interview round definitions
- interview completion rules
- escalation criteria into Maren
- interview prompt composition rules
- interview-specific tool policy
- Justec-to-Maren handover history transformation

### `application/`

Use-case orchestration for Maren behavior.

This layer should own:

- advancing round state
- restoring an interview from persisted state
- triggering proposal generation after confirmation
- deciding what async jobs to enqueue

### `ports/`

Interfaces Maren needs from the outside world.

These are the main future extraction seam.

### `adapters/`

SAIFA-specific implementations of the ports.

This is where Maren is allowed to know about:

- current session object shape
- SQLite
- current SSE message format
- current llm router
- current route mounting style

### `proposal/`, `portrait/`, `follow-up/`

Subdomains under Maren, but not part of the hot interview loop.

These should mostly be triggered asynchronously.

## Required Bridge Contracts

## 1. Runtime Port

This isolates Maren from direct dependence on the full SAIFA `Session`.

```ts
export interface ConversationSnapshot {
  sessionId: string;
  tier: 'lobby' | 'meeting_room' | 'interview_room';
  language: 'en' | 'de' | 'pt';
  guardLevel: 0 | 1 | 2 | 3 | 4;
  consent: 'pending' | 'granted' | 'declined';
  visitor: {
    name: string | null;
    company: string | null;
    role: string | null;
    companySize: string | null;
    industry: string | null;
  };
  history: Array<{
    role: 'visitor' | 'assistant';
    content: string;
    timestamp: string;
  }>;
}

export interface InterviewRuntimePort {
  getConversationSnapshot(sessionId: string): Promise<ConversationSnapshot>;
  updateSessionTier(sessionId: string, tier: 'interview_room'): Promise<void>;
  updateVisitorIdentity(sessionId: string, patch: Record<string, unknown>): Promise<void>;
}
```

Why:

- prevents `src/interview/` from importing the entire mutable `Session` model
- makes extraction into another app possible later

## 2. Repository Port

Interview state must not live primarily in `Session.metadata`.

```ts
export interface InterviewRecord {
  id: string;
  sessionId: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  currentRound: number;
  blueprintJson: string | null;
  proposalToken: string | null;
  proposalStatus: 'pending' | 'generated' | 'sent' | 'viewed' | 'expired' | null;
  portraitUrl: string | null;
  proposalPdfPath: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface InterviewRepositoryPort {
  getBySessionId(sessionId: string): Promise<InterviewRecord | null>;
  getByProposalToken(token: string): Promise<InterviewRecord | null>;
  createForSession(sessionId: string, language: string): Promise<InterviewRecord>;
  saveRoundState(interviewId: string, currentRound: number, blueprintJson: string): Promise<void>;
  markCompleted(interviewId: string, blueprintJson: string): Promise<void>;
  setProposalArtifacts(interviewId: string, patch: Record<string, unknown>): Promise<void>;
}
```

Why:

- keeps interview persistence first-class
- avoids stuffing proposal state into generic session fields

## 3. Events Port

Maren should not emit SSE directly from core logic.

```ts
export interface InterviewEventsPort {
  emitProgress(sessionId: string, completedRound: number, totalRounds: number, roundName: string): Promise<void>;
  emitTierChange(sessionId: string, data: Record<string, unknown>): Promise<void>;
  emitProposalReady(sessionId: string, token: string): Promise<void>;
}
```

Why:

- keeps UI contract separate from Maren core
- lets the future standalone app emit websocket/SSE/HTTP polling events differently

## 4. LLM Port

Do not let Maren call provider SDKs directly from core logic.

```ts
export interface InterviewLLMPort {
  runInterviewTurn(input: {
    system: string;
    messages: Array<Record<string, unknown>>;
    tools: Array<Record<string, unknown>>;
    modelHint: 'interview_room';
  }): AsyncGenerator<Record<string, unknown>>;

  generateProposal(input: {
    blueprintJson: string;
    language: string;
  }): Promise<{ text: string }>;
}
```

Why:

- interview flow and proposal generation may use different models later
- preserves provider swap flexibility

## 5. Jobs Port

Proposal rendering, portrait generation, and follow-up preparation should be async.

```ts
export interface InterviewJobsPort {
  enqueueProposalGeneration(interviewId: string): Promise<void>;
  enqueuePortraitGeneration(interviewId: string): Promise<void>;
  enqueueFollowUpPreparation(interviewId: string): Promise<void>;
}
```

Why:

- removes long-running work from the chat request path

## SAIFA Integration Points

These are the places SAIFA should integrate with Maren.

## 1. Types

Minimal central additions are acceptable:

- add `'interview_room'` to `SessionTier`
- add `interview_progress` to `ChatEventType`
- add `llm.interview_room` config

But avoid adding large Maren-specific state blobs to `Session`.

## 2. Prompt Selection

In this repository, the correct tier dispatch point is:

- `src/pipeline/stages/prompt-build.ts`

Not `src/persona/loader.ts`.

Recommended change:

- extract tier dispatch into a small prompt resolver
- let that resolver delegate to lobby, meeting room, or Maren builders

Target shape:

```ts
const prompt = resolvePromptForTier(ctx.session.tier, ctx.session);
```

This is cleaner than embedding a third branch directly into the stage forever.

## 3. Tool Dispatch

Current tool dispatch is centralized in:

- `src/tools/handler.ts`

Maren should not just append more cases blindly.

Recommended change:

- add a tier-aware authorization layer before tool execution

Target rule:

- public tiers can only execute tools allowed for that tier
- Maren tools must be explicitly whitelisted for `interview_room`
- booking/payment tools must be unavailable in `interview_room` unless intentionally bridged

## 4. Score Routing

Current escalation logic is hardcoded around lobby -> meeting room.

Recommended change:

- separate score calculation from routing decision
- let routing return one of:
  - stay
  - escalate_to_meeting_room
  - escalate_to_interview_room

This avoids stuffing Maren-specific logic into score math.

## 5. Route Mounting

Route mounting belongs in:

- `src/index.ts`

Not a nonexistent `src/app.ts`.

Recommended approach:

- mount `proposalRouter` from a SAIFA adapter
- keep route construction in `src/interview/adapters/routes.ts`
- keep route mounting outside Maren core

## Recommended Internal Flow

## 1. Handover Into Maren

1. SAIFA scoring/router decides the session should enter `interview_room`.
2. SAIFA runtime adapter creates or loads the interview record.
3. Maren `handover.ts` transforms existing Justec history into a clean `ConversationSnapshot`.
4. Tier changes to `interview_room`.
5. Frontend receives extended `tier_change`.

Important:

- strip tool noise
- keep only human-readable assistant/visitor text
- prepend a short handover note rather than raw internal system framing

## 2. Interview Turn

1. `message` route enters normal SAIFA pipeline.
2. Prompt resolver chooses Maren builder for `interview_room`.
3. Tool resolver exposes only:
   - Maren tools
   - `report_signals` if still needed
4. LLM stream runs through the same pipeline shell.
5. `round_complete` tool persists round state through repository port.
6. Event port emits `interview_progress`.

## 3. Proposal Generation

1. Final round confirms Blueprint.
2. Application service marks interview completed.
3. Jobs port enqueues:
   - proposal generation
   - portrait generation
   - follow-up preparation
4. Worker writes artifacts back via repository port.
5. Event port notifies frontend if still connected.
6. Proposal route serves HTML/PDF by proposal token.

## What Must Stay Synchronous

- chat turn processing
- round-complete validation
- round state persistence
- progress event emission
- tier transition

## What Must Be Asynchronous

- proposal letter generation
- portrait generation
- PDF rendering
- follow-up email preparation
- any external notification not required for the user to continue

## Security-Critical Requirements

Maren inherits the audit findings. The following items are mandatory if Maren is added.

## 1. Session authorization before Maren launch

Maren will create higher-value assets:

- Blueprint
- proposal links
- resume flows

So SAIFA must stop treating session UUIDs as bearer credentials before Maren is exposed.

Required:

- per-session secret or signed token
- required on all session-bound endpoints
- proposal tokens separate from session tokens

## 2. Inline output enforcement

Maren’s stricter vocabulary controls only matter if output is checked before text is released to the client.

Required:

- outbound buffer/gate in the streaming path
- tier-aware leakage policy
- regenerate or replace before emitting unsafe text

## 3. Tool-level enforcement

Maren’s tools must be authorized in code, not just by prompt.

Required:

- tier-aware tool allowlist
- server-side validation of round transitions
- server-side validation of `round_complete` payloads

## 4. Proposal token model

Proposal view tokens must not be session IDs.

Required:

- random high-entropy proposal token
- independently revocable
- expiry enforced server-side
- no access to live session internals from proposal route

## 5. Interview state isolation

Required:

- no cross-session query tools
- no raw filesystem access
- no inheritance of arbitrary internal knowledge
- only curated tools and curated prompt knowledge

## Data Model Recommendation

Keep SAIFA `sessions` and Maren `interviews` separate.

### `sessions`

Continue to represent:

- live public conversation container
- guard level
- language
- token usage
- minimal visitor identity

### `interviews`

Represent:

- interview lifecycle
- current round
- Blueprint
- completion status
- artifact status
- proposal token
- expiry

### Do not store primarily in `Session.metadata`

`metadata` can hold short-lived linking fields, for example:

- `interview_id`

But not:

- full Blueprint
- proposal artifact metadata
- follow-up workflow state

## Extraction Strategy

If Maren later becomes standalone, the extraction path should be:

1. move `src/interview/core`, `application`, and `ports` into a new package/app
2. replace SAIFA adapters with standalone adapters
3. retain the same repository and LLM contracts
4. keep proposal routes in the standalone app

What should survive extraction unchanged:

- Blueprint schema
- round logic
- prompt logic
- interview policy
- proposal orchestration use cases

What should be replaced:

- runtime adapter
- event adapter
- route adapter
- storage adapter if SQLite is no longer sufficient

## Recommended Implementation Order

1. Create `src/interview/core`, `application`, `ports`, `adapters` structure.
2. Implement Blueprint schema and round model first.
3. Implement SQLite-backed `InterviewRepositoryPort`.
4. Implement SAIFA runtime adapter and prompt resolver.
5. Add tier-aware tool authorization.
6. Add interview routing decision separate from score math.
7. Add async job mechanism for proposal artifacts.
8. Add proposal routes and token model.
9. Only then enable actual escalation into Maren.

## Non-Goals For MVP

Do not build these now:

- generic room registry
- generic plugin framework
- multi-provider abstraction for portrait generation
- deep mid-turn replay/resume
- shared universal workflow engine for every future persona

These will slow delivery and are not required to preserve a credible extraction path.

## Bottom Line

The right architecture for Maren in this repository is:

- in-repo module
- explicit bounded context
- narrow bridge to SAIFA core
- separate interview persistence
- async artifact generation
- stronger trust-boundary enforcement than SAIFA currently has

That is the smallest design that is both:

- realistic for MVP
- structurally honest about the future standalone goal
