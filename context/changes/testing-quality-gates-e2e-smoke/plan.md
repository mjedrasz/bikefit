# Quality-Gates Wiring + One E2E Smoke — Implementation Plan

## Overview

Closes out test-plan.md §3 Phase 4: make `npx tsc --noEmit` a required CI
step (the full Vitest suite is already required — that half of "quality
gates" is essentially done), and stand up a from-zero Playwright e2e layer
holding exactly one suite: a happy-path smoke over upload → analysing →
results, plus the deferred Risk #5 real cross-user RLS check as a second,
narrowly-scoped `test()` in that same suite.

## Current State Analysis

- CI (`.github/workflows/ci.yml:13-25`) runs checkout → setup-node →
  `npm ci` → `npx astro sync` → `npm run lint` → `npm test` → `npm run
build`. `npm test` already runs both Vitest projects (`unit` + `pages`),
  so every risk-response suite shipped in Phases 1–3 is already CI-gated.
  The one missing gate is `npx tsc --noEmit` as its own step — already the
  exact command `lefthook.yml:10-11` runs locally.
- Playwright does not exist in this repo — no dependency, config,
  directory, or script (`package.json:5-69`).
- `astro preview` under `@astrojs/cloudflare` runs a real workerd sandbox
  via `@cloudflare/vite-plugin` (confirmed by reading
  `node_modules/@astrojs/cloudflare/dist/entrypoints/preview.js`), not a
  plain Node server — this matters for two things resolved during this
  planning session (both `code`-origin findings, verified against the
  installed package source, not assumed from docs alone):
  - **Env vars reach it — but a real-project `.dev.vars` is already on disk.**
    `@cloudflare/vite-plugin`'s `getLocalDevVarsForPreview`
    (`node_modules/@cloudflare/vite-plugin/dist/index.mjs:48454-48463`) calls
    Wrangler's `unstable_getVarsForDev`, which sources local dev vars from
    `.dev.vars` **and `process.env`**. So Playwright's `webServer.env` reaches
    `astro:env/server` bindings with no `.dev.vars` generation needed — but the
    repo's existing `.dev.vars` sets `SUPABASE_URL` to the **real** project
    (`hucpghbsxwteiqknesus`), and which source wins when both are set is exactly
    what Phase 3's spike (3.4) must pin. Until it does, a local `npm run
test:e2e` cannot be assumed isolated from the real project. Two
    consequences the phases below carry: (a) the e2e project's creds are bound
    to the **app's own env names** (`SUPABASE_URL`, `SUPABASE_KEY`,
    `SUPABASE_SERVICE_ROLE_KEY` — read by `src/lib/supabase.ts:3` and
    `src/lib/services/supabase-admin.ts:2`); the `E2E_*` GitHub-secret names are
    labels only, remapped at the point of use. (b) The seeding helper and any
    teardown that deletes a user assert the target URL is not the real ref
    before running.
  - **A Node-level `undici.setGlobalDispatcher` mock cannot reach it.** The
    existing `installOpenRouterMock()` helper (`src/test/helpers/openrouter-mock.ts`)
    patches the _Node_ process's global dispatcher; the workerd sandbox has
    its own fetch implementation and never sees that patch. `OPENROUTER_URL`
    in `src/lib/services/llm.ts:10` is hardcoded, so mocking the LLM call for
    e2e needs a different mechanism than Vitest's — see Phase 3.
- The upload → analysing → results flow is entirely client-driven (no
  server-side polling): `VideoUpload.tsx` → `VideoAnalyzer.tsx` runs 5
  sequential API calls from the browser, flips to a rendered `"completed"`
  link on local callback (`VideoUpload.tsx:109-136`), and the user must
  click that link to reach `/sessions/{id}` — nothing auto-navigates.
- `sessions/[id].astro:18-29` is the one surface in the whole flow with no
  application-level `user_id` filter — a pure RLS read, `404` on
  `!sessionData`. This is the correct, minimal target for the deferred
  Risk #5 check, and per research it doesn't need the upload pipeline to
  run at all: a session row for user A can be inserted directly via the
  service-role admin client, then user B's real signed-in request against
  `/sessions/{that-id}` is asserted `404`.
- Auth: `POST /api/auth/signin` (`src/pages/api/auth/signin.ts`) is a real
  `formData()` handler (`email`, `password` fields) that calls
  `signInWithPassword` and lets `@supabase/ssr` set the (project-ref-derived,
  possibly chunked) session cookie via `Set-Cookie`. Driving this endpoint
  directly with Playwright's `request` fixture — which captures `Set-Cookie`
  into its own cookie jar automatically — and then calling
  `request.storageState()` avoids ever hand-constructing a cookie.
- This repo has a **real linked hosted Supabase project**
  (`hucpghbsxwteiqknesus`, "mjedrasz's Project") — confirmed via
  `npx supabase projects list` during this planning session. It is not an
  e2e-dedicated project; per your decision (below) e2e provisions its own.
- `fitting_sessions.user_id` and `analysis_results.session_id` are both
  `ON DELETE CASCADE` against `auth.users`/`fitting_sessions`
  (`supabase/migrations/20260526120000_initial_schema.sql:14,52`) — deleting
  a seeded test user via the admin API cascades cleanly, no separate
  session/results cleanup needed.
- Two usable, untracked video fixtures sit at repo root after the
  out-of-scope scratch-file cleanup (`video_left.mp4`, `video_right.mp4`;
  both 788×1146 H.264/AAC, ~2.81s, ≤525KB — the `video_fixed*.mp4` set
  from research §10 was pruned); neither is committed anywhere.
- The repo-root scratch files, including a plaintext leaked OpenRouter key
  in `test.sh`, are **explicitly out of this plan's scope** — you're
  handling that directly, outside this workflow.

## Definitions

Decisions made during this planning session that this plan depends on —
all origin `user` (this session), consistent with `product` guidance in
test-plan.md where it applies.

| Term                                             | Decided meaning                                                                                                                                                                                      | Origin                                                                                         | On degenerate data                                                                                                                                          | Verified by                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "one e2e smoke" (test-plan.md §3 Phase 4, §6.5)  | One spec file, two `test()` cases: the happy-path smoke and a short Risk #5 negative check — not a hard cap of exactly one `test()` in existence                                                     | user                                                                                           | A third scenario proposed later must open a new phase/change, not be added here                                                                             | Exactly 2 `test()` blocks in `e2e/upload-analysis-results.spec.ts`, confirmed at impl-review                                                                                                        |
| "seeded via Supabase Auth admin API" (change.md) | `admin.auth.admin.createUser` + a real `/api/auth/signin` POST captured into Playwright `storageState`; teardown via `admin.auth.admin.deleteUser` (cascades)                                        | user                                                                                           | A run that crashes before teardown leaves one orphaned user in the throwaway e2e project — accepted, since nothing else depends on that project being clean | Each test's `test.afterEach` calls `teardown()` (runs even after a failed test, so a CI retry re-seeds cleanly); a forced-failure manual run followed by a dashboard check confirms cascade cleanup |
| OpenRouter "mocked at the network edge" for e2e  | A local HTTP server on a fixed port stands in for `https://openrouter.ai/...`; `llm.ts`'s `OPENROUTER_URL` becomes overridable via an optional `OPENROUTER_BASE_URL` env var (default: the real URL) | user                                                                                           | An unrecognized `model` field in the mock's request body is a hard `500`, not a silent wrong-shape reply — a mock drift fails loud                          | Manual curl against the mock server during Phase 3; e2e test failure if the shape ever drifts                                                                                                       |
| "required" e2e CI gate                           | A separate `e2e` GitHub Actions job, required from the first merge (no non-blocking trial period), `retries: 1` in CI only                                                                           | user (test-plan.md §5 already names the end-state; this session picked the rollout path to it) | First-run flakiness blocks a legitimate PR — accepted risk per your explicit choice                                                                         | Branch protection's required-checks list includes `e2e`, confirmed manually                                                                                                                         |

## Desired End State

CI has two gates beyond today's lint/test/build: `npx tsc --noEmit` runs as
its own required step, and a required `e2e` job boots a real
`astro build && astro preview` (workerd) server, seeds two real throwaway
users in a dedicated Supabase project via the admin API, drives a real
browser through uploading a committed video fixture to a rendered "Your
fitting results" page (with the two OpenRouter calls served by a local
mock, everything else — session lifecycle, real CPU pose detection, RLS —
running for real), and separately asserts a second real user gets a `404`
reading the first user's results page.

**Verification**: open a PR touching any file in the flow; both `ci` and
`e2e` show as required, passing checks. Deliberately break something (a
bad Playwright selector, a temporarily-permissive `sessions_select_own`
policy) and watch the relevant check turn red without touching the other.

## What We're NOT Doing

- Not cleaning up the repo-root scratch files or rotating the leaked key —
  your explicit call, handled directly by you, outside this plan.
- Not hitting OpenRouter live from CI — mocked at the network edge, so no
  new `OPENROUTER_API_KEY` CI secret and no live billing/rate-limit risk
  from test runs.
- Not landing the `e2e` gate as non-blocking-then-flip — required from the
  first merge, per your choice.
- Not testing in Firefox/WebKit — Chromium only; the app's CPU-backend
  pose pipeline (`context/foundation/lessons.md`) has no GPU/WebGL
  dependency to cross-check, and this is a smoke, not a compat matrix.
- Not covering write-path cross-user attacks (session `start`/`results`
  mutation by a non-owner) in this phase — those already have stub-level
  ownership coverage from Phase 2 (test-plan.md §6.4); this phase's job is
  only the specific _read_ check test-plan.md §6.4/§6.6 deferred here.
- Not building a server-side reaper, a second happy-path variant, or any
  additional e2e scenario — exactly the two `test()`s decided above.
- Not touching `stryker.config.json` / mutation-testing scope — unrelated
  to this phase (test-plan.md §6.7 already covers it, advisory-only).

## Implementation Approach

Five phases, ordered so each is independently mergeable and the riskiest
external dependency (a new cloud project) is provisioned and proven before
any test code depends on it:

1. The CI typecheck gate first — zero dependencies, immediate value.
2. Provision the dedicated e2e Supabase project + secrets — external,
   needs your go-ahead before I run anything that creates cloud resources
   or writes repo secrets.
3. Playwright scaffolding + the OpenRouter stand-in — infra only, verified
   with zero real tests.
4. The seeding helper, the committed fixture, and the two real tests.
5. Wire the required `e2e` CI job and flip test-plan.md §5's e2e row.

## Critical Implementation Details

**Timing & lifecycle.** `playwright.config.ts` declares `webServer` as an
_array_ of two entries — the mock OpenRouter server (fixed port `4319`)
and `npm run build && npm run preview` (port `4321`, needing the prior
`astro build` to produce `.wrangler/deploy/config.json`). Playwright starts
both concurrently and waits on each entry's own health-check before
running any test; no explicit ordering is needed because the preview
server only calls the mock's URL once a test actually triggers
`/api/analyze`, by which point both are already up.

**State sequencing.** Both LLM calls in `llm.ts` hit the identical
hardcoded `OPENROUTER_URL`, so the mock server has no path-based way to
tell them apart — it must branch on the parsed request body's `model`
field (`google/gemini-3.5-flash` → vision/timestamps envelope,
`google/gemini-2.5-flash` → recommendations envelope). Anything else is a
hard `500`, per the Definitions table above.

**Debug & observability.** The mock's canned BDC/TDC timestamps are a
best-guess pick (e.g. `t=1.0`/`t=2.0` inside the fixture's real 2.81s
duration) against **real, unmocked** CPU pose detection on the committed
video — `VideoAnalyzer.tsx` throws if fewer than 2 angles compute. Expect
to tune these offsets empirically once Phase 4 runs against the real
fixture; this is normal iteration, not a sign the approach is wrong.

## Phase 1: CI typecheck gate

### Overview

Add the one CI gate research found genuinely missing.

### Changes Required:

#### 1. `.github/workflows/ci.yml`

**Intent**: Mirror the local `lefthook` typecheck gate in CI, closing the
gap test-plan.md §5 already names.

**Contract**: New step (`run: npx tsc --noEmit`) inserted after the
existing `npx astro sync` step (needs generated `.astro/` types) and
before `npm run build`. No new `env:` needed — this step touches no
secrets.

### Success Criteria:

#### Automated Verification:

- `npx tsc --noEmit` passes locally
- The new step is present in `.github/workflows/ci.yml`, positioned after `astro sync`

#### Manual Verification:

- Open a PR and confirm the new step runs and passes as part of the existing `ci` job
- Introduce a deliberate type error locally, confirm `npx tsc --noEmit` fails, then revert

---

## Phase 2: Dedicated e2e Supabase project + secrets

### Overview

External provisioning this plan's later phases depend on. No repository
code changes — this phase creates a cloud resource and repo secrets, both
requiring your explicit go-ahead before I execute anything here.

### Changes Required:

#### 1. Provision & wire the e2e Supabase project (external)

**Intent**: Isolate seeded e2e test data from the existing hosted project
("mjedrasz's Project") — keeping a cleanup bug or a crashed run off the
real data set. The project boundary is the containment; the Phase 3
prod-ref guard is the enforcement (a run that would hit the real ref
throws before seeding).

**Contract**:

- Create a new Supabase project (dashboard, or `npx supabase projects
create` against the same org, `xtjsxokjpiijxysffzxy`).
- `npx supabase link --project-ref <new-ref>` then `npx supabase db push`
  — applies all four existing migrations verbatim (no new migration this
  phase).
- Record three new GitHub Actions secrets: `E2E_SUPABASE_URL`,
  `E2E_SUPABASE_KEY` (anon), `E2E_SUPABASE_SERVICE_ROLE_KEY`. The `E2E_`
  prefix is a label for the secrets UI only — at the point of use (Phase 3
  `webServer.env`, Phase 5 CI job `env:`) each is bound to the name the app
  actually reads (`SUPABASE_URL` / `SUPABASE_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`, per `src/lib/supabase.ts:3`). Cross-project
  confusion is prevented by the runtime prod-ref guard (Phase 3), not by
  the name.
- Record two further secrets so CI can keep the e2e project's schema at
  HEAD on every run (Phase 5): `SUPABASE_ACCESS_TOKEN` (a personal access
  token) and `E2E_SUPABASE_DB_PASSWORD` (the e2e project's database
  password).
- No `OPENROUTER_API_KEY` secret needed — Phase 3 mocks it.

### Success Criteria:

#### Automated Verification:

- `npx supabase db push` against the new project reports all four migrations applied, zero errors
- A REST health-check (`curl <new-project-url>/rest/v1/`) returns a non-5xx response

#### Manual Verification:

- You confirm the new project exists in the Supabase dashboard
- You confirm all five new secrets are present under the repo's Settings → Secrets (`E2E_SUPABASE_URL`, `E2E_SUPABASE_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `E2E_SUPABASE_DB_PASSWORD`)

---

## Phase 3: Playwright scaffolding + deterministic OpenRouter stand-in

### Overview

Install and configure Playwright end to end, with no real test content
yet — success here means the two-server boot sequence works and the mock
answers correctly, verified in isolation from Phase 4's actual assertions.

### Changes Required:

#### 1. `package.json`

**Intent**: Add the e2e runner and its entry point.

**Contract**: New devDependency `@playwright/test`; new script
`"test:e2e": "playwright test"`.

#### 2. `astro.config.mjs` + `src/test/stubs/astro-env-server.ts`

**Intent**: Allow tests to redirect the OpenRouter call without touching
the real key or URL.

**Contract**: Add `OPENROUTER_BASE_URL: envField.string({ context:
"server", access: "public", optional: true })` to `env.schema`, alongside
the existing four fields. **Same commit**, add `export const
OPENROUTER_BASE_URL = undefined;` to the Vitest alias-stub
`src/test/stubs/astro-env-server.ts` — `llm.ts` (change #3) will
`import { OPENROUTER_BASE_URL } from "astro:env/server"`, and a named
import the aliased stub doesn't export is a hard ESM error that breaks
every route/contract spec at import (test-plan §6.2's documented
"keep the stub's export list in sync" hazard). `undefined` keeps
`OPENROUTER_BASE_URL || <real URL>` → the real URL, so the existing undici
`installOpenRouterMock()` still intercepts.

#### 3. `src/lib/services/llm.ts`

**Intent**: Consume the new optional override; every existing call site
(`analyzeVideo`, `generateRecommendations`) already references the single
`OPENROUTER_URL` constant, so this is the only line that changes.

**Contract** (non-obvious — the fallback pattern matters, this is the only
place production behavior must stay byte-identical when the var is unset):

```ts
import { OPENROUTER_API_KEY, OPENROUTER_BASE_URL } from "astro:env/server";
// ...
const OPENROUTER_URL = OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
```

#### 4. `e2e/helpers/openrouter-mock-server.mjs` (new)

**Intent**: Stand in for OpenRouter with zero real credentials or network
dependency, plain enough to need no new devDependency.

**Contract**: A plain Node `http` server on fixed port `4319`. Reads the
POST body, parses `model`, returns `{ choices: [{ message: { content:
JSON.stringify(...) } }] }` — the vision envelope (`timestamps`) for
`google/gemini-3.5-flash`, the recommendations envelope
(`recommendations` + `raw_llm_response`) for `google/gemini-2.5-flash`.
Any other `model` value: HTTP `500` (fail loud on drift, per Definitions).

#### 5. `playwright.config.ts` (new)

**Intent**: Define the two-server boot sequence, browser matrix, and
retry/timeout policy from your earlier decisions.

**Contract** (non-obvious — the two-entry `webServer` array with an
explicit `env` merge is the load-bearing part; the `SUPABASE_*` remap and
the prod-ref guard are what keep the run off the real project):

```ts
const E2E_SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "";
if (!E2E_SUPABASE_URL || E2E_SUPABASE_URL.includes("hucpghbsxwteiqknesus")) {
  throw new Error("E2E_SUPABASE_URL is unset or points at the real project — refusing to run");
}

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4321" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  retries: process.env.CI ? 1 : 0,
  timeout: 300_000,
  webServer: [
    { command: "node e2e/helpers/openrouter-mock-server.mjs", port: 4319, reuseExistingServer: !process.env.CI },
    {
      command: "npm run build && npm run preview",
      url: "http://localhost:4321/",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        // the app reads these names from astro:env/server — remap the E2E_* secrets here
        SUPABASE_URL: E2E_SUPABASE_URL,
        SUPABASE_KEY: process.env.E2E_SUPABASE_KEY ?? "",
        SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "",
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "e2e-mock-unused",
        OPENROUTER_BASE_URL: "http://127.0.0.1:4319/api/v1/chat/completions",
      },
    },
  ],
});
```

**Local runs and `.dev.vars`.** The repo's `.dev.vars` points `SUPABASE_URL`
at the real project and `astro preview` reads it too. Spike 3.4 must
establish whether the `webServer.env` values above override `.dev.vars`:
if `process.env` wins, nothing more to do; if `.dev.vars` wins, a local
`npm run test:e2e` requires `.dev.vars` pointed at the e2e project first
(documented in the Phase 4 manual steps and test-plan §6.5). CI writes no
`.dev.vars`, so CI is unaffected either way.

### Success Criteria:

#### Automated Verification:

- `npx playwright test --list` runs cleanly (0 tests, no config errors)
- Both `webServer` entries boot; Playwright's own health-check passes for the preview server
- `curl -X POST http://127.0.0.1:4319 -d '{"model":"google/gemini-3.5-flash",...}'` returns the canned timestamps envelope
- `npm test` still green — the `llm.ts` change #3 plus the stub change #2 must not break the existing contract/route suites (regression guard for test-plan §6.2's stub-sync hazard)

#### Manual Verification:

- Confirm (via a temporary log in `llm.ts` / a route, removed before Phase 4) that the workerd-hosted server received **both** `OPENROUTER_BASE_URL` pointing at the mock **and** `SUPABASE_URL` resolved to the e2e project (not `.dev.vars`' real ref) — the empirical confirmation of this plan's env-propagation finding and the `.dev.vars`-precedence question

---

## Phase 4: Seeding helper, video fixture, and the two e2e tests

### Overview

The actual test content: the happy-path smoke and the Risk #5 negative
check, as two independent `test()`s in one spec file.

### Changes Required:

#### 1. `e2e/fixtures/bike-fit-sample.mp4` (new, committed)

**Intent**: A canonical, reusable video fixture — this phase is the first
to need a committed binary test asset.

**Contract**: Renamed from the untracked `video_right.mp4` at repo root
(`video_fixed.mp4` from research §10 was removed in the out-of-scope
scratch-file cleanup; `video_left.mp4` and `video_right.mp4` are what
remain — pick the right-facing one as the canonical standard side-on
view). ~502KB, H.264/AAC, 788×1146, 2.807s — passes `VideoUpload.tsx`'s
gates (`video/mp4`, ≤100MB, ≥ `MIN_DURATION` 2s). Confirm it yields ≥2
computable angles during the Phase 4 timestamp tuning.

#### 2. `e2e/helpers/seed-user.ts` (new)

**Intent**: Create a real, throwaway Supabase Auth user and obtain a real
signed-in session — never a hand-built cookie.

**Contract** (non-obvious — `createAdminClient` from app code imports
`astro:env/server`, which Playwright's runner cannot resolve; the helper
builds its own client from `process.env` and guards the target ref):

```ts
import { createClient } from "@supabase/supabase-js";

const E2E_URL = process.env.E2E_SUPABASE_URL ?? "";
const E2E_SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!E2E_URL || E2E_URL.includes("hucpghbsxwteiqknesus")) {
  throw new Error("seed-user: E2E_SUPABASE_URL unset or the real project — refusing to seed/delete");
}

export async function seedUser(request: APIRequestContext, email: string, password: string) {
  const admin = createClient(E2E_URL, E2E_SERVICE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await request.post("/api/auth/signin", { form: { email, password } }); // @supabase/ssr's Set-Cookie lands in `request`'s own cookie jar
  return { userId: data.user!.id, teardown: () => admin.auth.admin.deleteUser(data.user!.id) }; // cascades to fitting_sessions/analysis_results
}
```

#### 3. `e2e/upload-analysis-results.spec.ts` (new)

**Intent**: The one e2e smoke plus the deferred Risk #5 check, per the
Definitions table.

**Contract**:

- `test("uploads a video and reaches the fitting results page")`: seed
  user A via `seedUser`, open a browser context from its `storageState`,
  go to `/dashboard`, `setInputFiles` the committed fixture on the hidden
  `input[type=file]`, wait for the real client-driven pipeline to finish
  and click the rendered "View fitting recommendations" link, assert
  `<h1>Your fitting results</h1>` and at least one in/out-of-range pill
  are visible.
- `test("user B cannot read user A's session")`: seed user A and user B;
  for user A, skip the upload pipeline entirely — insert a
  `fitting_sessions` row directly via the service-role admin client
  (`status: "completed"`), so this test has no LLM or pose-detection
  dependency at all. Open a context from user B's `storageState`, `goto`
  user A's `/sessions/{id}`, assert the navigation response status is
  `404`.
- Both tests call their seeded users' `teardown()` in `test.afterEach`.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` — both tests pass locally against the dedicated e2e Supabase project and the mocked OpenRouter server
- Temporarily making `sessions_select_own` permissive (`ALTER POLICY sessions_select_own ON fitting_sessions USING (true)`, then restore) makes the negative test fail red — proves it isn't a false-positive pass. **Not** dropping the policy: `fitting_sessions` is `FORCE ROW LEVEL SECURITY`, so dropping the only SELECT policy denies every read and the negative test would stay green, proving nothing.

#### Manual Verification:

- Watch one full local run headed (`--headed`) and confirm the upload UI visibly moves through validating → creating → analyzing → completed against the real committed video
- Confirm in the Supabase dashboard that both seeded users (and their cascaded rows) are gone after the run completes

---

## Phase 5: Wire the required `e2e` CI job

### Overview

Land the suite as a required, separate CI job — the end state test-plan.md
§5 already names, reached via your "required from day one" choice.

### Changes Required:

#### 1. `.github/workflows/ci.yml`

**Intent**: Run the Phase 4 suite on every PR, least-privilege on secrets
(only this job sees the e2e project's keys).

**Contract**: New `e2e` job — own checkout/setup-node/`npm ci`/`npx astro
sync` steps, then:

- `npx supabase link --project-ref <e2e-ref>` + `npx supabase db push`
  (env `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD: ${{
secrets.E2E_SUPABASE_DB_PASSWORD }}`) — applies any migration added since
  Phase 2 so the gate never runs against a stale e2e schema (F4). A
  migration that fails here fails the `e2e` job, which is correct.
- `npx playwright install --with-deps chromium`
- `npx playwright test`

Job-level `env:` exposes `E2E_SUPABASE_URL`, `E2E_SUPABASE_KEY`,
`E2E_SUPABASE_SERVICE_ROLE_KEY` (from the matching repo secrets); the
Phase 3 `playwright.config.ts` reads those, remaps them to the
`SUPABASE_*` names the preview server expects, and hands them to the
Node-side seed helper. Also set a fixed non-secret `OPENROUTER_API_KEY`
placeholder (never dereferenced against a real endpoint). No `.dev.vars`
is written in CI — `process.env` is the only var source there. Add `e2e`
to the repo's required-status-checks list.

#### 2. `context/foundation/test-plan.md`

**Intent**: Reconcile §5 to the shipped state.

**Contract**: Two row edits in §5, matching every other completed gate's
phrasing:

- "e2e smoke — happy path" `Required?`: "required after §3 Phase 4" →
  "required (wired)".
- "typecheck (`npx tsc --noEmit`)" `Required?`: "required locally (wired);
  required in CI after §3 Phase 4" → "required (wired)" — Phase 1 shipped
  the CI step.

### Success Criteria:

#### Automated Verification:

- `.github/workflows/ci.yml` parses cleanly (YAML lint / `actionlint` if available)
- A test PR shows both `ci` and `e2e` listed as checks
- The `supabase db push` step reports the e2e project up to date (all migrations applied, zero errors)

#### Manual Verification:

- Confirm `e2e` is added to branch protection's required-checks list
- Push a PR with a deliberately broken step (e.g. a bad selector), confirm it's blocked from merging by the new check, then revert and confirm it goes green

---

## Testing Strategy

### Unit Tests:

- None new — this phase adds no pure-logic modules.

### Integration Tests:

- None new — Phase 2's stub-level ownership coverage (test-plan.md §6.4) is unchanged and still the always-on CI gate; this phase adds the one deferred _real_ proof on top of it.

### Manual Testing Steps:

1. Run `npm run test:e2e` locally against the dedicated e2e project before ever relying on CI for the first signal.
2. Deliberately corrupt one mocked timestamp offset and confirm the happy-path test fails with the app's real "fewer than 2 angles" error, not a Playwright timeout — proves the assertion is meaningful.
3. Deliberately make `sessions_select_own` permissive (`USING (true)`, Phase 4's automated check) and restore it, confirming the negative test is red then green. Do not test by _dropping_ the policy — `FORCE ROW LEVEL SECURITY` then denies all reads and the test stays green.

## Performance Considerations

The real pipeline runs "single-digit minutes" per its own code comment
(`src/lib/session-display-status.ts:3-5`) even with the LLM calls mocked
(pose detection is real, CPU-bound JS). The 300s Playwright timeout and
CI-only `retries: 1` (Phase 3) are sized against that, not against a
mocked-fast expectation.

## Migration Notes

No schema migrations in this phase. Phase 2 pushes the four _existing_
migrations verbatim to a new project — no new SQL file. From Phase 5 on,
the `e2e` CI job runs `supabase db push` against the e2e project every
run, so any migration a _future_ change adds is applied there
automatically — no manual per-change step, and no schema drift between the
real project and the e2e gate.

## References

- Research: `context/changes/testing-quality-gates-e2e-smoke/research.md`
- Test-plan target state: `context/foundation/test-plan.md:99,128,178-179,498-502`
- Deferred Risk #5 statement: `context/foundation/test-plan.md:481-489,597-604`
- Prior admin-API + real-RLS precedent (manual, uncommitted): `context/archive/2026-08-23-session-history-list/reviews/impl-review.md:52`
- Workerd env-var sourcing (verified this session): `node_modules/@cloudflare/vite-plugin/dist/index.mjs:48454-48489`
- Cloudflare preview implementation (verified this session): `node_modules/@astrojs/cloudflare/dist/entrypoints/preview.js`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI typecheck gate

#### Automated

- [x] 1.1 `npx tsc --noEmit` passes locally — edc650a
- [x] 1.2 New step present in `.github/workflows/ci.yml`, after `astro sync` — edc650a

#### Manual

- [x] 1.3 PR shows the new step running and passing — edc650a
- [x] 1.4 Deliberate type error confirmed to fail the step, then reverted — edc650a

### Phase 2: Dedicated e2e Supabase project + secrets

#### Automated

- [x] 2.1 `npx supabase db push` applies all four migrations, zero errors — c787010
- [x] 2.2 REST health-check against the new project returns non-5xx — c787010

#### Manual

- [x] 2.3 New project confirmed in Supabase dashboard — c787010
- [x] 2.4 Five new secrets confirmed in repo Settings → Secrets (3 × `E2E_SUPABASE_*` + `SUPABASE_ACCESS_TOKEN` + `E2E_SUPABASE_DB_PASSWORD`) — c787010

### Phase 3: Playwright scaffolding + deterministic OpenRouter stand-in

#### Automated

- [x] 3.1 `npx playwright test --list` runs cleanly (0 tests) — 8470eb0
- [x] 3.2 Both webServer entries boot; preview health-check passes — 8470eb0
- [x] 3.3 Manual curl against the mock server returns the canned envelope — 8470eb0
- [x] 3.4 `npm test` still green after the `llm.ts` + stub changes — 8470eb0

#### Manual

- [x] 3.5 Confirmed the workerd sandbox received `OPENROUTER_BASE_URL` and `SUPABASE_URL` resolved to the e2e project, not `.dev.vars` — 8470eb0

### Phase 4: Seeding helper, video fixture, and the two e2e tests

#### Automated

- [x] 4.1 `npm run test:e2e` — both tests pass
- [x] 4.2 Permissive `sessions_select_own` (`USING (true)`, then restored) makes the negative test fail red

#### Manual

- [x] 4.3 Headed run confirms the upload UI moves through all states
- [x] 4.4 Dashboard confirms seeded users/rows are gone post-run

### Phase 5: Wire the required `e2e` CI job

#### Automated

- [ ] 5.1 `.github/workflows/ci.yml` parses cleanly
- [ ] 5.2 Test PR shows both `ci` and `e2e` checks
- [ ] 5.3 `supabase db push` step reports the e2e project up to date

#### Manual

- [ ] 5.4 `e2e` added to required-status-checks branch protection
- [ ] 5.5 Broken-step PR confirmed blocked, then confirmed green after revert
