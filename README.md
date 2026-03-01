# SAIFA

**Surfstyk Agent Internet Frontdesk Adapter** — an installation-agnostic Node.js/TypeScript middleware that powers virtual front desk chat experiences.

SAIFA sits between a chat frontend and LLM providers, handling session management, visitor qualification, model routing, tool integration (calendar booking, payments, phone capture), and security. Deploy it for any business by changing a config file and customizing the prompts directory.

## Features

- **Two-tier conversation system** — Lobby (discovery/qualification) → Meeting Room (value delivery + booking)
- **Qualification scoring** — Composite score from explicit signals, behavioral telemetry, and fit analysis triggers automatic tier escalation
- **Booking flow** — Phone capture → Calendar slot selection (Google Calendar) → Payment (Stripe embedded checkout) — all enforced sequentially
- **Model agnostic** — LLM adapter pattern; swap providers without changing business logic
- **Installation agnostic** — All identity (company, persona, services) lives in config + prompt templates
- **SSE streaming** — Real-time token streaming with structured messages for UI widgets
- **Security pipeline** — Input filtering, output scanning, guard state machine, rate limiting, IP blocking
- **GDPR consent** — Consent-first flow; only consented sessions are persisted
- **Multilingual** — English, German, Portuguese (extensible)
- **Integrations** — Google Calendar, Stripe, Trello, Telegram notifications

## Quick Start

```bash
npm install
npm run dev          # Dev server on port 3100
npm run build        # TypeScript compile → dist/
npm run lint         # ESLint
npm test             # Vitest
```

Requires Node.js >= 20.

### Configuration

```bash
CONFIG_PATH=config/surfstyk.json npm run dev   # Surfstyk deployment (default)
CONFIG_PATH=config/example.json npm run dev    # Example/template config
```

Copy `config/example.json` to create a new installation config. See the [Admin Guide](docs/ADMIN-GUIDE.md) for the full configuration reference.

## Architecture

```
Frontend (chat widget)
    │
    ├── POST /api/session              → Create session, get greeting + consent
    ├── POST /api/session/:id/message  → Send message, receive SSE stream
    ├── POST /api/session/:id/consent  → Grant/decline GDPR consent
    └── POST /api/webhooks/stripe      → Payment confirmation
    │
    ▼
┌─────────────────────────────────┐
│            SAIFA                │
│                                 │
│  Security → LLM → Tools → SSE  │
│                                 │
│  Sessions · Scoring · Budget    │
└─────────────────────────────────┘
    │
    ├── LLM Provider (Gemini / swappable)
    ├── Google Calendar (availability + booking)
    ├── Stripe (payment processing)
    ├── Trello (lead tracking)
    └── Telegram (notifications)
```

### Project Structure

```
config/         Per-installation config files
prompts/        Templatized prompt files (persona, knowledge, security, etc.)
src/
  routes/       Express route handlers
  llm/          LLM adapter interface + implementations
  persona/      Prompt loader, tier-specific prompt builders
  tools/        Tool call handlers (calendar, payment, phone, signals)
  sse/          SSE streaming + tool call sanitizer
  scoring/      Qualification scoring engine
  security/     Guard state machine, input/output filters, rate limiter
  session/      Session manager, in-memory store, token budgets
  db/           SQLite persistence (consent-gated)
  integrations/ Google Calendar, Stripe, PayPal, Trello, Telegram
  middleware/   Session lookup, request validation
docs/           Documentation
```

### Prompt System

Two-layer templating:

1. **Structural placeholders** `[X]` — assemble the full system prompt from modular files
2. **Identity variables** `{{x}}` — resolved from config at runtime (company name, owner, services, etc.)

See [prompts/README.md](prompts/README.md) for details.

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [Developer Guide](docs/DEVELOPER-GUIDE.md) | Developers | Architecture, module reference, data flows, extension points |
| [Admin Guide](docs/ADMIN-GUIDE.md) | Operators | Configuration, deployment, prompt editing, troubleshooting |
| [API Specification](docs/architecture/PUBLIC-JUSTEC-API-SPEC.md) | Frontend devs | REST + SSE endpoint contract |
| [SSE Contract](docs/SSE-STRUCTURED-MESSAGES-CONTRACT.md) | Frontend devs | Streaming protocol, structured message types |

## Deployment

The default deployment targets a Hetzner VPS with systemd + Caddy reverse proxy.

```bash
./deploy.sh    # Build → rsync → npm ci → restart service → health check
```

See the [Admin Guide](docs/ADMIN-GUIDE.md#deployment) for full deployment details.

## New Installation

1. Copy `config/example.json` → `config/your-company.json`
2. Fill in identity fields (company, owner, services, payment)
3. Set up credentials directory with API keys
4. Optionally customize prompt files (keep `{{variables}}` and `[PLACEHOLDERS]` intact)
5. `CONFIG_PATH=config/your-company.json npm run dev`

See the [Admin Guide](docs/ADMIN-GUIDE.md#setting-up-a-new-installation) for the full walkthrough.

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript, Express
- **LLM**: Google Gemini (via `@google/genai`), adapter pattern for swapping
- **Database**: SQLite (via `better-sqlite3`) — conversation logs only
- **Payments**: Stripe (embedded checkout)
- **Calendar**: Google Calendar API
- **Testing**: Vitest

## License

Proprietary. All rights reserved.
