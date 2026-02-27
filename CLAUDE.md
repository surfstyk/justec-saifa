# CLAUDE.md — SAIFA

## What This Is

**SAIFA** (Surfstyk Agent Internet Frontdesk Adapter) — an installation-agnostic Node.js/TypeScript middleware that powers virtual front desk chat experiences. It sits between a chat frontend and LLM providers, handling session management, qualification scoring, model routing, tool integration, and security.

Deploy it for any business by changing a config file and customizing the prompts directory. The default configuration targets Surfstyk Limited (surfstyk.com).

## Key Technical Constraints

- **Model agnostic**: LLM adapter pattern. Never hardcode a provider.
- **Installation agnostic**: All identity (company, owner, persona, services) lives in config + prompt templates. No hardcoded business identity in source.
- **No pip, no Python**: Node.js/TypeScript only. All integrations via npm packages or direct HTTP.
- **Secrets never in code**: Credentials loaded from a configurable path (default `/etc/justec-public/credentials/`). Use environment variables or config file references in development.
- **SQLite for persistence**: In-memory sessions, SQLite for conversation logs.
- **SSE streaming**: Every message response is a Server-Sent Events stream with a guaranteed `processing` → [content] → `stream_end` lifecycle.
- **Typed actions, not magic strings**: Visitor UI interactions (slot selection, phone submission, consent) use the structured `action` field.
- **Prompt templating**: Two-layer system — structural `[PLACEHOLDERS]` for prompt assembly, identity `{{variables}}` resolved from config. See `prompts/README.md`.

## Development

```bash
npm install
npm run dev          # Local dev server (port 3100)
npm run build        # TypeScript compile → dist/
npm run lint         # ESLint
npm test             # Tests (when available)
```

### Config

Set `CONFIG_PATH` to point at your config file:
```bash
CONFIG_PATH=config/surfstyk.json npm run dev   # Surfstyk deployment
CONFIG_PATH=config/example.json npm run dev    # Example/template deployment
```

Default (no `CONFIG_PATH`): loads `config/surfstyk.json`.

## Deployment (Surfstyk)

- **Server**: 46.225.188.5 (Hetzner VPS)
- **SSH**: `ssh hendrik@46.225.188.5`
- **Process**: systemd service on port 3100
- **Reverse proxy**: Caddy routes `/api/*` to localhost:3100
- **Deploy**: `./deploy.sh` (build + rsync + restart)

## Project Structure

- `config/` — Per-installation config files (`surfstyk.json`, `example.json`)
- `prompts/` — Templatized prompt files (persona, knowledge, security, etc.)
- `src/routes/` — Express route handlers (session, message, webhooks, etc.)
- `src/persona/` — Prompt loader with template engine, tier builders
- `src/llm/` — LLM adapter, Gemini implementation, model router
- `src/tools/` — Tool call handlers (calendar, payment, phone, signals)
- `src/integrations/` — External services (Google Calendar, Trello, Stripe, PayPal, Telegram)
- `src/security/` — Guard state machine, input/output filters, rate limiter, IP blocklist
- `src/scoring/` — Qualification scoring engine
- `src/session/` — Session manager, token budget, in-memory store

## Git Workflow

- Commit after every meaningful change
- Push to GitHub regularly
- Commit message format: `[saifa] Description of change`
- Never commit secrets
