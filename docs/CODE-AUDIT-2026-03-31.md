# SAIFA Code Audit

Date: 2026-03-31
Repository: `justec-saifa`
Audit mode: static code review + local test run (`npm test`, 198/198 passing)

## Executive Summary

This repository has a credible architectural skeleton for a public-facing LLM middleware:

- request flow is staged and readable
- prompt assembly, scoring, routing, tools, and integrations are separated into recognizable modules
- there is clear intent to harden the system with layered controls

That said, the current security model is **not sound enough for a hostile public environment** if the standard is "session-safe, leak-resistant, and hard to abuse under active probing." The main issue is not lack of security features; it is that several of the most important controls are either:

- heuristic instead of authoritative
- applied too late
- based on possession of a session UUID rather than actual session ownership

My overall judgment:

- Architecture quality: **good**
- Productization potential: **good**
- Security posture for public exposure: **moderate on paper, materially weaker in implementation**
- Reuse/extractability: **moderate**, with some clean seams and some important coupling points

## What Is Strong

### 1. The repository has real boundaries

The separation between routes, pipeline stages, persona/prompt loading, LLM adapters, tools, scoring, session management, and integrations is real, not cosmetic. The pipeline is especially readable and is a good base for further hardening:

- `src/pipeline/index.ts`
- `src/pipeline/stages/*`

### 2. Tool exposure is narrower than in many LLM apps

The meeting-room prompt builder exposes tools conditionally based on session progress rather than always giving the model full capability. That is a meaningful control:

- `src/persona/meeting-room.ts:88`

This is better than the common pattern of handing the model the whole capability surface from turn one.

### 3. There is a layered defensive intent

The system combines:

- Turnstile at session creation
- rate limiting
- input filtering
- guard escalation
- output leakage checks
- budget controls
- constrained tool rounds

This shows the right threat model instincts. The weakness is mostly in enforcement quality, not in absence of thinking.

### 4. The codebase is tested

The test suite is substantial for a project of this size, and it covers many behavioral invariants:

- security filters
- guard escalation
- prompt loading
- pipeline flow
- tool-call sanitization
- scoring

That is valuable. The main gap is that the tests validate intended mechanics, not the attack surface at the HTTP/security boundary.

## Priority Findings

## 1. High: Session ownership is not enforced

The system treats the session UUID as both identifier and bearer credential. `sessionLookup` only checks that the UUID exists; it does not bind the session to the caller, a session secret, a signed token, or even the originating IP:

- `src/middleware/session-lookup.ts:4`

Once a caller knows a session ID, they can:

- read full conversation history via `GET /api/session/:id/history`
  - `src/routes/history.ts:7`
- read internal session state, scores, visitor identity, payment state, budget, and guard level
  - `src/routes/state.ts:9`
- read status and activity information
  - `src/routes/status.ts:7`
- mutate consent
  - `src/routes/consent.ts:8`
- send messages as the visitor
  - `src/routes/message.ts:12`
- close the session entirely
  - `src/routes/close.ts:7`

This is the single biggest architectural weakness in the repository.

Why this matters:

- A leaked session ID becomes immediate transcript and state access.
- Browser logs, frontend bugs, analytics, referrer propagation, or client-side storage leakage become much more serious.
- Public introspection endpoints expose internal scores and guard level, which helps attackers tune prompts and probing strategies.

Recommended fix:

1. Split session identity from authorization.
2. Return `session_id` plus a strong `session_token` or signed capability token at creation time.
3. Require the token on every session-bound endpoint.
4. Bind high-risk operations to both token and origin context where practical.
5. Remove or heavily reduce public `/history`, `/state`, and `/status` exposure.

## 2. High: Output leakage checks happen after the content has already been streamed

Tokens are streamed to the client in `llmStream` as soon as they arrive:

- `src/pipeline/stages/llm-stream.ts:46`
- `src/pipeline/stages/llm-stream.ts:50`
- `src/pipeline/stages/llm-stream.ts:53`

The output filter only runs later in `securityOut`, after the full response has been accumulated:

- `src/pipeline/stages/security-out.ts:13`
- `src/pipeline/stages/security-out.ts:16`

At that point the user may already have received the leaked text. The current code only replaces the stored/server-side copy:

- `src/pipeline/stages/security-out.ts:20`

This means the system can detect a leak without actually preventing the leak.

The `ToolCallSanitizer` reduces one class of leakage in-stream, which is useful, but it is not equivalent to a general outbound policy gate.

Recommended fix:

1. Introduce an outbound streaming gate before `writeToken`.
2. Buffer a small rolling window and only release text once it passes leakage checks.
3. Treat output policy enforcement as an inline control, not a post-hoc correction.

## 3. Medium: Consent is presented as mandatory/stateless, but backend enforcement does not match

The session creation response presents a consent-first flow:

- `src/routes/session.ts:85`

The consent endpoint marks a session as `granted` or `declined` and returns `mode: stateless` when declined:

- `src/routes/consent.ts:17`
- `src/routes/consent.ts:23`

But the message endpoint and validation pipeline do not enforce consent status before processing LLM requests:

- `src/routes/message.ts:12`
- `src/pipeline/stages/validate.ts:12`

So in practice:

- `pending` sessions can still message the LLM
- `declined` sessions can still message the LLM
- "stateless" is inaccurate because the session still exists in memory and the full in-memory history still affects model behavior until the session is closed

This is partly a privacy/compliance issue and partly a trust-boundary issue, because the architecture claims a stronger rule than the runtime actually enforces.

Recommended fix:

1. Make consent status a hard precondition in the message path.
2. If decline truly means no conversation, terminate the session immediately.
3. If decline means ephemeral mode, create a genuinely non-persistent/no-history execution path and state that explicitly.

## 4. Medium: Important defenses are memory-local and disappear on restart or multi-instance deployment

Several controls are in-memory maps:

- rate limits
  - `src/security/rate-limiter.ts:8`
- IP blocklist
  - `src/security/ip-blocklist.ts:8`
- sessions
  - `src/session/manager.ts:70`

Operational consequences:

- restart clears active rate limits
- restart clears blocks
- horizontal scaling would fragment protections unless requests are perfectly sticky
- forensic continuity is weak for live controls

This is acceptable for a single-node prototype. It is weak for a public LLM service expected to survive active abuse.

Recommended fix:

1. Move sessions, rate limits, and block decisions to Redis or equivalent shared state.
2. Keep SQLite for consented transcript persistence if desired, but do not make live enforcement state memory-only.

## 5. Medium: Admin authentication is serviceable but weak for a public control surface

The admin panel uses Basic Auth backed by a file containing a SHA-256 password hash:

- `src/admin/middleware.ts:34`
- `src/admin/middleware.ts:36`
- `src/admin/middleware.ts:59`

Issues:

- plain SHA-256 is not a password hashing scheme fit for internet exposure
- no explicit rate limiting on admin auth
- no constant-time comparison
- `dev_mode` bypasses admin auth entirely
  - `src/admin/middleware.ts:46`

Recommended fix:

1. Replace SHA-256 with Argon2id or bcrypt.
2. Add dedicated admin rate limiting and lockout behavior.
3. Prefer reverse-proxy auth, VPN, IP allowlisting, or identity-provider-backed auth for admin.

## 6. Medium: Some security rules depend on prompt discipline or upstream gating rather than hard policy checks

A positive pattern exists in `buildMeetingRoomPrompt`, where tools are conditionally exposed:

- `src/persona/meeting-room.ts:88`

But the tool handlers themselves mostly assume that upstream gating was correct. For example `handleRequestPayment` validates `slot_id` and `visitor_name`, but does not independently enforce the full booking state machine such as "phone must already be captured" as a hard invariant:

- `src/tools/payment-tools.ts:9`

The architecture is therefore partly secure because the prompt builder chose not to expose a tool, not because the tool endpoint itself is fully policy-aware.

This is better than nothing, but it is not ideal for high-assurance public exposure.

Recommended fix:

1. Keep prompt/tool exposure gating.
2. Add redundant hard authorization checks inside each sensitive tool handler.
3. Treat prompt policy as advisory and server policy as authoritative.

## 7. Low to Medium: IP hashing is pseudonymization, not strong privacy isolation

IP hashes are derived from a hard-coded salt:

- `src/session/manager.ts:10`

This is enough to avoid storing raw IPs, but not enough for strong isolation across deployments or future code disclosure. It also makes the salt shared across all installations unless changed in code.

Recommended fix:

- move the salt to per-installation secret config
- document that this is pseudonymization, not anonymization

## Security Model Assessment

The intended model is layered and directionally correct:

1. anti-bot check at entry
2. per-session and per-IP throttling
3. input scanning
4. guard escalation
5. tool constraints
6. output scanning
7. budget exhaustion

The problem is that the strongest guarantees a public LLM needs are not currently guaranteed:

- session isolation is weak
- outbound leak prevention is post-hoc
- consent policy is soft
- stateful controls are not durable

So the current system is **hardened in several places, but not yet hardened at the trust-boundary level**.

## Component Structure And Coupling

## What is clean

The following seams are good:

- LLM adapter boundary
  - `src/llm/adapter.ts`
  - `src/llm/router.ts`
  - `src/llm/gemini.ts`
- persona/prompt assembly
  - `src/persona/*`
  - `prompts/*`
- pipeline stage sequencing
  - `src/pipeline/*`
- integrations grouped by external system
  - `src/integrations/*`

This makes the code understandable and keeps concerns recognizable.

## Where coupling is higher than it looks

### 1. The `Session` object is the de facto shared bus

Almost every subsystem reads or mutates the same mutable `Session` structure:

- prompts decide behavior from it
- tools mutate it
- scoring updates it
- routes expose it
- persistence serializes it

That is convenient, but it means the domain model is tightly interwoven around one large mutable record.

### 2. The pipeline context is also a broad mutable carrier

`PipelineContext` accumulates many concerns in one structure:

- security state
- prompt state
- streaming state
- tool state
- score state
- HTTP response state

This makes orchestration simple, but it also means stage extraction into a separate runtime would require deliberate disentangling.

### 3. Security behavior is partly embedded in prompt construction

Tool availability and some behavioral redirection are injected through prompt assembly:

- `src/persona/meeting-room.ts:88`
- `src/pipeline/stages/prompt-build.ts`
- `src/security/guard.ts:74`

That makes the system effective as a whole, but harder to reuse as an independent "security module" in another context.

## Extractability / Reuse Assessment

## Easy to extract

- prompt loader and prompt directory pattern
- LLM adapter abstraction
- scoring engine
- SSE structured message contract

These parts have relatively clear contracts.

## Moderate to extract

- the pipeline orchestration
- the booking/session flow
- the public persona middleware as a productized core

These are reusable, but they bring assumptions:

- Express request lifecycle
- in-memory sessions
- current `Session` schema
- current SSE protocol

## Hard to extract cleanly

- the security model as a standalone reusable package

Reason:

- it is spread across middleware, route behavior, prompt generation, output scanning, guard escalation, and session state mutation
- some important behavior depends on the specific pipeline order

If the goal is to lift this into "another room" or another deployment while preserving the security model, I would not extract files individually. I would extract these as bundles:

1. `pipeline + security + session`
2. `persona + prompts + tool policy`
3. `tool handlers + integrations`

Trying to move only one of those slices will produce hidden regressions.

## Productization Potential

This can become a reusable middleware product, but only if the next step is not more features. The next step should be **trust-boundary hardening**.

Most important productization changes:

1. Session auth model based on capability tokens, not bare UUIDs.
2. Inline outbound policy enforcement before token emission.
3. Server-authoritative tool preconditions.
4. Shared/durable enforcement state.
5. Stronger admin authentication and ops controls.

After that, the existing modular structure is good enough to support multi-client packaging.

## Other Relevant Observations

### 1. The test suite is useful but misses the highest-risk scenarios

I did not see coverage for:

- session hijack / unauthorized session access
- consent bypass
- admin brute-force resistance
- multi-instance or restart behavior of security controls
- adversarial outbound streaming leakage before filter stage

Those should become first-class tests.

### 2. Public introspection is too generous

Even if session auth is added, I would still question whether public clients should receive:

- internal score breakdown
- guard level
- full transcript history

Those are high-value internal signals that help attackers map the system.

### 3. There is a good basis for a stricter policy engine

The code is already close to supporting a proper policy layer because:

- tools are centrally dispatched
- session state is explicit
- pipeline stages are explicit

That means hardening does not require a rewrite. It requires replacing soft assumptions with hard checks.

## Assessment Of The Proposed Maren Implementation

Inputs reviewed:

- `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md`
- `/Users/surfstyk/Documents/projects/maren/docs/MVP_STRATEGY.md`
- `/Users/surfstyk/Documents/projects/maren/docs/TRUST_BOUNDARY.md`

## Overall judgment

The Maren proposal is strategically coherent and mostly compatible with this repository's direction. It is a better fit as a **bounded feature module inside SAIFA first** than as a separate product right now. But if standalone extraction is a serious objective, the current plan needs one important adjustment:

- keep the `src/interview/` module
- do **not** rely on "thin integration points" as the main modularity story
- create an explicit internal contract between SAIFA core and Maren, otherwise the new tier will deepen the existing shared-state coupling

In short:

- As an MVP inside this repo: **good fit**
- As a future standalone product without refactoring: **not yet**
- As a future standalone product with deliberate boundaries added now: **good potential**

## What fits well

### 1. The directory-module approach is pragmatic

The decision to place Maren in `src/interview/` is sensible for this codebase:

- it matches the current repo's module style
- it avoids premature plugin architecture
- it keeps delivery velocity high

For MVP, this is the right bias.

### 2. The proposal uses seams that already exist

These existing seams support the Maren concept well:

- tier-based routing
  - `src/types.ts:3`
  - `src/scoring/engine.ts:45`
- provider abstraction
  - `src/llm/router.ts`
- tool dispatch
  - `src/tools/handler.ts:11`
- tier-specific prompt construction
  - `src/pipeline/stages/prompt-build.ts:11`
- SSE event model
  - `src/types.ts:116`

That means a third room is not architecturally alien to the current design.

### 3. Blueprint-as-state is a strong product decision

Using one structured Blueprint as both:

- interview-progress state
- proposal input

is sound. It reduces translation layers and gives the feature a stable center of gravity. This is one of the strongest parts of the proposal.

### 4. Round-boundary resumability is the right MVP cut

The plan avoids pretending to support arbitrary mid-turn restoration. That is a good constraint. It matches the reality of this codebase, which is not designed for deterministic replay across partially completed streamed turns.

## Where the current Maren plan does not fit the repository cleanly

### 1. The listed integration points are not as thin as the plan claims

The plan describes "thin, surgical" integration points:

- `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:55`

That is only partly true. In this repository, behavior is spread across:

- global unions in `src/types.ts`
- prompt selection in `src/pipeline/stages/prompt-build.ts:11`
- score routing in `src/scoring/engine.ts:45`
- tier transition handling in `src/pipeline/stages/score-update.ts`
- tool dispatch in `src/tools/handler.ts:11`
- session/budget/state handling across `src/session/*`
- HTTP mounting in `src/index.ts:58`

This is manageable, but it is not "a few thin imports." It is a cross-cutting feature insertion.

### 2. Some named integration targets are wrong for this codebase

The implementation plan says:

- change `src/persona/loader.ts` to add `'interview_room'` case
  - `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:65`
- mount routes in `src/app.ts`
  - `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:71`

But in this repo:

- `src/persona/loader.ts` is a prompt file assembler, not the tier dispatcher
  - `src/persona/loader.ts:56`
- prompt selection happens in `src/pipeline/stages/prompt-build.ts:14`
- there is no `src/app.ts`; the server entrypoint is `src/index.ts`
  - `src/index.ts:21`

This is important because it shows the current extension seams are less clean than assumed.

### 3. Adding Maren will intensify the existing "global Session object" coupling

Today, `Session` is already the shared bus for almost everything:

- `src/types.ts:11`

If Maren adds:

- interview progress
- blueprint state
- resume state
- proposal state
- follow-up state

directly into `Session` or generic `metadata`, modularity will degrade quickly.

Recommendation:

- keep interview state in a separate persisted interview aggregate
- only store the minimum linking fields on `Session`
- avoid making `Session.metadata` the default home for Maren state

### 4. Proposal, portrait, and follow-up generation should not live on the hot conversation path

The Maren plan bundles proposal generation, PDF rendering, portrait generation, and follow-up preparation under the same feature family:

- `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:28`

That is fine as a module layout, but operationally these should be treated as asynchronous application services, not conversational turn work. If they are triggered inline from the chat request lifecycle, they will create:

- latency spikes
- retry complexity
- partial failure states
- harder resumability

Recommended shape:

- interview conversation remains synchronous
- round completion persists Blueprint
- proposal/portrait/follow-up tasks are queued and processed separately

## Critical fit with the earlier security audit

### 1. Maren's trust-boundary assumptions are stronger than SAIFA currently guarantees

The Maren trust-boundary doc assumes a semi-trusted Level 1 environment with "own session only":

- `/Users/surfstyk/Documents/projects/maren/docs/TRUST_BOUNDARY.md:17`
- `/Users/surfstyk/Documents/projects/maren/docs/TRUST_BOUNDARY.md:18`

That does **not** match the current SAIFA runtime, where session ownership is not properly enforced:

- `src/middleware/session-lookup.ts:4`

So the statement "same infrastructure, same security" from the MVP strategy:

- `/Users/surfstyk/Documents/projects/maren/docs/MVP_STRATEGY.md:16`

is not yet true in the way that matters most. If Maren is added before session authorization is fixed, the more valuable interview/proposal state will inherit the same weak session boundary.

### 2. The proposed stricter output filter fits the audit, but only if moved inline

The Maren docs correctly treat sanitization as a safety net:

- `/Users/surfstyk/Documents/projects/maren/docs/TRUST_BOUNDARY.md:97`

That aligns with the audit. But the current SAIFA architecture still streams tokens before general output policy enforcement:

- `src/pipeline/stages/llm-stream.ts:50`
- `src/pipeline/stages/security-out.ts:16`

So Maren's stricter term tiers are directionally correct, but they will not provide the claimed protection unless the outbound gate is moved into the streaming path.

### 3. Maren needs stronger tool-level policy than the current repo usually applies

The Maren plan explicitly wants interview-tier tool validation:

- `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:136`

That is the right instinct and should become the standard. It also confirms one of the audit's main conclusions: prompt gating alone is not sufficient. Maren will be safer if its tool handlers are server-authoritative from the start.

### 4. "Level 1 semi-public" is a different security model from SAIFA's anonymous-public model

This is a subtle but important architectural point.

Maren is described as:

- registered or identified
- resumable
- proposal-bearing
- shareable via tokenized URLs

That means Maren is not just "another tier" of the same public chat. It is a different trust zone with different asset value. Treating it as just another room in the existing anonymous session model would be a category error.

## What to change now if standalone extraction is a real goal

### 1. Introduce an internal feature contract

Do not let Maren couple directly to every SAIFA internal type. Define a small interface at the seam, for example:

- `ConversationSnapshot`
- `InterviewRuntimeContext`
- `InterviewPersistence`
- `InterviewEvents`
- `InterviewSecurityPolicy`

Then let `src/interview/` depend on those contracts, with SAIFA providing the implementation adapters.

This is the single highest-value modularity improvement you can make before implementation.

### 2. Separate core interview domain from delivery adapters

Inside `src/interview/`, split the module into:

- core domain
  - blueprint
  - round progression
  - escalation logic
  - prompt/tool policy
- adapters
  - SAIFA pipeline bridge
  - SQLite repository
  - Express proposal routes
  - SSE event emitter
  - LLM provider implementation

That will make later extraction materially easier.

### 3. Keep proposal routes out of the core public API

The current plan exports `proposalRouter` as part of the coupling surface:

- `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:52`

That is acceptable for MVP, but architecturally it is not part of the interview domain. It is a transport adapter. If standalone is a goal, keep route mounting separate from the domain contract.

### 4. Do not use generic global unions as the long-term extension mechanism

Right now adding a feature means widening central unions:

- `SessionTier`
  - `src/types.ts:3`
- `ChatEventType`
  - `src/types.ts:116`
- `QualificationSignals`
  - `src/types.ts:173`

This works for one more tier. It does not scale gracefully. For Maren, this is acceptable short-term, but I would avoid repeating the pattern for deeper feature growth.

### 5. Treat the interview store as a first-class bounded context

The plan already points toward an `interviews` table:

- `/Users/surfstyk/Documents/projects/maren/docs/IMPLEMENTATION_PLAN.md:204`

That is good. Lean into it. Do not make interview persistence a sidecar to `sessions`. This bounded context is the main enabler for future extraction into a standalone app.

## Recommended implementation stance

If you proceed, I would recommend this posture:

1. Build Maren inside `src/interview/` as planned.
2. Add a small explicit bridge layer between SAIFA core and Maren rather than letting Maren import arbitrary internals.
3. Fix session authorization before exposing proposal/resume URLs and interview state.
4. Move output enforcement into the streaming path before relying on stricter Maren leak rules.
5. Keep proposal, portrait, and follow-up generation asynchronous.

## Final assessment

The proposed Maren feature fits the codebase strategically, but not quite structurally as currently described. The repo is modular enough to host it, but not yet modular enough to guarantee clean future extraction unless you add one deliberate boundary now.

If you implement Maren exactly as a "directory module with a few thin imports," it will work, but it will become another deep branch of the current shared-state tree.

If you implement Maren as:

- `src/interview/` plus
- a narrow bridge contract plus
- its own persistence boundary plus
- hardened session/output controls

then it can serve both goals:

- a strong MVP inside SAIFA
- a credible path to becoming a standalone product later

## Bottom Line

This is a solid application architecture with a respectable first-pass hardening story. It is not security-naive. But it is also not yet security-rigorous enough for a public hostile environment.

The main gap is not "more filtering." The main gap is **authoritative control at the boundary**:

- authenticate session ownership
- prevent leaks before sending text
- enforce consent and tool policy in code, not just in prompts
- make live security state durable

If those changes are made, the current structure is good enough to support reuse across deployments while keeping the security model coherent.
