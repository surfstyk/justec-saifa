# Prompts Directory

This directory defines what the AI assistant knows and how it behaves. These files are the "personality layer" of the virtual front desk — everything from tone of voice to security boundaries to qualification criteria.

## Files

| File | Purpose |
|------|---------|
| `shared-persona.md` | Core identity, personality traits, communication rules, company naming |
| `knowledge-base.md` | What the assistant knows about the company, founder, services, technology |
| `lobby.md` | Lobby tier behavior — discovery conversation, SPIN questioning, token conservation |
| `meeting-room.md` | Meeting room tier — value delivery, booking flow, tool usage instructions |
| `security-instructions.md` | What to never reveal, how to handle injection attempts, off-topic requests |
| `language-instructions.md` | Language-specific tone (English, German, Portuguese), cultural adaptation |
| `qualification-extraction.md` | Scoring guide for the `report_signals` tool — how to assess visitors |

## Two-Layer Template System

### Layer 1: Structural Placeholders `[X]`

The tier files (`lobby.md`, `meeting-room.md`) use square-bracket placeholders to assemble the full prompt:

```
[SHARED_PERSONA]
[KNOWLEDGE_BASE]
[SECURITY_INSTRUCTIONS]
[LANGUAGE_INSTRUCTIONS]
[QUALIFICATION_EXTRACTION]
```

These are replaced at load time with the contents of the corresponding files. This keeps each concern in its own file while assembling a single system prompt.

### Layer 2: Identity Variables `{{x}}`

All files use double-brace variables for identity-specific values. These are resolved from the application config after structural assembly.

| Variable | Config Source | Example Value |
|----------|-------------|---------------|
| `{{owner}}` | `client.owner` | Hendrik Bondzio |
| `{{owner_first}}` | `client.owner` (first word) | Hendrik |
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

## Setting Up a New Installation

1. Copy `config/example.json` to `config/your-company.json`
2. Fill in all identity fields (company name, owner, services, payment details, etc.)
3. Set `CONFIG_PATH=config/your-company.json` as an environment variable
4. Optionally customize prompt files — the prose and strategy can be edited freely, just keep the `{{variables}}` and `[PLACEHOLDERS]` intact
5. If you want a completely different prompt directory, set `persona.prompts_dir` in your config and create the directory with all 7 files
6. Run `npm run build && npm run dev` — the loader will warn about any unresolved `{{variables}}`
