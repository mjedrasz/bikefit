# Delete Session — Plan Brief

> Full plan: `context/changes/delete-session/plan.md`
> Research: `context/changes/delete-session/research.md`

## What & Why

Let a signed-in user hard-delete one of their own past fitting sessions from
the history view. Roadmap S-06: "the deleted session and its result data
disappear from the history list and are no longer retrievable. A user can
delete only their own sessions." The process-and-discard privacy posture
extends to user-initiated removal.

## Starting Point

`/sessions` lists a user's sessions as plain SSR Astro rows (each row a single
`<a>`); there are no per-row actions. `fitting_sessions` has RLS SELECT/INSERT
policies but **no DELETE policy**, and `FORCE ROW LEVEL SECURITY` is on — so a
user-client delete silently affects zero rows. `analysis_results` cascades off
`fitting_sessions` (`ON DELETE CASCADE`). No raw video is ever persisted, so
there is nothing in object storage to clean up.

## Desired End State

Each history-list row has a delete control with an inline two-step confirm.
Confirming issues `DELETE /api/sessions/:id`; on success the page reloads and
the session is gone. Its `fitting_sessions` row and any `analysis_results`
row are permanently removed. A different user calling the same endpoint for a
session they don't own gets 404 and the row is untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ownership enforcement | Belt-and-braces: RLS SELECT pre-check + admin `.delete().eq(id).eq(user_id)` + new `sessions_delete_own` RLS policy | Three independent guards on an irreversible route; the RLS *write* path has failed in this SSR context before (Deviation 3), so the policy is forward-compat DDL, not an active guard (research OQ1 spike declined). | Plan (research recommended) |
| Delete removes | One `fitting_sessions` row; `analysis_results` via existing cascade | No other child tables, no object storage. | Research |
| Status guard | Allow delete in any status (`queued` / `processing` included) | Matches roadmap; a stuck `processing` session is the one a user most wants to clear; the browser pipeline has no server side to interrupt. | Plan |
| Confirm UX | Inline two-step confirm (`Button variant="destructive"` + `Trash2`), no new dependency | Preserves the deliberate minimal-dependency posture (Radix is `slot`-only today). | Plan |
| Control placement | History list row only | Matches the roadmap's list-centric framing; detail page stays read-only. | Plan |
| Post-delete refresh | `location.reload()` on 2xx | Re-runs the SSR query so the list (and its empty-state branch) stays authoritative; no client list-state to manage. | Plan |
| "Matched no row" response | 404 (via `.select()` on the delete: error→500, 0 rows→404, 1 row→200) | A real DB error, an already-deleted id, and a success are distinguishable (Risk #7). | Plan |
| Automated tests | Deferred to test-rollout Phase 2; this change verified manually with two accounts | Cookbook `§6.2` + the `astro:env`/Supabase-stub harness are Phase 2's scope. | Plan |

## Scope

**In scope:**
- New migration: `sessions_delete_own` DELETE RLS policy on `fitting_sessions`
- `export const DELETE` on `src/pages/api/sessions/[id].ts`
- `src/components/hooks/useDeleteSession.ts` (new — first custom hook)
- `src/components/DeleteSessionButton.tsx` (new island)
- Restructure the `/sessions` list row so an interactive control sits outside
  the row `<a>`

**Out of scope:**
- Soft delete / tombstone; bulk delete
- Delete control on the detail page (`/sessions/[id].astro`)
- Status guard / 409
- `src/types.ts`, `src/lib/schemas.ts` changes; `params.id` UUID validation
- `analysis_results` DELETE policy (cascade runs under the admin delete)
- Automated route/integration tests; new modal/toast dependency
- Converting the history list to a client island

## Architecture / Approach

**Backend:** handler mirrors `start.ts` — 401 guard → `createClient()` 503
guard → RLS-client ownership pre-check `SELECT` (missing → 404) →
`createAdminClient().delete().eq("id", …).eq("user_id", …).select("id")` →
error → 500, 0 rows → 404, 1 row → `{ ok: true }`. The `sessions_delete_own`
policy is added but the handler does not depend on it.

**Frontend:** the list stays SSR Astro. The row `<li>` becomes the card
containing two siblings — the navigation link and a `DeleteSessionButton`
island (`client:visible`). The island uses a local `confirming` boolean for
the two-step confirm and the `useDeleteSession` hook for the `fetch`
lifecycle; a 2xx triggers `location.reload()`, a failure renders inline error
text (`VideoUpload.tsx` idiom).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend — RLS policy + DELETE route | Migration + `DELETE /api/sessions/:id` with three-guard ownership enforcement and distinct 200/404/500 states | Cross-user delete (IDOR, Risk #5) — mitigated by pre-check + explicit `user_id` filter + policy; verified with two real accounts |
| 2. Frontend — history-row delete control | Restructured list row + `useDeleteSession` hook + `DeleteSessionButton` island with inline two-step confirm | Interactive control nested in the row `<a>` (invalid HTML) — row must be restructured, not augmented |

**Prerequisites:** S-04 (session history list) — done. A hosted/dev Supabase
to apply the migration (local stack is unreliable here). Two real test
accounts for manual verification.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Manual verification is the only ownership check until test-rollout Phase 2
  runs (unscheduled). The belt-and-braces design is what makes deferring
  acceptable.
- Assumes `ON DELETE CASCADE` from `fitting_sessions` to `analysis_results`
  executes under the RLS-bypassing admin delete (it does — service-role has
  `BYPASSRLS`).
- Deleting a session whose browser pipeline is still running leaves that tab
  to hit the existing 404 path on its next status/results POST — accepted, no
  server-side pipeline exists.
- `lucide-react` `Trash2` and `Button variant="destructive"` are already
  available; no dependency install needed.

## Success Criteria (Summary)

- A user can delete their own session from `/sessions`; it disappears from the
  list and `/sessions/:id` returns 404 afterward.
- The session's `fitting_sessions` and `analysis_results` rows are gone from
  the database.
- A user cannot delete another user's session — the endpoint returns 404 and
  the row survives.
- A delete failure surfaces as a distinct inline error, never a silent
  success or a false empty state.
