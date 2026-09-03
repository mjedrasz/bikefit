# LLM boundary + API-route integration (test-plan Phase 2) — Implementation Plan

## Overview

This is **§3 Phase 2** of the test rollout (`context/foundation/test-plan.md`). It stands up
BikeFit's first **integration + contract** test layer and, in the same pass, applies the code
hardening that makes four risks actually defensible:

- **Risk #2** — the OpenRouter response boundary (`src/lib/services/llm.ts`) becomes strict
  (per-item validation), markdown-fence tolerant, and fails clean; route 500s stop echoing
  upstream error text.
- **Risk #5** — every session-mutation route gets a belt-and-braces `user_id` guard on its
  admin write (generalising the hardened `DELETE`), and `POST /api/analyze` is bound to an
  owned `processing` session.
- **Risk #6** — the client reports a Step-7 failure, the unchecked status `UPDATE`s are
  checked, and a **display-time staleness rule** drives a long-lived `processing` (or stuck
  `queued`) session to a readable "timed out" state on the results page and history.
- **Risk #7** — every query site that collapses a DB error into 404 / empty / blank is fixed
  to surface a distinct error state, and that becomes the tested default.

It also fills cookbook **§6.2 / §6.3 / §6.4** and wires `npm test` as a required CI gate
(per §5 — "required after §3 Phase 2").

## Current State Analysis

**Architecture (from research + Phase 1).** The server is a thin persistence + LLM-proxy
layer. The analysis "pipeline" is a browser orchestrator (`src/components/VideoAnalyzer.tsx`)
that calls six API routes in sequence. There is no service layer — every Supabase query is
inline in a route handler, so **a route test is a handler test**.

**Test harness today** (`context/changes/testing-angle-correctness/`, shipped):

- `vitest.config.ts` — plain `defineConfig` from `vitest/config`, re-declares only the `@/*`
  alias, `environment: "node"`, `include: ["src/**/*.{test,spec}.ts"]`. **No `astro:env`, no
  DOM, no HTTP mock, no Supabase stub.**
- `npm test` → `vitest run`; no `pretest`. Vitest `4.1.11` installed.
- Cookbook §6.1 (pure logic) is the only filled pattern. §6.2–§6.4 all read `TBD — see §3
  Phase 2`.
- `.github/workflows/ci.yml` runs `npm ci` → `astro sync` → `lint` → `build`. **No test step,
  no typecheck step.**

**The import-time hazard.** Every route module transitively imports `astro:env/server` (via
`createClient` → `SUPABASE_URL/KEY`; `createAdminClient` → `SUPABASE_SERVICE_ROLE_KEY`;
`llm.ts` → `OPENROUTER_API_KEY`). `SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` are
`access: "secret"` **required** — importing any route module in a test throws at import time
unless the virtual module resolves. Phase 1 deliberately dodged this (§6.6); Phase 2 resolves
it.

**Risk-by-risk starting point** (verified against `44438a1`):

| Risk | Where it stands now |
|---|---|
| #2 | `llm.ts` parses `.json()`, null-checks `content`, `JSON.parse` in try/catch, `Array.isArray`-checks the top array — then `as`-casts items with **no per-item shape check**. No fence stripping. `analyze.ts:29` / `recommend.ts:48` return `{ error: err.message }` (full upstream text) on 500. `resultsPayloadSchema` re-validates `recommendations` + `body_angles` at `/results` (the one real per-item gate) but a reject there is a 400 the browser mishandles. |
| #5 | RLS `SELECT` pre-check proves ownership on `start`, `results`, `recommend`, `GET [id]`, `DELETE [id]`, both SSR pages. `start.ts:30` and `results.ts:58,63` key the admin `UPDATE` on `params.id` **only**. `DELETE [id]` is the hardened template (pre-check `error`→500 + `.eq("user_id")` + `sessions_delete_own` policy). `POST /api/analyze` has **no session scope** (`analyzeRequestSchema` = `{ video }` only). |
| #6 | No server-side reaper (`wrangler.jsonc` has no `triggers`/`crons`; no `pg_cron`; no sweep). `updated_at` is maintained by a `BEFORE UPDATE` trigger but nothing consumes it for staleness. `VideoAnalyzer` Step 7 (`:315-320`) catches a `/results` failure with **local state only — no `postError`**. `start.ts:30` and `results.ts:58,60-63` discard the `UPDATE` result. Results page (`[id].astro:101-108`) shows "Still processing — check back soon." forever; history shows a blue "Processing" pill forever. |
| #7 | `const { data } = …` (dropping `error`) is live in: `GET /api/sessions/[id]:18`, `start.ts:18`, `results.ts:32` (pre-check), `sessions/[id].astro:15` (session) and `:33` (results — the blank-card path). `recommend.ts:25` does `if (error) → 404` (conflates error with not-found). `sessions/index.astro:21-26` (fixed, S-04 F1) and `DELETE [id]` (fixed, delete-session F3) are the two correct patterns to copy. |

## Desired End State

- `npm test` (from a fresh checkout, no local Supabase, no network) runs a green suite that
  includes: pure-logic units (Phase 1, unchanged), an **OpenRouter contract suite** over the
  malformed-response corpus, **route integration tests** with a stubbed Supabase client, and
  **SSR-page tests** via Astro's Container API.
- `src/lib/services/llm.ts` rejects every malformed / drifted / truncated / fenced / wrong-
  shape response with a typed `Error`; `analyze.ts` and `recommend.ts` return a fixed
  plain-language 500 body and log the detail.
- `start.ts`, `results.ts`, and a newly session-scoped `analyze.ts` each run the RLS pre-check
  before any admin write and carry an explicit `user_id` guard on that write.
- A `processing` — or stuck `queued` — session with no progress for longer than
  `STALE_PROCESSING_MS` renders as a terminal "timed out" failure on both the results page and
  history; `VideoAnalyzer` Step 7 reports its failure.
- Every route/page query error surfaces as a 500 or a distinct "couldn't load" state — never a
  404, an empty list, or a blank card.
- Cookbook §6.2 / §6.3 / §6.4 are filled; §6.6 carries the Phase 2 notes; `.github/workflows/
  ci.yml` runs `npm test` as a blocking step; a `/10x-test-plan --refresh` note is left for §4.

### Key Discoveries

- **Official Astro endpoint-test pattern** (Context7, `withastro/docs`): call the exported
  `GET`/`POST` with a context object — `await GET(Astro)` — or use
  `experimental_AstroContainer.renderToResponse(endpoint, { request })`. Our routes touch only
  `context.locals.user`, `context.request`, `context.cookies`, `context.params`, so a
  hand-built context is sufficient and lightest.
- **`getViteConfig` gained a second argument** (Astro 4.8+) that overrides the inline Astro
  config (drop the Cloudflare adapter, keep only the React renderer). The two SSR-page specs
  (`src/pages/sessions/*.{test,spec}.ts`) run under a dedicated `pages` Vitest project built
  from it; every other spec keeps the fast plain config. A plain `defineConfig` has no Astro
  Vite plugin, so importing a `.astro` file into a spec fails at `vite:import-analysis`
  (verified) — the alias-stub only fixes the `astro:env/server` throw for `.ts` route specs,
  not `.astro` compilation. Both projects still apply the `astro:env/server` alias-stub so
  required secrets don't throw. A Phase 1 spike confirms the Cloudflare adapter can be excluded
  cleanly before `renderPage` is written; if it can't, the fallback is to test the two pages'
  logic as extracted pure helpers (no Container API).
- **`undici` 7.24.8 is already resolvable** at the top level (hoisted). Node's global `fetch`
  is undici, so `setGlobalDispatcher(new MockAgent())` intercepts the exact `fetch` `llm.ts`
  calls. Add it as an explicit `devDependency` so the import is not relying on hoisting.
- **A hosted Supabase project is wired in `.dev.vars`** — but the real cross-user RLS
  assertion is **deferred to §3 Phase 4** (Playwright, seed via Auth admin API). Phase 2's
  ownership coverage is stub-level: pre-check-before-admin-write ordering, no-row → 404 with no
  write, and the `.eq("user_id")` guard's presence.
- **`recommendationSchema` and `bodyAngleSchema` already exist** in `src/lib/schemas.ts` —
  `llm.ts`'s per-item validation reuses `recommendationSchema`, no new duplicate.
- **`.single()` vs `.maybeSingle()`**: `.single()` returns `{ data: null, error: <PGRST116> }`
  for no-row, so the current `!data → 404` checks already mask real errors as 404. The fix
  everywhere is the `DELETE` pattern: `.maybeSingle()` → `if (error) 500` → `if (!data) 404`.
- **The measurement-frame keyframe schema** in `llm.ts` sends `f` (frame number) as a required
  property but `analyzeVideo`'s return type drops it — per-item validation must accept `f` as
  optional, not reject on it.

## What We're NOT Doing

- **No server-side reaper / cron / TTL job.** Risk #6 is closed with a *display-time*
  reconciliation rule (pure function + page render), not a DB write-back. The row literally
  stays `processing`; only its rendered status changes. A real sweep is out of scope (closer to
  Phase 3's feature-work character) and is not tracked as owed here.
- **No real cross-user request against deployed RLS in this phase.** Deferred to §3 Phase 4 per
  the decision above. Phase 2 ships the stub-level ordering floor only.
- **No rate limiting, payload-size caps, or provider-error-degradation work** — that is §3
  Phase 3 (Risk #3). Phase 2 only *binds* `/analyze` to a session (an ownership fix).
- **No adversarial / prompt-injection probe** — §3 Phase 3 (Risk #4).
- **No typecheck CI gate, no e2e, no Playwright** — §3 Phase 4. Phase 2 wires only `npm test`.
- **No historical data backfill.** Existing `processing` rows that are actually stuck keep
  their stored status; only new renders reflect the staleness rule.
- **No DOM-level unit tests of `VideoAnalyzer`'s I/O helpers** (`seekTo`, `loadVideoElement`,
  `detectPoseAt`) — needs a DOM env; not this phase. The Step-7 change is a small, reviewable
  edit verified by reading + the integration test on `/results`.
- **Not touching the vision model name** (`google/gemini-3.5-flash`) — flagged historically,
  dismissed by the owner, out of scope.

## Implementation Approach

Build the harness first (Phase 1), then walk the four risks in dependency order: Risk #2
(pure boundary, needs only the OpenRouter mock) → Risk #7 (route + page error branches, needs
the Supabase stub + Container API) → Risk #5 (ownership, builds on the same stub) → Risk #6
(client fix + staleness rule + lifecycle tests). Close with the CI gate and cookbook
finalisation (Phase 6).

Every phase ships its tests **with** its code change in the same commit — no `.skip`, no
"tests land later" (the Phase 1 rule from §6.6). Where a phase hardens a route, the test
asserts the *new* behaviour and would fail against today's code.

## Critical Implementation Details

**`astro:env/server` alias-stub — resolution order.** The stub module must export **every**
name any route transitively imports: `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`. If a later route imports a new
`astro:env/server` field, the stub must gain it or that route's test throws at import. Keep the
stub's export list annotated as mirroring `astro.config.mjs` `env.schema`. **Both** Vitest
projects register this alias — the `pages` project needs it too, because `getViteConfig` wires
the *real* `astro:env/server` virtual module, which throws on the missing required secrets.

**`vi.mock` vs the alias.** The `astro:env/server` resolution is a static `resolve.alias` (not
`vi.mock`) so it applies at import time for every test file unconditionally. `createClient` /
`createAdminClient` are neutralised **per-test-file** with `vi.mock("@/lib/supabase")` /
`vi.mock("@/lib/services/supabase-admin")` returning the chainable stub — the alias only stops
the import from throwing; the mock controls behaviour.

**undici `MockAgent` lifecycle.** `enableNetConnect` is off during contract tests
(`agent.disableNetConnect()`), restored in `afterEach`/`afterAll` (`setGlobalDispatcher` back
to a real `Agent`, or `agent.close()`), or a leaked interceptor silently swallows a later
suite's real fetch. The mock helper owns this; suites never touch the dispatcher directly.

**Staleness rule reads `updated_at`, which two selects don't fetch.** `sessions/[id].astro`
selects `id, status, error_message, video_filename, created_at` and `sessions/index.astro`
selects `id, video_filename, status, created_at` — **neither includes `updated_at`**. Both
selects must add it before the rule can run. `GET /api/sessions/[id]` already returns
`updated_at` (unused — no caller).

**`results.ts` completed-`UPDATE` failure leaves an orphan row.** If `INSERT analysis_results`
succeeds and the `UPDATE status='completed'` then fails, checking it and returning 500 leaves a
results row against a still-`processing` session. That row is **not rendered** (the page only
reads results when `status === 'completed'`), and the staleness rule eventually flips the
render to "timed out". Accepted; documented on the handler.

## Phase 1: Integration/contract harness foundation

### Overview

Resolve the `astro:env` import hazard, add the OpenRouter HTTP-edge mock and the Supabase
client stub, establish how a route handler and an SSR page are exercised, and prove it with one
smoke test per surface type. Fill cookbook §6.2.

### Changes Required

#### 1. Explicit `undici` devDependency

**File**: `package.json`

**Intent**: Stop relying on `undici` being hoisted; pin it so the contract-test mock import is
stable across installs.

**Contract**: Add `"undici": "^7.24.8"` to `devDependencies`. No runtime dep change (Node
already bundles undici for `fetch`; this is for the importable `MockAgent`/`setGlobalDispatcher`
API in tests).

#### 2. `astro:env/server` test stub

**File**: `src/test/stubs/astro-env-server.ts` (new)

**Intent**: A module that stands in for the `astro:env/server` virtual module in tests,
exporting fake but well-formed values so any route module imports without throwing.

**Contract**: Named exports `SUPABASE_URL` (`"http://stub.supabase.local"`), `SUPABASE_KEY`
(`"stub-anon-key"`), `SUPABASE_SERVICE_ROLE_KEY` (`"stub-service-role-key"`),
`OPENROUTER_API_KEY` (`"stub-openrouter-key"`). Header comment: "Mirror of `astro.config.mjs`
`env.schema` — add a field here whenever the schema gains one, or route tests throw at import."

#### 3. Vitest config — two projects

**File**: `vitest.config.ts` (+ optionally `vitest.pages.config.ts`, new)

**Intent**: Keep the fast plain-config setup for the bulk of the suite (units, route-handler
integration, contract); add a second project — scoped to the two SSR-page spec files — that
carries Astro's Vite plugin so `.astro` imports compile. A plain `defineConfig` has no Astro
plugin, so importing `sessions/index.astro` / `[id].astro` into a spec fails at
`vite:import-analysis` — the Container-API assertions in Phases 3 and 5 need this.

**Contract**: Convert `vitest.config.ts` to the Vitest 4 `test.projects` API with two projects:
- **`unit`** — an inline project carrying the current plain config (`environment: "node"`,
  `@/*` alias) plus `"astro:env/server"` →
  `fileURLToPath(new URL("./src/test/stubs/astro-env-server.ts", import.meta.url))` in
  `resolve.alias`. `include: ["src/**/*.{test,spec}.ts"]`,
  `exclude: ["src/pages/sessions/*.{test,spec}.ts"]` (SSR-page specs sit directly in
  `src/pages/sessions/`; API-route specs under `src/pages/api/` stay in this project).
- **`pages`** — a project built from
  `getViteConfig({ test: { name: "pages", environment: "node", include: ["src/pages/sessions/*.{test,spec}.ts"] } }, inlineAstroConfig)`
  (inline, or referenced as `vitest.pages.config.ts` — the spike decides), where
  `inlineAstroConfig` drops the `@astrojs/cloudflare` adapter and keeps
  `integrations: [react()]` only. Re-add the same `astro:env/server` alias so required secrets
  don't throw under the real virtual module.

No `setupFiles`. Rewrite the file's top comment to explain the split (fast plain config for
units + route handlers + contract; Astro-plugin config only for the two SSR-page spec files).

**Phase 1 spike — do before #6:** stand up the `pages` project and confirm
`getViteConfig(..., inlineAstroConfig)` container-renders `sessions/index.astro` with the
Cloudflare adapter excluded and no `astro sync` complaint. If the adapter can't be cleanly
dropped, fall back to testing the two pages' logic as extracted pure helpers (record the
switch in §6.2) instead of widening scope to make the adapter build.

#### 4. Supabase client stub factory

**File**: `src/test/helpers/supabase-stub.ts` (new)

**Intent**: A hand-rolled chainable fake of the subset of the supabase-js query builder our
handlers use, letting a test script the `{ data, error }` a query resolves to — including an
error, which the real "always succeeds" mock could never do (the §2 anti-pattern for Risk #7).

**Contract**: Export `makeSupabaseStub(script)` returning an object with `.from(table)` →
chainable `.select().eq().order().single()/.maybeSingle()`, `.insert()`, `.update().eq().eq()`,
`.delete().eq().eq().select()`. Each terminal resolves to a scripted `{ data, error }` keyed by
`(table, operation)`. Records the call sequence (`stub.calls`) so a test can assert
`select` ran before `update`. Ships with a typed `ScriptEntry` shape. Covers both
`createClient` (RLS client) and `createAdminClient` (admin) shapes — same surface.

#### 5. OpenRouter mock helper

**File**: `src/test/helpers/openrouter-mock.ts` (new)

**Intent**: One place that installs an undici `MockAgent`, intercepts
`POST https://openrouter.ai/api/v1/chat/completions`, and lets a test set the next reply
(status + body); owns setup/teardown so suites can't leak a dispatcher.

**Contract**: Export `installOpenRouterMock()` → `{ replyWith(status, body), replyRaw(status, text), assertCalledOnce(), restore() }`. `replyWith` serialises `body` as the OpenRouter
envelope `{ choices: [{ message: { content: <stringified arg> } }] }` unless the caller passes
a full envelope; `replyRaw` sets the body verbatim (for non-JSON / truncated / fenced corpus
entries). `disableNetConnect()` on install; `restore()` in `afterEach`.

#### 6. Route-handler + page invocation helpers

**File**: `src/test/helpers/api-context.ts` (new), `src/test/helpers/render-page.ts` (new)

**Intent**: `makeApiContext` builds the minimal `APIContext` our handlers read; `renderPage`
wraps Astro's Container API for the two SSR pages.

**Contract**:
- `makeApiContext({ user, params, body, headers, cookies })` → object with `locals.user`
  (or `null`), `params`, `request` (a real `Request` with JSON body + headers), `cookies` (a
  minimal `AstroCookies`-shaped stub: `get`/`set`/`delete`/`has`). Returned shape is `as
  unknown as APIContext` at the call site.
- `renderPage(Component, { request, params, locals })` → uses
  `experimental_AstroContainer.create()` + `container.renderToResponse(Component, { … })`,
  returning the `Response` (so a test can assert `.status` and parse `.text()` for rendered
  markup). Only imported by specs in the `pages` project (#3); the React renderer that
  `DeleteSessionButton client:visible` needs is supplied by `inlineAstroConfig`'s
  `integrations: [react()]`, not a manual `loadRenderers` call. Grounding: Context7
  `withastro/docs` — testing guide + container-reference.

#### 7. Smoke tests

**File**: `src/pages/api/sessions/[id].smoke.test.ts` (new),
`src/pages/sessions/index.smoke.test.ts` (new)

**Intent**: Prove the harness end to end on the simplest route and the simplest page before any
hardening work depends on it.

**Contract**: Route smoke — `GET /api/sessions/[id]`: no `locals.user` → 401; stub returns
`{ data: null, error: null }` → 404; stub returns a row → 200 with the projected fields. Page
smoke — `sessions/index.astro`: stub returns `[]` → renders the empty state; stub returns rows
→ renders the list. Both exercise `vi.mock` of the supabase modules + the stub factory.

#### 8. Cookbook §6.2

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 `TBD` with the filled pattern: the two-project Vitest config
(plain `unit` + `getViteConfig`-based `pages` for `src/pages/sessions/*` specs), where
integration specs live, the `astro:env` alias-stub, the Supabase stub, `makeApiContext`,
`renderPage`, and the network-edge-only rule for OpenRouter.

**Contract**: §6.2 prose only (no §6.3/§6.4 yet — those land with their phases). Note the
harness file locations under `src/test/` and the page-spec location convention
(`src/pages/sessions/*.{test,spec}.ts`). If the Phase 1 spike forced the pure-helper fallback,
§6.2 says so.

### Success Criteria

#### Automated Verification

- `npm test` passes with the new smoke tests green (both the `unit` and `pages` projects run)
- `npm test` is green from a clean state with no network: `rm -rf .astro node_modules/.vite && npm test`
- A `.astro` import in a `src/pages/sessions/*.{test,spec}.ts` spec compiles under the `pages` project
- Lint passes on all new files under `src/test/`: `npm run lint`
- Type-check passes: `npx tsc --noEmit`
- A test that imports a route module (e.g. `results.ts`) does **not** throw at import

#### Manual Verification

- The Supabase stub can return `{ data: null, error: { message, code } }` and a handler test observes it
- `openrouter-mock` leaves no global dispatcher installed after a suite (a following real-`fetch` test is unaffected)
- §6.2 reads as a usable recipe to someone who wasn't in this session

---

## Phase 2: LLM boundary hardening + contract tests (Risk #2)

### Overview

Make `src/lib/services/llm.ts` validate every item it returns, tolerate a markdown-fenced
body, and fail with a typed `Error` on every corpus entry; make `analyze.ts` and `recommend.ts`
return a generic 500. Add the contract suite. Fill §6.3.

### Changes Required

#### 1. Per-item response validation in `llm.ts`

**File**: `src/lib/services/llm.ts`

**Intent**: Replace the `as`-casts with real shape checks so a drifted item (`type: "MIDDLE"`,
`{ foo: 1 }` recommendation, non-numeric `t`) is rejected at the boundary, not silently passed
downstream.

**Contract**:
- New `timestampItemSchema = z.object({ t: z.number(), f: z.number().optional(), type: z.enum(["BDC", "TDC"]) })` (defined in `llm.ts`, or in the pure `src/lib/llm-response.ts` from #2 if the shape checks are moved there for mutation coverage); `analyzeVideo` validates `z.array(timestampItemSchema).safeParse(result.timestamps)` and throws `new Error("Vision LLM returned a malformed timestamp list")` on failure. Return type unchanged.
- `generateRecommendations` imports `recommendationSchema` from `@/lib/schemas` and validates
  `z.array(recommendationSchema).safeParse(result.recommendations)`; throws
  `new Error("Recommendations LLM returned a malformed recommendation list")` on failure. The
  existing `raw_llm_response` string check stays.
- All thrown messages are **fixed strings** — no interpolation of `content` or upstream text
  (that text moves to a `console.error` alongside the throw, or is dropped).

#### 2. Markdown-fence tolerance — pure `llm-response.ts` module

**File**: `src/lib/llm-response.ts` (new), `src/lib/services/llm.ts`

**Intent**: A ` ```json … ``` ` body is common model drift and currently dies in `JSON.parse`.
Strip a leading/trailing fence before parsing, both functions. Put the fence-stripping in a
pure, I/O-free module so its branches are unit-testable directly and Stryker can mutate it —
`llm.ts` imports `astro:env/server`, so anything defined there is outside the §6.1 pure-unit
pattern and the Stryker `mutate` scope.

**Contract**: New `src/lib/llm-response.ts` (no `astro:*` imports, no I/O) exporting
`stripJsonFence(s: string): string` — trims, removes a leading `` ```json `` or `` ``` `` line
and a trailing `` ``` ``, trims again; returns input unchanged if no fence. `llm.ts` imports it
and applies it to `content` before `JSON.parse` in both `analyzeVideo` and
`generateRecommendations`. A body that is *only* a fence with no JSON still throws the existing
"invalid JSON" error. Optionally move the per-item schema constants from #1
(`timestampItemSchema` and the `z.array(...).safeParse` helpers) here too, so the shape checks
are mutation-covered as well; `llm.ts` re-imports them.

#### 3. Generic route error responses

**File**: `src/pages/api/analyze.ts`, `src/pages/api/sessions/[id]/recommend.ts`

**Intent**: Stop returning upstream OpenRouter error text (visible to a direct API caller) in
the 500 body; log the detail instead.

**Contract**: Both `catch` blocks become
`console.error("<route> LLM call failed", err); return Response.json({ error: "<plain message>" }, { status: 500 })` — `"Video analysis failed. Please try again."` for `analyze`,
`"Could not generate recommendations. Please try again."` for `recommend`. Status stays 500.
No behaviour change on the success path.

#### 4. OpenRouter contract suite

**File**: `src/lib/services/llm.test.ts` (new)

**Intent**: Pin that every malformed-response shape produces a typed `Error` and never a
partial success.

**Contract**: Using `installOpenRouterMock()`, one case per corpus entry against **both**
`analyzeVideo` and `generateRecommendations` where applicable:
`!ok` (429 / 500 / 403 / 451) · 200 + empty body · 200 + `{ choices: [] }` · 200 +
`content` empty · 200 + fenced JSON (**passes** — asserts the parsed value) · 200 +
`{ timestamps: [] }` (**passes** — `analyzeVideo` resolves `{ timestamps: [] }`; the system
prompt instructs the model to return exactly this when unsure) · 200 + truncated
JSON · 200 + `{ timestamps: "nope" }` · 200 + `{ timestamps: [{ t: 1, type: "MIDDLE" }] }` ·
200 + `{ recommendations: [{ foo: 1 }] }` · 200 + `raw_llm_response` missing. Each malformed
case asserts the thrown `Error` (message is one of the fixed strings) — never a returned
partial. The fenced-body and empty-`timestamps` cases assert a **successful** parse.

#### 5. Route-level integration for the LLM boundary

**File**: `src/pages/api/analyze.test.ts` (new),
`src/pages/api/sessions/[id]/recommend.test.ts` (new — extended in Phases 4–5)

**Intent**: A malformed upstream response → route 500 with the **generic** body and **no
`analysis_results` write**.

**Contract**: Auth via `makeApiContext({ user })`; Supabase via the stub; OpenRouter via the
mock returning a corpus entry. Assert: status 500, body `{ error: "<generic string>" }`, and
the admin stub's `insert` was **never called**. Also assert the happy path (well-formed
response → 200 + shape).

#### 6. Cookbook §6.3

**File**: `context/foundation/test-plan.md`

**Contract**: Replace §6.3 `TBD` with: the corpus list, `installOpenRouterMock` usage, the
"assert a typed failure, never a partial" rule, and the network-edge-only reminder.

### Success Criteria

#### Automated Verification

- Contract suite passes: `npm test src/lib/services/llm.test.ts`
- Every corpus entry asserts a typed `Error` (or, for the fenced and empty-`timestamps` cases, a successful parse)
- `src/lib/llm-response.test.ts` covers every `stripJsonFence` branch directly; Stryker `mutate` includes `src/lib/llm-response.ts`
- Route integration tests pass; `insert` is never called on a boundary failure
- Lint + type-check pass: `npm run lint && npx tsc --noEmit`
- `git grep -n "err.message" src/pages/api/analyze.ts src/pages/api/sessions/\[id\]/recommend.ts` returns nothing in the catch responses

#### Manual Verification

- A fenced ` ```json ` body from OpenRouter now completes analysis instead of failing
- A direct `curl` to `/api/analyze` with a forced upstream 500 returns the generic string, and the detail appears in server logs only
- §6.3 is a usable recipe

---

## Phase 3: Distinct DB-error states (Risk #7)

### Overview

Fix every query site that folds a DB error into "absent": five route sites, `recommend.ts`'s
error-as-404, and the `sessions/[id].astro` blank-card path. Make "distinct error state" the
tested default.

### Changes Required

#### 1. Route pre-checks → `maybeSingle` + split error/absent

**File**: `src/pages/api/sessions/[id].ts` (GET), `src/pages/api/sessions/[id]/start.ts`,
`src/pages/api/sessions/[id]/results.ts`

**Intent**: Adopt the `DELETE` handler's pattern — a genuine query failure is a 500, a
missing/not-owned row is a 404.

**Contract**: Each `const { data } = await supabase.from("fitting_sessions").select(...).eq("id", …).single()` becomes `.maybeSingle()` with `const { data, error }`; then
`if (error) return new Response(null, { status: 500 })` before `if (!data) return … 404`. The
`status`-gate 409s downstream are unchanged.

#### 2. `recommend.ts` — error is 500, not 404

**File**: `src/pages/api/sessions/[id]/recommend.ts`

**Intent**: Today `if (error) → 404` (archived F6 "fixed" as 404). A query error is not a
missing session.

**Contract**: `.single()` → `.maybeSingle()`; `if (error) return Response.json({ error: "Could not load session" }, { status: 500 })`; `if (!session) return Response.json({ error: "Session not found" }, { status: 404 })`. The `status !== "processing"` 409 branch is unchanged.

#### 3. `sessions/[id].astro` — session query error → 500

**File**: `src/pages/sessions/[id].astro`

**Intent**: A failed session lookup should be a 500, not a 404.

**Contract**: `.single()` → `.maybeSingle()` with `error`; `if (error) return new Response(null, { status: 500 })`; keep `if (!sessionData) return … 404`.

#### 4. `sessions/[id].astro` — results query error → distinct state (the blank card)

**File**: `src/pages/sessions/[id].astro`

**Intent**: For a `completed` session, if the `analysis_results` query *errors*, the page today
renders a blank card (no branch matches). It must render a readable error state instead.

**Contract**: The `completed` branch captures `error` from the results query. Add a
`resultsLoadError` boolean. New render branch: `session.status === "completed" && resultsLoadError`
→ a card with "We couldn't load your results — please refresh." styled like the `failed` state.
The existing `completed && results` branch is unchanged; a genuinely absent row (no error, no
data) also routes to the new error state (a `completed` session should always have a row —
§5 of research).

#### 5. `sessions/index.astro` — regression test only

**File**: `src/pages/sessions/index.test.ts` (extend the Phase 1 smoke)

**Intent**: Lock in the already-correct S-04 behaviour so a future refactor can't regress it.

**Contract**: Stub the list query to return `{ data: null, error: {...} }` → assert status 500
and the "Couldn't load your sessions" copy; `[]` → empty state; rows → list. No code change.

#### 6. Route + page error-branch tests

**File**: co-located `*.test.ts` for each route in (1)–(2); `src/pages/sessions/[id].test.ts`
(new)

**Intent**: Each fixed site has a test that injects a query error and asserts the distinct
state — and would fail against today's code.

**Contract**: Per route: stub the pre-check query → `{ data: null, error: { code: "XX000", message: "boom" } }` → assert **500** (not 404), and no admin write. Page: stub session
query error → 500; stub `completed` + results query error → rendered markup contains the
"couldn't load your results" copy and **not** the recommendations section.

#### 7. Cookbook §6.2 addendum — SSR page error branches

**File**: `context/foundation/test-plan.md`

**Contract**: Extend §6.2 with the `renderPage` + stubbed-Supabase pattern for asserting a
page's error branch (status code and rendered copy).

### Success Criteria

#### Automated Verification

- All route/page error-branch tests pass: `npm test`
- `git grep -nE "const \{ data \} = await supabase" src/pages` returns **only** intentional non-error-bearing reads (documented), none in a pre-check
- Lint + type-check pass
- Each new test fails when reverted against the pre-change handler (spot-check 2)

#### Manual Verification

- Force a DB error on the results page (e.g. break the query) → "couldn't load your results", not a blank card
- Force a DB error on `GET /api/sessions/[id]` → 500, not 404
- The happy paths (real completed session, real history list) still render correctly

---

## Phase 4: Session-route ownership (Risk #5)

### Overview

Generalise the hardened `DELETE` pattern: an explicit `user_id` guard on every admin write, and
`POST /api/analyze` bound to an owned `processing` session. Stub-level ownership tests (the
real cross-user RLS check is §3 Phase 4).

### Changes Required

#### 1. `user_id` guard on the `start` admin write

**File**: `src/pages/api/sessions/[id]/start.ts`

**Intent**: Defence in depth — if the RLS pre-`SELECT` ever failed open or were refactored
away, the admin `UPDATE` still can't cross users.

**Contract**: `admin.from("fitting_sessions").update({ status: "processing" }).eq("id", context.params.id)` gains `.eq("user_id", context.locals.user.id)`. (Result-checking is Phase 5.)

#### 2. `user_id` guard on the `results` admin writes

**File**: `src/pages/api/sessions/[id]/results.ts`

**Intent**: Same, for both the `completed` and `failed` `UPDATE`s.

**Contract**: Both `.update(...).eq("id", context.params.id)` calls gain
`.eq("user_id", context.locals.user.id)`. The `INSERT analysis_results` keys on
`session_id = params.id`; the preceding RLS pre-check plus the FK to a now-guarded session row
is the ownership guarantee there (no `user_id` column on `analysis_results`) — documented in a
comment.

#### 3. Bind `POST /api/analyze` to an owned session

**File**: `src/lib/schemas.ts`, `src/pages/api/analyze.ts`

**Intent**: Close Risk #5's "vision route not scoped to an owned session" — any authed user can
currently burn vision budget on any blob.

**Contract**:
- `analyzeRequestSchema` gains `session_id: z.string().uuid()`.
- `analyze.ts` — after auth + parse, create the RLS client, run the sibling pre-check:
  `.from("fitting_sessions").select("id, status").eq("id", parsed.data.session_id).maybeSingle()`
  → `error` → 500, `!data` → 404, `status !== "processing"` → 409. Only then call
  `analyzeVideo`. Mirrors `recommend.ts` exactly.

#### 4. `VideoAnalyzer` sends `session_id` to `/analyze`

**File**: `src/components/VideoAnalyzer.tsx`

**Intent**: Step 4's fetch body must carry the session id now that the route requires it.

**Contract**: The Step-4 `body` becomes `JSON.stringify({ video: videoBase64, session_id: sessionId })`. No other change to the step (the existing `!res.ok` handling already routes to
`postError`).

#### 5. Ownership tests (stub-level)

**File**: co-located `*.test.ts` for `start`, `results`, `recommend`, `analyze`,
`GET`/`DELETE [id]`

**Intent**: Assert the ownership *discipline* without a live DB: pre-check runs first, a
no-row pre-check yields 404 with no admin write, the admin write carries `.eq("user_id")`, and
an anonymous request is 401.

**Contract**: Per route: (a) `makeApiContext({ user: undefined })` → 401; (b) stub pre-check →
`{ data: null }` → 404 **and** `stub.calls` shows no `update`/`insert`/`delete`; (c) stub
pre-check → a row → happy path, and `stub.calls` for the admin write includes an
`eq("user_id", <id>)` entry; (d) `stub.calls` ordering: `select` index < admin-write index.
`/analyze` also asserts a missing/`queued` session → 404/409 with no OpenRouter call.

#### 6. Cookbook §6.4

**File**: `context/foundation/test-plan.md`

**Contract**: Replace §6.4 `TBD` with: default-to-integration for a new endpoint, the
pre-check-before-admin-write assertion via `stub.calls`, the `.eq("user_id")` guard convention,
and an explicit pointer that the **real two-user RLS cross-check is §3 Phase 4 (Playwright)** —
the stub floor proves ordering, not RLS.

### Success Criteria

#### Automated Verification

- Ownership tests pass for all six surfaces: `npm test`
- `git grep -n 'eq("user_id"' src/pages/api/sessions` shows the guard on `start`, `results` (×2), `[id].ts` DELETE
- `analyzeRequestSchema` requires `session_id`; `analyze.test.ts` covers 401/404/409/200
- Lint + type-check pass
- `VideoAnalyzer` Step 4 sends `session_id` (grep + the `analyze` happy-path test uses the same body shape)

#### Manual Verification

- Full pipeline still completes end to end in the browser (upload → results) with the new `/analyze` contract
- A `curl` to `/api/analyze` with a `session_id` the caller doesn't own → 404, no vision call
- §6.4 is a usable recipe and the Phase 4 deferral is unambiguous

---

## Phase 5: Stuck-processing terminal state (Risk #6)

### Overview

A `processing` — or stuck `queued` — session with no progress past `STALE_PROCESSING_MS`
renders as a terminal "timed out" failure (display-time rule, no DB write). `VideoAnalyzer`
Step 7 reports its failure. The unchecked status `UPDATE`s are checked.

### Changes Required

#### 1. `effectiveSessionStatus` pure helper

**File**: `src/lib/session-display-status.ts` (new)

**Intent**: One pure function, unit-testable, that maps a stored status + `updated_at` + "now"
to the status the UI should render.

**Contract**: `effectiveSessionStatus(status: SessionStatus, updatedAt: string, now: number): SessionStatus` — returns `"failed"` when `(status === "processing" || status === "queued")`
**and** `now - Date.parse(updatedAt) > STALE_PROCESSING_MS`; otherwise returns `status`
unchanged. The `queued` arm rescues a session whose `queued → processing` `UPDATE` silently
failed (research §4c — a transient error, or the Phase 4 `.eq("user_id")` guard matching
0 rows, neither of which surfaces as an `error`); a normal `queued` row has
`updated_at ≈ created_at` and the client fires `/start` on mount, so it never trips the
threshold. Exported `STALE_PROCESSING_MS = 15 * 60_000` with a comment: "the browser pipeline (vision LLM
+ CPU pose detection over 5 offsets/keyframe) runs single-digit minutes; 15 min is a safe
'no client is coming back' threshold. Tune with real telemetry." A companion
`STALE_PROCESSING_MESSAGE = "Analysis timed out — the browser tab may have been closed before it finished. Please try again."`

#### 2. Results page renders the effective status

**File**: `src/pages/sessions/[id].astro`

**Intent**: A stale `processing` session shows the timed-out failure, not "check back soon."

**Contract**: Add `updated_at` to the session `select`. Compute
`const displayStatus = effectiveSessionStatus(session.status, session.updated_at, Date.now())`.
The `queued || processing` branch keys on `displayStatus`; when `displayStatus === "failed"`
and the stored status was `processing` or `queued`, render the failed card with
`STALE_PROCESSING_MESSAGE` (the stored `error_message` is null in this case). The
real-`failed` branch is unchanged.

#### 3. History list renders the effective status

**File**: `src/pages/sessions/index.astro`

**Intent**: The blue "Processing" pill shouldn't be permanent.

**Contract**: Add `updated_at` to the `select`. Map each row through `effectiveSessionStatus`
before `SESSION_STATUS_META[...]`, so a stale row shows the "Failed" pill.

#### 4. Check the status `UPDATE`s in `results.ts`

**File**: `src/pages/api/sessions/[id]/results.ts`

**Intent**: A silently-failed `UPDATE` is how a session sticks in `processing` (research §4c
item 4).

**Contract**: The `completed` `UPDATE` — capture `{ error }`; on error `console.error` +
`return new Response(null, { status: 500 })` (the orphan-row case is documented per Critical
Implementation Details). The `failed`-branch `UPDATE` — capture `{ error }`; on error
`console.error` and still return `Response.json({ ok: true })` (the client's error is already
recorded locally; the staleness rule backstops the render).

#### 5. Check the status `UPDATE` in `start.ts`

**File**: `src/pages/api/sessions/[id]/start.ts`

**Intent**: If `queued → processing` silently fails, every downstream step 409s and the session
sticks in `queued`.

**Contract**: Capture `{ error }` from the admin `UPDATE`; on error `console.error` +
`return new Response(null, { status: 500 })` so `VideoAnalyzer` Step 1's `!res.ok` handling
fires `postError`.

#### 6. `VideoAnalyzer` Step 7 reports failure

**File**: `src/components/VideoAnalyzer.tsx`

**Intent**: Today a `/results` submit failure sets only local state — DB and other devices
disagree forever.

**Contract**: The Step-7 `catch` calls `await postError("submitting", …)` (replacing the
inline `setErrorMessage`/`onError`). `postError` already POSTs the error-shaped body to
`/results`; a 400 (schema reject) submit followed by a valid error-shaped POST will land the
session in `failed`. Add a one-line comment that a `409` here (session not `processing`) is
backstopped by the staleness rule.

#### 7. Tests

**File**: `src/lib/session-display-status.test.ts` (new); extend
`src/pages/sessions/[id].test.ts`, `src/pages/api/sessions/[id]/results.test.ts`,
`start.test.ts`

**Intent**: Unit-cover the state map; integration-cover the lifecycle gaps.

**Contract**:
- Unit: fresh `processing` (age < threshold) → `processing`; stale `processing` → `failed`;
  fresh `queued` → `queued`; stale `queued` → `failed`; exactly-at-threshold boundary;
  `completed`/`failed` returned unchanged regardless of age; malformed `updated_at` → returns
  `status` unchanged (no throw).
- Page: stub a `processing` session with `updated_at` 20 min old → rendered markup contains the
  timed-out message, not "check back soon"; 2 min old → still "processing".
- Route: `results.ts` completed-`UPDATE` error (stub) → 500; `start.ts` `UPDATE` error → 500.
- `/results` schema-reject (400) path documented + asserted (a malformed success payload → 400,
  session still `processing`; a following error-shaped POST → session `failed`).

#### 8. Cookbook §6.6 note

**File**: `context/foundation/test-plan.md`

**Contract**: Add a Phase 2 sub-section to §6.6: the display-time staleness rule (no reaper),
`STALE_PROCESSING_MS` location + rationale, the orphan-results-row documented edge, and the
Step-7 `postError` fix.

### Success Criteria

#### Automated Verification

- `session-display-status.test.ts` passes with all boundary cases (incl. stale/fresh `queued`)
- Page tests assert the timed-out render for a stale `processing` session
- `results.ts` / `start.ts` `UPDATE`-error tests pass (500)
- Both SSR `select`s include `updated_at`: `git grep -n updated_at src/pages/sessions`
- Lint + type-check pass

#### Manual Verification

- A session left `processing` with an old `updated_at` shows "Analysis timed out" on the results page and a "Failed" pill in history
- Closing the browser tab mid-analysis, then reopening the results page after 15 min → timed-out state (not "check back soon")
- Forcing a `/results` submit to 500 → the session ends up `failed` with a readable message on reload
- A fresh `processing` session (just started) still shows "processing" normally

---

## Phase 6: CI gate + cookbook finalisation

### Overview

Wire `npm test` as a blocking CI step (per §5 — required after §3 Phase 2). Finalise the
cookbook and leave a §4 refresh note.

### Changes Required

#### 1. Add `npm test` to CI

**File**: `.github/workflows/ci.yml`

**Intent**: The gate goes live with the suites it gates — no window where the tests exist but
nothing runs them.

**Contract**: A `- run: npm test` step after `npm run lint` and before/after `npm run build`
(order doesn't matter; keep it before `build` so a fast unit failure short-circuits). No new
secrets — the suite is hermetic (alias-stub env, mocked network). Node stays 22.

#### 2. §4 Stack table refresh note

**File**: `context/foundation/test-plan.md`

**Intent**: §4 still says "none yet" for Vitest and recommends `getViteConfig`; Phase 1 chose
otherwise. Flag it rather than silently editing frozen strategy.

**Contract**: Append to §4 (or its notes): "Vitest `4.1.11` in use since §3 Phase 1;
`astro:env` resolved via an alias-stub (`src/test/stubs/`), **not** `getViteConfig` — see §6.2.
API/network mocking: `undici` `MockAgent` (added as devDep in Phase 2), MSW not adopted.
Supabase: hand-rolled stub (`src/test/helpers/supabase-stub.ts`). A full `/10x-test-plan
--refresh` is due to reconcile the §4 table rows."

#### 3. §7 negative-space update

**File**: `context/foundation/test-plan.md`

**Contract**: Add a §7 entry: "**A server-side reaper for stuck `processing` sessions** —
Phase 2 closed Risk #6 with a display-time staleness rule (`effectiveSessionStatus`), not a DB
write-back. A real sweep/cron is deliberately not built; re-evaluate only if display-time
reconciliation proves insufficient (e.g. a downstream consumer needs the DB status to be
terminal)."

#### 4. §6.6 Phase 2 wrap-up

**File**: `context/foundation/test-plan.md`

**Contract**: Ensure §6.6 has a complete "Phase 2 — LLM boundary + API-route integration"
subsection: harness locations, the alias-stub hazard resolution, the `stub.calls` ordering
assertion idiom, the `renderPage` Container API pattern, and the deferred real-RLS check.

#### 5. §3 scope annotation — Phase 2 exceeded "test-only"

**File**: `context/foundation/test-plan.md`

**Intent**: §3 says "All other phases [besides Phase 3] are test-only against behavior that
already exists." Phase 2 shipped real behavior changes the risk responses required
(`effectiveSessionStatus` + page wiring, `/analyze` session-binding + the `analyzeRequestSchema`
contract change + the `VideoAnalyzer` client change, the Step-7 `postError` fix). Research OQ-1
asked the plan to flag this. Annotate the drift rather than silently leave it.

**Contract**: Add a note to §3's Phase 2 row (or the "test-only" sentence): "Phase 2 also
shipped the minimal display-time reconciliation + client-side hardening the risk responses
required — see this change's §4/§7 notes; reconcile the 'test-only' framing in the next
`/10x-test-plan --refresh`." Consistent with how #2 handles the §4 table drift. Do **not**
rewrite frozen §1–§5 strategy in place beyond this pointer.

### Success Criteria

#### Automated Verification

- CI config is valid and the `npm test` step runs on a PR: push a branch, observe the job
- `npm test` in CI is green without any Supabase/OpenRouter secret set
- `context/foundation/test-plan.md` §6.2, §6.3, §6.4 no longer contain "TBD"
- §3's "test-only" sentence / Phase 2 row carries the scope-drift annotation and a `/10x-test-plan --refresh` pointer
- Lint passes on the workflow + markdown: `npm run lint`

#### Manual Verification

- The CI run on the phase's own PR shows `lint` → `test` → `build` all green
- §6.2–§6.4 + §6.6 read as a coherent set to someone new
- §4 refresh note + §7 reaper entry accurately reflect what shipped

---

## Testing Strategy

### Unit Tests

- `effectiveSessionStatus` — the staleness state map, all boundaries incl. stale/fresh
  `queued` (Phase 5).
- `stripJsonFence` (`src/lib/llm-response.test.ts`, Phase 2) — direct branch cases: leading
  ` ```json ` fence, bare ` ``` ` fence, trailing ` ``` `, no-fence passthrough, fence-only →
  downstream `JSON.parse` throw. Pure module, inside Stryker's `mutate` scope.
- No new pure-math units (Phase 1 territory, unchanged).

### Integration / Contract Tests

- **OpenRouter contract** (`llm.test.ts`) — the malformed-response corpus → typed failures.
- **Route integration** — every session route + `/analyze` + `/recommend`, with the Supabase
  stub and (where relevant) the OpenRouter mock: auth gating, ownership discipline, error-vs-
  absent, no-write-on-failure, status-`UPDATE` failure → 500.
- **SSR page** — `sessions/index.astro` and `sessions/[id].astro` via the Container API: empty
  state, list, completed results, query-error state (no blank card), stale-`processing`
  timed-out render.

### Manual Testing Steps

1. Run the full pipeline in the browser (upload a real side-view clip) → completes to results
   with the new `/analyze` `session_id` contract.
2. Force an OpenRouter 500 (temporarily point `OPENROUTER_URL` or use a bad key) → analysis
   fails with a generic message; server logs carry the detail.
3. Paste a ` ```json `-fenced body into a mocked response manually / observe the contract test
   — fenced body now parses.
4. Start a session, close the tab before Step 7, wait 15 min, open `/sessions/<id>` → "Analysis
   timed out"; check `/sessions` → "Failed" pill.
5. `curl -X POST /api/analyze` with a `session_id` owned by another account → 404, no vision
   call (check logs / budget).
6. Break the `analysis_results` query for a `completed` session → results page shows "couldn't
   load your results", not a blank card.

## Performance Considerations

- The staleness rule is a single `Date.parse` + subtraction per rendered row — negligible.
- Adding `updated_at` to two `select`s is one extra column, no new round-trip.
- The contract suite mocks all network — no real OpenRouter calls, no cost, fast.
- `/analyze` gains one Supabase `SELECT` per call (the pre-check) — same cost as its sibling
  routes already pay.

## Migration Notes

- **No schema migration.** `updated_at` and its trigger already exist. `analysis_results` has
  no `user_id` column and none is added.
- **No data backfill.** Existing stuck `processing` rows are reconciled at display time on next
  view; their stored status is left as-is.
- **`analyzeRequestSchema` gains a required `session_id`** — the client change ships in the same
  phase (Phase 4), so there is no version skew for the app. A third-party direct caller of
  `/api/analyze` (none known) would break — acceptable, the route is app-internal.

## References

- Research: `context/changes/testing-llm-and-ownership/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risk response), §3 Phase 2, §4 (stack),
  §6.2–§6.4 (cookbook targets), §7 (exclusions)
- Phase 1: `context/changes/testing-angle-correctness/plan.md` (harness bootstrap, §6.1,
  `astro:env` hazard)
- Hardened-DELETE template: `src/pages/api/sessions/[id].ts:36-90`
- Fixed error-vs-absent pattern: `src/pages/sessions/index.astro:17-27`
- Prior Risk #5 treatment: `context/archive/2026-09-02-delete-session/` (research §2, plan
  `plan.md:430-435` deferring the two-user test to this phase)
- Context7: `withastro/docs` — testing guide (`getViteConfig`, Container API), endpoint recipes
- Lessons: `context/foundation/lessons.md` (`npx tsc --noEmit` not `npm run typecheck`;
  `z.treeifyError` not `.flatten()`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Integration/contract harness foundation

#### Automated

- [x] 1.1 `npm test` passes with the new smoke tests green — c62e041
- [x] 1.2 `npm test` is green from a clean state with no network (`rm -rf .astro node_modules/.vite && npm test`) — c62e041
- [x] 1.3 Lint passes on all new files under `src/test/` — c62e041
- [x] 1.4 Type-check passes (`npx tsc --noEmit`) — c62e041
- [x] 1.5 A test importing a route module does not throw at import — c62e041
- [x] 1.9 A `.astro` import in a `src/pages/sessions/*.{test,spec}.ts` spec compiles under the `pages` project — c62e041

#### Manual

- [x] 1.6 The Supabase stub can return an `error` shape and a handler test observes it — c62e041
- [x] 1.7 `openrouter-mock` leaves no global dispatcher installed after a suite — c62e041
- [x] 1.8 §6.2 reads as a usable recipe to someone who wasn't in this session — c62e041

### Phase 2: LLM boundary hardening + contract tests (Risk #2)

#### Automated

- [x] 2.1 Contract suite passes (`npm test src/lib/services/llm.test.ts`)
- [x] 2.2 Every corpus entry asserts a typed `Error` (fenced + empty-`timestamps` cases assert a successful parse)
- [x] 2.3 Route integration tests pass; `insert` never called on a boundary failure
- [x] 2.4 Lint + type-check pass
- [x] 2.5 No `err.message` interpolation left in the `analyze`/`recommend` catch responses
- [x] 2.9 `stripJsonFence` branch cases live in `src/lib/llm-response.test.ts`; Stryker `mutate` includes `src/lib/llm-response.ts`

#### Manual

- [x] 2.6 A fenced ` ```json ` body now completes analysis instead of failing
- [x] 2.7 A direct call with a forced upstream 500 returns the generic string; detail in logs only
- [x] 2.8 §6.3 is a usable recipe

### Phase 3: Distinct DB-error states (Risk #7)

#### Automated

- [ ] 3.1 All route/page error-branch tests pass
- [ ] 3.2 No `const { data } = await supabase` left in a pre-check (grep clean)
- [ ] 3.3 Lint + type-check pass
- [ ] 3.4 Spot-checked: 2 new tests fail when reverted against the pre-change handler

#### Manual

- [ ] 3.5 Forced DB error on the results page → "couldn't load your results", not a blank card
- [ ] 3.6 Forced DB error on `GET /api/sessions/[id]` → 500, not 404
- [ ] 3.7 Happy paths (real completed session, real history list) still render correctly

### Phase 4: Session-route ownership (Risk #5)

#### Automated

- [ ] 4.1 Ownership tests pass for all six surfaces
- [ ] 4.2 `eq("user_id"` guard present on `start`, `results` (×2), `[id].ts` DELETE (grep)
- [ ] 4.3 `analyzeRequestSchema` requires `session_id`; `analyze.test.ts` covers 401/404/409/200
- [ ] 4.4 Lint + type-check pass
- [ ] 4.5 `VideoAnalyzer` Step 4 sends `session_id`

#### Manual

- [ ] 4.6 Full pipeline still completes end to end with the new `/analyze` contract
- [ ] 4.7 `curl` to `/api/analyze` with an unowned `session_id` → 404, no vision call
- [ ] 4.8 §6.4 is a usable recipe and the Phase 4 deferral is unambiguous

### Phase 5: Stuck-processing terminal state (Risk #6)

#### Automated

- [ ] 5.1 `session-display-status.test.ts` passes with all boundary cases
- [ ] 5.2 Page tests assert the timed-out render for a stale `processing` session
- [ ] 5.3 `results.ts` / `start.ts` `UPDATE`-error tests pass (500)
- [ ] 5.4 Both SSR `select`s include `updated_at` (grep)
- [ ] 5.5 Lint + type-check pass

#### Manual

- [ ] 5.6 A stale `processing` session shows "Analysis timed out" + a "Failed" pill in history
- [ ] 5.7 Tab closed mid-analysis, reopened after 15 min → timed-out state
- [ ] 5.8 Forcing a `/results` submit to 500 → session ends up `failed` with a readable message
- [ ] 5.9 A fresh `processing` session still shows "processing" normally

### Phase 6: CI gate + cookbook finalisation

#### Automated

- [ ] 6.1 CI `npm test` step runs on a PR (observed on a branch)
- [ ] 6.2 `npm test` in CI is green with no Supabase/OpenRouter secret set
- [ ] 6.3 §6.2, §6.3, §6.4 no longer contain "TBD"
- [ ] 6.4 Lint passes on the workflow + markdown
- [ ] 6.8 §3 "test-only" framing carries the Phase 2 scope-drift annotation + `/10x-test-plan --refresh` pointer

#### Manual

- [ ] 6.5 CI run on the phase's PR shows `lint` → `test` → `build` all green
- [ ] 6.6 §6.2–§6.4 + §6.6 read as a coherent set to someone new
- [ ] 6.7 §4 refresh note + §7 reaper entry accurately reflect what shipped
