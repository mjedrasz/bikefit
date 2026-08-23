# Session History List Implementation Plan

## Overview

Build a standalone, protected `/sessions` page where a signed-in user browses every bike-fitting session they've ever submitted — filename, submission date, and status — newest first. Each row links to `/sessions/${id}`, the results-detail page that the sibling `fitting-results-display` change (S-03) is building in parallel. This is **S-04** on the BikeFit roadmap, delivering FR-009 ("User can view their past bike-fitting sessions").

## Current State Analysis

- `fitting_sessions` table and its RLS policy already exist and are done (F-01): `id`, `user_id`, `status`, `video_r2_key`, `video_filename`, `video_duration_s`, `error_message`, `created_at`, `updated_at`. The `sessions_select_own` policy scopes every `SELECT` to `auth.uid() = user_id` — no manual ownership filter is needed in queries.
- `VideoUpload.tsx:218-223` already links to `/sessions/${sessionId}` on analysis completion, even though that route doesn't exist yet — this is the established "link ahead of the target page" precedent in this codebase.
- `src/pages/sessions/[id].astro` (the results-detail page) is only a *plan* (`fitting-results-display`, S-03) — unimplemented as of this writing. `src/pages/sessions/` doesn't exist as a directory yet.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`. `/sessions` is not yet protected. Matching is `startsWith` (`src/middleware.ts:18`), so a single `"/sessions"` entry covers both this list page and the future `/sessions/[id]` detail page.
- No `GET /api/sessions` list endpoint exists. `src/pages/api/sessions/index.ts` is `POST`-only (session creation); `src/pages/api/sessions/[id].ts` is a single-session `GET` used for upload-flow polling.
- No list/table/card rendering pattern exists anywhere in the codebase. The only established visual precedent is `dashboard.astro`'s glass-card layout (`bg-cosmic` wrapper, `rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl` card) and `VideoUpload.tsx`'s hand-rolled `StatusBadge` (`VideoUpload.tsx:55-75`) mapping `SessionStatus` to Tailwind color classes.
- No shadcn `Table`/`Card`/`Badge` is installed (`src/components/ui/` has only `LibBadge.astro` and `button.tsx`).
- No pagination pattern exists anywhere in the repo (`.range(`, `.limit(`, etc. — zero hits). `context/foundation/prd.md` sets `target_scale.data_volume: small`.
- `src/lib/supabase.ts` exports `createClient(requestHeaders, cookies)`, the RLS-respecting SSR client factory; it returns `null` if `SUPABASE_URL`/`SUPABASE_KEY` are unset and callers must null-check (see `src/pages/api/sessions/[id].ts:12-15` for the existing convention).

## Desired End State

A signed-in user visiting `/sessions` sees every fitting session they've created, newest first, each as a glass-card row showing filename (or a fallback label if none), submission date, and a color-coded status badge — clicking any row navigates to `/sessions/${id}`. A user with zero sessions sees a friendly empty-state message with a link back to `/dashboard`. Signed-out visitors are redirected to sign-in, matching `/dashboard`'s existing behavior. `/dashboard` gains a small link so the new page is reachable.

Verification: sign in, upload at least one video to generate sessions in different statuses (or insert test rows), visit `/sessions`, confirm the list renders correctly and each row's link target matches `/sessions/${id}`.

### Key Discoveries:

- `src/types.ts:1` — `SessionStatus = "queued" | "processing" | "completed" | "failed"`, the exhaustive set a status badge must handle.
- `src/pages/api/sessions/[id].ts:17-25` — the established "query, 404 if `!data`, no manual ownership check" pattern (RLS handles ownership implicitly). The list page doesn't need this exact shape (empty array ≠ 404) but the null-check + RLS-trust convention carries over.
- `VideoUpload.tsx:55-75` — the exact 4-way status→Tailwind-class mapping to reuse for visual consistency between the upload flow and the history list.
- `supabase/migrations/20260526120000_initial_schema.sql` — index on `fitting_sessions(user_id)` supports this query's equality-scoped RLS filter; no index on `created_at`, acceptable at `target_scale: small`.

## What We're NOT Doing

- Not building `/sessions/[id]` (results detail) — that's the sibling `fitting-results-display` change (S-03). We link to it ahead of its existence, matching `VideoUpload.tsx`'s existing precedent; a 404 there until S-03 ships is expected.
- Not adding a `GET /api/sessions` API endpoint — direct SSR Supabase query in the Astro page's frontmatter instead, matching the sibling plan's approach for `/sessions/[id]`.
- Not adding pagination, a result-count cap, or infinite scroll — a single unpaginated query matches `target_scale: small` and has no precedent anywhere else in the codebase.
- Not showing a recommendation excerpt/preview per row — row content is filename + date + status only, no join into `analysis_results`.
- Not installing any new shadcn components (`Table`/`Card`/`Badge`) — reusing the existing glass-card Tailwind pattern.
- Not building side-by-side session comparison (FR-010) — parked in the roadmap.
- Not adding filtering, search, or sort controls — one fixed sort (newest first).

## Implementation Approach

Two phases, mirroring the sibling `fitting-results-display` plan's shape: first make `/sessions` a protected route (trivial, and idempotent if the sibling change lands first), then build the actual list page — including a shared status-badge helper so the upload flow and the history list draw from one source of truth instead of two copies of the same 4-color map — plus the dashboard nav link needed to reach it.

## Phase 1: Route protection

### Overview

Add `/sessions` to `PROTECTED_ROUTES` so unauthenticated visitors are redirected, matching the existing `/dashboard` behavior.

### Changes Required:

#### 1. Protect `/sessions` routes

**File**: `src/middleware.ts`

**Intent**: Redirect unauthenticated visitors away from `/sessions` and the future `/sessions/[id]`, exactly like `/dashboard` today.

**Contract**: Add `"/sessions"` to the `PROTECTED_ROUTES` array (`src/middleware.ts:4`). `startsWith` matching means this one entry covers both this list page and the sibling change's detail page. If `fitting-results-display` lands first and already added this entry, this step is a no-op — check the array before editing to avoid a duplicate.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Visiting `/sessions` while signed out redirects to `/auth/signin`
- Visiting `/dashboard` while signed out still redirects to `/auth/signin` (no regression)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Session history list page

### Overview

Build the `/sessions` page: a shared status-badge helper, the session list query, glass-card rows linking to `/sessions/${id}`, an empty state, and a nav link from `/dashboard`.

### Changes Required:

#### 1. Shared status-badge helper

**File**: `src/lib/session-status.ts` (new)

**Intent**: Single source of truth for the `SessionStatus` → label/Tailwind-class mapping, so `VideoUpload.tsx` and the new sessions list page don't each hardcode their own copy of the same 4 colors.

**Contract**: Export a mapping keyed by `SessionStatus` (`"queued" | "processing" | "completed" | "failed"`) to `{ label: string; className: string }`, using the exact same label text and 4 color pairs `VideoUpload.tsx:55-75`'s `StatusBadge` currently hardcodes. Update `VideoUpload.tsx`'s `StatusBadge` to read from this module instead of its inline `Record`/`cn(...)` calls, so both consumers stay in sync.

#### 2. Session history list page

**File**: `src/pages/sessions/index.astro` (new)

**Intent**: Fetch and render every session belonging to the signed-in user, newest first, each as a clickable glass-card row linking to `/sessions/${id}`; show a friendly empty state with a way back to `/dashboard` when there are none.

**Contract**: SSR frontmatter calls `createClient(Astro.request.headers, Astro.cookies)`, null-checks it per the `src/pages/api/sessions/[id].ts:12-15` convention (503 response or equivalent inline message if null), then queries `fitting_sessions` selecting `id, video_filename, status, created_at`, `.order("created_at", { ascending: false })`, no `.limit()`. RLS (`sessions_select_own`) scopes the result to the signed-in user automatically — no manual `.eq("user_id", …)` needed. Renders inside `Layout` using `dashboard.astro`'s visual language (`bg-cosmic` wrapper, `rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl` per card). Each row is an `<a href={`/sessions/${session.id}`}>` wrapping the filename (fallback `"Untitled session"` when `video_filename` is `null`), a human-readable formatted `created_at`, and the status badge from `session-status.ts`. When the query returns zero rows, render an empty-state message plus a link back to `/dashboard`.

#### 3. Dashboard nav link

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach the new `/sessions` page from the page they land on after signing in.

**Contract**: Add a link (e.g. "View session history") to `/sessions`, placed near the existing sign-out form (`dashboard.astro:10-22`) within the current header row, without disrupting the existing sign-out button or the "Signed in as" text.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- A user with sessions in 2+ different statuses sees all of them listed newest-first, with filename, date, and status badge colors matching `VideoUpload.tsx`'s convention exactly
- Clicking any row navigates to `/sessions/<id>` (a 404 there is expected/acceptable until `fitting-results-display` ships)
- A user with zero sessions sees the empty state with a working link back to `/dashboard`
- A session with a `null` `video_filename` shows the fallback label instead of a blank
- `/dashboard` shows a working link to `/sessions`, and the existing sign-out flow still works unchanged
- A second test user's sessions never appear in the first user's list (RLS scoping holds)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None planned — this repo has no test runner configured (`package.json` scripts are `dev`/`build`/`preview`/`lint`/`format` only); consistent with the sibling `fitting-results-display` plan, verification is automated-lint/typecheck plus manual testing.

### Integration Tests:

- None planned, for the same reason.

### Manual Testing Steps:

1. Sign in as a user with no sessions; visit `/sessions`; confirm the empty state and its link to `/dashboard`.
2. Upload one or more videos (or seed rows directly) so the user has sessions across `queued`/`processing`/`completed`/`failed`; visit `/sessions`; confirm all appear, newest first, with correct badges.
3. Click a `completed` row's link; confirm it navigates to `/sessions/<id>` (404 acceptable pre-S-03).
4. Sign in as a second user; confirm their `/sessions` list never shows the first user's rows.
5. Sign out; visit `/sessions` directly; confirm redirect to `/auth/signin`.

## Performance Considerations

None beyond the existing index on `fitting_sessions(user_id)`, which already supports this query's RLS-scoped equality filter. At `target_scale: small` an unindexed `ORDER BY created_at DESC` sort is not a concern.

## Migration Notes

None — no schema changes; this is a pure read/query slice against the existing `fitting_sessions` table.

## References

- Roadmap: `context/foundation/roadmap.md` (S-04: session-history-list)
- PRD: `context/foundation/prd.md` (FR-009)
- Sibling plan: `context/changes/fitting-results-display/plan.md` (S-03, results detail page this list links into)
- Status badge precedent: `src/components/VideoUpload.tsx:55-75`
- Protected-route precedent: `src/middleware.ts:4,18`
- SSR Supabase client convention: `src/lib/supabase.ts`, `src/pages/api/sessions/[id].ts:7-21`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Route protection

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit`
- [x] 1.2 Linting passes: `npm run lint`

#### Manual

- [x] 1.3 Visiting `/sessions` while signed out redirects to `/auth/signin`
- [x] 1.4 Visiting `/dashboard` while signed out still redirects to `/auth/signin` (no regression)

### Phase 2: Session history list page

#### Automated

- [ ] 2.1 Type checking passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes: `npm run lint`

#### Manual

- [ ] 2.3 A user with sessions in 2+ different statuses sees all of them listed newest-first, with filename, date, and status badge colors matching `VideoUpload.tsx`'s convention exactly
- [ ] 2.4 Clicking any row navigates to `/sessions/<id>` (a 404 there is expected/acceptable until `fitting-results-display` ships)
- [ ] 2.5 A user with zero sessions sees the empty state with a working link back to `/dashboard`
- [ ] 2.6 A session with a `null` `video_filename` shows the fallback label instead of a blank
- [ ] 2.7 `/dashboard` shows a working link to `/sessions`, and the existing sign-out flow still works unchanged
- [ ] 2.8 A second test user's sessions never appear in the first user's list (RLS scoping holds)
