# BikeFit

Self-service gravel bike fitting from a short video. A logged-in cyclist uploads a
side-view clip of themselves pedalling; the **browser** runs pose estimation plus a
vision LLM to find the top- and bottom-of-stroke keyframes, measures the joint
angles, and a second LLM turns those angles into plain-language adjustment advice
("raise saddle ~5 mm"). Every analysis is saved to the user's session history so
they can track changes across fittings.

**Status:** MVP. Gravel geometry only — see [Scope](#scope). Full product spec in
[`context/foundation/prd.md`](context/foundation/prd.md).

## How it works

The analysis pipeline runs almost entirely client-side
([`src/components/VideoAnalyzer.tsx`](src/components/VideoAnalyzer.tsx)). The server
only persists what the browser posts.

1. **Create session** — `POST /api/sessions` inserts a `queued` row.
2. **Load pose model** — TensorFlow.js MoveNet (SinglePose Lightning, CPU backend)
   loads in the browser.
3. **Find keyframes** — the MP4 is sent to a vision LLM (`POST /api/analyze` →
   OpenRouter) which returns Bottom Dead Center / Top Dead Center timestamps.
4. **Measure angles** — MoveNet estimates poses on a ±2-frame scan around each
   keyframe; [`src/lib/pose/angles.ts`](src/lib/pose/angles.ts) computes knee
   (BDC/TDC), hip, torso, and elbow angles.
5. **Generate recommendations** — `POST /api/sessions/[id]/recommend` sends the
   angles to a text LLM with a fitter prompt built from the reference bands.
6. **Save results** — `POST /api/sessions/[id]/results` persists recommendations +
   angles and marks the session `completed` (or `failed` with a human-readable
   message).

The raw video is **never stored** — the `video_r2_key` column exists but is never
populated ("process and discard", per the PRD privacy guardrail).

The five gravel reference angle bands are fixed in
[`context/foundation/reference-angles.md`](context/foundation/reference-angles.md)
and mirrored by `ANGLE_REFS` in `src/lib/pose/angles.ts`; a test pins the two
together.

## Tech stack

- **Astro 6** SSR (`output: "server"`) with **React 19** islands
- **TypeScript**, **Tailwind 4**, **shadcn/ui** ("new-york" variant)
- **Supabase** — email/password auth + Postgres + row-level security
- **OpenRouter** — vision + text LLM calls ([`src/lib/services/llm.ts`](src/lib/services/llm.ts))
- **TensorFlow.js** `pose-detection` (MoveNet) — client-side pose estimation
- **Cloudflare Workers** — deploy target (`@astrojs/cloudflare` + `wrangler`)

## Prerequisites

- Node.js `22.14.0` (see `.nvmrc`)
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
   `astro preview` and Wrangler. Both are gitignored.

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:4321`, sign up at `/auth/signup`, then upload a
   ≤10 s side-view MP4 from `/dashboard`.

## Available Scripts

- `npm run dev` — start the Astro dev server (`http://localhost:4321`)
- `npm run build` — production build
- `npm run preview` — preview the production build on the Cloudflare runtime
- `npm test` — run the Vitest suite once
- `npm run test:watch` — Vitest in watch mode
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked rules)
- `npm run format` — Prettier
- `npx astro check` — type-check `.astro`/`.ts` (`astro build` does **not** type-check)

Pre-commit hooks (husky + lint-staged) run `eslint --fix` on `*.{ts,tsx,astro}` and
`prettier --write` on `*.{json,css,md}`.

## Project Structure

| Path                                                       | What's there                                    |
| ---------------------------------------------------------- | ----------------------------------------------- |
| `src/pages/api/analyze.ts`                                 | Vision-LLM keyframe (BDC/TDC) detection         |
| `src/pages/api/auth/`                                      | `signin` / `signup` / `signout` endpoints       |
| `src/pages/api/sessions/index.ts`                          | `POST` — create a session                       |
| `src/pages/api/sessions/[id].ts`                           | `GET` status poll, `DELETE` (ownership-checked) |
| `src/pages/api/sessions/[id]/{start,recommend,results}.ts` | Workflow transitions + LLM recommend + persist  |
| `src/pages/auth/*.astro`                                   | `signin` / `signup` / `confirm-email` pages     |
| `src/pages/dashboard.astro`                                | Upload + run analysis (protected)               |
| `src/pages/sessions/{index,[id]}.astro`                    | History list + session detail (protected)       |
| `src/components/VideoAnalyzer.tsx`                         | The client-side analysis pipeline               |
| `src/lib/pose/angles.ts`                                   | Joint-angle geometry + `ANGLE_REFS`             |
| `src/lib/angle-verdict.ts`                                 | In / out-of-range decision on a measurement     |
| `src/lib/recommendations-prompt.ts`                        | Fitter system prompt built from `ANGLE_REFS`    |
| `src/lib/services/llm.ts`                                  | OpenRouter vision + text calls                  |
| `src/lib/supabase.ts`                                      | Cookie-session SSR Supabase client              |
| `src/middleware.ts`                                        | Resolves the user, guards `PROTECTED_ROUTES`    |
| `src/types.ts`                                             | Shared entities + DTOs                          |
| `supabase/migrations/`                                     | Schema + RLS policies                           |
| `context/foundation/`                                      | PRD, roadmap, test plan, reference angles       |

## Auth & Access Control

- Email/password via Supabase. Auth pages under `src/pages/auth/`; endpoints under
  `src/pages/api/auth/`.
- [`src/middleware.ts`](src/middleware.ts) resolves the current user on every
  request into `context.locals.user` and redirects unauthenticated visitors away
  from `PROTECTED_ROUTES` (`/dashboard`, `/sessions`).
- `fitting_sessions` and `analysis_results` have RLS `ENABLE` + `FORCE` with
  per-operation `*_own` policies; every session is scoped to `user_id`. Every API
  route returns `401` when `context.locals.user` is absent.

## Database

Schema and policies live in `supabase/migrations/` (naming:
`YYYYMMDDHHmmss_short_description.sql`). Two tables:

- `fitting_sessions` — one row per upload; `status` state machine
  `queued → processing → completed | failed`.
- `analysis_results` — one row per completed analysis (angles + recommendations),
  `ON DELETE CASCADE` from its session.

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
etc.) or in the Cloudflare dashboard. Point `SUPABASE_URL`/`SUPABASE_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` at your hosted Supabase project, and re-enable email
confirmation there (Studio → Authentication → Providers → Email).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `lint` + `build` on
every push and PR to `master`. Requires `SUPABASE_URL` and `SUPABASE_KEY`
repository secrets. `astro build` does not type-check, and `npm test` is not yet
gated — wiring both into CI is tracked in
[`context/foundation/test-plan.md`](context/foundation/test-plan.md) §3 (Phases 2
and 4).

## Testing

`npm test` runs the Vitest suite (currently the joint-angle geometry, angle
verdict, recommendations-prompt, and formatting units). The quality strategy —
risk map, phased rollout, and per-risk test mapping — is in
[`context/foundation/test-plan.md`](context/foundation/test-plan.md).

## Scope

MVP is deliberately narrow (full list in `context/foundation/prd.md` → Non-Goals):

- **Gravel geometry only** — reference bands are not calibrated for road or MTB.
- **MP4 only**, side-view, ≤10 s, one rider in frame.
- No own pose model (third-party MoveNet), no mobile app, no live/real-time
  analysis, no equipment recommendations, no sharing or coach access, no medical
  advice.

## License

MIT
