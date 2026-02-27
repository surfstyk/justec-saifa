# Session Brief — justec-public-api

**Purpose**: Build the Public Persona API middleware for the Justec Virtual Front Desk
**Created by**: Claw Father (surfjust-0001) — handoff to a dedicated build session
**Date**: 2026-02-26

---

## What You're Building

A Node.js/TypeScript middleware API that powers the public-facing Justec chat on surfstyk.com. This is NOT an OpenClaw agent — it's a standalone HTTP service that:

1. Receives visitor messages from the chat frontend
2. Routes them to an LLM (model-agnostic: Gemini, Claude, or OpenAI)
3. Streams responses back via SSE
4. Manages sessions, qualification scoring, tier transitions, and security
5. Integrates with Google Calendar (availability + booking), Trello (lead management), Stripe + PayPal (payments), and Telegram (notifications)

## Architecture Documents (Your Spec)

These are your primary references. They live in the surfjust-0001 agent directory:

| Document | Path | What It Covers |
|----------|------|---------------|
| **Architecture** | `agents/surfjust-0001/docs/architecture/PUBLIC-JUSTEC-ARCHITECTURE.md` | Component model, system diagram, middleware design, data model, infrastructure, security, cost projections |
| **API Specification** | `agents/surfjust-0001/docs/architecture/PUBLIC-JUSTEC-API-SPEC.md` | The frontend↔backend contract. All endpoints, SSE events, structured message types, error handling. **v0.2.0** — reviewed and refined. |
| **Persona** | `agents/surfjust-0001/docs/architecture/PUBLIC-JUSTEC-PERSONA.md` | System prompts (Lobby + Meeting Room), knowledge base, qualification signal extraction, security instructions |
| **Framework** | `agents/surfjust-0001/docs/JUSTEC-VIRTUAL-FRONT-DESK-FRAMEWORK.md` | The original concept/strategy document. Business context, sales methodology, qualification criteria, UX requirements, visitor journeys. Read this for the "why." |
| **Tech Stack** | `agents/surfjust-0001/docs/surfstyk-www-stack-briefing.md` | Current surfstyk.com infrastructure: Hetzner VPS, Caddy, React+Vite, deployment pipeline |

## Deployment Target

| Detail | Value |
|--------|-------|
| **Server** | 46.225.188.5 (Hetzner VPS — existing surfstyk.com server) |
| **SSH** | `ssh hendrik@46.225.188.5` — key auth only |
| **Web server** | Caddy (already serving surfstyk.com, gripandtraction.com) |
| **Middleware port** | 3100 (Caddy reverse proxies `/api/*` to localhost:3100) |
| **Process manager** | systemd (user service: `justec-public.service`) |
| **Site root** | `/var/www/surfstyk.com/` (static frontend) |
| **Middleware root** | `/opt/justec-public/` (middleware code) |
| **Config** | `/etc/justec-public/config.json` |
| **Credentials** | `/etc/justec-public/credentials/` (chmod 600) |
| **Database** | SQLite at `/var/lib/justec-public/conversations.db` |

## Credentials You'll Need

These must be provided by Hendrik and placed on the server:

| Credential | Path on Server | Source |
|------------|---------------|--------|
| Google OAuth (Calendar, Sheets) | `/etc/justec-public/credentials/google_oauth.json` | Copy from private Justec (46.225.69.90:~/.config/justec/google_oauth.json) OR generate a second refresh token from the same Google Cloud project |
| Gemini API key | `/etc/justec-public/credentials/gemini_api_key` | Google AI Studio — use the "Surfstyk Justec" project (gen-lang-client-0480960234) or create a new project for the public persona |
| Trello API key + token | `/etc/justec-public/credentials/trello_credentials.json` | Same Trello account as private Justec. Create a new "Website Leads" board. |
| Stripe secret key | `/etc/justec-public/credentials/stripe_secret_key` | Hendrik's existing Stripe account |
| Stripe webhook signing secret | `/etc/justec-public/credentials/stripe_webhook_secret` | Generated when configuring the webhook endpoint in Stripe dashboard |
| PayPal client ID + secret | `/etc/justec-public/credentials/paypal_credentials.json` | Hendrik's existing PayPal account |
| Justec Telegram bot token | `/etc/justec-public/credentials/justec_bot_token` | Same bot as private Justec: @surfstykjustec_bot. Token already exists at 46.225.69.90. |
| Hendrik's Telegram chat ID | In config.json | `1465455370` |

## Coordination with surfjust-0001 (Private Justec)

The two systems are independent but share data via Google Workspace and Trello:

| What | Who Owns It | Coordination Needed |
|------|-----------|-------------------|
| **Google Calendar** | Both read/write | If you need a new OAuth scope, tell Hendrik — the Claw Father session (surfjust-0001) handles OAuth changes on 46.225.69.90 |
| **Google Sheets** | Both read/write | Share the same spreadsheet ID for the task tracker if needed |
| **Trello** | Both read/write | Create a separate "Website Leads" board for public Justec. Private Justec can read it via her existing Trello skill. |
| **Telegram (@surfstykjustec_bot)** | Both send | The middleware sends booking/lead notifications via the Telegram API directly. Private Justec uses the same bot via OpenClaw channels. No conflict — they send to the same chat ID. |
| **Architecture docs** | surfjust-0001 | If the API spec needs changes during build, update the docs in the surfjust-0001 repo and tell Hendrik. |

## Key Design Decisions (Already Made)

- **Model agnostic**: LLM adapter pattern. Start with Gemini 3 Flash for both tiers.
- **Seamless tier transition**: Invisible model/prompt swap at score threshold. No UI change.
- **Session creation on page load**: Turnstile check + greeting returned immediately.
- **Stripe embedded checkout**: Not redirect. Stays on the page.
- **No CRM**: Trello board for lead management.
- **No Cal.com/Calendly**: Google Calendar direct (compute availability from events + working hours config).
- **No returning visitors (POC)**: Fresh session every visit. Add later.
- **No Redis (POC)**: In-memory sessions. SQLite for persistence.
- **Notifications via @surfstykjustec_bot**: Not @surfstykclawgod_bot.
- **POST /close** (not DELETE): For sendBeacon compatibility.
- **Typed action field**: Not magic strings. See API spec v0.2.0.
- **stream_end terminal event**: Explicit SSE stream lifecycle.
- **processing event**: Typing indicator before first token.
- **2-second queue polling**: Not 5 seconds.

## Suggested Repo Structure

```
justec-public-api/
├── CLAUDE.md                       ← Session instructions (see below)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    ← Entry point
│   ├── config.ts                   ← Configuration loader
│   ├── routes/
│   │   ├── session.ts              ← POST /api/session
│   │   ├── message.ts              ← POST /api/session/:id/message (SSE)
│   │   ├── consent.ts              ← POST /api/session/:id/consent
│   │   ├── language.ts             ← POST /api/session/:id/language
│   │   ├── close.ts                ← POST /api/session/:id/close
│   │   ├── state.ts                ← GET /api/session/:id/state
│   │   ├── history.ts              ← GET /api/session/:id/history
│   │   ├── status.ts               ← GET /api/session/:id/status
│   │   ├── health.ts               ← GET /api/health
│   │   └── webhooks.ts             ← POST /api/webhooks/stripe, /api/webhooks/paypal
│   ├── llm/
│   │   ├── adapter.ts              ← LLMAdapter interface
│   │   ├── gemini.ts               ← Google Gemini implementation
│   │   ├── anthropic.ts            ← Anthropic Claude implementation
│   │   ├── openai.ts               ← OpenAI implementation
│   │   └── router.ts               ← Model routing (tier → provider/model)
│   ├── scoring/
│   │   ├── engine.ts               ← Composite scoring engine
│   │   ├── behavioral.ts           ← Behavioral signal scoring
│   │   └── explicit.ts             ← LLM-extracted signal scoring
│   ├── security/
│   │   ├── input-filter.ts         ← Pre-LLM input processing
│   │   ├── output-filter.ts        ← Post-LLM output processing
│   │   ├── rate-limiter.ts         ← Per-session + per-IP rate limiting
│   │   └── guard.ts                ← Security guard state machine
│   ├── tools/
│   │   ├── calendar.ts             ← Google Calendar: availability, booking
│   │   ├── trello.ts               ← Trello: lead card management
│   │   ├── stripe.ts               ← Stripe: embedded checkout
│   │   ├── paypal.ts               ← PayPal: payment processing
│   │   └── telegram.ts             ← Telegram: notifications via @justec bot
│   ├── session/
│   │   ├── manager.ts              ← Session lifecycle
│   │   ├── store-memory.ts         ← In-memory session store (POC)
│   │   └── budget.ts               ← Token budget tracking
│   ├── persona/
│   │   ├── loader.ts               ← Load and assemble system prompts
│   │   ├── lobby.ts                ← Lobby tier prompt builder
│   │   └── meeting-room.ts         ← Meeting Room tier prompt builder
│   └── db/
│       ├── sqlite.ts               ← SQLite connection
│       └── conversations.ts        ← Conversation log persistence
├── prompts/
│   ├── shared-persona.md
│   ├── lobby.md
│   ├── meeting-room.md
│   ├── knowledge-base.md
│   ├── security-instructions.md
│   ├── language-instructions.md
│   └── qualification-extraction.md
├── config/
│   └── surfstyk.json               ← Surfstyk-specific configuration
├── .github/
│   └── workflows/
│       └── deploy.yml              ← CI/CD (same pattern as surfstyk.com)
├── .gitignore
└── deploy.sh                       ← Manual deploy script
```

## GitHub Repo Setup

```bash
# Create repo under surfstyk org (private)
gh repo create surfstyk/justec-public-api --private --description "Public Persona API — Justec Virtual Front Desk for surfstyk.com"

# Clone and start
cd ~/Documents/projects
git clone git@github.com:surfstyk/justec-public-api.git
cd justec-public-api
```

## Build Priority Order

1. **Scaffolding**: Express/Fastify setup, config loader, health endpoint
2. **Session management**: Create, store (in-memory), expire, close
3. **LLM adapter**: Gemini implementation, streaming, prompt assembly
4. **Message endpoint**: POST → LLM → SSE stream with processing/token/message_complete/stream_end
5. **Persona prompts**: Port from architecture docs to prompt files, test with Gemini 3 Flash
6. **Qualification scoring**: Behavioral + explicit signal extraction, composite scoring, tier transition
7. **Security**: Input filter, output filter, rate limiter, guard state machine
8. **Google Calendar**: OAuth, availability computation, booking creation
9. **Trello**: Lead card creation, list management
10. **Payment**: Stripe embedded checkout, webhook handling
11. **PayPal**: Payment flow, webhook handling
12. **Telegram**: Booking/lead notifications via @surfstykjustec_bot
13. **Deployment**: systemd service, Caddy config, CI/CD pipeline
14. **Integration testing**: End-to-end with frontend team

Steps 1-6 are the critical path. The frontend team can start building against a stub API as soon as step 4 is working.
