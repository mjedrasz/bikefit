# Delete Session Implementation Plan

## Overview

Let a signed-in user hard-delete one of their own past fitting sessions from
the history view. Deleting a `fitting_sessions` row removes its 0-or-1
`analysis_results` child via the existing `ON DELETE CASCADE`; the session and
its results become unretrievable. Ownership is enforced server-side — an RLS
`SELECT` pre-check plus an explicit `user_id` filter on the admin-client
delete — not by the UI. A new `sessions_delete_own` RLS policy is also shipped,
but as forward-compatible DDL (the admin client bypasses it), not as an active
guard.

Two phases: a backend phase (new RLS policy migration + `DELETE` route handler)
and a frontend phase (an inline two-step confirm control on each history-list
row).

## Current State Analysis

- **Data model.** One migration exists
  (`supabase/migrations/20260526120000_initial_schema.sql`).
  `fitting_sessions` (`:13-24`) is owned via
  `user_id … REFERENCES auth.users(id)`. `analysis_results.session_id`
  (`:53`) has `ON DELETE CASCADE`. There are no other child tables and no
  object storage — `video_r2_key` (`:18`) is never written by any code path,
  `wrangler.jsonc` has no R2 binding.
- **RLS as deployed.** Both tables are `ENABLE` + `FORCE ROW LEVEL SECURITY`
  (`:31-32`, `:60-61`). `fitting_sessions` has `sessions_select_own` (`:34-37`)
  and `sessions_insert_own` (`:39-42`) only — **no UPDATE or DELETE policy**
  (`:44-46` is a comment noting this is deliberate; `service_role` bypasses
  RLS for pipeline writes). Consequence: a `.delete()` issued through the
  user-scoped client (`src/lib/supabase.ts`, anon key, RLS-enforced) matches
  **zero rows and returns no error**.
- **The established mutation pattern.** `src/pages/api/sessions/[id]/start.ts`
  and `.../results.ts`: 401 guard → `createClient()` 503 guard → RLS-client
  `.select().eq("id", …).single()` to prove ownership (a missing row doubles
  as 404 + ownership guard) → `createAdminClient()`
  (`src/lib/services/supabase-admin.ts`, service-role, RLS-bypassing) for the
  write, keyed by `context.params.id` **with no `user_id` filter**.
- **RLS write policies are not trusted here.** Archived Deviation 3
  (`context/archive/2026-05-28-ai-analysis-pipeline/plan.md:490-498`):
  `sessions_insert_own` failed in the SSR context because the authenticated
  user's JWT was not propagated to the Supabase client; `POST /api/sessions`
  was switched to `createAdminClient()` with a server-set `user_id` and the
  RLS insert policy is now dead code. The RLS **SELECT** policy demonstrably
  works (every read path depends on it); the RLS **INSERT** policy did not; an
  RLS **DELETE** policy is untested.
- **The route file.** `src/pages/api/sessions/[id].ts` currently exports only
  `prerender = false` and `GET`. Error bodies here are bare
  `new Response(null, { status })` (not `{ error }` JSON — that is a different
  file's convention).
- **Middleware.** `src/middleware.ts` `PROTECTED_ROUTES = ["/dashboard",
  "/sessions"]` matched with `startsWith`, so `/api/sessions/*` is **not**
  guarded — the handler must self-check `context.locals.user` as its first
  statement (every existing route does).
- **The history list.** `src/pages/sessions/index.astro` is pure SSR Astro,
  no islands. It already destructures `error` and renders a distinct
  "Couldn't load your sessions" 500 branch (`:16-25`, `:52-55`). Each row
  (`:71-83`) is a single `<a href="/sessions/${id}">` wrapping the filename,
  date, and a status pill. **No per-row actions today.**
- **Client-mutation precedent.** The only island that mutates via `fetch` is
  `src/components/VideoUpload.tsx` — `fetch` + discriminated-union `useState`
  + inline `<p className="text-destructive text-sm">` error. No `useTransition`,
  no `window.location` / `location.reload()`, no toast, no modal / `Dialog` /
  `AlertDialog` anywhere in the codebase.
- **Dependencies.** `src/components/ui/` has only `button.tsx` (has
  `variant="destructive"`, `size="sm" | "icon"`). `lucide-react` is installed
  (`Trash2` available). `--destructive` token + `text-destructive` /
  `bg-destructive` classes are used app-wide. Radix is `@radix-ui/react-slot`
  only — deliberately minimal. `src/components/hooks/` **does not exist**;
  there are zero custom hooks.
- **Tests.** Vitest is configured for **pure logic only** (`vitest.config.ts`:
  `environment: "node"`, `include: ["src/**/*.{test,spec}.ts"]`, no Astro
  plugin chain, no `astro:env`, no DOM). Cookbook `§6.2` (integration tests,
  route handlers, two-user ownership fixture) is `TBD — see §3 Phase 2` and
  Phase 2 is unscheduled. There is no route/integration test pattern yet.

## Desired End State

A signed-in user viewing `/sessions` sees a delete affordance on each session
row. Activating it asks for inline confirmation; confirming issues
`DELETE /api/sessions/:id`, and on success the page reloads with that session
gone. The session's `fitting_sessions` row and any `analysis_results` row are
permanently removed from the database; navigating to `/sessions/:id`
afterward returns 404. A different signed-in user who issues
`DELETE /api/sessions/:id` against a session they do not own receives 404 and
the row is untouched.

**Verification:** the manual testing steps in each phase pass; `npm run lint`,
`npx tsc --noEmit`, and `npm run build` are clean; the new migration file
follows the `YYYYMMDDHHmmss_description.sql` convention and sorts after
`20260526120000`.

### Key Discoveries:

- `analysis_results.session_id … ON DELETE CASCADE`
  (`supabase/migrations/20260526120000_initial_schema.sql:53`) — deleting the
  parent session is the entire data-cleanup story. The cascade runs under the
  admin-client delete (service-role, RLS-bypassing), so no child DELETE policy
  is needed.
- No DELETE RLS policy exists on `fitting_sessions` today
  (`…initial_schema.sql:44-46`) and `FORCE ROW LEVEL SECURITY` is on — a
  user-client `.delete()` silently affects zero rows.
- `sessions_insert_own` RLS failed in SSR (JWT not propagated) — Deviation 3,
  `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:490-498`. Do not
  make a new `sessions_delete_own` policy the load-bearing guard.
- The pre-check → admin-write pattern lives in
  `src/pages/api/sessions/[id]/start.ts`; the admin-write-error → `500`
  pattern lives in `src/pages/api/sessions/[id]/results.ts:54-56`.
- `src/pages/sessions/index.astro:71-83` — the row is one `<a>`; an
  interactive control cannot nest inside it, so the row markup must be
  restructured, not merely augmented.
- `src/components/VideoUpload.tsx:85-100,168` — the `fetch` + `useState` +
  inline-error island idiom this change follows.
- This is **test-plan Risk #5** (`context/foundation/test-plan.md:53,75`) and
  its highest-risk instance — destructive, irreversible, cascading, no status
  window. Automated coverage is deferred to test-rollout Phase 2
  (`test-plan.md §3` row 2, `§6.2`); this change is verified manually with two
  real accounts.

## What We're NOT Doing

- **No soft delete / tombstone.** Roadmap S-06 default is hard delete; the
  process-and-discard privacy posture extends to user-initiated removal
  (`roadmap.md:168`).
- **No bulk / multi-select delete.** `change.md`: "no bulk operation is
  needed."
- **No delete control on the detail page** (`src/pages/sessions/[id].astro`).
  Placement is the history list only. The detail page stays read-only.
- **No status guard.** A `queued` / `processing` session can be deleted
  (roadmap allows any status). Deleting a session whose browser pipeline is
  still running is accepted — the later status/results POST from that tab hits
  the existing 404 path.
- **No `src/types.ts` or `src/lib/schemas.ts` change.** The session is
  addressed purely by the `[id]` path param; there is no request body.
- **No `params.id` UUID validation.** No existing session route validates it;
  a non-UUID id simply fails the pre-check `SELECT` and returns 404. Matching
  siblings keeps scope tight.
- **No `analysis_results` DELETE RLS policy.** The cascade runs under the
  RLS-bypassing admin delete.
- **No automated route / integration test in this change.** Cookbook `§6.2`
  and the `astro:env` + Supabase-stub harness are test-rollout Phase 2 work;
  this change is verified manually. (See Testing Strategy.)
- **No new `Dialog` / `AlertDialog` / toast dependency.** Inline two-step
  confirm using the existing `Button`.
- **No conversion of the history list to a client island.** The list stays
  SSR Astro; the delete control is a small per-row island and the list
  refreshes via `location.reload()`.
- **No backfill / recompute of existing data.** N/A here — delete only.

## Implementation Approach

Build the backend first so the route can be exercised (curl / two browser
sessions) before any UI exists, then add the UI island that calls it.

**Backend.** A new migration adds `sessions_delete_own`, but as
**forward-compatible DDL, not active enforcement** — the handler deletes
through the admin client (RLS-bypassing) and never exercises the policy. It is
shipped to satisfy the roadmap's "enforced by RLS" directive and to be ready
if a later change adopts a user-client delete. Research OQ1 (re-test whether
the Deviation-3 JWT-propagation failure still reproduces on the current
`@supabase/ssr` — if fixed, an RLS-only user-client delete becomes viable and
simpler) is **declined for this change**: the belt-and-braces handler is safe
regardless, and re-validating a 3-month-old SSR-auth failure is out of scope
here. The handler mirrors `start.ts`: self-check auth, build the
RLS client, run an ownership pre-check `SELECT` (missing row → 404), then
delete through the admin client with **both** `.eq("id", …)` and
`.eq("user_id", context.locals.user.id)` — the explicit `user_id` filter is
the belt-and-braces guard no existing admin write has, keeping the route safe
even if the pre-check is later refactored away. Chaining `.select()` on the
delete lets the handler return distinct states: a genuine DB error → 500, zero
rows affected (already deleted, or a race) → 404, one row → `{ ok: true }`.

**Frontend.** Restructure the history-list row so the primary link and the
delete control are siblings (an interactive control cannot live inside an
`<a>`). Add a `useDeleteSession` hook owning the request lifecycle and a
`DeleteSessionButton` island owning the two-step confirm toggle. The island
mounts `client:visible` per row. On a 2xx it calls `location.reload()` so the
SSR frontmatter query re-runs and the list (including its empty-state branch)
stays authoritative; on failure it renders an inline error and leaves the row.

## Critical Implementation Details

- **The row `<a>` cannot contain the delete control.** `sessions/index.astro`
  wraps the entire row card in a single `<a href>`. Nesting a `<button>` (or
  any interactive element) inside an `<a>` is invalid HTML and breaks
  keyboard / click behavior. The row must be restructured so the link and the
  delete island are siblings within the `<li>` — e.g. the `<li>` becomes the
  bordered card, the link covers the text/pill area, and the island sits
  beside it.
- **Auth-guard ordering is load-bearing.** The ownership pre-check `SELECT`
  (RLS-scoped) must run and return a row *before* the admin `.delete()`. Do
  not skip the pre-check and delete straight by `params.id` — that is a direct
  IDOR over enumerable UUIDs. The new `sessions_delete_own` policy is not a
  substitute for the pre-check (Deviation 3: RLS write policies have failed in
  this SSR context before).

## Phase 1: Backend — RLS policy + DELETE route

### Overview

Add the `sessions_delete_own` RLS policy and the `DELETE` handler on the
existing `/api/sessions/[id]` route. After this phase, a session can be
deleted end-to-end via HTTP with ownership enforced.

### Changes Required:

#### 1. New migration — `sessions_delete_own` DELETE policy

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_sessions_delete_own_policy.sql`
(use the real UTC timestamp at creation; it must sort after
`20260526120000`).

**Intent**: Grant the `authenticated` role permission to delete its own
`fitting_sessions` rows. This is **forward-compatible DDL, not active
enforcement** — the route deletes via the admin client and never exercises
this policy (mirroring how `sessions_insert_own` went inert after Deviation
3). It is added to satisfy roadmap S-06's "enforced by RLS, not just the UI"
directive and to be ready if a later change adopts a user-client delete.
Research OQ1's spike (re-test the Deviation-3 JWT propagation) is declined for
this change — see Implementation Approach.

**Contract**: One `CREATE POLICY "sessions_delete_own" ON fitting_sessions
FOR DELETE TO authenticated USING (auth.uid() = user_id);`. No policy on
`analysis_results` (the cascade runs under the RLS-bypassing admin delete).
The `fitting_sessions(user_id)` index already exists
(`20260526120000_initial_schema.sql:81`), so the `USING` predicate does not
sequential-scan. Mirror the existing policy statements' formatting
(`…initial_schema.sql:34-42`).

#### 2. `DELETE` handler on the session route

**File**: `src/pages/api/sessions/[id].ts`

**Intent**: Add `export const DELETE: APIRoute` that verifies the caller owns
the session, hard-deletes it (cascading to `analysis_results`), and returns
distinct status codes for success / not-found / server error. Template:
`src/pages/api/sessions/[id]/start.ts`.

**Contract**: Handler sequence —
1. `if (!context.locals.user) return new Response(null, { status: 401 })`.
2. `const supabase = createClient(context.request.headers, context.cookies);
   if (!supabase) return new Response("Service unavailable", { status: 503 })`.
3. Ownership pre-check: `const { data, error } = await supabase
   .from("fitting_sessions").select("id").eq("id", context.params.id)
   .single(); if (error || !data) return new Response(null, { status: 404 })`.
   (Destructure `error`, not just `data` — do not inherit the swallow.)
4. Admin delete:
   `const admin = createAdminClient();
   const { data: deleted, error: deleteError } = await admin
     .from("fitting_sessions").delete()
     .eq("id", context.params.id)
     .eq("user_id", context.locals.user.id)
     .select("id");`
5. `if (deleteError) return new Response(null, { status: 500 })`.
6. Count the affected rows through `unknown` — supabase-js infers `data` as
   `null` for a string `.select()` on the admin client (see the workaround
   comment at `src/pages/api/sessions/index.ts:40-46`), so a bare
   `deleted.length` fails `tsc --noEmit` (check 1.2) or forces an ad-hoc
   `as any`. Instead:
   `const rows: unknown = deleted;
   if (!Array.isArray(rows) || rows.length === 0) return new Response(null, { status: 404 })`.
7. `return Response.json({ ok: true })`.

Error bodies are bare `new Response(null, { status })` to match the rest of
this file (not `{ error }` JSON). No zod, no request-body read.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx tsc --noEmit` passes
- `npm run build` passes
- Migration file name matches `^\d{14}_.*\.sql$` and sorts after
  `20260526120000_initial_schema.sql`

#### Manual Verification:

- Against a hosted/dev Supabase with the migration applied
  (`supabase db push` or dashboard SQL — the local stack is unreliable in this
  environment): sign in as user A, `DELETE /api/sessions/:id` for one of A's
  sessions → `200 {"ok":true}`; the `fitting_sessions` row is gone and its
  `analysis_results` row (if any) is gone.
- Sign in as user B (real second account, cookies from `/api/auth/signin`),
  `DELETE /api/sessions/:id` for one of **A's** sessions → `404`; A's row is
  still present in the DB.
- `DELETE /api/sessions/:id` with no session cookie → `401`.
- `DELETE` the same id twice as the owner → first `200`, second `404`.
- Delete a session whose `status` is `processing` → `200`; row gone.
- After a successful delete, `GET /sessions/:id` in the browser → 404 page.

**Implementation Note**: Phase 1 is **BLOCKED — not complete** until manual
checks 1.5–1.10 pass against a real hosted/dev Supabase with two real
accounts. The automated checks (1.1–1.4 — lint / tsc / build / filename
regex) do not exercise the handler and **do not close this phase**: a green
automation run says nothing about whether the ownership guard works. Record in
`## Progress` which manual checks passed and against which Supabase project
(append e.g. `— vs. project <ref>, 2026-09-02` to each check line). If a
hosted project with two accounts is unavailable, stop and escalate rather than
marking the phase done. Pause here for explicit human confirmation before
starting Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live
in `## Progress`.

---

## Phase 2: Frontend — history-row delete control

### Overview

Restructure the `/sessions` list row and add the delete island + hook so a
user can delete a session from the history view with an inline two-step
confirm.

### Changes Required:

#### 1. `useDeleteSession` hook

**File**: `src/components/hooks/useDeleteSession.ts` (new file; the
`src/components/hooks/` directory does not exist yet — this is the project's
first custom hook, per `CLAUDE.md`).

**Intent**: Own the `DELETE` request lifecycle for one session and expose its
state to the button component.

**Contract**: Exports `useDeleteSession()` returning
`{ state, deleteSession }` where `state` is a discriminated union
`{ kind: "idle" } | { kind: "deleting" } | { kind: "error"; message: string }`
and `deleteSession(id: string): Promise<void>` does
`fetch(\`/api/sessions/${id}\`, { method: "DELETE" })`; on `res.ok` it calls
`window.location.reload()` (state stays `deleting` through the reload); on a
non-OK response or a thrown network error it sets
`{ kind: "error", message: … }` with a plain-language message. Follows the
`VideoUpload.tsx` fetch/`useState` idiom.

#### 2. `DeleteSessionButton` island

**File**: `src/components/DeleteSessionButton.tsx` (new file).

**Intent**: Render the per-row delete affordance with an inline two-step
confirm and inline error text — no modal, no new dependency.

**Contract**: Props `{ sessionId: string; filename?: string | null }`. Local
`const [confirming, setConfirming] = useState(false)`. Idle: a single
destructive-styled trigger (`Button` `variant="destructive"` `size="sm"` or
`size="icon"` with `Trash2` from `lucide-react`; include an accessible label,
e.g. `aria-label={\`Delete ${filename ?? "session"}\`}`). Confirming: a
"Confirm" (destructive) + "Cancel" pair; "Confirm" calls
`deleteSession(sessionId)` from the hook and the trigger shows a pending state
while `state.kind === "deleting"`. `state.kind === "error"` renders
`<p role="alert" className="text-destructive text-sm">{state.message}</p>`
inline (the `VideoUpload.tsx:168` idiom plus `role="alert"` — a failed delete
is an event a screen reader must hear, not passive validation text). Hold a
`ref` on the idle delete trigger and move focus back to it both on "Cancel"
and when a Confirm attempt lands in `state.kind === "error"`, so keyboard / SR
users are not stranded on a control that has just been removed. Uses `cn()`
from `@/lib/utils` for any conditional classes.

#### 3. History-list row restructure

**File**: `src/pages/sessions/index.astro`

**Intent**: Move the row's `<a>` off the whole card so the delete island can
sit beside it, and mount the island per row.

**Contract**: In the `sessions.map(...)` block (`:68-83`), restructure the row:
- The `<li>` (or an inner wrapper `<div>`) becomes the bordered card and owns
  the hover highlight — move `rounded-2xl border border-white/10 bg-white/10
  p-4 text-white backdrop-blur-xl transition-colors hover:bg-white/20` off the
  `<a>` and onto it.
- Inside, one flex row (`flex items-center justify-between gap-4`) holds two
  **non-nested siblings**: the existing `<a href={\`/sessions/${session.id}\`}>`
  — now wrapping only the filename + date `<div>` and the status pill — and
  `<DeleteSessionButton client:visible sessionId={session.id}
  filename={session.video_filename} />` beside it.
- The `<a>` covers the filename / date / status-pill area only; **whole-card
  click is dropped** (previously the entire card was the link target).
- The status pill stays between the link text and the delete button.
Import the component in the frontmatter. Leave the `!supabase` / `loadError` /
empty-state branches unchanged. Keep `client:visible` (not `client:load`) — a
history page can have many rows.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx tsc --noEmit` passes
- `npm run build` passes

#### Manual Verification:

- `/sessions` renders each row with a visible delete control; the row's
  filename/pill area still navigates to `/sessions/:id`.
- Click delete → inline "Confirm / Cancel" appears; "Cancel" returns to idle
  with no request sent.
- Click delete → "Confirm" → row's session is deleted, page reloads, that
  session is gone from the list.
- Deleting the last remaining session → after reload the "You haven't
  submitted any bike-fitting sessions yet" empty state shows.
- Simulated failure (e.g. temporarily point the fetch at a 500, or delete a
  row already removed in another tab) → inline red error text appears, the
  row stays, no reload.
- Keyboard: the delete trigger and the Confirm / Cancel controls are
  focusable and operable with Enter / Space; focus order is sensible.
- No console errors; `Trash2` icon renders.
- The card hover highlight spans the whole row; hovering the delete control
  does not leave the card without it or double it.
- After "Cancel", and after a failed "Confirm", focus returns to the delete
  trigger, and the inline error is announced (`role="alert"`).

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human before
considering the change complete.

---

## Testing Strategy

### Unit Tests:

- None added in this change. The delete route is pure I/O (Supabase calls) and
  the island is DOM behavior — neither fits the current pure-logic-only Vitest
  setup (`vitest.config.ts`: `environment: "node"`, no `astro:env`, no DOM).

### Integration Tests:

- **Deferred to test-rollout Phase 2** ("LLM boundary + API-route
  integration", `context/foundation/test-plan.md:88`), which is scoped to
  "make every session route enforce ownership, surface DB errors as distinct
  states" and will establish cookbook `§6.2` (route-handler exercise, Supabase
  stub, two-distinct-user ownership fixture). When that phase runs, the
  `DELETE` handler should get: owner-deletes-own → 200 + row gone; non-owner →
  404 + row present; unauthenticated → 401; already-deleted → 404; DB error →
  500.

### Manual Testing Steps:

1. Apply the migration to a hosted/dev Supabase (not the local stack).
2. Create two real accounts via `/auth/signup`; upload a session as each so
   both have history rows (and at least one `completed` session with an
   `analysis_results` row).
3. As user A, delete a `completed` session from `/sessions` → confirm the row
   disappears after reload and both the `fitting_sessions` and
   `analysis_results` rows are gone (check via dashboard).
4. As user B, use browser devtools / curl with B's session cookie to
   `DELETE /api/sessions/<A's session id>` → expect 404; verify A's row
   survives.
5. `DELETE` with no cookie → 401.
6. Delete a `processing` session → succeeds.
7. Delete the same id twice → 200 then 404.
8. Delete the last session → empty state renders after reload.
9. Force an error path (stale row / mocked 500) → inline error, no reload.

## Performance Considerations

Negligible. The delete is a single indexed `DELETE` by primary key plus a
cascade over the `analysis_results(session_id)` index. The per-row island is
mounted `client:visible` so off-screen rows on a long history page do not
hydrate.

## Migration Notes

- The new policy is additive (`CREATE POLICY`) — no data change, no
  destructive DDL, safe to apply to production.
- The local Supabase stack has been unreliable in this environment
  (`context/archive/2026-08-23-session-history-list/reviews/impl-review.md`
  F2); apply and verify via `supabase db push` against a hosted project or the
  dashboard SQL editor.
- Existing `analysis_results` rows for already-deleted sessions: none can
  exist (the cascade has always been in place); nothing to reconcile.

## References

- Related research: `context/changes/delete-session/research.md`
- Roadmap item: `context/foundation/roadmap.md:159-170` (S-06)
- Risk: `context/foundation/test-plan.md:53,75` (Risk #5 — IDOR / mixed
  client), `:55` (Risk #7 — error-as-absent)
- Route template: `src/pages/api/sessions/[id]/start.ts`
- Admin-write-error → 500: `src/pages/api/sessions/[id]/results.ts:54-56`
- Deviation 3 (RLS write policy failed in SSR):
  `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:490-498`
- Island fetch/error idiom: `src/components/VideoUpload.tsx:85-100,168`
- Schema + cascade: `supabase/migrations/20260526120000_initial_schema.sql:13-24,51-58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — RLS policy + DELETE route

#### Automated

- [x] 1.1 `npm run lint` passes
- [x] 1.2 `npx tsc --noEmit` passes
- [x] 1.3 `npm run build` passes
- [x] 1.4 Migration file name matches `^\d{14}_.*\.sql$` and sorts after `20260526120000_initial_schema.sql`

#### Manual

> Phase 1 does not close until 1.5–1.10 are checked here. Append the Supabase
> project ref and date each check ran against, e.g. `— vs. project abcd1234,
> 2026-09-02`. Automated checks 1.1–1.4 alone do not complete this phase.

- [x] 1.5 Owner deletes own session → 200; `fitting_sessions` + `analysis_results` rows gone — vs. local Supabase, 2026-09-02
- [x] 1.6 Non-owner DELETE of another user's session → 404; row survives — vs. local Supabase, 2026-09-02
- [x] 1.7 Unauthenticated DELETE → 401 — vs. local Supabase, 2026-09-02
- [x] 1.8 Double delete of same id → 200 then 404 — vs. local Supabase, 2026-09-02
- [x] 1.9 Delete a `processing` session → 200 — vs. local Supabase, 2026-09-02
- [x] 1.10 `GET /sessions/:id` after delete → 404 page — vs. local Supabase, 2026-09-02

### Phase 2: Frontend — history-row delete control

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npx tsc --noEmit` passes
- [ ] 2.3 `npm run build` passes

#### Manual

- [ ] 2.4 Each row shows a delete control; filename/pill area still navigates to the session
- [ ] 2.5 Delete → inline Confirm / Cancel; Cancel sends no request
- [ ] 2.6 Delete → Confirm → session removed, page reloads, session gone from list
- [ ] 2.7 Deleting the last session → empty state renders after reload
- [ ] 2.8 Failure path → inline red error text, row stays, no reload
- [ ] 2.9 Delete trigger and Confirm / Cancel are keyboard-focusable and operable; sensible focus order
- [ ] 2.10 No console errors; `Trash2` icon renders
- [ ] 2.11 Card hover highlight spans the row; hovering the delete control does not break or double it
- [ ] 2.12 Focus returns to the delete trigger after Cancel / failed Confirm; error `<p>` has `role="alert"`
