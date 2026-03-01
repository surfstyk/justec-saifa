# SAIFA Admin & Operator Guide

This guide is for anyone deploying, configuring, or troubleshooting a SAIFA installation. You don't need to understand the code — you need to understand the config file, the prompt files, where to look when something goes wrong, and which knob controls which behavior.

---

## Table of Contents

1. [How SAIFA Works (30-Second Version)](#how-saifa-works-30-second-version)
2. [Deployment](#deployment)
3. [Configuration Reference](#configuration-reference)
4. [Credentials](#credentials)
5. [Prompt Files — What Controls What](#prompt-files--what-controls-what)
6. [The Two-Tier System](#the-two-tier-system)
7. [Booking Flow](#booking-flow)
8. [GDPR Consent](#gdpr-consent)
9. [Security Features](#security-features)
10. [Monitoring & Health Checks](#monitoring--health-checks)
11. [Troubleshooting](#troubleshooting)
12. [Setting Up a New Installation](#setting-up-a-new-installation)

---

## How SAIFA Works (30-Second Version)

SAIFA is a chat backend. It sits between your website's chat widget and an AI model. When a visitor sends a message:

1. The message goes through security checks (injection detection, rate limiting)
2. It's sent to the AI model along with a carefully crafted prompt
3. The AI responds, possibly calling tools (calendar, payment, phone capture)
4. The response streams back to the visitor in real time

Visitors start in the **lobby** (lightweight, evaluative conversation). If they score high enough on qualification criteria, they're escalated to the **meeting room** (richer conversation, access to booking tools).

---

## Deployment

### Surfstyk Production Setup

| Component | Details |
|-----------|---------|
| Server | 46.225.188.5 (Hetzner VPS) |
| SSH | `ssh hendrik@46.225.188.5` |
| Service | systemd `justec-public.service` |
| Port | 3100 (internal) |
| Reverse proxy | Caddy routes `/api/*` → localhost:3100 |
| App directory | `/opt/justec-public/` |
| Config | `/etc/justec-public/config.json` |
| Credentials | `/etc/justec-public/credentials/` |
| Database | `/var/lib/justec-public/conversations.db` |

### Deploying Code Changes

```bash
./deploy.sh
```

This script:
1. Builds TypeScript locally
2. Syncs `dist/`, `prompts/`, `config/`, `package.json` to the server
3. Runs `npm ci --omit=dev` on the server
4. Restarts the systemd service
5. Runs a health check

**Important**: `deploy.sh` does NOT update the production config file (`/etc/justec-public/config.json`). If you changed config values, you must update it manually:

```bash
ssh hendrik@46.225.188.5
sudo nano /etc/justec-public/config.json
sudo systemctl restart justec-public.service
```

### Service Management

```bash
# On the server:
sudo systemctl status justec-public.service    # Check status
sudo systemctl restart justec-public.service   # Restart
sudo systemctl stop justec-public.service      # Stop
sudo journalctl -u justec-public.service -f    # Live logs
sudo journalctl -u justec-public.service --since "1 hour ago"  # Recent logs
```

---

## Configuration Reference

The config file is a JSON file. Every field has a built-in default — you only need to specify what you want to override. The defaults are defined in `src/config.ts`.

### `client` — Company Identity

```json
{
  "client": {
    "name": "surfstyk",              // Internal identifier
    "company": "Surfstyk Limited",   // English company name (used in prompts)
    "company_pt": "Surfstyk LDA",   // Portuguese company name
    "owner": "Hendrik Bondzio",     // Company owner/founder name
    "timezone": "Europe/Lisbon",    // IANA timezone for calendar slots
    "languages": ["en", "de", "pt"], // Supported languages
    "phone": "+351 XXX XXX XXX",    // Contact phone (shown in end messages)
    "website": "https://surfstyk.com",
    "cors_origins": ["https://surfstyk.com", "https://www.surfstyk.com"],
    "location": "Ericeira, Portugal"
  }
}
```

**What these control**: The assistant's identity, greeting messages, calendar timezone, which languages are available, CORS security, and contact info shown when conversations end.

### `persona` — Assistant Identity

```json
{
  "persona": {
    "name": "Justec",                        // The assistant's name
    "assistant_role": "justec",              // Role tag for message history
    "system_name": "Justec Virtual Front Desk", // System reference name
    "contact_channel": "WhatsApp",           // How visitors can reach the owner
    "prompts_dir": "prompts"                 // Directory containing prompt files
  }
}
```

**What these control**: The persona name the AI uses, how it refers to itself, and which communication channel it mentions.

### `services` — What You're Selling

```json
{
  "services": {
    "name": "Strategy Session",      // Name of the bookable service
    "duration_display": "60-minute"   // How duration is described
  }
}
```

**What these control**: How the AI talks about your service offering, and what appears in calendar events and payment descriptions.

### `llm` — AI Model Configuration

```json
{
  "llm": {
    "lobby": {
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "max_tokens": 4096,
      "temperature": 0.7
    },
    "meeting_room": {
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  }
}
```

**What these control**:
- `provider` / `model` — Which AI model to use (per tier)
- `max_tokens` — Maximum output length. Higher = more verbose but more reliable. Lower = cheaper but risks empty responses. Current sweet spot: lobby 4096, meeting room 8192
- `temperature` — Creativity. 0.0 = deterministic, 1.0 = creative. Default 0.7 works well

### `scoring` — Qualification Criteria

```json
{
  "scoring": {
    "weights": {
      "explicit": 0.40,    // What the visitor tells us (need, authority, timeline)
      "behavioral": 0.35,  // How they interact (typing speed, engagement)
      "fit": 0.25          // How well they match our ideal client
    },
    "thresholds": {
      "qualified": 70,     // Score to escalate to meeting room
      "warm": 45,          // "Interested but not ready"
      "cold": 25           // "Just browsing"
    }
  }
}
```

**What these control**: When visitors move from lobby to meeting room. Lower `qualified` threshold = more visitors get escalated. Higher = more selective. The weights determine how much each scoring component matters.

### `budgets` — Token Limits Per Session

```json
{
  "budgets": {
    "anonymous": 30000,       // First-time visitor
    "engaged": 60000,         // After 2+ messages
    "qualified": 150000,      // Escalated to meeting room
    "post_booking": 300000    // After successful payment
  }
}
```

**What these control**: How long conversations can last. Higher numbers = longer conversations but higher API costs. A typical message exchange uses 500-2000 tokens.

### `rate_limits` — Abuse Prevention

```json
{
  "rate_limits": {
    "messages_per_session": 15,       // Max messages per session
    "messages_per_ip_per_hour": 20,   // Max messages per IP per hour
    "max_concurrent_sessions": 10,    // Max simultaneous active sessions
    "session_ttl_minutes": 60         // Session timeout
  }
}
```

**What these control**: Protection against abuse and runaway costs. Sessions that exceed limits get queued or rejected. The TTL controls when idle sessions are automatically closed.

### `calendar` — Booking Availability

```json
{
  "calendar": {
    "working_hours": {
      "days": [1, 2, 3, 4, 5],        // Mon-Fri (1=Mon, 7=Sun)
      "start": "09:00",
      "end": "17:00",
      "timezone": "Europe/Lisbon"
    },
    "slot_duration_minutes": 60,       // Length of each bookable slot
    "lookahead_days": 14,              // How far ahead to show availability
    "buffer_minutes": 15,              // Minimum gap between events
    "max_offered_slots": 3,            // Max different slots offered per conversation
    "hold_ttl_minutes": 30             // How long a tentative hold lasts
  }
}
```

**What these control**: When visitors can book, how long sessions are, and how many options they see. Slots are computed from Google Calendar free/busy data within these constraints.

### `payment` — Checkout Configuration

```json
{
  "payment": {
    "deposit_amount": 5000,          // In smallest currency unit (5000 = 50.00 EUR)
    "currency": "eur",
    "currency_symbol": "€",
    "providers": ["stripe", "paypal"],
    "deposit_credited": true,        // Deposit credited toward engagement
    "deposit_display": "50 EUR",     // Human-readable amount
    "product_name": "Strategy Session Deposit",
    "product_description": "60-minute strategy session — credited toward your first engagement",
    "return_base_url": "https://surfstyk.com/chat"  // Redirect URL after payment
  }
}
```

**What these control**: Payment amount, methods, and what appears on the checkout page and receipt.

### `greetings` — Welcome Messages

```json
{
  "greetings": {
    "en": "Welcome to Surfstyk Limited — I'm Justec...",
    "de": "Willkommen bei Surfstyk Limited — ich bin Justec...",
    "pt": "Bem-vindo à Surfstyk LDA — sou a Justec..."
  }
}
```

**What these control**: The first message visitors see when they open the chat. Sent at session creation, before the consent banner.

### `consent_messages` — GDPR Banner

```json
{
  "consent_messages": {
    "en": {
      "text": "We store this conversation to improve our service...",
      "privacy_url": "https://surfstyk.com/privacy",
      "accept_label": "I agree",
      "decline_label": "No thanks"
    }
  }
}
```

**What these control**: The consent banner shown after the greeting. If declined, chat stays disabled.

### `security` — Internal Keyword Blacklist

```json
{
  "security": {
    "internal_keywords": [
      "gemini-3-flash",
      "better-sqlite3",
      "systemd",
      "localhost:3100"
    ]
  }
}
```

**What these control**: If the AI accidentally mentions any of these terms, the output filter catches it and replaces the response with a generic message. Add any terms that should never appear in visitor-facing output.

### Paths

```json
{
  "credentials_path": "/etc/justec-public/credentials",
  "database_path": "/var/lib/justec-public/conversations.db",
  "dev_mode": false,
  "port": 3100
}
```

- `credentials_path` — Directory containing API keys and OAuth tokens
- `database_path` — SQLite file for conversation logs (`:memory:` in dev mode)
- `dev_mode` — Skips Turnstile verification, uses in-memory DB
- `port` — HTTP listen port

---

## Credentials

All secrets are stored as files in the `credentials_path` directory (default `/etc/justec-public/credentials/`). Each file contains a single value (no JSON wrapping for simple keys).

| File | Purpose | Required |
|------|---------|----------|
| `gemini_api_key` | Google Gemini API key | Yes |
| `google_oauth.json` | Google Calendar OAuth credentials (client_id, client_secret, refresh_token) | Yes (for booking) |
| `stripe_secret_key` | Stripe secret key (sk_test_... or sk_live_...) | Yes (for payments) |
| `stripe_publishable_key` | Stripe publishable key (pk_test_... or pk_live_...) | Yes (for payments) |
| `stripe_webhook_secret` | Stripe webhook signing secret (whsec_...) | Yes (for payments) |
| `justec_bot_token` | Telegram bot token for lead notifications | Optional |
| `admin_bot_token` | Telegram bot token for security alerts | Optional |
| `trello_credentials.json` | Trello API key + token (JSON: `{"api_key":"...","token":"..."}`) | Optional |
| `paypal_credentials.json` | PayPal client_id + secret (not provisioned) | Not used |

---

## Prompt Files — What Controls What

The `prompts/` directory is where the AI's personality and behavior are defined. These are markdown files with template variables that get resolved from your config.

### File-to-Behavior Map

| File | What It Controls | When to Edit |
|------|-----------------|--------------|
| `shared-persona.md` | Personality, tone, communication rules | You want the AI to be more/less formal, change its speaking style, adjust how many questions it asks |
| `knowledge-base.md` | Company knowledge — services, founder, tech, positioning | Your company details, offerings, or positioning change |
| `lobby.md` | Discovery conversation strategy, how the AI evaluates visitors | You want to change the qualification approach, SPIN questions, or lobby behavior |
| `meeting-room.md` | Value delivery, booking flow, tool usage rules | You want to change how booking works, when tools are called, or the sales approach |
| `security-instructions.md` | What the AI must never reveal, how to handle attacks | You want to adjust security boundaries or add protected information |
| `language-instructions.md` | Language-specific tone and cultural rules | You add a language or change tone for a specific market |
| `qualification-extraction.md` | Scoring dimensions and how to assess visitors | You want to change what qualifies a lead or add new scoring criteria |

### Template Variables in Prompt Files

Prompt files use `{{variable}}` syntax that gets replaced with values from your config:

| Variable | Config Source | Example |
|----------|-------------|---------|
| `{{owner}}` | `client.owner` | Hendrik Bondzio |
| `{{owner_first}}` | First word of `client.owner` | Hendrik |
| `{{company}}` | `client.company` | Surfstyk Limited |
| `{{company_pt}}` | `client.company_pt` | Surfstyk LDA |
| `{{persona_name}}` | `persona.name` | Justec |
| `{{website}}` | `client.website` | surfstyk.com |
| `{{location}}` | `client.location` | Ericeira, Portugal |
| `{{services_name}}` | `services.name` | Strategy Session |
| `{{duration_display}}` | `services.duration_display` | 60-minute |
| `{{deposit_display}}` | `payment.deposit_display` | 50 EUR |
| `{{contact_channel}}` | `persona.contact_channel` | WhatsApp |
| `{{system_name}}` | `persona.system_name` | Justec Virtual Front Desk |
| `{{currency_symbol}}` | `payment.currency_symbol` | € |

You can freely edit the prose in prompt files. Just keep `{{variables}}` and `[PLACEHOLDERS]` intact.

### Structural Placeholders

The tier files (`lobby.md`, `meeting-room.md`) use `[PLACEHOLDER]` syntax to include other files:

```
[SHARED_PERSONA]           → includes shared-persona.md
[KNOWLEDGE_BASE]           → includes knowledge-base.md
[SECURITY_INSTRUCTIONS]    → includes security-instructions.md
[LANGUAGE_INSTRUCTIONS]    → includes language-instructions.md
[QUALIFICATION_EXTRACTION] → includes qualification-extraction.md
```

Don't remove these from the tier files unless you intentionally want to drop that section from the prompt.

---

## The Two-Tier System

### Lobby (Default)

- **Purpose**: Evaluate whether the visitor is a good fit
- **Behavior**: Asks discovery questions (SPIN method), keeps responses short (2-4 sentences), conserves tokens
- **Tools available**: None (only `report_signals` for internal scoring)
- **Token budget**: Lower (anonymous: 30K, engaged: 60K)
- **History window**: Last 5 exchanges (10 messages) to save tokens

### Meeting Room (Escalated)

- **Purpose**: Deliver value, guide toward booking
- **Behavior**: Shares insights, proposes the service, guides through booking flow
- **Tools available**: Phone capture, calendar availability, payment (gated sequentially)
- **Token budget**: Higher (qualified: 150K, post-booking: 300K)
- **History window**: Full conversation

### Escalation

A visitor is escalated from lobby to meeting room when their composite qualification score crosses the `qualified` threshold (default: 70). This is a one-way transition.

The score is computed after every message from three components:
1. **Explicit** (40%) — What the visitor reveals about their problem, authority, timeline, budget
2. **Behavioral** (35%) — How they interact (typing speed, corrections, engagement patterns)
3. **Fit** (25%) — How well their need matches your services

When escalation happens: a Trello card is created, a Telegram notification is sent, and the frontend receives a `tier_change` event.

---

## Booking Flow

The booking flow is strictly sequential — one step at a time:

1. **AI delivers value** (insight, reframe) and proposes the service
2. **Visitor verbally agrees** (the AI must wait for this before using any tools)
3. **Phone capture** → `request_phone` tool → phone input widget appears
4. **Calendar slot** → `check_calendar_availability` tool → slot card appears (1 slot per call, max 3 total)
5. **Visitor selects slot** → frontend sends `slot_selected` action
6. **Payment** → `request_payment` tool → embedded Stripe checkout appears
7. **Payment completes** → Stripe webhook → calendar event confirmed, Trello card moved, Telegram notified

The AI is trained to never skip steps or combine multiple tools in one message.

---

## GDPR Consent

Consent is handled at session creation, not during the conversation:

1. Session is created → backend returns `greeting` + `consent_request` + `post_consent` messages
2. Frontend shows the greeting, then the consent banner
3. Visitor clicks accept or decline
4. Frontend sends `POST /api/session/:id/consent` with `granted` or `declined`
5. **Accepted**: Chat input is enabled, conversation proceeds normally, data is persisted to SQLite
6. **Declined**: Chat stays disabled (the site requires consent for Google Fonts/Cloudflare). No data is logged

The AI has no knowledge of the consent system — it's purely a frontend + backend concern.

---

## Security Features

### Input Filtering

Every visitor message is scanned before reaching the AI:
- **Injection detection**: Prompt resets, jailbreak attempts, `[INST]` tags → threat level 2
- **Hostility detection**: Violence, threats → threat level 3
- **Profanity detection**: Swear words (EN/DE/PT) → threat level 1
- **Length limiting**: Messages > 2000 chars truncated → threat level 1
- **Rapid-fire detection**: Messages < 3s apart → flagged

### Guard State Machine

Threat levels escalate a one-way state machine:
- Level 0: Normal operation
- Level 1: Soft redirect (the AI gets an extra instruction to steer back on topic)
- Level 2: Stronger redirect with warning
- Level 3: Session terminated with localized message
- Level 4: IP blocked (1-hour ban) + session terminated

### Output Filtering

Every AI response is scanned before reaching the visitor:
- Prompt leakage detection (mentions of "system prompt", "my instructions")
- Sales methodology keywords ("SPIN selling", "Challenger Sale", "Sandler")
- Architecture terms ("qualification score", "tier transition", "token budget")
- Internal keywords (from `security.internal_keywords` in config)

If leakage is detected, the response is replaced with a generic message.

### Rate Limiting

- Per-session: configurable message count (default 15)
- Per-IP: hourly limit (default 20)
- Concurrent sessions: global cap (default 10), excess sessions queued

---

## Monitoring & Health Checks

### Health Endpoints

```bash
# Public health check
curl https://your-domain.com/api/health

# Detailed health (localhost only)
curl http://localhost:3100/api/health/detailed
```

### Session Inspection

```bash
# Quick status
curl https://your-domain.com/api/session/{id}/status

# Full state (scores, visitor info, budget)
curl https://your-domain.com/api/session/{id}/state

# Conversation history
curl https://your-domain.com/api/session/{id}/history
```

### Logs

```bash
# Live logs on server
sudo journalctl -u justec-public.service -f

# Recent errors
sudo journalctl -u justec-public.service --since "1 hour ago" | grep -i error
```

Key log prefixes to watch for:
- `[message]` — Message processing events, tool calls, LLM errors
- `[security]` — Guard escalations, input/output filter triggers
- `[calendar]` — Slot computation, hold creation/deletion
- `[stripe]` — Payment session creation, webhook processing
- `[trello]` — Card operations
- `[telegram]` — Notification sends
- `[config]` — Config loading issues
- `[deploy]` — Deployment script output

### Telegram Notifications

If configured, you'll receive:
- **Activity bot**: Lead qualification notifications, booking confirmations
- **Admin bot**: Security incidents (guard terminations, IP blocks)

---

## Troubleshooting

### AI gives empty responses

**Cause**: Usually a Gemini model quirk — produces "thinking" tokens without visible text.

**Check**: Look for `[message] Empty response after all rounds — sending fallback` in logs.

**Fix**: Increase `llm.lobby.max_tokens` / `llm.meeting_room.max_tokens` in config. Current recommended values: lobby 4096, meeting room 8192.

### AI leaks internal information

**Cause**: The model occasionally mentions scoring, tool names, or methodology keywords.

**Check**: Look for `output_filter:` in logs.

**Fix**: Add the leaked term to `security.internal_keywords` in config. The output filter will catch it and replace the response.

### Calendar shows no available slots

**Check**:
1. Verify `calendar.working_hours` matches your actual availability
2. Check Google Calendar for events blocking slots (including `[HOLD]` events from past sessions)
3. Verify Google OAuth credentials are valid: `cat /etc/justec-public/credentials/google_oauth.json`

**Fix**: Stale holds are cleaned up automatically every 60 seconds, but you can restart the service to clear them immediately.

### Payment webhook not processing

**Check**:
1. Verify webhook secret: `cat /etc/justec-public/credentials/stripe_webhook_secret`
2. Check Stripe Dashboard → Webhooks for delivery status
3. Look for `[stripe]` errors in logs

### Visitor gets rate limited too quickly

**Fix**: Increase `rate_limits.messages_per_session` and/or `rate_limits.messages_per_ip_per_hour` in config.

### Visitors not getting escalated to meeting room

**Check**: Use the state endpoint (`GET /api/session/{id}/state`) to see the visitor's scores.

**Fix**: Lower `scoring.thresholds.qualified` (default 70) if too few visitors are escalating. Adjust `scoring.weights` if certain scoring components should matter more.

### Service won't start

**Check**:
```bash
sudo journalctl -u justec-public.service --since "5 minutes ago"
```

Common causes:
- Missing credentials files
- Invalid JSON in config file
- Port 3100 already in use
- Node.js version too old (needs >= 20)

### Config changes not taking effect

Remember: `deploy.sh` does NOT update `/etc/justec-public/config.json`. You must:
```bash
ssh hendrik@46.225.188.5
sudo nano /etc/justec-public/config.json
sudo systemctl restart justec-public.service
```

---

## Setting Up a New Installation

1. **Copy the example config**:
   ```bash
   cp config/example.json config/your-company.json
   ```

2. **Fill in your identity** — company name, owner, timezone, languages, website, CORS origins

3. **Set up credentials** — create the credentials directory and populate:
   - Gemini API key
   - Google Calendar OAuth (client_id, client_secret, refresh_token)
   - Stripe keys (secret, publishable, webhook secret)
   - Optional: Telegram bot tokens, Trello credentials

4. **Customize prompts** (optional) — edit the prose in `prompts/` files, keeping `{{variables}}` and `[PLACEHOLDERS]` intact. Or set `persona.prompts_dir` to a new directory with all 7 files

5. **Configure payment** — set deposit amount, currency, product name

6. **Configure calendar** — set working hours, timezone, slot duration

7. **Test locally**:
   ```bash
   CONFIG_PATH=config/your-company.json npm run dev
   ```
   The loader will warn about any unresolved `{{variables}}`.

8. **Deploy** — set up the server with systemd, Caddy, credentials directory, and run `deploy.sh`
