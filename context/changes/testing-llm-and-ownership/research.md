---
date: 2026-09-03T20:33:00+02:00
researcher: maro
git_commit: 44438a16968e7b29fd04f453dc2da8df4029e206
branch: master
repository: mjedrasz/bikefit
topic: "LLM boundary + API-route integration — grounding for test-plan Phase 2 (Risks #2, #5, #6, #7)"
tags: [research, codebase, openrouter, llm-boundary, api-routes, rls, ownership, session-lifecycle, error-handling, test-plan, risk-2, risk-5, risk-6, risk-7]
status: complete
last_updated: 2026-09-03
last_updated_by: maro
---

# Research: LLM boundary + API-route integration (test-plan Phase 2)

**Date**: 2026-09-03T20:33:00+02:00
**Researcher**: maro
**Git Commit**: 44438a16968e7b29fd04f453dc2da8df4029e206
**Branch**: master
**Repository**: mjedrasz/bikefit

## Research Question

Rollout **Phase 2** of `context/foundation/test-plan.md` (`context/changes/testing-llm-and-ownership/`)
defends four risks at once:

- **Risk #2** — OpenRouter returns a drifted / truncated / markdown-fenced / wrong-shape body
  and the whole analysis dies (or writes a partial result).
- **Risk #5** — one user reads or mutates another user's session because routes verify
  "is logged in" while mutations run through the RLS-bypassing service-role client keyed by a
  path parameter.
- **Risk #6** — the browser tab closes mid-analysis and the session is orphaned in
  `processing` forever — no result, no failure message.
- **Risk #7** — a Supabase query errors and the UI renders it as "not found" / "no sessions
  yet" / a blank card.

Before a plan can be written, this phase needs the code grounded: **which routes exist, which
Supabase client each uses for reads vs writes, where the LLM boundary parsing lives, who writes
each session-status transition, and every query site that swallows a DB error.**

## Summary

**The server is a thin persistence + LLM-proxy layer. Six API routes and two SSR pages touch
`fitting_sessions` / `analysis_results`; the analysis "pipeline" is a browser orchestrator
(`src/components/VideoAnalyzer.tsx`) that calls those routes in sequence.** Nothing on the
server re-derives or sweeps anything.

**Risk #2 — the OpenRouter boundary is one file, `src/lib/services/llm.ts`, two functions.**
`analyzeVideo()` (vision, `response_format: json_schema` + `strict: true`) and
`generateRecommendations()` (text, `response_format: json_object` — no schema). Both already:
parse `.json()`, null-check `choices[0].message.content`, `JSON.parse` in try/catch,
`Array.isArray`-check the top-level array. **Gaps:** (a) **no per-item shape validation** —
`timestamps` items are cast `as {t,type}[]` with no check that `type ∈ {BDC,TDC}`;
`recommendations` items are cast `as Recommendation[]` with no `{adjustment,rationale}` check;
(b) **no markdown-fence stripping** — a ` ```json … ``` ` body throws in `JSON.parse` → caught →
re-thrown as a typed `Error` → route 500; (c) **the two `response_format` paths diverge** —
vision is server-enforced-strict, text is prompt-instructed-only ("Return ONLY a valid JSON
object (no markdown…)"); (d) on `!response.ok` the **full upstream OpenRouter error body** is
interpolated into the thrown `Error.message` and returned verbatim in the route's 500 JSON
(`{ error: <upstream text> }`) — the app UI never reads that body, but a direct API caller
does. **Mitigating fact:** the *final* DB write (`POST /api/sessions/[id]/results`)
re-validates `recommendations` and `body_angles` against `resultsPayloadSchema` with real
per-item Zod schemas — so a malformed recommendation shape is rejected there. But that
rejection is a 400 the browser does **not** convert to a clean failure (see Risk #6).

**Risk #5 — ownership is "RLS `SELECT` pre-check proves ownership, admin write keyed by
`params.id`."** Applied consistently on `start`, `results`, `recommend`, `GET [id]`, `DELETE
[id]`, and both SSR pages. **Two admin writes (`start`, `results`) key the write on
`params.id` only — the RLS pre-`SELECT` is their *sole* ownership guard.** `DELETE [id]` is the
one hardened route (belt-and-braces `.eq("user_id", …)` on the admin delete + a dedicated
`sessions_delete_own` RLS policy shipped 2026-09-02, though inert). `POST /api/analyze` is
**not session-scoped at all** — any authenticated user posts any video and burns vision-model
budget (this is the "vision route not scoped to an owned session" clause of Risk #5, and the
lead-in to Risk #3). The known soft spot: **RLS write policies have failed in this SSR context
before** (archived Deviation 3 — `sessions_insert_own` never worked, JWT not propagated), so a
test must exercise a *real* cross-user `SELECT` against deployed RLS, not a stub — which
collides with §4's "CI should not depend on local Supabase."

**Risk #6 — the only path to a terminal state (`completed` / `failed`) is the browser POSTing
to `/api/sessions/[id]/results`.** There is **no server-side sweep, cron, TTL, or
`updated_at`-based reaper** (confirmed: `wrangler.jsonc` has no `triggers`/`crons`; grep finds
nothing). Four distinct ways a session sticks in a non-terminal state: (1) tab closes after
`/start` and before `/results`; (2) `/results` returns 400 (schema reject) / 409 / 500 —
`VideoAnalyzer` Step 7 throws but does **not** call `postError`; (3) `postError()` itself POSTs
to `/results`, which requires `status === 'processing'` — if `/start`'s status write silently
failed (its result is unchecked) the error report also 409s; (4) the non-atomic success write
(`INSERT analysis_results` ok → `UPDATE status='completed'` fails silently) leaves `processing`
+ an orphan results row (archived async-job plan-review F2, ACCEPTED). The UI renders a
long-lived `processing` as "Still processing — check back soon." (detail page, forever) and a
blue "Processing" pill (history list, forever). **The Phase 2 goal line — "drive
stuck-`processing` sessions to a terminal state" — describes a mechanism that does not exist
yet** (see Open Questions #1).

**Risk #7 — `const { data } = await supabase.from(...)...` (dropping `error`) is live in five
places:** `GET /api/sessions/[id]`, `start.ts`, `results.ts` (pre-check), `sessions/[id].astro`
(both the session query and the results query), and — as `if (error) return 404` rather than
500 — `recommend.ts`. Only `sessions/index.astro` (fixed in S-04 review F1) and the `DELETE`
handler in `[id].ts` (fixed in delete-session review F3) distinguish a query error from an
absent row. The worst instance: `sessions/[id].astro:33-38` — if the `analysis_results` query
errors for a `completed` session, `results` is `null`, no status branch matches, and the page
renders a **blank card with only a back-link** (exactly S-03 review F2, still live).

**Secrets check (§2 asked):** `OPENROUTER_API_KEY` only ever appears in the `Authorization`
header — never a body, URL, or log line — so `response.text()` on an upstream error cannot
echo it. `raw_llm_response` is persisted to a TEXT column but is **not rendered** on the
results page (`[id].astro` renders only `recommendations` and `body_angles`). No secret-leak
surface found; the only leakage is verbose upstream *error* text at the route boundary to a
direct API caller.

**Test-harness reality:** Vitest is `environment: "node"`, pure-logic only, `include:
["src/**/*.{test,spec}.ts"]`, **no `astro:env`, no DOM, no HTTP mock, no Supabase stub**.
Cookbook `§6.2`–`§6.4` (integration / contract / new-endpoint) are all `TBD — see §3 Phase 2`.
This phase builds that harness from zero. Every route module transitively imports
`astro:env/server` (via `createClient` / `createAdminClient` / `llm.ts`), which **throws at
import time** if the env vars are unset — so an env-setup file is the first task.

## Detailed Findings

### 1. Route & page inventory — auth, ownership, and Supabase client per surface

Every server surface that touches `fitting_sessions` or `analysis_results`:

| Surface | File | Auth gate | Ownership mechanism | Read client | Write client |
|---|---|---|---|---|---|
| `POST /api/sessions` (create) | `src/pages/api/sessions/index.ts:9-50` | `!locals.user` → 401 | n/a — `user_id` set from `locals.user.id` on insert | — | **admin**, server-set `user_id` |
| `GET /api/sessions/[id]` (status poll) | `src/pages/api/sessions/[id].ts:8-34` | `!locals.user` → 401 | RLS `sessions_select_own` on `.select().single()` → `!data` → 404 | user (RLS) | — |
| `DELETE /api/sessions/[id]` | `src/pages/api/sessions/[id].ts:36-90` | `!locals.user` → 401 | RLS pre-`select("id").maybeSingle()` → `error`→500, `!data`→404; **PLUS `.eq("user_id", locals.user.id)` on the admin delete** + `sessions_delete_own` policy | user (RLS) | **admin + explicit `user_id` filter** |
| `POST /api/sessions/[id]/start` | `src/pages/api/sessions/[id]/start.ts:8-33` | `!locals.user` → 401 | RLS pre-`select("id, status").single()` → `!data` → 404 | user (RLS) | **admin, keyed by `params.id` only** |
| `POST /api/sessions/[id]/recommend` | `src/pages/api/sessions/[id]/recommend.ts:9-50` | `!locals.user` → 401 | RLS pre-`select("id, status").single()` → `if (error)` → 404 | user (RLS) | — (LLM call only) |
| `POST /api/sessions/[id]/results` | `src/pages/api/sessions/[id]/results.ts:10-67` | `!locals.user` → 401 | RLS pre-`select("id, status").single()` → `!data` → 404 | user (RLS) | **admin, keyed by `params.id` only** |
| `POST /api/analyze` (vision LLM) | `src/pages/api/analyze.ts:8-31` | `!locals.user` → 401 | **NONE — not session-scoped** | — | — (LLM call only) |
| `GET /sessions` (history list) | `src/pages/sessions/index.astro:10-27` | middleware (`/sessions` in `PROTECTED_ROUTES`) | RLS only — `.select().order()`, **no `.eq("user_id")`** | user (RLS) | — |
| `GET /sessions/[id]` (results page) | `src/pages/sessions/[id].astro:10-39` | middleware | RLS only — `.eq("id", id).single()`, **no `.eq("user_id")`** | user (RLS) | — |

**Middleware** (`src/middleware.ts:4,18`): `PROTECTED_ROUTES = ["/dashboard", "/sessions"]`
matched with `startsWith`, so `/api/*` is **not** middleware-guarded — every API route
self-checks `context.locals.user` as its first statement.

**The two Supabase clients:**
- `createClient(headers, cookies)` — `src/lib/supabase.ts:5-24`, `@supabase/ssr`
  `createServerClient`, anon key, cookie-bound, **RLS-enforced**. Returns `null` if
  `SUPABASE_URL` / `SUPABASE_KEY` unset (both `optional: true` in `astro.config.mjs:19-20`) →
  routes 503.
- `createAdminClient()` — `src/lib/services/supabase-admin.ts:4-14`, `@supabase/supabase-js`,
  `SUPABASE_SERVICE_ROLE_KEY` (required secret), `BYPASSRLS`. Throws if `SUPABASE_URL` unset.

**RLS as deployed** (`supabase/migrations/20260526120000_initial_schema.sql` +
`20260902201711_add_sessions_delete_own_policy.sql`):

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `fitting_sessions` | `sessions_select_own` — `auth.uid() = user_id` | `sessions_insert_own` — `WITH CHECK (auth.uid() = user_id)` (**dead code** — see §3) | none | `sessions_delete_own` — `auth.uid() = user_id` (**inert** — route uses admin client) |
| `analysis_results` | `results_select_own` — correlated `EXISTS` on parent `user_id` | none | none | none (cascade from parent) |

Both tables `ENABLE` + `FORCE ROW LEVEL SECURITY`. `service_role` bypasses all of it.

### 2. Risk #2 — the OpenRouter response boundary

**All of it is `src/lib/services/llm.ts` (167 lines, two exported async functions).** No other
file calls OpenRouter. Both functions are `fetch` → check `response.ok` → `response.json()` →
dig out `choices[0].message.content` → `JSON.parse` → shape-check.

#### 2a. `analyzeVideo(videoBase64)` — vision / keyframe detection

- Model `google/gemini-3.5-flash` (`llm.ts:5`). *(Historical note: flagged as non-existent in
  archived impl-review F2, DISMISSED on the user's assertion. Not this phase's concern.)*
- `response_format` (`llm.ts:51-77`): `type: "json_schema"`, `json_schema.name: "body_angles"`
  *(misnomer — the schema is `timestamps`)*, **`strict: true`**, full nested schema with
  `enum: ["BDC", "TDC"]` on `type` and `additionalProperties: false`. OpenRouter enforces this
  server-side **for models that support structured outputs**; for models that don't it silently
  degrades to best-effort.
- Boundary handling (`llm.ts:81-103`):
  - `!response.ok` → `throw new Error(\`OpenRouter vision request failed: ${response.status} ${await response.text()}\`)` — **full upstream body in the message**.
  - `data.choices?.[0]?.message?.content` falsy → `throw new Error("OpenRouter returned no content for vision request")`.
  - `JSON.parse(content)` in try/catch → `throw new Error(\`Vision LLM returned invalid JSON: ${content}\`)` — **no markdown-fence stripping**; a fenced body dies here.
  - `!Array.isArray(result.timestamps)` → `throw new Error(\`Vision LLM response missing timestamps array: ${content}\`)`.
  - **then `return { timestamps: result.timestamps as { t: number; type: "BDC" | "TDC" }[] }`** — no per-item check. An item `{t: "soon", type: "MIDDLE"}` passes straight through.
- Downstream: `VideoAnalyzer.tsx:180-184` reads `data.timestamps ?? []`, throws
  "No keyframes detected…" if empty, then `for (const { t, type } of timestamps)` — a bad
  `type` string is neither `"BDC"` nor `"TDC"` so `pickExtremumFrame` is called with it and
  the frame is silently never assigned; a non-numeric `t` produces `NaN` seeks.

#### 2b. `generateRecommendations(angles)` — text / fitting advice

- Model `google/gemini-2.5-flash` (`llm.ts:6`).
- `response_format: { type: "json_object" }` (`llm.ts:123`) — **no schema.** The system
  prompt (`src/lib/recommendations-prompt.ts:58-64`) instructs: *"Return ONLY a valid JSON
  object (no markdown, no extra text) in this exact format…"*. Compliance is the model's
  problem.
- Boundary handling (`llm.ts:137-160`): same five checks as 2a, plus
  `typeof result.raw_llm_response !== "string"` → throw. Then
  `return { recommendations: result.recommendations as Recommendation[], raw_llm_response }` —
  **no per-item `{adjustment, rationale}` check.**
- `anglesText` (`llm.ts:109-113`) formats the client-supplied `body_angles` into the user
  message — including the client-authored `reference_min`/`reference_max` (Risk #1 lineage;
  not Phase 2's target, but the prompt trusts them).

#### 2c. What the browser does with a route 4xx/5xx

`VideoAnalyzer.tsx` wraps every fetch. On `!res.ok` it `throw new Error(\`Server returned HTTP
${res.status}\`)` — **it never reads the error body**, so the verbose upstream text from §2a
is logged server-side (Cloudflare observability) but not shown to the user. The `catch` for
steps 1, 4, 5, 6 calls `postError(step, msg)` which POSTs `{error: true, error_message}` to
`/results` → session `failed`. **Step 7 (`/results` submit) is the exception** — its catch
sets local error state only, no `postError` (it can't — `/results` is the endpoint that just
failed). See Risk #6.

#### 2d. Route-level wrapping

- `POST /api/analyze` (`analyze.ts:25-30`): `try { analyzeVideo() } catch (err) → Response.json({ error: err.message ?? "LLM call failed" }, { status: 500 })` — **upstream error text reaches a direct caller**.
- `POST /api/sessions/[id]/recommend` (`recommend.ts:44-49`): identical pattern.
- `POST /api/sessions/[id]/results` (`results.ts:22-25`): `resultsPayloadSchema.safeParse` →
  400 `{ error: "Invalid payload", details: z.treeifyError(...) }` on failure. **This is the
  one place per-item shape is enforced** (`recommendationSchema`, `bodyAngleSchema`). The
  success `INSERT` checks `insertError` → 500; the subsequent `UPDATE status='completed'` is
  **not checked** (`results.ts:58`). The `failed`-branch `UPDATE` is also unchecked
  (`results.ts:60-63`).

#### 2e. Risk #2 — what a test must assert (from test-plan §2 guidance)

> A drifted, truncated, markdown-fenced, or wrong-shape OpenRouter response produces a typed,
> plain-language failure — never a crash, never a partial DB write.

Corpus the contract test needs (mock OpenRouter **at the HTTP edge** — `undici` `MockAgent` or
MSW, per §4): `!ok` (429/500/403/451), 200 + empty body, 200 + `{choices:[]}`, 200 +
`content: "```json\n{...}\n```"`, 200 + truncated JSON, 200 + `{timestamps: "nope"}`, 200 +
`{timestamps: [{t:1,type:"MIDDLE"}]}` (bad enum), 200 + `{recommendations: [{foo:1}]}`
(bad item shape → passes `generateRecommendations`, rejected later by `resultsPayloadSchema`).
Assert: typed `Error` / route status, **no `analysis_results` row written**, and — the gap —
what happens to session status on each (today: `failed` for steps 1/4/5/6, **stuck
`processing`** for a Step-7 schema reject).

### 3. Risk #5 — session-route ownership

#### 3a. The pattern and its single point of failure

Established in F-02 (`context/archive/2026-05-31-async-job-pipeline/plan.md:61-65`): *"use the
cookie-based (RLS) client to SELECT the session first — RLS returns nothing if the session
belongs to another user, so a missing row doubles as a 404 and an ownership guard. Only then
use the admin client for the write."*

For `start.ts` and `results.ts` the admin write is
`admin.from("fitting_sessions").update(...).eq("id", context.params.id)` — **keyed on the path
param only.** If the RLS pre-`SELECT` were refactored away, reordered, or if
`sessions_select_own` ever failed open, a cross-user write would land. The pre-check is
**load-bearing and undefended-in-depth** for those two routes. `results.ts` has a second
partial guard — `status !== 'processing'` → 409 — which narrows but does not close the window
(both users' sessions pass through `processing`).

`DELETE [id]` (shipped 2026-09-02) is the counter-example and the template Phase 2 should
generalise: RLS pre-check **and** `.eq("user_id", context.locals.user.id)` on the admin
`.delete()` **and** a `sessions_delete_own` policy (inert, defense-in-depth).

#### 3b. Why RLS-write-policy-only is not trusted — archived Deviation 3

`context/archive/2026-05-28-ai-analysis-pipeline/plan.md:490-498`: `sessions_insert_own` (the
`WITH CHECK` INSERT policy) *"was preventing the insert from completing correctly in the SSR
context — the authenticated user's JWT was not being propagated to the Supabase client as
expected, causing the RLS check to fail even for valid authenticated requests."* → `POST
/api/sessions` switched to `createAdminClient()` with server-set `user_id`;
`sessions_insert_own` is now dead code.

**The RLS `SELECT` policy demonstrably works** — every read path (both SSR pages, all five
route pre-checks) depends on it and the app functions. The RLS **write** path has a track
record of silent failure. `delete-session` impl-review F2 names `auth.uid()` / JWT-claim
behaviour as *"the known soft spot"* and flags that the non-owner→404 path was only ever
verified against local Supabase, never a hosted multi-account project.

#### 3c. `POST /api/analyze` is not session-scoped

`analyze.ts` checks `locals.user` and nothing else — no `sessionId` in the request
(`analyzeRequestSchema` is `{ video: z.string().min(1).max(140_000_000) }`), no session lookup.
Any authenticated user can POST any ≤140 MB base64 blob and invoke the vision model. This is
the *"the vision route not scoped to an owned session"* clause of Risk #5 and the direct
lead-in to **Risk #3** (unprotected shared dependency) — which is Phase 3. Phase 2 should at
minimum **document** that `/analyze` carries no session binding, and decide whether binding it
to an owned `processing` session is Phase 2 (ownership) or Phase 3 (abuse) work (Open
Questions #3).

#### 3d. Risk #5 — what a test must assert (test-plan §2 guidance)

> A second user receives 404 / empty / 403 for every route and page that addresses the first
> user's session or results — reads *and* writes.

Two distinct real user fixtures. For **each** of `GET [id]`, `DELETE [id]`, `POST [id]/start`,
`POST [id]/recommend`, `POST [id]/results`, `GET /sessions/[id]` (page), `GET /sessions`
(page): user B addressing user A's session → 404 / empty, **and** user A's row/status
unchanged afterward. The anti-pattern §2 calls out: *"testing only that an anonymous request
is blocked; trusting RLS without exercising a cross-user request against it."* → the test
**must** run a real cross-user request against deployed RLS. Tension with §4 ("CI should not
depend on the local Supabase stack; use a thin client stub") — a stub cannot prove RLS. See
Open Questions #2.

### 4. Risk #6 — stuck `processing`

#### 4a. Status lifecycle — who writes each transition

| Transition | Written by | Checked? |
|---|---|---|
| → `queued` | `POST /api/sessions` insert (`index.ts:31-36`) | insert error → 500 |
| `queued` → `processing` | `POST /api/sessions/[id]/start` admin update (`start.ts:30`) | **not checked** — `await admin...update(...)` result discarded |
| `processing` → `completed` | `POST /api/sessions/[id]/results` success branch (`results.ts:58`) | `INSERT` checked (→500); the `UPDATE` itself **not checked** |
| `processing` → `failed` | `POST /api/sessions/[id]/results` error branch (`results.ts:60-63`) | **not checked** |

`start.ts:25` gates on `status === 'queued'` (else 409). `results.ts:39` and `recommend.ts:28`
gate on `status === 'processing'` (else 409). So a session that reaches `processing` and never
gets a `/results` call is **terminal-state-unreachable** through the normal flow — `/start`
won't re-run it, and `postError` → `/results` needs it to still be `processing` (which it is)
but there is no UI that offers "retry".

#### 4b. There is no server-side reaper

- `wrangler.jsonc` — no `triggers` / `crons` block; bindings are `ASSETS` + `observability` only.
- `astro.config.mjs` — no scheduled handler.
- `supabase/` — no `pg_cron`, no Edge Function, no migration adding a sweep. Only two
  migrations exist (initial schema + the delete policy).
- Grep for `cron|scheduled|queue|sweep|stale|reap|orphan|timeout|setInterval|ttl` across
  `src/` + `supabase/` + config → only the `SessionStatus` union, the `'queued'` literals, and
  Supabase's own `config.toml` health timeouts.
- `fitting_sessions.updated_at` **is** maintained (a `BEFORE UPDATE` trigger,
  `initial_schema.sql:26-29`) and **is** exposed by `GET /api/sessions/[id]` — so the raw
  material for a staleness check exists, but nothing consumes it.

#### 4c. Four ways a session sticks

1. **Tab closes after `/start`, before `/results`.** The documented, accepted case
   (`context/archive/2026-05-28-ai-analysis-pipeline/plan.md:74` — `/start` is deliberately
   first *"so the failure path… can always run"*, which only helps if the tab stays open).
   The client-side pipeline runs minutes of CPU pose detection — ample window.
2. **`/results` returns non-OK and the browser is still alive.** `VideoAnalyzer.tsx:314-320`
   Step 7: `if (!res.ok) throw` → catch sets `errorMessage` + `onError(msg)` but calls **no
   `postError`**. A 400 (schema reject — see §2d), 409, or 500 here → session stays
   `processing`, user sees "Analysis failed" locally, DB and every other device disagree.
3. **`postError()` can't land.** `postError` (`VideoAnalyzer.tsx:99-112`) POSTs `{error:true,
   error_message}` to `/results`, which 409s unless `status === 'processing'`. If `/start`'s
   unchecked `UPDATE` silently failed, status is still `queued` → the error report 409s → the
   `catch` in `postError` swallows it → session stuck `queued`, user sees a local error.
4. **Non-atomic success write** (`results.ts:47-58`): `INSERT analysis_results` succeeds →
   `UPDATE status='completed'` fails (transient) → **`processing` forever + orphan results
   row**. Archived async-job plan-review F2, ACCEPTED as MVP-acceptable.

#### 4d. What the UI shows for a long-lived `processing`

- `src/pages/sessions/[id].astro:101-108`: `queued || processing` → *"Still processing — check
  back soon."* Indefinitely. No timestamp, no "this looks stuck", no retry.
- `src/pages/sessions/index.astro:70,81` via `SESSION_STATUS_META.processing` → blue
  "Processing" pill. Indefinitely.
- Dashboard: **no polling.** The dead polling machinery in `VideoUpload.tsx` was removed in
  `23c0413` (`context/changes/testing-angle-correctness/plan.md` Addendum). `VideoAnalyzer`
  now runs the pipeline inline and calls `onComplete`/`onError` directly; `GET
  /api/sessions/[id]` has **no caller in the current codebase** (grep: only the route
  definition).

#### 4e. Risk #6 — what a test must assert (test-plan §2 guidance)

> A session with no client progress for longer than a defined interval reaches a terminal
> `failed` state with a readable message; the results page and history never show a
> permanently stuck `processing`.

This assertion **cannot pass against current code** — there is no interval, no sweep, no
terminal transition without the browser. Phase 2 must either (a) build a minimal server-side
staleness→`failed` transition (feature work) and test it, or (b) restate the assertion to what
*is* testable now (the UI state-mapping for a `processing` session; the Step-7 / `postError`
gaps in items 2–3 above, which *are* client-fixable) and defer the reaper. See Open Questions
#1. The `unit (UI state mapping)` half of §2's "likely cheapest layer" is doable today; the
`integration (status lifecycle)` half needs the mechanism to exist.

### 5. Risk #7 — DB errors rendered as "absent"

Every `.from(...)` read site and how it treats `error`:

| Site | Code | Query error → | Verdict |
|---|---|---|---|
| `GET /api/sessions/[id]` | `[id].ts:18-26` — `const { data } = …` | `!data` → 404 | **swallows `error`** |
| `DELETE [id]` pre-check | `[id].ts:52-63` — `const { data, error } = … .maybeSingle()` | `error` → 500; `!data` → 404 | **fixed** (delete-session review F3) |
| `POST [id]/start` | `start.ts:18-20` — `const { data } = …` | `!data` → 404 | **swallows `error`** |
| `POST [id]/recommend` | `recommend.ts:19-27` — `const { data: session, error } = …` | `if (error)` → **404** | conflates error with 404 (archived F6 "fixed" — but as 404, not 500) |
| `POST [id]/results` pre-check | `results.ts:32-34` — `const { data } = …` | `!data` → 404 | **swallows `error`** |
| `GET /sessions` (page) | `index.astro:17-26` — `const { data, error } = …` | `error` → status 500 + "Couldn't load your sessions" | **fixed** (S-04 review F1) |
| `GET /sessions/[id]` (page) — session | `[id].astro:15-23` — `const { data: sessionData } = …` | `!sessionData` → 404 | **swallows `error`** (S-03 review F2, SKIPPED) |
| `GET /sessions/[id]` (page) — results | `[id].astro:33-38` — `const { data: resultsData } = …` | `results = null` → **no branch matches → blank card** | **swallows `error`** — worst instance |

**The blank-card path** (`[id].astro:32-39`, `54-117`): for a `completed` session the page
queries `analysis_results`; if that query *errors*, `resultsData` is `null`, `results` stays
`null`, so `session.status === "completed" && results` is false — and the `queued|processing`
and `failed` branches don't match either. The user gets the outer card chrome (border,
back-link) and **nothing inside**. This is precisely S-03 impl-review F2, filed as OBSERVATION
/ SKIPPED ("matches existing project-wide convention") and never fixed.

**The `completed` ⟹ results-row invariant:** `results.ts` inserts `analysis_results` and
checks `insertError` *before* flipping status to `completed`, so a `completed` session with no
results row only happens via the non-atomic-write failure (§4c item 4) or manual DB edits. So
Risk #7's practical trigger on the results page is a **query error**, not genuine row absence —
which is exactly what the current code cannot distinguish.

#### 5a. Risk #7 — what a test must assert (test-plan §2 guidance)

> When a Supabase query returns an error, the user sees a distinct error state (a 500 or a
> "couldn't load" message), never an empty list or a 404.

Per site: inject a query error (Supabase client stub returning `{ data: null, error: {...} }`)
→ assert 500 / distinct message, **not** 404 / empty / blank. §2's anti-pattern: *"asserting
the current `data ?? []` fallthrough; mocking Supabase so it can only ever succeed."* The stub
must be able to return an error. Cheapest layer: unit on the error branch where one can be
extracted; integration on the route/page otherwise.

### 6. Secrets & `raw_llm_response` leakage check (test-plan §2 asked)

- **`OPENROUTER_API_KEY`** (`llm.ts:1,27,118`) — used only as `Authorization: Bearer …`
  header. Never in a request body, URL, query string, or thrown message. `await
  response.text()` on an upstream error returns OpenRouter's error JSON, which does not
  contain the caller's key. **No key-leak surface.**
- **`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_KEY`** — only passed to the client constructors;
  never logged or returned.
- **`raw_llm_response`** — persisted to `analysis_results.raw_llm_response` (TEXT). **Not
  rendered**: `src/pages/sessions/[id].astro` renders `recommendations` and `body_angles`
  only. `GET /api/sessions/[id]` returns `status, updated_at, error_message` only. So even
  though it is stored "for pipeline debugging" (`initial_schema.sql:56`), it is not on any
  user-facing path.
- **`error_message`** (persisted, and rendered on the results page `[id].astro:114` for
  `failed` sessions): built by `VideoAnalyzer.postError` as `\`${step}: ${detail}\`` where
  `detail` is almost always the generic `\`Server returned HTTP ${res.status}\`` (the browser
  never reads route error bodies — §2c). So the *persisted, user-visible* error text is
  generic. The **verbose** upstream text (`OpenRouter … failed: 429 {…}`, `Vision LLM returned
  invalid JSON: <raw content>`) is confined to the route's 500 JSON response body and
  Cloudflare logs — visible to a **direct API caller** but not surfaced in the app UI.
  Worth a hardening note (route error responses should be generic; detail to logs only) —
  arguably Phase 3 (abuse) rather than Phase 2.

### 7. Test-harness reality — what Phase 2 builds from zero

**What exists** (`context/changes/testing-angle-correctness/`, shipped):
- `vitest.config.ts` — plain `defineConfig` from `vitest/config` (**not** `getViteConfig`),
  re-declares only the `@/*` alias, `environment: "node"`, `include:
  ["src/**/*.{test,spec}.ts"]`. No Astro plugin chain, no `astro:env`, no DOM.
- `npm test` → `vitest run`; `npm run test:watch` → `vitest`. **No `pretest`** — nothing in
  the current test graph imports `astro:env` (`rm -rf .astro && npm test` is green).
- Vitest `4.1.11` is the installed version (§4's stack table still says "none yet").
- Cookbook §6.1 (pure logic) is the only filled pattern. Worked examples:
  `src/lib/pose/angles.test.ts`, `src/lib/angle-verdict.test.ts`,
  `src/lib/recommendations-prompt.test.ts`, `src/lib/format-angle.test.ts`. All use explicit
  `import { describe, it, expect } from "vitest"` (no `globals`).
- eslint `strictTypeChecked` + `projectService` type-checks test files too — they must be
  lint-clean under the strict config.

**What Phase 2 must add** (all currently `TBD — see §3 Phase 2` — cookbook §6.2, §6.3, §6.4):
1. **`astro:env` test setup.** Every route module transitively imports `astro:env/server`
   (`createClient` → `SUPABASE_URL/KEY`; `createAdminClient` → `SUPABASE_SERVICE_ROLE_KEY`;
   `llm.ts` → `OPENROUTER_API_KEY`). `SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` are
   **`access: "secret"` required** — importing any route module in a test **throws at import
   time** unless the vars are set. Options: a Vitest `setupFiles` that sets `process.env`
   before import + `getViteConfig` (drags the Cloudflare adapter — the reason Phase 1 avoided
   it), or a Vitest alias that stubs the `astro:env/server` virtual module. §6.6 already flags
   this hazard; Phase 2 resolves it. This likely forces the `getViteConfig`-vs-plain-config
   decision §4 and Phase 1's Key Discoveries left open, and a `/10x-test-plan --refresh` on §4.
2. **OpenRouter HTTP-edge mock.** `undici` `MockAgent` (`setGlobalDispatcher`) or MSW,
   intercepting `https://openrouter.ai/api/v1/chat/completions`. §4 and §1 principle #1: mock
   at the **network edge only**, never stub `analyzeVideo`/`generateRecommendations`
   themselves.
3. **Supabase client stub** for the Risk #7 error-branch tests and the non-RLS route logic —
   a thin fake returning `{ data, error }` shapes. §4: *"the local Supabase stack has been
   unreliable in this environment… CI should not depend on it."*
4. **Two-user ownership fixtures for Risk #5** — the one place a stub is insufficient
   (a stub cannot prove `sessions_select_own`). The precedent
   (`session-history-list` review F2, `delete-session`): seed via the Supabase **Auth admin
   API**, sign in through the real `/api/auth/signin` for real cookies, drive `curl`/`fetch`
   against a running dev server. This is an **integration/e2e-shaped** test, not a Vitest unit
   — it may belong with the Phase 4 Playwright work, or as a a tagged integration suite that
   CI runs only when a hosted project is configured. See Open Questions #2.
5. **How a route handler is exercised** — Astro `APIRoute` handlers take a `context` object
   (`locals`, `request`, `cookies`, `params`). No existing pattern; Phase 2 establishes
   whether to call the exported `POST`/`GET` with a hand-built context or to run the built
   worker. Context7 (Astro testing docs) is the grounding tool per §4.

## Code References

Permalink base: `https://github.com/mjedrasz/bikefit/blob/44438a16968e7b29fd04f453dc2da8df4029e206/`

**Risk #2 — LLM boundary**
- `src/lib/services/llm.ts:23-104` — `analyzeVideo()`; `:51-77` strict `json_schema`; `:81-103` boundary checks; `:103` unchecked `as` cast of items
- `src/lib/services/llm.ts:106-166` — `generateRecommendations()`; `:123` `json_object` (no schema); `:154-160` checks; `:163` unchecked `as Recommendation[]`
- `src/lib/recommendations-prompt.ts:58-72` — "Return ONLY a valid JSON object (no markdown…)" prompt instruction
- `src/lib/schemas.ts:29-40` — `resultsPayloadSchema` (the only per-item shape enforcement, at final submit)
- `src/pages/api/analyze.ts:25-30`, `src/pages/api/sessions/[id]/recommend.ts:44-49` — `catch → 500 { error: err.message }` (upstream text passthrough)
- `src/components/VideoAnalyzer.tsx:174-190` (`/analyze` call), `:291-304` (`/recommend`), `:307-320` (`/results` — no `postError`)

**Risk #5 — ownership**
- `src/pages/api/sessions/[id]/start.ts:18,30` — RLS pre-check + admin update keyed by `params.id` only
- `src/pages/api/sessions/[id]/results.ts:32,43-64` — same; non-atomic success write; unchecked status UPDATEs
- `src/pages/api/sessions/[id].ts:52-75` — `DELETE` — the hardened pattern (pre-check `error`→500 + `.eq("user_id")` + policy)
- `src/pages/api/analyze.ts:8-12` — auth-only, no session scope
- `src/lib/supabase.ts:5-24` (RLS client), `src/lib/services/supabase-admin.ts:4-14` (admin client)
- `supabase/migrations/20260526120000_initial_schema.sql:31-46,60-76` — RLS enable/force + policies; `:44-46` "No UPDATE or DELETE policy" comment
- `supabase/migrations/20260902201711_add_sessions_delete_own_policy.sql` — `sessions_delete_own` (shipped inert)
- `src/middleware.ts:4,18` — `PROTECTED_ROUTES` does not cover `/api/*`
- `src/pages/sessions/index.astro:17-20`, `src/pages/sessions/[id].astro:15-19` — pages read via RLS only, no `user_id` filter

**Risk #6 — stuck processing**
- `src/pages/api/sessions/[id]/start.ts:29-30` — unchecked `queued → processing` admin update
- `src/pages/api/sessions/[id]/results.ts:47-64` — the only terminal-state writes; `:58` unchecked
- `src/components/VideoAnalyzer.tsx:99-112` — `postError()` POSTs to `/results` (needs `status === 'processing'`)
- `src/components/VideoAnalyzer.tsx:307-320` — Step 7 catch: local error only, no `postError`
- `src/pages/sessions/[id].astro:101-108` — "Still processing — check back soon." (no TTL)
- `src/pages/sessions/index.astro:70,81` + `src/lib/session-status.ts:12-15` — "Processing" pill
- `src/pages/api/sessions/[id].ts:8-34` — `GET` status poll (currently **no caller**)
- `wrangler.jsonc` (whole file) — no `triggers`/`crons`
- `supabase/migrations/20260526120000_initial_schema.sql:26-29` — `updated_at` trigger (maintained, unused for staleness)

**Risk #7 — error-as-absent**
- `src/pages/api/sessions/[id].ts:18-26` (GET), `src/pages/api/sessions/[id]/start.ts:18-20`, `src/pages/api/sessions/[id]/results.ts:32-34` — `const { data } = …`, no `error`
- `src/pages/api/sessions/[id]/recommend.ts:25-27` — `if (error) → 404` (not 500)
- `src/pages/sessions/[id].astro:15-23` (session), `:33-38` (results — blank-card path)
- `src/pages/sessions/index.astro:21-26` — the fixed pattern to copy (500 + distinct message)
- `src/pages/api/sessions/[id].ts:57-63` — the fixed pattern for a route (`error`→500, `!data`→404)

**Harness**
- `vitest.config.ts` (whole file), `package.json:9-10` (test scripts, no `pretest`), `package.json` devDeps (`vitest: 4.1.11`)
- `astro.config.mjs:17-24` — env schema; `SUPABASE_URL/KEY` `optional`, `SERVICE_ROLE_KEY`/`OPENROUTER_API_KEY` required secret
- `.github/workflows/ci.yml:18-24` — CI runs `npm ci` → `astro sync` → `lint` → `build` (no test, no typecheck)
- `src/lib/recommendations-prompt.test.ts`, `src/lib/angle-verdict.test.ts` — the established spec idiom

## Architecture Insights

- **The correctness/robustness boundary is a handful of route handlers and one LLM service
  file.** No service layer for sessions (every query is inline in the handler), no ORM, no
  repository. A route test is a handler test.
- **"Ownership" is one RLS SELECT policy doing all the work.** `sessions_select_own` (and its
  `analysis_results` correlate) is the only mechanism that actually enforces cross-user
  isolation on 7 of 9 surfaces. RLS write policies are deliberately absent / inert; the admin
  client bypasses everything. The system's isolation guarantee is exactly as strong as that
  one policy plus each route's discipline in running the pre-check before the admin write.
- **The session status machine has no server-side authority.** Every transition is written by
  a route in response to a browser call, none of the writes are checked for success, and there
  is no reconciler. "Processing" means "a browser said /start and hasn't said /results yet" —
  it does not mean work is happening.
- **Error handling degrades toward "absent" by convention.** `const { data } = …` then
  `!data → 404/empty` is the repo's default; it has been fixed reactively, one surface at a
  time, each time a review caught it. Phase 2 is the chance to make "distinct error state" the
  default and pin it.
- **Two `response_format` regimes.** Vision uses server-enforced `strict` JSON schema; text
  uses prompt-instructed `json_object`. The text path is the more fragile and the one whose
  output feeds user-visible recommendations.
- **The final Zod re-validation at `/results` is a real safety net** — but it converts an LLM
  shape drift into a 400 that the browser mishandles into a stuck session. Fixing the browser
  Step-7 path (call `postError` on a `/results` non-OK, or make `postError` resilient to a
  non-`processing` status) is small and closes a Risk #2 × Risk #6 intersection.

## Historical Context (from prior changes)

- `context/archive/2026-05-31-async-job-pipeline/plan.md:61-65` — origin of the "RLS SELECT to
  prove ownership, then admin write" pattern; `reviews/plan-review.md` F2 (**ACCEPTED**) — the
  non-atomic INSERT-then-UPDATE in `/results` can orphan a `processing` session.
- `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:74` — `/start` deliberately first
  "so the failure path can always run" (only true while the tab is open); `:490-498`
  **Deviation 3** — `sessions_insert_own` RLS failed in SSR (JWT not propagated), INSERT moved
  to admin client. `reviews/impl-review.md` F1/F2/F3 (criticals/warnings in `llm.ts` — dead
  import, model name, orphaned schema fields), F5 (added the `140_000_000` video cap), F6
  (`/recommend` query error masked as 404 — "fixed" as 404, not 500), F9 (SyntaxError leaked
  in `/analyze` response — fixed).
- `context/archive/2026-06-04-video-upload-and-status/reviews/plan-review.md:55-63` — a failed
  status poll "silently leaves the user staring at a `queued` card forever"; the polling loop
  it discussed was later removed entirely (`23c0413`).
- `context/archive/2026-08-23-fitting-results-display/reviews/impl-review.md` F2
  (**SKIPPED**) — `sessions/[id].astro` folds query errors into 404 / blank card; "matches
  existing project-wide convention."
- `context/archive/2026-08-23-session-history-list/reviews/impl-review.md` F1 (**FIXED**) —
  the list page's swallowed error → false "no sessions" empty state; F2 — local Supabase stack
  unhealthy in-sandbox, verification done via Auth admin API + real signin cookies.
- `context/archive/2026-09-02-delete-session/` — `research.md` §2 (the RLS gap + mixed-client
  pattern, Risk #5 framing), `plan.md` (shipped the hardened DELETE: pre-check + `.eq("user_id")`
  + `sessions_delete_own`); `reviews/impl-review.md` F2 (Risk #5 verification downgraded to
  local Supabase — the exact tension Phase 2 inherits), F3 (pre-check `error`→500 split).
  `plan.md:430-435` explicitly **defers** the two-user integration test and cookbook §6.2 to
  "test-rollout Phase 2" — i.e. this change.
- `context/changes/testing-angle-correctness/` — Phase 1: stood up Vitest (`environment:
  "node"`, pure logic), filled cookbook §6.1, documented the `astro:env` import hazard
  (`plan.md` Key Discoveries + test-plan §6.6). `plan.md` Addendum — the dead polling
  machinery removed from `VideoUpload.tsx`.
- `context/foundation/test-plan.md` §2 (per-risk "what would prove protection" / "must
  challenge" / "likely cheapest layer"), §3 Phase 2 row, §4 (stack — MSW/undici, Supabase
  stub, "CI should not depend on local Supabase"), §6.2–§6.4 (the cookbook entries this phase
  fills), §7 (exclusions: LLM prose wording, e2e determinism, hand-crafted own-session
  payloads).

## Related Research

- `context/changes/testing-angle-correctness/research.md` — Phase 1; §9 ("server would catch a
  bad result — it does not"), §1 (the browser-orchestrator architecture), the route table in
  its §9 (schema validation per route).
- `context/archive/2026-09-02-delete-session/research.md` — the definitive prior treatment of
  Risk #5 / the RLS gap / the mixed-client mutation pattern; §7 (testing context) anticipates
  this phase.
- `context/archive/2026-05-28-ai-analysis-pipeline/research.md` — pipeline architecture
  decision (browser-side, external LLMs, no server worker).

## Open Questions

1. **Risk #6 — does Phase 2 build a server-side staleness→`failed` mechanism, or only test
   what exists?** The Phase 2 goal line says "drive stuck-`processing` sessions to a terminal
   state," but §3's own note says "All other phases [besides Phase 3] are test-only against
   behavior that already exists" — and **no reaper exists**. Options: **(a)** Phase 2 adds a
   minimal mechanism — e.g. `GET /sessions` / the results page treats a `processing` session
   older than N minutes (via `updated_at`) as `failed` for display, or a lightweight
   `POST`-on-page-load "mark stale sessions failed" using the admin client, or a Supabase
   `pg_cron` job — and tests it (this is feature work, like Phase 3's rate-limiting); **(b)**
   Phase 2 tests only the *client-fixable* gaps (Step-7 calls `postError`; `postError` resilient
   to non-`processing` status) plus the UI state-mapping unit, and a new stub change tracks the
   reaper; **(c)** owner decides the interval and mechanism now. **Recommend (a) with the
   display-time staleness rule** — it is the cheapest real terminal state, needs no new
   infra, and `updated_at` is already there. Flag to `/10x-plan` and the orchestrator that
   this stretches Phase 2 past "test-only."

2. **Risk #5 — how is the cross-user assertion run in CI?** §2 demands a real cross-user
   request against deployed RLS; §4 says CI must not depend on local Supabase. Options:
   **(a)** a tagged integration suite (`*.integration.test.ts`) that runs only when
   `SUPABASE_URL` + two seeded test accounts are configured (hosted dev project), skipped
   otherwise — CI wires it as an optional gate; **(b)** fold the two-user ownership check into
   the Phase 4 Playwright e2e (seed via Auth admin API, as `session-history-list` did);
   **(c)** accept a Supabase-stub "logic" test for the pre-check *ordering* (assert the handler
   calls `select` before the admin `update` and returns 404 when `select` yields no row) as the
   CI gate, and keep the real-RLS cross-user test as a documented manual/pre-release step.
   **Recommend (a)** for the routes + **(c)** as the always-on CI floor. Needs an owner
   decision on whether a hosted dev Supabase project is available (the `delete-session` review
   could not confirm one).

3. **Is binding `POST /api/analyze` to an owned `processing` session Phase 2 or Phase 3?**
   It is named in **both** Risk #5 (ownership — "vision route not scoped to an owned session")
   and Risk #3 (abuse — Phase 3). The scoping change is small (add `sessionId` to the request,
   RLS pre-check like the sibling routes). **Recommend doing the session-binding in Phase 2**
   (it is an ownership fix and makes `/analyze` testable with the same two-user fixture) and
   leaving rate-limiting / payload caps / provider-error degradation to Phase 3.

4. **Route error-response verbosity** (`{ error: <upstream OpenRouter text> }` on 500 —
   §2d/§6). Generic-ify now (Phase 2, alongside the boundary work) or defer to Phase 3
   (abuse/hardening)? It is not surfaced in the app UI today, so low urgency. **Recommend a
   one-line fix in Phase 2** (return a fixed string, log the detail) since the boundary tests
   will be asserting on these responses anyway.

5. **`astro:env` in tests — stub the virtual module or set `process.env` + `getViteConfig`?**
   Phase 1 deliberately dodged this; Phase 2 can't. Stubbing `astro:env/server` via a Vitest
   alias keeps the fast plain-config setup; `getViteConfig` is "official" but drags the
   Cloudflare adapter. **Recommend the alias-stub**, decided in `/10x-plan` against current
   Astro 6 / Vitest 4 behaviour (Context7), and a `/10x-test-plan --refresh` note on §4's
   stack rows (still says "none yet" for Vitest and names `getViteConfig`).

6. **Does exercising a route handler mean calling the exported `POST`/`GET` with a synthetic
   `context`, or booting the built worker?** No precedent in the repo. Affects how much of
   `locals.user` / cookie plumbing the tests fake. Decide in `/10x-plan` (Context7: Astro
   endpoint testing).
