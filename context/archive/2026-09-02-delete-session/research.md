---
date: 2026-09-02T21:21:23+02:00
researcher: maro
git_commit: 02b81bc32245c39f71362b922a996d8ac61b25d3
branch: master
repository: bikefit
topic: "Delete session — data model, authorization, API-route and UI patterns for hard-deleting a user's own fitting session"
tags: [research, codebase, delete-session, rls, fitting-sessions, api-routes, session-history]
status: complete
last_updated: 2026-09-02
last_updated_by: maro
---

# Research: Delete session (S-06 / `delete-session`)

**Date**: 2026-09-02T21:21:23+02:00
**Researcher**: maro
**Git Commit**: 02b81bc32245c39f71362b922a996d8ac61b25d3
**Branch**: master
**Repository**: bikefit

## Research Question

How do we implement "a user can delete an individual historical fitting
session they own" (roadmap S-06, `context/foundation/roadmap.md:159-170`)?
Specifically: what a delete must remove, how ownership is enforced at the DB
and route layers, which existing patterns a `DELETE` route and a delete
control in the UI must follow, and what prior decisions constrain the design.

Scope confirmed with the user: individual **hard delete**, per-session action,
no bulk operation, ownership enforced (not just in the UI).

## Summary

**The feature is small and almost entirely an authorization problem.**

- **What a delete removes:** exactly one `fitting_sessions` row and its
  0-or-1 `analysis_results` child row. The child is removed automatically by
  `ON DELETE CASCADE` (`supabase/migrations/20260526120000_initial_schema.sql:53`).
  There are **no other child tables** (no job/queue/notification tables exist
  anywhere in the repo) and **no object-storage cleanup** — `video_r2_key` is
  dead schema, never populated, and there is no R2 binding in the project.
- **The one real risk is ownership** (test-plan Risk #5 / IDOR). Today there
  is **no `DELETE` RLS policy** on `fitting_sessions` (or `analysis_results`),
  and `FORCE ROW LEVEL SECURITY` is on — so a delete issued through the
  user-scoped (anon-key) client silently affects **zero rows**. A delete must
  go through either a new `sessions_delete_own` RLS policy **or** the
  established "RLS-scoped SELECT to prove ownership → `createAdminClient()`
  write" pattern. History says: don't trust an RLS write policy alone here —
  `sessions_insert_own` already failed in the SSR context because the user
  JWT was not propagated to the client (archived Deviation 3). The proven-safe
  path is **precheck-SELECT (works) + admin `.delete()` with an explicit
  `.eq("user_id", user.id)` (works)**; add the RLS policy as defense-in-depth
  and to honour the roadmap's "enforced by RLS" directive, but not as the sole
  mechanism.
- **Route:** add `export const DELETE` to the existing
  `src/pages/api/sessions/[id].ts`. Template to copy:
  `src/pages/api/sessions/[id]/start.ts`.
- **UI:** the history list (`src/pages/sessions/index.astro`) and the detail
  page (`src/pages/sessions/[id].astro`) are both pure SSR Astro with the row
  rendered as a single `<a>`. There are **no per-row actions today** and **no
  `Dialog`/`AlertDialog`/toast** in the codebase (`src/components/ui/` has only
  `button.tsx`). The row must be restructured either way; the cheapest fit is
  a small React island doing `fetch` + `useState` (mirroring `VideoUpload.tsx`)
  with an inline two-step confirm, or `npx shadcn@latest add alert-dialog`.

## Detailed Findings

### 1. Data model — what a delete must remove

Single migration in the repo:
`supabase/migrations/20260526120000_initial_schema.sql` (verified in full).

**`fitting_sessions`** (`:13-24`)
- Owner FK: `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` (`:15`)
- `status TEXT CHECK (status IN ('queued','processing','completed','failed'))` (`:16-17`)
- `video_r2_key TEXT` (`:18`) — **never written by any code path** (see §4)
- `set_updated_at` trigger is `BEFORE UPDATE` only (`:26-29`) — **no delete trigger**

**`analysis_results`** (`:51-58`)
- `session_id UUID NOT NULL REFERENCES fitting_sessions(id) ON DELETE CASCADE` (`:53`)
- No `user_id` column — ownership is derived by joining to `fitting_sessions`.
- No triggers.

**Cascade behaviour:** `DELETE FROM fitting_sessions WHERE id = :id` removes
the session **and** its `analysis_results` row automatically. No FK error, no
orphan rows, nothing else to touch. Grep of `.from("...")` across `src/`
returns only these two tables. No job-queue / notifications / audit table
exists.

**DB types:** hand-written in `src/types.ts` (`FittingSession` `:3-13`,
`AnalysisResult` `:28-35`). No generated `database.types.ts`; project
convention is manual types (`CLAUDE.md:11`,
`context/archive/2026-05-26-db-schema-and-privacy-design/plan.md:37`). The
delete route touches no payload schema, so **no `src/types.ts` or
`src/lib/schemas.ts` change is needed** (the session is addressed purely by
the `[id]` path param).

### 2. Authorization — the RLS gap and the mixed-client pattern

**Policies that exist** (`20260526120000_initial_schema.sql`):

| Table | Op | Role | Expression | Line |
|---|---|---|---|---|
| `fitting_sessions` | SELECT | `authenticated` | `USING (auth.uid() = user_id)` | `:34-37` |
| `fitting_sessions` | INSERT | `authenticated` | `WITH CHECK (auth.uid() = user_id)` | `:39-42` |
| `fitting_sessions` | **UPDATE / DELETE** | — | **none** | `:44-46` (comment) |
| `analysis_results` | SELECT | `authenticated` | correlated `EXISTS` on parent `user_id` | `:63-73` |
| `analysis_results` | INSERT / UPDATE / DELETE | — | **none** | `:75-76` (comment) |

Both tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` (`:31-32`, `:60-61`).
`service_role` has `BYPASSRLS`, so the pipeline writes need no policy — this
is deliberate (`context/archive/2026-05-26-db-schema-and-privacy-design/plan.md:21,29,320`).

**Consequence:** a `.delete()` through the user-scoped client
(`src/lib/supabase.ts`, anon key, RLS-enforced) matches **0 rows and returns
no error**. The feature cannot "just call `.delete()`".

**The established write pattern** (introduced in F-02,
`context/archive/2026-05-31-async-job-pipeline/plan.md:61-65`):
> "use the cookie-based (RLS) client to SELECT the session first — RLS
> returns nothing if the session belongs to another user, so a missing row
> from that SELECT doubles as a 404 and an ownership guard. Only then use the
> admin client for the write."

Shipped in `src/pages/api/sessions/[id]/start.ts` and `.../results.ts`:
RLS-client `.select("id, status").eq("id", params.id).single()` → `if (!data)
404` → `createAdminClient()` (`src/lib/services/supabase-admin.ts`,
`SUPABASE_SERVICE_ROLE_KEY`, RLS-bypassing) for the write, keyed by
`context.params.id` **with no `.eq("user_id")`**.

**Why not rely on a new RLS DELETE policy alone** — archived Deviation 3
(`context/archive/2026-05-28-ai-analysis-pipeline/plan.md:490-498`):
> "The RLS INSERT policy (`sessions_insert_own`) was preventing the insert
> from completing correctly in the SSR context — the authenticated user's JWT
> was not being propagated to the Supabase client as expected, causing the
> RLS check to fail even for valid authenticated requests."
> ⇒ `POST /api/sessions` was switched to `createAdminClient()` with
> `user_id` set from `context.locals.user.id`; `sessions_insert_own` is now
> effectively dead code.

The RLS **SELECT** policy demonstrably works (every read path depends on it).
The RLS **INSERT** policy did not. An RLS **DELETE** policy is untested. So:
- ✅ ownership pre-check via RLS `.select().single()` — proven
- ✅ delete via `createAdminClient().delete().eq("id", …).eq("user_id", …)` — proven primitive
- ⚠️ delete via user client relying on a new `sessions_delete_own` policy — same failure class as the insert; do not make it the only guard.

**This is test-plan Risk #5** (`context/foundation/test-plan.md:53,75`):
> "the ownership check erodes because routes verify 'is logged in' while
> mutations run through the service-role client keyed by a path parameter."

The new `DELETE` is the **highest-risk instance** of this pattern: destructive,
irreversible, cascading, and — unlike `start`/`results` — there is no status
guard forcing a narrow window. A "just delete it by `params.id`" handler that
skips the pre-check is a direct IDOR over enumerable UUIDs. Mitigation for
this route specifically: **keep the RLS pre-check AND add
`.eq("user_id", context.locals.user.id)` to the admin `.delete()`** — belt
and braces, which no existing admin write has.

Middleware note: `src/middleware.ts` `PROTECTED_ROUTES = ["/dashboard",
"/sessions"]` uses `startsWith`, so `/api/sessions/*` is **not** guarded — the
handler must self-check `context.locals.user` as its first statement (every
existing route does).

### 3. API route conventions the `DELETE` handler must follow

**Placement:** add `export const DELETE: APIRoute` to the existing
`src/pages/api/sessions/[id].ts` (already has `export const prerender = false`
and `export const GET`). No new file.

**Template:** `src/pages/api/sessions/[id]/start.ts` — the minimal mutating
route. Step-by-step for the delete:

1. `export const prerender = false` — already in the file (`[id].ts:5`).
2. `if (!context.locals.user) return new Response(null, { status: 401 })` —
   bare 401, matching `[id].ts:8-10` and `start.ts:9-11`.
3. `const supabase = createClient(context.request.headers, context.cookies)`;
   `if (!supabase) return new Response("Service unavailable", { status: 503 })`
   (`start.ts:13-16`).
4. **Ownership pre-check (load-bearing):**
   `const { data, error } = await supabase.from("fitting_sessions").select("id").eq("id", context.params.id).single()`;
   `if (error || !data) return new Response(null, { status: 404 })`.
   RLS `sessions_select_own` scopes this to the owner; another user's row →
   `!data` → 404 (no owner-enumeration leak — same as `[id].ts:23-25`).
   Destructuring `error` (not just `data`) is the Risk #7 fix already applied
   on the list page — do it here too rather than inherit the swallow.
5. *(Optional)* status guard — the roadmap does **not** require refusing to
   delete a `processing` session (`roadmap.md:168` allows hard delete of any
   status). Decide in planning; if added, use the `start.ts:25-27` 409 shape.
6. **Delete via admin client:**
   `const admin = createAdminClient()`;
   `const { error: deleteError } = await admin.from("fitting_sessions").delete().eq("id", context.params.id).eq("user_id", context.locals.user.id)`.
   `analysis_results` is removed by cascade.
7. `if (deleteError) return new Response(null, { status: 500 })`
   (`results.ts:54-56` pattern — a distinct error state, not a silent success).
8. `return Response.json({ ok: true })` — the established mutating-route
   success shape (`start.ts:32`, `results.ts:66`). `204 No Content` is also
   defensible; `{ ok: true }` matches siblings.

**Conventions confirmed across routes:**
- Error body: this file uses **bare `new Response(null, { status })`** — match
  it (do not switch to `{ error }` JSON, which other routes use).
- zod errors: `z.treeifyError(...)`, never `.flatten()`
  (`context/foundation/lessons.md`) — only relevant if `params.id` is
  validated (no existing route does; optional cheap hardening:
  `z.string().uuid()` → 400).
- No session/results **service module** exists — every query is inline in the
  handler. Adding one is optional and would be a new convention.
- `createAdminClient()` throws if `SUPABASE_URL` is unset and reads the
  **required** secret `SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server` —
  importing it in a unit test throws at import time unless env is wired (see §7).

### 4. Object storage — nothing to clean up

Raw video **never reaches server storage**. Confirmed:
- `wrangler.jsonc` — no `r2_buckets` / KV / queues; only `ASSETS` + observability.
- `astro.config.mjs:17-24` — env schema is only `SUPABASE_URL`, `SUPABASE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`.
- No `@aws-sdk/*` / `S3Client` / `PutObjectCommand` anywhere in `src/`.
- `video_r2_key` appears only in the migration (`:18`) and `src/types.ts:7`.
  The session-create insert (`src/pages/api/sessions/index.ts:30-38`) sets
  only `user_id, video_filename, video_duration_s, status`.
- The video is base64'd in-browser (`VideoAnalyzer.tsx`) and POSTed straight
  to the vision LLM via `/api/analyze` (`src/pages/api/analyze.ts:25-30`) —
  **not persisted, not even an ownership check on that route** (that is Risk
  #3, out of scope here).

Design intent:
`context/archive/2026-05-28-ai-analysis-pipeline/plan.md:52` ("No R2 video
storage — video stays in-browser"), `context/foundation/test-plan.md:63`
("the `video_r2_key` column exists but is never populated"). The
"two-layer video deletion" in
`context/archive/2026-05-26-db-schema-and-privacy-design/plan.md:45-48` was a
planned F-02 task that was never implemented and is not needed. The roadmap
ties this to privacy: "the process-and-discard privacy posture extends to
user-initiated removal" ⇒ **hard delete, no tombstone** (`roadmap.md:168`).

### 5. UI — where the delete control goes

**History list — `src/pages/sessions/index.astro`** (verified in full):
- Pure SSR Astro, no islands. Data loaded in frontmatter via the RLS client
  (`:9,16-19`); already destructures `error` and renders a distinct
  "Couldn't load your sessions" 500 branch (`:20-25,52-55`) — the Risk #7 F1
  fix landed here.
- Each row (`:71-83`) is a single `<a href="/sessions/${id}">` wrapping the
  filename, formatted date, and a status pill (`src/lib/session-status.ts`).
- **No per-row actions today.** An interactive `<button>`/`<form>` cannot nest
  inside the `<a>`, so the row markup must be restructured regardless of
  approach.

**Detail page — `src/pages/sessions/[id].astro`**:
- Pure SSR Astro, no islands. RLS-client frontmatter queries (`:15-19,33-37`);
  ownership by RLS only (no explicit `user_id` filter); `!sessionData` → 404
  (`:21-23`). Still folds a query error into 404 (Risk #7, accepted —
  `context/archive/2026-08-23-fitting-results-display/reviews/impl-review.md`
  F2 SKIPPED).
- Only existing action is a "Back to dashboard" link (`:51`).
- `formatAngle()` from the in-flight `results-display-ux-improvements` slice
  is already imported here (`:4`) — that work is done, no conflict.

**Client mutation precedents (only two in the codebase):**
1. **Native `<form method="POST">` → route → `context.redirect(...)`** —
   sign-out (`dashboard.astro:21-28`, `src/components/Topbar.astro:16-20` →
   `src/pages/api/auth/signout.ts`); sign-in/up surface errors by redirecting
   with `?error=` and reading it back in the `.astro` page.
2. **React island + `fetch` + discriminated-union `useState`** —
   `src/components/VideoUpload.tsx` (`client:load`):
   ```ts
   const res = await fetch("/api/sessions", { method: "POST", headers: {...}, body: JSON.stringify({...}) });
   if (!res.ok) { const body = await res.json().catch(() => ({})); setState({ kind: "error", message: body.error ?? "…" }); return; }
   ```
   errors rendered inline: `{state.kind === "error" && <p className="text-destructive text-sm">{state.message}</p>}` (`VideoUpload.tsx:168`).
   Redirect-after-success is a **rendered `<a href>`**, not programmatic nav.

**Not in the codebase at all:** `useTransition`, `window.location` /
`location.reload()`, toast / `sonner`, any modal / `Dialog` / `AlertDialog`.

**shadcn / deps:**
- `src/components/ui/` contains only `button.tsx` (has `variant="destructive"`,
  `size="sm" | "icon"`) and the starter `LibBadge.astro`.
- `lucide-react` is installed (`Trash2` available). `--destructive` token and
  `text-destructive` / `bg-destructive` classes already used app-wide
  (`src/styles/global.css:24,56`).
- `AlertDialog` would need `npx shadcn@latest add alert-dialog` (pulls
  `@radix-ui/react-alert-dialog`, not currently a dep — the project has
  deliberately kept Radix to `slot` only).
- `src/components/hooks/` **does not exist**; there are zero custom hooks.
  `CLAUDE.md` says extract hooks there — a `useDeleteSession.ts` would be the
  first.

**Recommended shape (for `/10x-plan` to confirm):**
- Primary location: the **history-list row** (roadmap S-06 frames the outcome
  in terms of the list). Secondary/optional: the **detail page**, deleting
  then `Astro`-redirecting (or client-navigating) to `/sessions`.
- Restructure the row so the `<a>` no longer wraps the whole card; add a small
  React island (`DeleteSessionButton.tsx` or a `SessionList.tsx` island that
  owns the list for optimistic row removal), mounted `client:visible` /
  `client:idle`.
- Confirm UX — two viable options, decide in planning:
  - **No new dep:** inline two-step confirm ("Delete" → "Confirm / Cancel")
    with the existing `Button` `variant="destructive"` + `Trash2`.
  - **Modal:** `npx shadcn@latest add alert-dialog`.
- After `2xx`: `location.reload()` (re-runs frontmatter query; simplest) or
  local island state removal if the whole list is an island.
- Errors: inline `<p className="text-destructive text-sm">` from `useState`,
  per `VideoUpload.tsx:168`.

### 6. Error-handling convention (test-plan Risk #7)

`data ?? []` / "query error renders as empty or 404" is an accepted
project-wide convention:
- **Fixed** on the list page —
  `context/archive/2026-08-23-session-history-list/reviews/impl-review.md` F1
  (added `error` destructure + 500 branch; visible in
  `sessions/index.astro:20-25`).
- **Accepted/SKIPPED** on the detail page + API routes —
  `context/archive/2026-08-23-fitting-results-display/reviews/impl-review.md`
  F2, `context/archive/2026-05-28-ai-analysis-pipeline/reviews/impl-review.md`
  F6 (the latter was fixed in `/recommend`).

For the delete route: **return a distinct `500`** on a delete error rather
than folding it into `{ ok: true }` or a 404. A successful `DELETE` that
matched no row (already-deleted, or — if the belt-and-braces `user_id` filter
is what excluded it — not owned) should be `404`, not `200`; treat
`count === 0` as 404.

### 7. Testing context

- **Vitest exists** (rollout Phase 1, `context/changes/testing-angle-correctness/`,
  implemented): `getViteConfig` from `astro/config`, `environment: "node"`,
  specs colocated `*.test.ts`, `npm test` → `vitest run`, `pretest` runs
  `astro sync`. Cookbook `§6.1` (pure logic) is the only filled pattern.
- **Integration-test cookbook `§6.2–§6.4` is `TBD — see §3 Phase 2`**, and
  Phase 2 is `not started`. There is **no established route/integration test
  pattern yet**, and no two-user ownership-fixture helper.
- **Test-plan Phase 2** is scoped to exactly this surface — "make every
  session route enforce ownership, surface DB errors as distinct states"
  (Risks #2, #5, #6, #7). A `delete-session` route built now should be built
  to that bar (a two-distinct-user ownership test; distinct error state) so
  Phase 2 does not have to retrofit it.
- **`astro:env` import hazard:** `createAdminClient()` reads the required
  secret `SUPABASE_SERVICE_ROLE_KEY`; anything importing `src/lib/services/llm.ts`
  reads `OPENROUTER_API_KEY`. Importing such a module in a unit test throws at
  import time unless env-setup is wired — deferred to Phase 2
  (`test-plan.md §6.6`).
- **Supabase local stack is unreliable in this environment** —
  `context/archive/2026-08-23-session-history-list/reviews/impl-review.md` F2
  ("local Supabase stack was attempted but analytics/realtime/storage
  containers came up unhealthy"); `test-plan.md:108` ("CI should not depend on
  it"; use a thin client stub). Manual / e2e verification: seed via the Auth
  admin API + real `/api/auth/signin` cookies, as that review ultimately did.
- **CI today runs `lint` + `build` only**; typecheck is ungated until rollout
  Phase 4. Use `npx tsc --noEmit` locally (`context/foundation/lessons.md`).

## Code References

- `supabase/migrations/20260526120000_initial_schema.sql:13-24` — `fitting_sessions` table + owner FK
- `supabase/migrations/20260526120000_initial_schema.sql:44-46` — comment: no UPDATE/DELETE policy for `authenticated`
- `supabase/migrations/20260526120000_initial_schema.sql:53` — `analysis_results.session_id … ON DELETE CASCADE`
- `supabase/migrations/20260526120000_initial_schema.sql:34-42` — `sessions_select_own` / `sessions_insert_own`
- `src/lib/supabase.ts:1-24` — RLS-enforced request-scoped client (`createClient`)
- `src/lib/services/supabase-admin.ts:1-14` — `createAdminClient()`, service-role, RLS-bypassing
- `src/pages/api/sessions/[id].ts` — where `DELETE` is added (currently `GET` only, `prerender = false`)
- `src/pages/api/sessions/[id]/start.ts` — the template: 401 → RLS SELECT → 404 → admin write → `{ ok: true }`
- `src/pages/api/sessions/[id]/results.ts:54-56` — admin-write error → `500` pattern
- `src/pages/api/sessions/index.ts:28-38` — `createAdminClient()` insert with server-set `user_id` (Deviation 3)
- `src/middleware.ts:4` — `PROTECTED_ROUTES` does not cover `/api/*`
- `src/pages/sessions/index.astro:16-25,71-83` — history list: RLS query with `error` branch; row is one `<a>`
- `src/pages/sessions/[id].astro:15-23,51` — detail page: RLS query, 404 on `!data`, only a back-link
- `src/components/VideoUpload.tsx:85-100,168` — the `fetch` + `useState` + inline-error island idiom
- `src/components/ui/button.tsx:13-14` — `variant="destructive"`
- `src/types.ts:3-13,28-35` — `FittingSession`, `AnalysisResult`
- `src/lib/session-status.ts` — `SESSION_STATUS_META`, badge classnames

## Architecture Insights

- **Reads via RLS client, writes via admin client after an RLS pre-check.**
  The ownership guarantee lives in the pre-check SELECT, not in the write —
  fragile, and flagged as Risk #5. For a destructive delete, add an explicit
  `.eq("user_id", …)` on the write so the handler is safe even if the
  pre-check is later refactored away.
- **RLS write policies are not trusted here.** `sessions_insert_own` failed in
  SSR (JWT propagation) and is dead code. Any plan that leans solely on a new
  `sessions_delete_own` policy repeats that mistake. The policy is still worth
  adding for defense-in-depth and to satisfy the roadmap directive.
- **Cascade does the data cleanup.** No application code needs to touch
  `analysis_results`; no storage layer exists to clean.
- **No API layer for the pages.** `/sessions` and `/sessions/[id]` query
  Supabase directly in frontmatter. A delete is the first *mutation* from
  those pages — the only island mutation precedent is `VideoUpload.tsx`.
- **Minimal-dependency posture.** shadcn is one component (`button`); Radix is
  `slot` only. A confirm modal is a real dependency decision, not a given.
- **Error states must be distinct from "absent".** Project convention has
  historically folded query errors into empty/404; the list page was fixed,
  the rest accepted. New code should return `500` on a genuine failure.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:159-170` — **S-06** authoritative framing:
  hard delete (default), ownership "enforced by RLS, not just the UI", "result
  data disappears… no longer retrievable", prerequisite S-04 (done).
- `context/archive/2026-05-26-db-schema-and-privacy-design/plan.md:21,29,125-127,320`
  — deliberate "no UPDATE/DELETE policy for `authenticated`; service_role
  bypasses RLS"; `FORCE ROW LEVEL SECURITY` needed to block the table owner in
  local dev.
- `context/archive/2026-05-26-db-schema-and-privacy-design/reviews/plan-review.md`
  — F3 added the two FK indexes so RLS lookups don't sequential-scan (relevant
  if a `sessions_delete_own` policy on `user_id` is added — index already
  exists, `migration:81`).
- `context/archive/2026-05-31-async-job-pipeline/plan.md:61-65` — origin of the
  "RLS SELECT to prove ownership, then admin write" pattern; `createAdminClient()`
  contract.
- `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:490-498` —
  **Deviation 3**: `sessions_insert_own` RLS failed in SSR (JWT not
  propagated); `POST /api/sessions` switched to admin client with server-set
  `user_id`; RLS insert policy is now dead code.
- `context/archive/2026-05-28-ai-analysis-pipeline/reviews/impl-review.md` — F4
  (unplanned `createAdminClient` swap flagged for scope), F1/F2 (criticals in
  `llm.ts` — unrelated to delete), F6 (swallowed query error masked as 404,
  fixed in `/recommend`).
- `context/archive/2026-08-23-session-history-list/reviews/impl-review.md` — F1
  (swallowed query error → false empty state, **fixed** on the list page), F2
  (local Supabase stack unhealthy in-sandbox; manual verification via Auth
  admin API + real signin cookies).
- `context/archive/2026-08-23-fitting-results-display/reviews/impl-review.md` —
  F2 (query-error-as-404 on the detail page, **SKIPPED** as existing
  convention); Key Discoveries: a `completed` session is guaranteed to have a
  results row (the cascade preserves this 1:1 — both go together).
- `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:52` +
  `context/archive/2026-06-04-video-upload-and-status/plan.md:31` — "no R2
  video storage; video stays in-browser".
- `context/foundation/test-plan.md:53,75` (Risk #5 — IDOR / mixed client),
  `:55` (Risk #7 — error-as-absent), `:88` (Phase 2 covers "every session
  route enforce ownership"), `:108` (Supabase stub in CI).
- `context/foundation/lessons.md` — `npx tsc --noEmit` (not `npm run
  typecheck`); `z.treeifyError` (not `.flatten()`).

## Related Research

- `context/changes/testing-angle-correctness/research.md` — most recent
  research doc; notes the `results.ts` admin-client insert path and the
  still-open `error`-swallow in `[id].ts` / `results.ts`.
- No prior research doc addresses session deletion, RLS DELETE policies, or
  session-history mutations.

## Open Questions

1. **RLS DELETE policy: add it, and does the route rely on it?**
   Recommendation from the evidence: **add `sessions_delete_own`
   (`FOR DELETE TO authenticated USING (auth.uid() = user_id)`) as
   defense-in-depth, but execute the delete through the proven
   precheck-SELECT + admin `.delete().eq("id",…).eq("user_id",…)` path** —
   because the RLS *write* path has a track record of SSR JWT-propagation
   failure (Deviation 3). `/10x-plan` to confirm. (A cheap alternative worth a
   spike: verify whether the JWT-propagation issue still reproduces on the
   current `@supabase/ssr` version — if it's fixed, an RLS-only user-client
   delete becomes viable and simpler.)
2. **Status guard?** May a `queued` / `processing` session be deleted, or only
   terminal ones? Roadmap allows any status; `start`/`results` use a 409
   guard. Default: allow any status (simplest, matches roadmap), accept that
   deleting a `processing` session abandons an in-flight browser pipeline
   (which already has no server side).
3. **Confirm UX:** inline two-step confirm (no new dep) vs
   `npx shadcn@latest add alert-dialog` (adds `@radix-ui/react-alert-dialog`).
4. **Delete control placement:** history-list row only, or also the detail
   page (delete → redirect to `/sessions`)?
5. **Post-delete refresh:** `location.reload()` (not used elsewhere) vs making
   the list an island for optimistic row removal.
6. **Response for "matched no row":** confirm `404` (not `200`) when the
   delete affects 0 rows, so an already-deleted or not-owned id is
   distinguishable from a success.
7. **Test bar:** build the route now with a two-user ownership integration
   test even though the `§6.2` cookbook pattern doesn't exist yet (this change
   would establish it), or defer route testing to rollout Phase 2? The
   `astro:env` + Supabase-stub setup is Phase 2 work either way.
