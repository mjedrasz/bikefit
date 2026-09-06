---
date: 2026-09-05T18:37:49+02:00
researcher: maro
git_commit: 569051abd5ba5b7efd597a986fd5268bf76025ae
branch: master
repository: mjedrasz/bikefit
topic: "Quality-gates wiring + one e2e smoke — grounding for test-plan §3 Phase 4"
tags: [research, codebase, ci, gates, playwright, e2e, rls, ownership, supabase]
status: complete
last_updated: 2026-09-05
last_updated_by: maro
---

# Research: Quality-gates wiring + one e2e smoke

**Date**: 2026-09-05T18:37:49+02:00
**Researcher**: maro
**Git Commit**: 569051abd5ba5b7efd597a986fd5268bf76025ae
**Branch**: master
**Repository**: mjedrasz/bikefit

## Research Question

Ground `context/foundation/test-plan.md` §3 Phase 4 ("Quality-gates wiring + one
e2e smoke"): what does it take to (a) make `tsc --noEmit` and the full Vitest
suite required CI gates, and (b) add a single Playwright happy-path smoke over
upload → analysing → results, seeded via the Supabase Auth admin API? Plus the
change's own stated grounding question (`change.md`): does the deferred real
two-user cross-RLS check (Risk #5) fit inside that one flow, or does it need a
second, narrowly-scoped e2e case?

## Summary

- **CI typecheck gap is real and narrow.** `npm test` is already a required CI
  step (`.github/workflows/ci.yml:21`) and already runs the _full_ Vitest
  suite — both `vitest.config.ts` projects (`unit` + `pages`) — so "make the
  new test suites required CI gates" is already substantially satisfied by
  what's live today. The one missing gate is `npx tsc --noEmit` as its own CI
  step; it's already the exact command Lefthook runs locally
  (`lefthook.yml:10-11`), so wiring it into CI is a direct lift, not new
  tooling.
- **Playwright is not installed at all** — no dependency, no config, no e2e
  directory, no script. Building it from zero.
- **Running a real Astro+Cloudflare server for e2e is not `astro dev`.**
  Astro's own docs (Context7, `/withastro/docs`) say `astro preview` under the
  `@astrojs/cloudflare` adapter runs the actual **workerd runtime** — the
  closest local approximation to production — and needs a prior `astro build`
  plus `.dev.vars` for secrets. `astro dev` is a plain Node server and doesn't
  exercise the same runtime shape.
- **CI is missing two secrets an e2e job would need.** `astro.config.mjs:21-22`
  requires `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` at module-load
  time (non-optional in the env schema); today only `SUPABASE_URL`/`SUPABASE_KEY`
  are passed to any CI step (`ci.yml:23-25`, build only). An e2e job needs at
  minimum `SUPABASE_SERVICE_ROLE_KEY` (admin-API seeding); `OPENROUTER_API_KEY`
  only if the flow hits OpenRouter live rather than mocking it — see Open
  Questions.
- **The whole upload → analysing → results flow is client-driven, not polled.**
  `dashboard.astro` → `VideoUpload.tsx` → `VideoAnalyzer.tsx` runs 5 sequential
  API calls (`POST /api/sessions` → `.../start` → `/api/analyze` →
  `.../recommend` → `.../results`) purely from the browser; the UI flips to
  "completed" from a local callback, never from polling a status endpoint.
  Two of those calls are real OpenRouter network round-trips — the dominant
  source of e2e timing/flakiness, not WebGL (pose detection is forced onto the
  TF.js **CPU** backend specifically to avoid a WebGL2 dependency, per
  `context/foundation/lessons.md`, so headless Chromium needs no special GPU
  flags).
- **Real, reusable video fixtures already exist**, just not committed as
  fixtures: three untracked root-level MP4s (`video_fixed.mp4`,
  `video_fixed2.mp4`, `video_fixed2_right.mp4`, ~500-600KB, 2.8s H.264/AAC)
  satisfy `VideoUpload.tsx`'s own client-side gates (mp4 mime, ≤100MB, 2-15s
  duration) and are directly usable via Playwright's `setInputFiles`.
- **Auth cookies are not a fixed name or shape.** `@supabase/ssr` derives the
  cookie name from the Supabase project ref (`sb-<project-ref>-auth-token`)
  and may chunk it (`.0`, `.1`, …) if the session exceeds ~3.1KB. Don't
  hand-construct a `Set-Cookie` header — either drive the real `/auth/signin`
  form, or use Playwright's documented `storageState` fixture-override to
  inject a session obtained via the Supabase Auth admin API.
- **The Risk #5 grounding question has a concrete answer.** `sessions/[id].astro`
  is the _only_ surface in the entire flow with no application-level
  `user_id` filter at all — a pure `createClient` (RLS-respecting) read. It's
  the correct, minimal target for the deferred check, and it doesn't require
  re-running the pipeline for a second user (no upload, no LLM calls — just a
  negative assertion against an existing session id). It fits as **a second,
  separate `test()` in the same Playwright spec/suite for this phase** — not
  folded into the happy-path `test()`'s body, and not a second spec file.
  This reading should be flagged back and confirmed before the plan locks it
  in, since "one e2e smoke" is literally singular and a stricter reading
  could object to a second `test()` existing at all.
- **Unplanned finding, flagged separately below and to the user directly**: a
  repo-root untracked file (`test.sh`) contains a live-looking OpenRouter API
  key hardcoded in plaintext. Not committed, but present on disk.

## Detailed Findings

### 1. CI as it exists today (`.github/workflows/ci.yml`, full file, 26 lines)

- Steps: checkout → `setup-node@v4` (node 22) → `npm ci` → `npx astro sync` →
  `npm run lint` → `npm test` → `npm run build` (`ci.yml:13-22`).
- Only the `build` step gets `env:` — `SUPABASE_URL`, `SUPABASE_KEY` from
  repo secrets (`ci.yml:23-25`).
- **No typecheck step anywhere** (no `tsc`, no `astro check`, no
  `npm run typecheck` — and that script doesn't exist, see §3).
- `npm test` → `vitest run` (`package.json:13`) → picks up
  `vitest.config.ts`'s `test.projects` array, which is **both** the `unit`
  project (`vitest.config.ts:34-41`) and the `pages` project
  (`vitest.config.ts:42-48`). So the CI `npm test` step already runs
  everything — angle-math, LLM-boundary, ownership, rate-limit, payload-cap,
  output-contract specs are all in `src/**/*.{test,spec}.ts` and already
  gated. There is no separate "new test suites" wiring left to do beyond
  what's already live.
- `test:mutation` (Stryker) is correctly **absent** from CI — matches
  test-plan.md §5's "advisory (not gated)" (`context/foundation/test-plan.md:177`).

### 2. Local git-hook layer — the typecheck command CI needs to mirror

- `lefthook.yml:10-11` — `typecheck: run: npx tsc --noEmit` — full-project,
  not scoped to staged files (no `{staged_files}` interpolation, unlike
  `lint`/`format`/`test` at lines 4-9, 12-14). This is the exact invocation
  to lift into CI as its own step — no new command shape to design.
- `lint` (`lefthook.yml:4-6`) and `test` (`lefthook.yml:12-14`) are scoped to
  staged files locally; CI's existing `npm run lint` / `npm test` are
  already unscoped (whole project), which is the correct CI posture (commit
  gates scope to staged files for speed; CI re-checks everything).

### 3. `package.json` — scripts and dependencies

- Scripts (`package.json:5-17`): `dev`, `build`, `preview`, `astro`, `lint`,
  `lint:fix`, `format`, `test`, `test:watch`, `test:mutation`, `prepare`.
  **No `"typecheck"` script** — matches `context/foundation/lessons.md:5-9`
  ("Use `npx tsc --noEmit` for TypeScript checks", not `npm run typecheck`
  which doesn't exist). **No e2e script.**
- Dependencies (`package.json:18-69`): **no `@playwright/test` / `playwright`**
  anywhere. Building the e2e layer starts from zero — new devDependency, new
  config file, new script (e.g. `test:e2e`), new directory.

### 4. Env vars and which local server mode an e2e run needs

- `astro.config.mjs:17-24` env schema: `SUPABASE_URL` / `SUPABASE_KEY` are
  `optional: true` (lines 19-20); `SUPABASE_SERVICE_ROLE_KEY` and
  `OPENROUTER_API_KEY` have **no** `optional` flag — required at module load.
  `src/lib/services/llm.ts` and `src/lib/services/supabase-admin.ts` import
  these from `astro:env/server` at import time and throw without them
  (already noted in test-plan.md's Phase 1 "`astro:env` import hazard",
  `context/foundation/test-plan.md:520-526`).
- `README.md:90-91` — `.env` is read by `astro dev` and the Supabase CLI;
  `.dev.vars` is read by `astro preview` and Wrangler (matches CLAUDE.md's
  "Cloudflare secrets go in `.dev.vars`, not `.env`" note).
  `README.md:104-111` confirms `npm run dev` → `astro dev`,
  `npm run preview` → "preview the production build **on the Cloudflare
  runtime**."
- **Confirmed via Context7 (`/withastro/docs`, Cloudflare adapter guide)**:
  _"After building an Astro project, running `astro preview` tests
  Cloudflare Workers applications locally using Cloudflare's **workerd
  runtime**, closely mirroring the production environment."_ This settles
  which local server mode an e2e run should target — `astro preview`, not
  `astro dev` — but it requires a prior `astro build` (confirmed by
  `wrangler.jsonc`'s `assets.directory: ./dist` and Astro's own
  `npx astro build && npx wrangler dev` example snippet).
- **Genuinely open, not settled by docs**: whether Playwright's
  `webServer.env` (plain Node env vars on the spawned process) actually
  reaches the workerd-backed `astro:env` bindings the way `.dev.vars` does,
  or whether the e2e job needs to write a `.dev.vars` file instead. Context7
  describes `.dev.vars` as _the_ local-secrets mechanism for the Cloudflare
  runtime, not `process.env` passthrough — flagged as something to verify
  empirically before the plan commits to a `webServer.command`/`env` shape.
- **New CI secrets needed.** Today only `SUPABASE_URL`/`SUPABASE_KEY` are
  wired as GitHub Actions secrets (`ci.yml:24-25`; CLAUDE.md's CI section and
  `README.md:183` say the same, narrower thing). A real e2e job needs at
  least a `SUPABASE_SERVICE_ROLE_KEY` repo secret (required for admin-API
  seeding, which `change.md:26-27` already commits to). `OPENROUTER_API_KEY`
  is only needed if the e2e flow calls OpenRouter live — see Open Questions.

### 5. Playwright — Context7-grounded setup facts (library ID `/microsoft/playwright`, 6185 snippets, High reputation; Astro docs via `/withastro/docs`, 86.93 benchmark)

- **`webServer` config** (`docs/src/test-webserver-js.md`,
  `docs/src/test-api/class-testconfig.md`):
  ```ts
  webServer: {
    command: 'npm run build && npm run preview', // this app's Cloudflare-adapter case
    url: 'http://localhost:4321/',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { /* SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY */ },
  }
  ```
  `reuseExistingServer: !process.env.CI` is Playwright's documented idiom:
  locally it attaches to an already-running dev server, in CI it always
  spawns fresh. Graceful shutdown is `SIGTERM`/`SIGINT` before `SIGKILL`.
- **Astro's own testing guide** (`guides/testing.mdx`) uses exactly
  `command: 'npm run preview'` in its documented Playwright example — this
  project's Cloudflare-adapter caveat (§4 above) narrows that further to
  "build first, then preview."
- **`storageState` for a pre-authenticated session** (`docs/src/auth.md`,
  `docs/src/test-fixtures-js.md`, `docs/src/api/class-browsercontext.md`):
  the documented "log in once, reuse everywhere" pattern is a setup project
  that authenticates via a direct `request.post(...)` call (not a UI form)
  and writes `request.storageState({ path: ... })`; other tests declare a
  `dependencies` on that setup project. For injecting a cookie obtained
  out-of-band (this project's case — a session minted via the Supabase Auth
  admin API, not a login form), Playwright documents overriding the
  `storageState` **fixture** directly (`test.extend({ storageState: async ({}, use) => { ... } })`)
  or building a `{ cookies: [...], origins: [...] }` object by hand for
  `browser.newContext({ storageState })`. `class-browsercontext.md` /
  `params.md` note storage-state cookies need `domain`+`path` set correctly.
  This is first-class, documented support for exactly the seeding approach
  `change.md` already commits to.

### 6. The upload → analysing → results flow, file by file

- **Entry point**: `src/pages/dashboard.astro:1-35` (protected route, see §9)
  mounts `<VideoUpload client:load />` (line 32). `src/pages/index.astro` is
  just the marketing welcome page — not part of the flow.
- **`src/components/VideoUpload.tsx`** — client state machine
  `idle → validating → creating → analyzing → completed/failed`:
  - File input `accept="video/mp4"` (line 167); client-side gates before any
    network call: exact MIME `video/mp4` (line 55), size ≤100MB (lines 24, 59),
    duration 2-15s read via a throwaway `<video>` element (lines 25-26, 28-44,
    73-80).
  - `POST /api/sessions` (lines 85-89) → `{ id, status }`, HTTP 201 → mounts
    `<VideoAnalyzer>` (lines 102-121).
  - Terminal states are pure local React state, not polling: `"completed"`
    renders a link to `/sessions/{sessionId}` (lines 124-136); `"failed"`
    renders a retry button (lines 139-148).
- **`src/components/VideoAnalyzer.tsx`** — runs once per mount
  (`hasRunRef` guard, lines 97, 329-333), 5 sequential API calls plus local
  compute, each step updating a rendered checklist (`currentStep`, lines
  344-373):
  1. `POST /api/sessions/{id}/start` (lines 118-125, no body).
  2. Dynamic-import TF.js + `@tensorflow-models/pose-detection`, force
     `setBackend("cpu")` (line 139), create MoveNet `SINGLEPOSE_LIGHTNING`
     (lines 127-147) — explicitly CPU-only so no WebGL is required (comment,
     lines 127-129).
  3. Base64-encode the file, load into an off-DOM `<video>`, size a canvas
     (lines 150-167).
  4. `POST /api/analyze` with `{ video, session_id }` (lines 170-190) →
     `{ timestamps: [{t, type}] }`; throws on empty result.
  5. For each BDC/TDC timestamp, seek 5 offsets, run pose estimation, pick
     the extremum frame, compute up to 5 body angles (lines 193-281); throws
     if fewer than 2 angles computed.
  6. `POST /api/sessions/{id}/recommend` with `{ body_angles }` (lines
     287-304) → `{ recommendations, raw_llm_response }`.
  7. `POST /api/sessions/{id}/results` with the full payload (lines 307-321).
  8. `onComplete(sessionId)` (line 323) flips the parent to `"completed"`.
  - Any failed step calls `postError(step, detail)` (lines 99-112), a
    best-effort `POST .../results` with `{ error: true, error_message }`.
  - **Timing**: steps 4 and 6 are real OpenRouter network calls
    (non-deterministic latency, need a valid `OPENROUTER_API_KEY`); step 5 is
    CPU-bound JS (up to 10 `estimatePoses` calls). A code comment describes
    the whole pipeline as running "single-digit minutes"
    (`src/lib/session-display-status.ts:3-5`). These two network calls, not
    WebGL/GPU availability, are the dominant e2e flakiness/timeout risk.

### 7. API routes and the session-status lifecycle

| Route                                                    | Auth/rate-limit                                                                                                                                                                                                   | Ownership guard                                                                                                          | Effect                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/sessions` (`src/pages/api/sessions/index.ts`) | 401 if unauth (lines 10-12)                                                                                                                                                                                       | n/a (insert)                                                                                                             | admin insert, `status: "queued"` (line 35) → 201 `{id, status}`                                                                                                                                                                |
| `POST /api/sessions/[id]/start` (`.../start.ts`)         | 401                                                                                                                                                                                                               | RLS pre-check `.select("id,status").eq("id",...)` (lines 20-24) → 404/500; requires `status==="queued"` else 409 (34-36) | admin update `status: "processing"` scoped `id`+`user_id` (43-47)                                                                                                                                                              |
| `POST /api/analyze` (`src/pages/api/analyze.ts`)         | 401 (17-19); rate-limited via `checkRateLimit` RPC, route key `"analyze"`, ~10 req/10min (`src/lib/services/rate-limit.ts:9-10,22-38`); body capped at 140,100,000 bytes pre-parse (`readJsonWithCap`, 14, 35-41) | RLS lookup, must be owned + `status==="processing"` else 409 (58-72)                                                     | calls `analyzeVideo()` (`src/lib/services/llm.ts:41-125`, model `google/gemini-3.5-flash`) → real OpenRouter call; fixed 500 message on any upstream failure (line 80); **does not write status**                              |
| `POST /api/sessions/[id]/recommend`                      | 401; same rate-limit pattern, route key `"recommend"`                                                                                                                                                             | Same pattern, requires `status==="processing"` (35-49)                                                                   | calls `generateRecommendations()` (`llm.ts:127-181`, model `google/gemini-2.5-flash`) → real OpenRouter call; **does not write status**                                                                                        |
| `POST /api/sessions/[id]/results`                        | 401                                                                                                                                                                                                               | RLS pre-check, requires `status==="processing"` else 409 (34-50)                                                         | **only route that can reach a terminal state**: success → admin insert `analysis_results` + `status: "completed"` (55-86); failure → admin `status: "failed", error_message` (87-100, best-effort, always returns `{ok:true}`) |
| `GET /api/sessions/[id]`                                 | 401                                                                                                                                                                                                               | RLS pre-check                                                                                                            | returns `{status, updated_at, error_message}` — the only status-read endpoint, though nothing in the client polls it                                                                                                           |

- Status lifecycle: `queued` → `processing` → terminal `completed`/`failed`,
  enforced by a DB CHECK constraint
  (`supabase/migrations/20260526120000_initial_schema.sql:16-17`,
  `status IN ('queued','processing','completed','failed')`).

### 8. Results / history pages — what a Playwright test asserts against

- **`src/pages/sessions/index.astro`** — session list; empty state text
  "You haven't submitted any bike-fitting sessions yet." (58-67); per-row
  status pill from `SESSION_STATUS_META[effectiveSessionStatus(...)]`
  (`src/lib/session-status.ts:11-21` — exact labels "Queued", "Processing",
  "Completed", "Failed"); each row links `/sessions/{id}`. **No
  `data-testid` attributes anywhere** — assert on text/href.
- **`src/pages/sessions/[id].astro`** — results page, the happy-path
  landing page. Computes `displayStatus = effectiveSessionStatus(status,
updated_at, now)` (line 39) — a **display-time-only** staleness rule (15
  min, `src/lib/session-display-status.ts:6`) that never rewrites the DB row.
  Four render branches, no testids:
  - `completed && results` (74-117): `<h1>Your fitting results</h1>` +
    Recommendations list + Body angles list with in/out-of-range pills.
    **This is the assertion target for the happy-path e2e test.**
  - `completed && resultsLoadError` (121-127): "Couldn't load your results".
  - `queued`/`processing` (130-136): `<h1>Still processing</h1>`.
  - `failed` (139-147): `<h1>Analysis failed</h1>` + `error_message`.

### 9. Auth — how a Playwright test would authenticate

- `src/pages/auth/signin.astro` renders `SignInForm.tsx` — a **real HTML
  form** `POST /api/auth/signin` (line 43), not a fetch/XHR call.
- `src/pages/api/auth/signin.ts` reads `formData()` (line 5), calls
  `supabase.auth.signInWithPassword(...)` (line 13), redirects to `/` on
  success (line 19). A Playwright test can drive this form directly and let
  the redirect response set cookies.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/sessions"]`.
  **`/api/*` is not in this list** — every API route does its own
  `locals.user` check (401), confirmed per-route in §7's table.
- `src/lib/supabase.ts:9-22` builds a `@supabase/ssr` `createServerClient`
  with no custom `cookieOptions.name` — the cookie name defaults to
  `sb-${projectRefFromUrl}-auth-token` (confirmed against
  `node_modules/@supabase/supabase-js`'s bundled logic, and empirically
  against the real captured cookie in the untracked root file `cookie.txt`:
  `sb-hucpghbsxwteiqknesus-auth-token=base64-...`). The value is
  `base64-`-prefixed JSON and may be **chunked** (`.0`, `.1`, …) past ~3.1KB
  (`node_modules/@supabase/ssr/dist/main/utils/chunker.js:8`).
- **Implication**: don't hand-construct a `Set-Cookie` header for either
  test user. Either drive the real signin form, or use Playwright's
  documented `storageState` fixture-override (§5) fed by a session minted
  via the Supabase Auth admin API.

### 10. Video fixtures available for the e2e upload step

All confirmed untracked (`git status --short` → `??`):

| File                     | Size      | Format                                                  | Usable as upload fixture?                            |
| ------------------------ | --------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `video_fixed.mp4`        | 604,592 B | H.264/AAC MP4, 788×1146, 2.81s                          | Yes — passes mime/size/duration gates                |
| `video_fixed2.mp4`       | 523,755 B | same codec/res/duration                                 | Yes                                                  |
| `video_fixed2_right.mp4` | 502,766 B | same codec/res/duration                                 | Yes (name suggests an orientation-corrected variant) |
| `video.json`             | 219 KB    | pre-extracted base64 JPEG frames, not a video container | No                                                   |
| `test.base64`            | 2.5 MB    | raw base64 text of an mp4                               | No (not a `File` object; a curl artifact)            |
| `payload.json`           | 698 KB    | full `/api/analyze` request body                        | No (curl artifact)                                   |

No dedicated `src/test/fixtures/` directory exists — `src/test/` only holds
`astro-shims.d.ts`, `helpers/`, `stubs/`. Any of the three MP4s is directly
usable via Playwright's `setInputFiles`, but should be **committed** into a
proper fixtures location as part of this phase rather than relied upon as an
untracked scratch file (see §13 — these files are the same "uncommitted
manual-verification scratch" the Phase 3 impl-review already flagged and the
team accepted as a skip once; this phase is a natural point to resolve it
since it now needs one of these files as a committed test asset anyway).

### 11. RLS policies and the ownership-guard pattern per route

`supabase/migrations/20260526120000_initial_schema.sql` (full file):

- `fitting_sessions` (13-46): RLS enabled + **forced**; only `sessions_select_own`
  (`SELECT ... USING (auth.uid() = user_id)`, 34-37) and `sessions_insert_own`
  (39-42) exist for `authenticated`. **No UPDATE/DELETE policy** — status
  transitions and deletes must go through the service-role admin client
  (comment, 44-46).
- `analysis_results` (51-76): RLS enabled + forced; only `results_select_own`
  (an `EXISTS` subquery against `fitting_sessions.user_id`, 63-73) — no
  write policy at all.
- `supabase/migrations/20260902201711_add_sessions_delete_own_policy.sql`
  adds `sessions_delete_own`, documented as currently **inert** (the delete
  route uses the admin client after an RLS pre-check, never the user client)
  — shipped for defense-in-depth, not currently exercised.
- Rate-limit migrations (`20260905150000...`, `20260905160000...`) establish
  the codebase's current convention for a new protected resource: RLS
  enabled+forced with **zero** policies, all access via a locked-down
  service-role-only RPC — i.e., "RLS is the belt, an explicit second guard is
  the braces," consistently applied.
- Per-route ownership guard (`src/lib/services/supabase-admin.ts:1-15` for
  the admin client, `src/lib/supabase.ts:9-22` for the cookie-bound client):

  | Route                 | RLS pre-check (cookie client)    | Admin write guard                                                     |
  | --------------------- | -------------------------------- | --------------------------------------------------------------------- |
  | `.../start.ts`        | `:20-24` select+`.maybeSingle()` | `:43-47` update `.eq("id",..).eq("user_id",..)`                       |
  | `.../recommend.ts`    | `:35-39`                         | none — stops at pre-check (no mutation)                               |
  | `.../results.ts`      | `:34-38`                         | `:72-76`, `:88-92` both admin updates `.eq("id",..).eq("user_id",..)` |
  | `[id].ts` `GET`       | `:20-24`                         | n/a (read-only)                                                       |
  | `[id].ts` `DELETE`    | `:57-61`                         | `:74-80` admin delete `.eq("id",..).eq("user_id",..)`                 |
  | `sessions/[id].astro` | `:18-22`                         | **none — no admin client anywhere in this file**                      |

  `sessions/[id].astro` is the only surface in the whole flow that is _pure_
  RLS with no application-level `user_id` filter as a backstop — the cleanest
  possible target for a live cross-RLS assertion (a 404 there can only come
  from `sessions_select_own` actually denying the row, never from an
  app-level guard, because none exists).

### 12. The deferred Risk #5 two-user cross-RLS check — precedent and feasibility

- **test-plan.md is explicit that this is deferred here, not invented here.**
  §6.4 (`context/foundation/test-plan.md:481-489`): _"This is stub-level
  ordering, not a real cross-user RLS check... The real two-user assertion —
  user B's real, signed-in request against user A's real session, hitting
  deployed RLS — is deferred to §3 Phase 4 (Playwright, seeded via the
  Supabase Auth admin API)."_ §6.6 Phase 2 (`:597-604`) repeats this. The
  already-opened `change.md` for this phase (`change.md:29-35`) restates it
  as its own open question, so this research is answering a question the
  plan itself flagged, not introducing scope.
- **Precedent found is weaker than it sounds.** The only prior "admin API +
  real cross-user RLS" work is a **manual verification pass** (not an
  automated test, not committed anywhere) recorded in
  `context/archive/2026-08-23-session-history-list/reviews/impl-review.md:52`:
  _"created two real test users via the Auth admin API, seeded 4 real
  sessions across all statuses..., signed in via the real
  `/api/auth/signin` endpoint to get real cookies, and drove `curl` against
  the live running dev server."_ It proved RLS scoping only for the **list**
  endpoint (`plan.md:195`, "second real test user's `/sessions` response
  showed zero of the first user's 4 seeded rows") — not a direct
  by-`id` 404 check, and `/sessions/[id]` didn't even exist at that time. No
  `supabase.auth.admin.createUser` call is preserved anywhere in the repo or
  git history (`grep -rn "admin.createUser\|auth.admin"` across the whole
  repo returns zero hits) — the admin-API seeding mechanics need to be built
  fresh for this phase, not copied from a surviving script.
- **Feasibility of appending it to the one flow**: yes, cheaply — user B's
  check doesn't need to run the pipeline at all. It only needs: seed user B
  via the same admin-API call already used for user A, sign in as user B,
  `GET /sessions/{user-A's-session-id}`, assert 404. No second video upload,
  no second set of LLM calls.
- **Recommended shape, to flag back rather than assume**: **one spec file /
  one Playwright suite for this phase, holding two `test()` cases** — the
  happy-path smoke, and a short, separately-named negative test for Risk #5
  (e.g. `test("user B cannot read user A's session")`). Reasoning: Playwright
  gives each `test()` its own isolated browser context by default, so
  switching to "signed in as user B" mid-test means manually managing a
  second context inside one test — messier than a second `test()`, and it
  conflates a positive functional assertion with a negative security
  assertion in one pass/fail signal. Test-plan.md's "one e2e smoke" /
  "one happy-path flow" wording (`:99`, `:128`) most plausibly scopes the
  _positive flow being tested_ (there's only one happy path, not "upload
  smoke" + "delete smoke" + "history smoke" etc.), not a hard cap of exactly
  one `test()` block in existence — but a stricter reader could disagree, so
  this reading should be confirmed with the user/planner rather than baked
  into the plan silently, per `change.md`'s own instruction not to expand
  scope without flagging it back.

### 13. Security note — leaked API key in the working tree (unplanned finding)

While surveying repo-root scratch files for reusable e2e fixtures (§10), the
untracked `test.sh` (2,661 B) was found to contain a **live-looking
OpenRouter API key hardcoded in plaintext** at line 2
(`OPENROUTER_API_KEY=sk-...`), used to `curl` OpenRouter directly for manual
testing, bypassing the app. The file is **untracked** (not committed, not in
git history), but it exists on disk in the working tree right now. This is
distinct from — and more serious than — the "uncommitted manual-verification
scratch files" the Phase 3 impl-review already flagged and the team accepted
as a housekeeping-only skip (`context/foundation/test-plan.md:678-683`,
"no functional impact"): a plaintext live credential sitting in a working
directory is a real exposure regardless of git status (accidental `git add
-A`, a tarball of the directory, a screen share, etc.). This is being flagged
directly to the user in this session outside the plan/implement workflow —
recommend rotating the key and removing (or properly `.gitignore`-ing) this
file and its siblings (`cookie.txt`, `payload.json`, `video.json`,
`test.base64`) rather than carrying them forward.

## Code References

Permalink base: `https://github.com/mjedrasz/bikefit/blob/569051abd5ba5b7efd597a986fd5268bf76025ae/`

**CI / gates**

- `.github/workflows/ci.yml:13-25` — current steps; no typecheck; only `build` gets `SUPABASE_URL`/`SUPABASE_KEY`
- `lefthook.yml:10-11` — the `npx tsc --noEmit` command to lift into CI
- `vitest.config.ts:30-49` — `test.projects` (`unit` + `pages`), both already run by `npm test`
- `package.json:5-17` — no `typecheck` script, no e2e script; `:18-69` no Playwright dependency
- `astro.config.mjs:17-24` — env schema; `SUPABASE_SERVICE_ROLE_KEY`/`OPENROUTER_API_KEY` required, not currently passed in any CI step
- `context/foundation/test-plan.md:171-181` — §5 Quality Gates target state (typecheck required in CI "after §3 Phase 4"; e2e smoke row)

**Upload → analysing → results flow**

- `src/pages/dashboard.astro:32` — mounts `<VideoUpload client:load />`
- `src/components/VideoUpload.tsx:55,59,73-80` — client-side mime/size/duration gates; `:85-89` `POST /api/sessions`; `:124-148` terminal UI states
- `src/components/VideoAnalyzer.tsx:118-125` (`start`), `:127-147` (CPU-backend MoveNet), `:170-190` (`/api/analyze`), `:193-281` (angle computation), `:287-304` (`/recommend`), `:307-321` (`/results`), `:323` (`onComplete`)
- `src/pages/api/sessions/index.ts:35` — initial `status: "queued"` insert
- `src/pages/api/sessions/[id]/start.ts:20-24,34-36,43-47` — pre-check, `queued`-only guard, `processing` write
- `src/pages/api/analyze.ts:17-19,26-31,35-41,58-72,80` — auth, rate-limit, payload cap, ownership+status guard, fixed error message
- `src/lib/services/llm.ts:41-125` (`analyzeVideo`), `:127-181` (`generateRecommendations`)
- `src/pages/api/sessions/[id]/results.ts:34-50,55-86,87-100` — the only terminal-state writer
- `src/pages/sessions/[id].astro:39,74-147` — `effectiveSessionStatus`, the four render branches

**Auth**

- `src/pages/auth/signin.astro:43` — real form POST
- `src/pages/api/auth/signin.ts:5,13,19` — `formData()`, `signInWithPassword`, redirect
- `src/middleware.ts:4,18-22` — `PROTECTED_ROUTES`, excludes `/api/*`
- `src/lib/supabase.ts:9-22` — cookie-bound client, default cookie-name derivation

**RLS / ownership**

- `supabase/migrations/20260526120000_initial_schema.sql:13-46,51-76` — `fitting_sessions`/`analysis_results` schema + RLS policies
- `supabase/migrations/20260902201711_add_sessions_delete_own_policy.sql` — inert `sessions_delete_own`
- `src/lib/services/supabase-admin.ts:1-15` — `createAdminClient` (service-role, RLS-bypassing)
- `context/foundation/test-plan.md:481-489,597-604` — the deferred-check statements this research answers
- `context/archive/2026-08-23-session-history-list/reviews/impl-review.md:52` — the only prior admin-API + real-RLS precedent (manual, uncommitted)

## Architecture Insights

- **RLS-is-the-belt, explicit-filter-is-the-braces** is now a consistent,
  repeated pattern across three independent features (session ownership,
  rate-limit RPC lockdown, admin-write `.eq("user_id", ...)` guards) — any
  new mutation surface in this codebase is expected to follow it.
- **The client is the orchestrator, the server has no saga/state machine.**
  Every status transition is a discrete, unconditionally-trusted POST from
  the browser; the server never verifies that `start` happened before
  `analyze`, only that the _current_ status matches what each route expects.
  This is exactly why Risk #6 (stuck `processing`) exists and why the e2e
  smoke's real value is proving the whole client-driven chain actually
  completes against live infrastructure, not just that each hop is
  individually well-typed.
- **No test fixtures directory for binary assets.** `src/test/` holds only
  `.ts` helpers/stubs; this phase introducing the first real video fixture
  is a good moment to establish where such fixtures live (e.g.
  `src/test/fixtures/` or an e2e-scoped equivalent) given three usable but
  homeless MP4s already sit at the repo root.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §3 Phase 4 row (`:99`), §4 e2e stack row
  (`:128`), §6.5 stub (`:498-502`) — this phase's own scope statement, still
  a TBD cookbook section this research/plan will fill in.
- `context/archive/2026-08-23-session-history-list/` — the only prior
  Supabase-Auth-admin-API + real-RLS precedent in this codebase; manual and
  uncommitted (see §12).
- `context/changes/testing-abuse-resource-protection/` (Phase 3, just
  shipped) — established the rate-limit RPC + lockdown pattern this
  research cites in §11 as current RLS convention.
- `context/changes/testing-llm-and-ownership/` (Phase 2) — established the
  RLS pre-check + admin-write ownership pattern this research's §11 table
  extends to the full route set.

## Related Research

- `context/changes/testing-abuse-resource-protection/research.md`
- `context/changes/testing-llm-and-ownership/research.md`
- `context/changes/testing-angle-correctness/research.md`

## Open Questions

1. **Flag back per `change.md`'s own instruction**: does "one e2e smoke"
   permit a second `test()` in the same suite for the Risk #5 cross-user
   check (this research's recommendation, §12), or must the plan find a way
   to fold it into the single happy-path `test()`, or defer it to a later
   phase instead? Needs an explicit answer before `/10x-plan`.
2. **Mock OpenRouter in the e2e run, or hit it live?** Nothing in
   test-plan.md settles this. Hitting it live is the more faithful smoke
   (proves the real integration) but adds cost, non-determinism, and a
   required `OPENROUTER_API_KEY` CI secret; mocking at the network edge
   (reusing `installOpenRouterMock`-style interception, if it can attach to
   a real spawned server process rather than the Vitest process) would be
   faster and deterministic but weakens the "end-to-end" claim for exactly
   the two steps most likely to break (Risk #2). This is a planning
   decision, not a research finding — flagged here because it directly
   determines whether `OPENROUTER_API_KEY` needs to become a new CI secret.
3. **Does `webServer.env` actually reach the workerd/`astro:env` runtime**,
   or does the e2e job need to generate a `.dev.vars` file before invoking
   `astro preview`? (§4) — empirical, needs a spike before the plan commits
   to a specific `playwright.config.ts` shape.
4. **Where should the committed video fixture live**, and which of the three
   candidate MP4s (or a newly recorded one) should become canonical? (§10)
5. **Cleanup of repo-root scratch files, including the leaked key** (§13) —
   raised to the user directly in this session; not this change's scope to
   silently fix, but worth an explicit decision before this branch is
   considered done, echoing the Phase 3 impl-review's earlier (accepted)
   deferral of the same file set.
