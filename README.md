# BikeFit

Self-service gravel bike fitting from a short video. A logged-in cyclist uploads a
side-view clip of themselves pedalling; the **browser** runs pose estimation plus a
vision LLM to find the top- and bottom-of-stroke keyframes, measures the joint
angles, and a second LLM turns those angles into plain-language adjustment advice
("raise saddle ~5 mm"). Every analysis is saved to the user's session history so
they can track changes across fittings.

**Status:** MVP. Every roadmap slice through S-07 has shipped (see
[`context/foundation/roadmap.md`](context/foundation/roadmap.md)). Gravel geometry
only — see [Scope](#scope). Full product spec in
[`context/foundation/prd.md`](context/foundation/prd.md).

## How it works

The analysis pipeline runs almost entirely client-side
([`src/components/VideoAnalyzer.tsx`](src/components/VideoAnalyzer.tsx)). The server
only persists what the browser posts, gates the LLM calls, and enforces ownership.

1. **Create session** — `POST /api/sessions` validates the filename + duration
   (zod) and inserts a `queued` row.
2. **Start session** — `POST /api/sessions/[id]/start` flips the row
   `queued → processing` (a repeat call returns `409` and is tolerated).
3. **Load pose model** — TensorFlow.js MoveNet (SinglePose Lightning, CPU backend)
   loads in the browser via dynamic import (kept out of the SSR bundle).
4. **Find keyframes** — the MP4 is base64-encoded and sent to a vision LLM
   (`POST /api/analyze` → OpenRouter) which returns Bottom Dead Center / Top Dead
   Center timestamps. This route is session-scoped (the session must be owned and
   `processing`), rate-limited, and body-size-capped.
5. **Measure angles** — MoveNet estimates poses on a ±2-frame scan (5 offsets)
   around each keyframe; [`pickExtremumFrame`](src/lib/pose/angles.ts) picks the
   extremum knee angle and [`src/lib/pose/angles.ts`](src/lib/pose/angles.ts)
   computes knee (BDC/TDC), hip, torso, and elbow angles.
6. **Generate recommendations** — `POST /api/sessions/[id]/recommend` sends the
   angles to a text LLM with a fitter prompt built from the reference bands
   (also session-scoped and rate-limited).
7. **Save results** — `POST /api/sessions/[id]/results` persists recommendations +
   angles and marks the session `completed` (or `failed` with a human-readable
   message).

The raw video is **never stored** — the `video_r2_key` column exists but is never
populated ("process and discard", per the PRD privacy guardrail).

A session left `processing` (or stuck `queued`) with no progress for
`STALE_PROCESSING_MS` (15 min) — a browser tab closed mid-analysis — renders as a
terminal "timed out" failure at display time
([`src/lib/session-display-status.ts`](src/lib/session-display-status.ts)); the
stored row is never rewritten.

The five gravel reference angle bands are fixed in
[`context/foundation/reference-angles.md`](context/foundation/reference-angles.md)
and mirrored by `ANGLE_REFS` in `src/lib/pose/angles.ts`; a test pins the two
together.

## Tech stack

- **Astro 6** SSR (`output: "server"`) with **React 19** islands
- **TypeScript**, **Tailwind 4**, **shadcn/ui** ("new-york" variant)
- **zod** — input validation on every API route
- **Supabase** — email/password auth + Postgres + row-level security
- **OpenRouter** — vision + text LLM calls ([`src/lib/services/llm.ts`](src/lib/services/llm.ts))
- **TensorFlow.js** `pose-detection` (MoveNet) — client-side pose estimation
- **Cloudflare Workers** — deploy target (`@astrojs/cloudflare` + `wrangler`)
- **Vitest** (unit + integration) and **Playwright** (e2e smoke)

## Prerequisites

- Node.js `22.14.0` (see `.nvmrc`; CI runs on Node 24)
- Docker + ~7 GB RAM — for the local Supabase stack
- An [OpenRouter](https://openrouter.ai/) API key

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the local Supabase stack. This applies every file in
   `supabase/migrations/` on boot (downloads Docker images on first run):

   ```bash
   npx supabase start
   ```

   Studio UI is then at `http://localhost:54323`. Email confirmation is already
   disabled for local dev (`enable_confirmations = false` in
   `supabase/config.toml`), so you can sign in immediately after sign-up.

3. Create the env files from the template, then fill in the values the previous
   step printed plus your OpenRouter key:

   ```bash
   cp .env.example .env
   cp .env.example .dev.vars
   ```

   | Variable                    | Where it comes from                                                                                                                                                    |
   | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `SUPABASE_URL`              | `API URL` from `supabase start` — `http://127.0.0.1:54321`                                                                                                             |
   | `SUPABASE_KEY`              | `anon key` from `supabase start`                                                                                                                                       |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role key` from `supabase start`. The pipeline routes use it to write across RLS ([`src/lib/services/supabase-admin.ts`](src/lib/services/supabase-admin.ts)). |
   | `OPENROUTER_API_KEY`        | <https://openrouter.ai/keys>                                                                                                                                           |

   `.env` is read by `astro dev` and the Supabase CLI; `.dev.vars` is read by
   `astro preview` and Wrangler. Both are gitignored. An optional
   `OPENROUTER_BASE_URL` redirects the LLM calls to a mock — it is set only for
   the e2e run and unset everywhere else.

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:4321`, sign up at `/auth/signup`, then upload a
   2–15 s side-view MP4 (≤100 MB) from `/dashboard`.

## Available Scripts

- `npm run dev` — start the Astro dev server (`http://localhost:4321`)
- `npm run build` — production build
- `npm run preview` — preview the production build on the Cloudflare runtime
- `npm test` — run the Vitest suite once
- `npm run test:watch` — Vitest in watch mode
- `npm run test:e2e` — Playwright e2e suite (see [`e2e/README.md`](e2e/README.md))
- `npm run test:mutation` — Stryker mutation run
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked rules)
- `npm run format` — Prettier
- Type-check: `npx astro sync && npx tsc --noEmit` (`astro build` does **not**
  type-check; `astro sync` regenerates `astro:env` / content types first)

Pre-commit hooks are run by **Lefthook** (`lefthook.yml`, installed via the
`prepare` script → `lefthook install`): `eslint --fix` on `*.{ts,tsx,astro,js,jsx}`,
`prettier --write` on `*.{json,css,md}`, a full `tsc --noEmit`, and `vitest related`
on staged `*.{ts,tsx}`.

## Project Structure

| Path                                                       | What's there                                          |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `src/pages/index.astro`                                    | Landing page (redirects signed-in users to dashboard) |
| `src/pages/api/analyze.ts`                                 | Vision-LLM keyframe (BDC/TDC) detection               |
| `src/pages/api/auth/`                                      | `signin` / `signup` / `signout` endpoints             |
| `src/pages/api/sessions/index.ts`                          | `POST` — create a session                             |
| `src/pages/api/sessions/[id].ts`                           | `GET` status poll, `DELETE` (ownership-checked)       |
| `src/pages/api/sessions/[id]/{start,recommend,results}.ts` | Workflow transitions + LLM recommend + persist        |
| `src/pages/auth/*.astro`                                   | `signin` / `signup` / `confirm-email` pages           |
| `src/pages/dashboard.astro`                                | Upload + run analysis (protected)                     |
| `src/pages/sessions/{index,[id]}.astro`                    | History list + session detail (protected)             |
| `src/components/VideoUpload.tsx` / `VideoAnalyzer.tsx`     | Upload/validation UI + the client-side pipeline       |
| `src/components/{Landing,Topbar,Banner}.astro`             | Marketing page, nav bar, missing-config banner        |
| `src/components/auth/`                                     | Sign-in / sign-up form islands                        |
| `src/lib/pose/angles.ts`                                   | Joint-angle geometry + `ANGLE_REFS`                   |
| `src/lib/schemas.ts`                                       | zod schemas for every API payload                     |
| `src/lib/angle-verdict.ts`                                 | In / out-of-range decision on a measurement           |
| `src/lib/recommendations-prompt.ts`                        | Fitter system prompt built from `ANGLE_REFS`          |
| `src/lib/session-display-status.ts`                        | Display-time "timed out" reconciliation               |
| `src/lib/config-status.ts`                                 | Detects missing Supabase config for the banner        |
| `src/lib/services/llm.ts`                                  | OpenRouter vision + text calls                        |
| `src/lib/services/rate-limit.ts`                           | Per-user, per-route request counter                   |
| `src/lib/supabase.ts`                                      | Cookie-session SSR Supabase client                    |
| `src/middleware.ts`                                        | Resolves the user, guards `PROTECTED_ROUTES`          |
| `src/types.ts`                                             | Shared entities + DTOs                                |
| `supabase/migrations/`                                     | Schema + RLS policies                                 |
| `e2e/`                                                     | Playwright smoke + cross-user RLS check               |
| `src/test/helpers/`                                        | Vitest stubs (Supabase, OpenRouter, API context)      |
| `context/foundation/`                                      | PRD, roadmap, test plan, reference angles             |

## Auth & Access Control

- Email/password via Supabase. Auth pages under `src/pages/auth/`; endpoints under
  `src/pages/api/auth/`.
- [`src/middleware.ts`](src/middleware.ts) resolves the current user on every
  request into `context.locals.user` and redirects unauthenticated visitors away
  from `PROTECTED_ROUTES` (`/dashboard`, `/sessions`).
- `fitting_sessions` and `analysis_results` have RLS `ENABLE` + `FORCE` with
  per-operation `*_own` policies; every session is scoped to `user_id`. Every API
  route returns `401` when `context.locals.user` is absent, and the pipeline
  routes carry a belt-and-braces `.eq("user_id", …)` on every service-role write.
- `POST /api/analyze` and `POST /api/sessions/[id]/recommend` are rate-limited per
  user per route (10 requests / 10 min) via an atomic Postgres counter
  ([`src/lib/services/rate-limit.ts`](src/lib/services/rate-limit.ts)); `/api/analyze`
  also rejects an oversized body with `413` before buffering it.

## Database

Schema and policies live in `supabase/migrations/` (naming:
`YYYYMMDDHHmmss_short_description.sql`). Three tables:

- `fitting_sessions` — one row per upload; `status` state machine
  `queued → processing → completed | failed`. A stale `processing`/`queued` row is
  additionally shown as "timed out" at display time only.
- `analysis_results` — one row per completed analysis (angles + recommendations),
  `ON DELETE CASCADE` from its session. Written only via the service-role client.
- `rate_limits` — per-user, per-route request counter in fixed 10-minute windows;
  reachable only through the `check_and_increment_rate_limit` RPC (service-role only).

Local: `npx supabase start` applies migrations on boot; `npx supabase db reset`
re-applies from scratch. Against a cloud project: `npx supabase link` then
`npx supabase db push`.

## Deployment

Deploys to [Cloudflare Workers](https://workers.cloudflare.com/) (the
`@astrojs/cloudflare` v13+ adapter targets Workers with Static Assets, not Pages —
see [`context/foundation/infrastructure.md`](context/foundation/infrastructure.md)).

```bash
npm run build
npx wrangler deploy
```

Set the four env vars as Worker secrets (`npx wrangler secret put SUPABASE_URL`,
etc.) or in the Cloudflare dashboard. Point `SUPABASE_URL` / `SUPABASE_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` at your hosted Supabase project, and re-enable email
confirmation there (Studio → Authentication → Providers → Email).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and PR to
`master`, on Node 24, in two jobs:

- **`ci`** — `npm ci` → `astro sync` → `tsc --noEmit` → `lint` → `test` → `build`.
  Needs `SUPABASE_URL` and `SUPABASE_KEY` repository secrets (build step only).
- **`e2e`** — `npm ci` → `astro sync` → `supabase link` + `db push` against the
  dedicated `bikefit-e2e` project → `playwright install` → `playwright test`. The
  OpenRouter calls are served by a local mock. Needs `SUPABASE_ACCESS_TOKEN`,
  `E2E_SUPABASE_DB_PASSWORD`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_KEY`, and
  `E2E_SUPABASE_SERVICE_ROLE_KEY`.

## Testing

`npm test` runs the Vitest suite (currently 18 files / 171 tests — joint-angle
geometry, angle verdict, recommendations prompt, LLM response parsing, rate limit,
capped body, session display status, and the API-route integration tests).
`npm run test:e2e` runs the Playwright upload → analysing → results smoke plus a
real cross-user RLS check ([`e2e/README.md`](e2e/README.md)). The quality strategy —
risk map, phased rollout, and per-risk test mapping — is in
[`context/foundation/test-plan.md`](context/foundation/test-plan.md).

## Scope

MVP is deliberately narrow (full list in `context/foundation/prd.md` → Non-Goals):

- **Gravel geometry only** — reference bands are not calibrated for road or MTB.
- **MP4 only**, side-view, 2–15 s, ≤100 MB, one rider in frame.
- No own pose model (third-party MoveNet), no mobile app, no live/real-time
  analysis, no equipment recommendations, no sharing or coach access, no medical
  advice.

## License

MIT
