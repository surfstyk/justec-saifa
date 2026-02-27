# Tech & Infrastructure Stack — Briefing Document

## Workspace Structure

Monorepo-style workspace at `lovable-migration/` containing 3 independent subprojects, each with its own `package.json`, build pipeline, and GitHub repo. No shared `node_modules` or workspace manager (not npm workspaces, not turborepo) — each project is fully standalone.

| Project | Domain | Purpose | GitHub Repo |
|---|---|---|---|
| `surfstyk/` | surfstyk.com | AI CRM consulting marketing site | `surfstyk/surfstyk` |
| `gripandtraction/` | gripandtraction.com | Surf traction pad landing page | `surfstyk/gripandtraction` |
| `kongquant/` | kongquant.com | Autonomous crypto trading platform | `surfstyk/kongquant-www` |

All repos are private under the `surfstyk` GitHub org.

---

## Frontend Stack (per project)

### surfstyk & gripandtraction (Lovable.dev legacy)

- React 18.3 + Vite 5 + TypeScript 5.8 + Tailwind CSS v3 + PostCSS + Autoprefixer
- shadcn/ui (individual `@radix-ui/*` packages, `class-variance-authority`, `clsx`, `tailwind-merge`)
- React Router v6 + TanStack React Query v5
- Lucide React icons, Sonner toasts
- ESLint 9, `@vitejs/plugin-react-swc`
- `lovable-tagger` dev dependency (Lovable.dev artifact)

**surfstyk-specific:** GSAP (scroll animations), Recharts, cmdk, react-hook-form + zod, embla-carousel, react-resizable-panels, vaul (drawer), date-fns, next-themes

**gripandtraction-specific:** Framer Motion (animations), same Lovable base as surfstyk

### kongquant (modernized, post-migration)

- React 19.2 + Vite 7 + TypeScript 5.9 + Tailwind CSS v4 (no PostCSS — uses `@tailwindcss/vite` plugin directly)
- shadcn v3 (unified `radix-ui` package, not individual `@radix-ui/*`)
- React Router v7 (lazy-loaded routes + Suspense)
- TanStack React Query v5 + TanStack React Virtual v3 (virtualized lists)
- TradingView Lightweight Charts v5.1 (candlestick/line charts with custom primitives)
- Lucide React icons, Sonner toasts
- tw-animate-css (replaces tailwindcss-animate for v4)
- ESLint 9, `@vitejs/plugin-react`
- No GSAP, no Framer Motion — pure CSS keyframe animations

---

## Build System

Identical npm scripts across all projects:

```
npm install    → install deps
npm run dev    → Vite dev server (surfstyk/kongquant: 5173, gripandtraction: 8080)
npm run build  → production build → dist/
npm run lint   → ESLint
```

kongquant build includes `tsc -b` before `vite build`; the other two skip type-checking in the build step.

---

## Server Infrastructure

- **Provider:** Hetzner VPS (single Ubuntu server)
- **IP:** 46.225.188.5
- **SSH:** `ssh hendrik@46.225.188.5` — key auth only, no root login, no password auth
- **Web server:** Caddy — automatic HTTPS (Let's Encrypt), static file serving
- **Firewall:** UFW — ports 22, 80, 443 only
- **DNS:** Managed externally, A records point to Hetzner IP
- **Site root:** `/var/www/<domain>/` per site (e.g., `/var/www/surfstyk.com/`)
- **Caddy config:** Static serving for surfstyk and gripandtraction; SPA fallback (`try_files {path} /index.html`) for kongquant

---

## Deployment

### Manual (local)

```bash
./deploy.sh              # build + deploy all (currently surfstyk + gripandtraction only)
./deploy.sh surfstyk     # single project
```

Builds locally with Vite, rsyncs `dist/` to `/var/www/<domain>/` on the server. Caddy serves the files directly — no restart needed.

### CI/CD (GitHub Actions)

- Each repo has `.github/workflows/deploy.yml`
- Trigger: push to `main`
- Steps: checkout → npm install → npm run build → rsync to server
- Duration: ~50s
- Auth: `DEPLOY_SSH_KEY` GitHub secret (dedicated ed25519 key, separate from personal key)

---

## External Services & Integrations

| Service | Used By | Purpose |
|---|---|---|
| FormSubmit.co | kongquant | Waitlist form forwarding (hashed endpoint) |
| n8n (self-hosted at n8n.surfstyk.com) | surfstyk, gripandtraction | Form webhook processing |
| WordPress (blog.surfstyk.com) | surfstyk | Blog/case studies |
| Calendly | surfstyk | Scheduling |
| Kong Engine API (api.kongquant.com/v1) | kongquant | Trading data, authenticated with `X-API-Key` header |

Form submissions forward to `hazetbe@googlemail.com`.

---

## kongquant-Specific Architecture

### Two surfaces

1. **Landing page** (`/`) — cinematic one-pager, waitlist form, no auth
2. **Dashboard** (`/dashboard/*`) — authenticated SPA with 4 sub-pages

### Auth

Client-side SHA-256 password gate via Web Crypto API, session in localStorage. No backend auth.

### API

Kong Engine at `api.kongquant.com/v1`. Requires `X-API-Key` header (stored as `VITE_KONG_API_KEY` env var, local `.env` + GitHub secret). `/health` endpoint is exempt from auth.

### Dashboard routes

- `/login` → password gate
- `/dashboard` → Overview (main table with regime bar, filters, virtualized rows)
- `/dashboard/pair/:base` → Pair detail with interactive TradingView charts (candlestick + cloud fill + RSI/MACD indicator panes)
- `/dashboard/flips` → Flip events table
- `/dashboard/primes` → Prime card grid

### Key libraries in use

- TradingView Lightweight Charts v5 (custom `ISeriesPrimitiveBase` for cloud fills, series markers plugin, synced multi-pane charts)
- TanStack Virtual for table virtualization
- React Query with 4h staleTime

### SEO

Dashboard and login pages have `<meta name="robots" content="noindex">` via custom `useNoIndex` hook.

---

## Key Patterns & Conventions

- All external URLs (webhooks, social, scheduling) are hardcoded in source — no env vars except kongquant's API key
- shadcn/ui components in `src/components/ui/` (standard shadcn path)
- No database, no Supabase, no backend (except kongquant's external API)
- No testing framework configured in any project
- Tailwind v4 opacity modifiers (`text-color/30`) unreliable with custom theme colors — use `rgba()` inline
- Domain terminology for kongquant: "Prime" (never "signal"), outcomes are `open | target_hit | stop_hit | opposite_flip | expired`

---

## Gold Standard Stack for New Projects

Based on the most recent project (kongquant), the current baseline for a new site:

- **React 19** + **Vite 7** + **TypeScript 5.9** + **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **shadcn v3** (unified `radix-ui` package)
- **React Router v7** with lazy routes
- **TanStack React Query v5** for data fetching
- **Lucide React** for icons, **Sonner** for toasts
- **CSS keyframe animations** (no animation library)
- Deploy via rsync to Hetzner, served by Caddy, CI/CD via GitHub Actions
