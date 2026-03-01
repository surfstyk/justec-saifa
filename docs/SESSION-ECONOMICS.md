# Session Economics & Rate Limits

Reference document for understanding conversation flow mechanics, token budgets, rate limits, scoring thresholds, and per-session costs.

**Last updated**: 2026-03-01

---

## Conversation Flow

A session moves through two stages, each with different prompts, tools, and budgets.

### Stage 1 — Lobby (Discovery & Qualification)

The agent qualifies visitors through natural conversation using SPIN methodology (Situation, Problem, Implication, Need-Payoff). The prompt instructs: "You don't need all four — 2-3 well-placed questions often suffice."

**Available tools**: `report_signals` only (no booking tools).

**Typical exchange count**: 6-10 visitor messages.

| Exchange | Purpose |
|----------|---------|
| 1 | Visitor's opening message, agent responds with tailored question |
| 2-4 | Discovery — problem specificity, authority, timeline, need alignment |
| 5-7 | Deeper qualification — budget indicators, engagement depth |
| 8-10 | Buffer for multilingual conversations, tangents, clarifications |

**Promotion trigger**: Composite score crosses the `qualified` threshold (default: 70/100). On promotion, the session moves to meeting room, a Trello lead card is created, and the activity bot sends a Telegram notification.

### Stage 2 — Meeting Room (Booking Flow)

Sequential booking steps enforced by prompt: "Call ONE booking tool per message, then STOP and wait for the visitor to respond."

**Available tools**: `report_signals`, `request_phone`, `check_calendar_availability`, `request_payment` (gated sequentially — each unlocks only after the previous step completes).

**Typical exchange count**: 7-10 visitor messages.

| Exchange | Purpose | Tool |
|----------|---------|------|
| 1-2 | Deliver value (insight/reframe), propose session | — |
| 3 | Visitor agrees, agent requests phone | `request_phone` |
| 4 | Phone submitted, agent checks calendar | `check_calendar_availability` |
| 5-6 | Slot negotiation (up to 3 offers if visitor declines) | `check_calendar_availability` |
| 7 | Slot accepted, agent requests payment | `request_payment` |
| 8 | Payment completed, post-booking wrap-up | — |

---

## Scoring System

Three methodologies feed a weighted composite score (0-100):

### Explicit Score (40% weight)
Extracted by the LLM via `report_signals` tool after every message. Six dimensions, each 0-10:

| Dimension | 0 | 5 | 10 |
|-----------|---|---|---|
| Problem specificity | No problem mentioned | Specific area | Named stakeholders + metrics |
| Authority level | Unknown | Manager | Founder/CEO |
| Timeline urgency | No timeline | This quarter | Immediately |
| Need alignment | Unrelated | Adjacent | Perfect fit |
| Budget indicator | Price-first | Discusses ROI | Budget not a concern |
| Engagement depth | Single-word | Moderate | Deep engagement + questions back |

Score = average of 6 dimensions x 10.

### Behavioral Score (35% weight)
Computed from frontend signals sent with each message. Factors weighted equally:

- **Typing duration**: <1s = 10pts, <3s = 40, <30s = 70, <60s = 85, >60s = 95
- **Keypress count**: <5 = 15pts, <20 = 40, <80 = 65, >=80 = 80
- **Corrections**: 0 = 40pts, 1-5 = 75, 6-15 = 60, >15 = 30
- **Response time**: <2s = 20pts, <10s = 60, <60s = 80, <180s = 50, >=180s = 20
- **Mouse movement**: detected = 70pts, not detected = 30
- **Message count bonus**: >=5 msgs = +20, >=3 msgs = +10

Default (no signals): 30/100.

### Fit Score (25% weight)
Derived from explicit dimensions: need_alignment x 0.45 + authority_level x 0.30 + budget_indicator x 0.25, scaled to 0-100.

### Classification Thresholds

| Composite Score | Classification | Action |
|----------------|----------------|--------|
| >= 70 | Hot | Promote to meeting room |
| >= 45 | Warm | Continue discovery |
| >= 25 | Cold | Continue, lower priority |
| < 25 | Disqualified | Graceful exit |

---

## Rate Limits & Budgets

### Rate Limits
Three independent limits protect against abuse:

| Limit | Value | What it controls |
|-------|-------|-----------------|
| `messages_per_session` | 25 | Max visitor messages in one session |
| `messages_per_ip_per_hour` | 40 | Max visitor messages from one IP across all sessions |
| `session_ttl_minutes` | 60 | Session expires after inactivity |

Each visitor POST to `/api/session/:id/message` increments both session and IP counters. Assistant responses don't count (they're returned in the same SSE stream).

### Token Budgets
Token consumption is tracked per session. Budget tier is determined by session state:

| Budget Tier | Token Limit | Condition |
|-------------|-------------|-----------|
| Anonymous | 300,000 | Default (0-1 messages) |
| Engaged | 600,000 | messages_count >= 2 |
| Qualified | 1,500,000 | tier = meeting_room |
| Post-booking | 3,000,000 | payment_status = completed |

**How tokens are counted** (current implementation):
- Each LLM API call estimates: `input_tokens = (system_prompt + all_messages) / 4`, `output_tokens = response_text / 4`
- Both input and output are summed into `session.tokens_used`
- The `report_signals` tool pattern causes **2 API calls per turn** (signal call + text continuation), so the system prompt (~16-19KB) is counted twice per visitor message

**Known issue**: The system prompt dominates token counting (~4,000-4,750 tokens per call). At 2 calls per turn, that's ~8,000-9,500 tokens/turn of fixed overhead. Over 7-8 turns, the system prompt alone can exhaust the `engaged` budget (60,000) — independent of actual conversation content. This makes the budget effectively a turn counter rather than a meaningful token limit.

### Budget Exhaustion Flow
When `session.tokens_used >= budget`:
1. Pre-message check rejects with 429 if already over
2. Post-message: `consume()` returns `exhausted: true`
3. SSE sends `budget_exhausted` event with localized end message
4. Session remains open but no more messages accepted

---

## Per-Session Cost (Gemini 3 Flash)

Gemini Flash pricing (approximate):

| | Rate |
|---|---|
| Input | ~$0.10 / 1M tokens |
| Output | ~$0.40 / 1M tokens |

### Cost estimate per conversation

| Scenario | Turns | Est. Input Tokens | Est. Output Tokens | Cost |
|----------|-------|-------------------|--------------------| -----|
| Short lobby (3 turns) | 3 | ~30,000 | ~2,000 | ~$0.004 |
| Full lobby (8 turns) | 8 | ~75,000 | ~5,000 | ~$0.010 |
| Full booking flow (15 turns) | 15 | ~140,000 | ~10,000 | ~$0.018 |
| Extended conversation (25 turns) | 25 | ~230,000 | ~16,000 | ~$0.030 |

**Bottom line**: A full end-to-end conversation costs **under €0.03**. At 100 conversations/day, monthly cost is **~€90**. Token budgets protect against abuse, not cost.

---

## End-to-End Session Sizing

Minimum, typical, and comfortable estimates for visitor messages per session:

| Phase | Minimum | Typical | With Buffer |
|-------|---------|---------|-------------|
| Lobby qualification | 6 | 8-10 | 12 |
| Meeting room booking | 7 | 8 | 10 |
| **Total** | **13** | **16-18** | **22** |

**Buffer factors**:
- German/Portuguese conversations: +20-30% exchange count
- Visitor questions about process/pricing: +2-3 exchanges
- Calendar slot renegotiation: +1-2 exchanges
- Post-booking follow-up questions: +1-2 exchanges

### Decision Log

**2026-03-01 — 10x budget increase + rate limit adjustment**

Previous values caused budget exhaustion after 7-8 messages in lobby due to system prompt double-counting (~8,000 tokens/turn overhead). A professional German conversation was terminated mid-qualification with "Dieses Gespräch hat sein Limit erreicht."

Analysis showed a full booking flow costs under €0.03 on Gemini Flash. Budgets were protecting against a non-existent cost risk while actively blocking conversions.

Changes applied:
- `messages_per_session`: **15 → 25** — based on flow analysis: lobby qualification needs 6-10 exchanges, meeting room booking needs 7-10, plus buffer for multilingual conversations and slot renegotiation
- `messages_per_ip_per_hour`: **20 → 40** — prevents IP limit from becoming the bottleneck before session limit (previous value would cap a single session at 20 messages)
- Token budgets: **10x across the board** — anonymous 300K, engaged 600K, qualified 1.5M, post-booking 3M. Removes budget as a conversation bottleneck while the qualification system is being tuned. Will adjust further based on observed session data.

Rationale: At this stage, the priority is learning how well the qualification and booking flow works end-to-end. Premature rate limiting cuts off the data needed to tune the system. Cost exposure is negligible (~€90/month at 100 conversations/day).

---

## Security Guard (Escalation)

Separate from rate limits, the security guard state machine can terminate conversations:

| Guard Level | Trigger | Action |
|-------------|---------|--------|
| 0 | No threat | Continue |
| 1 | Mild issue (profanity, long message) | Soft redirect injected into system prompt |
| 2 | Repeated mild issues or injection attempt | Firm redirect |
| 3 | Hostility (threat level 3) or escalated from level 2 | Terminate — canned response, session closed |
| 4 | Continued after level 3 | Block IP (1 hour) + terminate |

Guard levels only ratchet up, never down. A single hostility detection (threat level 3) jumps directly to termination. Multiple mild issues (threat level 1) escalate incrementally: 3 mild flags = termination.

**Input filter patterns**: English, German, and Portuguese profanity and hostility patterns. Language-specific to avoid false positives (e.g., German article "die" was removed from English hostility patterns).
