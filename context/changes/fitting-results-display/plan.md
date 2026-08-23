# Fitting Results Display Implementation Plan

## Overview

Build the page that shows a user their completed bike-fitting analysis: plain-language recommendations alongside the body angles that back them up, each angle flagged against its reference range. This is the S-03 slice of the BikeFit roadmap — the visible outcome of the upload → analyze → recommend pipeline that F-01/F-02/S-01/S-02 already built.

## Current State Analysis

- `src/types.ts` already defines `FittingSession`, `AnalysisResult`, `BodyAngle`, `Recommendation` — the exact shapes this page renders. No new types are needed.
- `VideoUpload.tsx` already links to `/sessions/${sessionId}` on completion ("View fitting recommendations" button at `src/components/VideoUpload.tsx:218-224`) — that route does not exist yet. This plan creates it.
- `src/pages/api/sessions/[id]/results.ts` has only a `POST` handler (written by the pipeline in `VideoAnalyzer.tsx`). This plan does not add a `GET` handler there — the page queries Supabase directly server-side instead (see Key Discoveries).
- RLS policies `sessions_select_own` and `results_select_own` (migration `20260526120000_initial_schema.sql`) already scope `SELECT` on both tables to `auth.uid() = user_id` (`fitting_sessions`) and an ownership `EXISTS` subquery (`analysis_results`). No migration changes are needed — this slice is read-only against existing schema.
- `src/middleware.ts` only protects `/dashboard` today (`PROTECTED_ROUTES = ["/dashboard"]`). `/sessions/[id]` is not currently auth-gated.
- No test runner is configured in this repo. Prior plans (`video-upload-and-status/plan.md`) verify with `npx tsc --noEmit` + scoped `npx eslint <file>` per phase — this plan follows the same convention.

## Desired End State

A signed-in user who visits `/sessions/<id>` for their own completed session sees: the recommendations in plain language, and each body angle with its measured value, its reference range, and a color-coded badge showing whether it falls inside that range. A link back to `/dashboard` is always present. Visiting the same URL for a session that's still queued/processing shows a status message instead of results; a failed session shows the stored error message. Visiting an ID that doesn't exist, or belongs to another user, returns a 404. Visiting while signed out redirects to `/auth/signin`.

Verify by: signing in, running a real video through the existing upload flow to completion, clicking "View fitting recommendations," and confirming the results render correctly — plus the queued/processing/failed/404/signed-out cases from Testing Strategy below.

### Key Discoveries:

- `src/pages/api/sessions/[id].ts:17-21` and `src/pages/api/sessions/[id]/results.ts:32` both use the pattern "fetch by id, `if (!data) return 404`" and lean on RLS to make "doesn't exist" and "isn't yours" indistinguishable — this plan's page follows the identical pattern rather than adding a manual ownership check.
- `results.ts:46-58` (the pipeline's `POST` handler) always inserts the `analysis_results` row *before* updating `fitting_sessions.status` to `'completed'` — a completed session is therefore guaranteed to have a results row. The page does not need a defensive "completed but no results" fallback.
- `dashboard.astro` establishes the visual language this page should match: a `bg-cosmic` full-height wrapper around a `rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl` card, white text. This page reuses that language rather than introducing a new visual style.
- `VideoUpload.tsx`'s `StatusBadge` component establishes the color convention: `bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300` for a positive/good state, `bg-destructive/10 text-destructive` for a bad one. This page's in-range badge reuses the green variant; out-of-range introduces an amber variant (`bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`) following the same dark-mode-aware pattern — amber isn't used elsewhere yet, but red/destructive would misleadingly read as an error rather than "outside the ideal range."

## What We're NOT Doing

- No `GET` handler on `/api/sessions/[id]/results` — the page fetches directly via Supabase in its own SSR frontmatter (see Key Decisions in the brief for why).
- No changes to the pipeline, upload flow, or database schema — this is a pure read/display slice on top of existing data.
- No session history / list view — that's S-04 (`session-history-list`), a separate change. This page is only reachable today by a direct link (from `VideoUpload.tsx`'s completion state) or a typed/bookmarked URL; S-04 will later link to it from a list.
- No side-by-side session comparison (FR-010) — parked in the roadmap as nice-to-have.
- No client-side interactivity (filtering, sorting angles, etc.) — the page is server-rendered, read-only markup.

## Implementation Approach

Two small, independently verifiable phases: first extend the existing auth-gating mechanism to cover the new route, then build the page itself. Both phases touch files in isolation (`middleware.ts` vs. a new `.astro` file), so there's no ordering risk beyond "the route should be protected before/alongside it existing," which sequencing naturally handles.

## Critical Implementation Details

- **RLS does the ownership check.** Do not add a manual `session.user_id === user.id` comparison — the `sessions_select_own` RLS policy already returns nothing for another user's session ID, which the page treats identically to "doesn't exist" (404). Adding a redundant check would be dead code.
- **`PROTECTED_ROUTES` matching is prefix-based** (`context.url.pathname.startsWith(route)` in `middleware.ts`). Adding `"/sessions"` (not `"/sessions/"`) covers `/sessions/<id>` now and will also cover the future `/sessions` list page (S-04) automatically — no further middleware change will be needed when that slice lands.
- **A `completed` session is guaranteed to have an `analysis_results` row** (see Key Discoveries) — the results-fetch branch can render its data without a "results missing" fallback path.

## Phase 1: Route protection

### Overview

Extend the existing auth-gating middleware to cover `/sessions`, matching how `/dashboard` is already protected.

### Changes Required:

#### 1. Protect the `/sessions` path

**File**: `src/middleware.ts`

**Intent**: Unauthenticated visitors to `/sessions/<id>` (or any future `/sessions/*` route) should redirect to `/auth/signin`, exactly as `/dashboard` does today.

**Contract**: Add `"/sessions"` as a second entry in the `PROTECTED_ROUTES` array (`src/middleware.ts:4`). No other logic changes — the existing `startsWith` check and redirect already generalize to any array length.

### Success Criteria:

#### Automated Verification:

- TypeScript checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/middleware.ts`

#### Manual Verification:

- Signed out, visiting `/sessions/00000000-0000-0000-0000-000000000000` redirects to `/auth/signin`
- Signed in, visiting the same URL does not redirect (renders the Phase 2 page's 404, once Phase 2 lands — for Phase 1 alone, confirm no redirect loop and the request reaches the (currently 404-by-default) route)

---

## Phase 2: Results page

### Overview

Build `src/pages/sessions/[id].astro`: SSR data fetch, status branching, and the results view (recommendations + angle badges + back-to-dashboard link).

### Changes Required:

#### 1. Results page

**File**: `src/pages/sessions/[id].astro`

**Intent**: Render a completed session's recommendations and body angles for the owning user; show an appropriate status message for a non-completed session; 404 for a missing or not-owned session ID.

**Contract**:

- Frontmatter fetches the `fitting_sessions` row by `Astro.params.id` via `createClient(Astro.request.headers, Astro.cookies)` (same client factory `src/lib/supabase.ts` exports, used identically to `src/pages/api/sessions/[id].ts`). Select `id, status, error_message, video_filename, created_at`.
- If no row comes back, `return new Response(null, { status: 404 })` from the frontmatter — same pattern as the existing API routes (`src/pages/api/sessions/[id].ts:23-25`), and Astro SSR pages support returning a `Response` directly from frontmatter.
- If `session.status === "completed"`, fetch the matching `analysis_results` row (`recommendations, body_angles`) by `session_id`. Otherwise skip this fetch entirely.
- Render three mutually exclusive branches based on `session.status`:
  - `"completed"` → the results view (below).
  - `"queued"` / `"processing"` → a status message ("Your analysis is still processing — check back soon.").
  - `"failed"` → a status message surfacing `session.error_message`.
- Results view: a heading, the list of `recommendations` (each showing `adjustment` and `rationale`), and the list of `body_angles` (each showing `name`, `value`, `unit`, `reference_min`–`reference_max`, and a badge reading "In range" / "Outside range" computed as `value >= reference_min && value <= reference_max`). In-range badge uses the existing green pattern from `StatusBadge` in `VideoUpload.tsx`; out-of-range uses the new amber variant described in Key Discoveries.
- Page chrome matches `dashboard.astro`'s visual language (`bg-cosmic` wrapper, `rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl` card, white text) and includes a link back to `/dashboard`.
- Wrap the page content in the existing `Layout` component (`src/layouts/Layout.astro`), passing an appropriate `title`.

### Success Criteria:

#### Automated Verification:

- TypeScript checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/pages/sessions/[id].astro`

#### Manual Verification:

- Run a real video through the existing upload flow (`/dashboard`) to completion, click "View fitting recommendations," and confirm the results page renders the recommendations and all body angles with correct in/out-of-range badges matching each angle's reference range
- Manually navigate to a session ID known to be `queued` or `processing` — status message shown, no results rendered
- Manually navigate to a session ID known to be `failed` — the stored `error_message` is shown
- Navigate to a random/nonexistent session ID — 404
- (If a second test account is available) navigate to another user's completed session ID — 404
- "Back to dashboard" link returns to `/dashboard`
- Signed out, visiting any `/sessions/<id>` URL redirects to `/auth/signin` (confirms Phase 1 + Phase 2 work together)

---

## Testing Strategy

### Manual Testing Steps:

1. Complete a full upload → analysis cycle via `/dashboard`, follow the "View fitting recommendations" link, confirm the results render correctly.
2. While a session is mid-analysis, open `/sessions/<that id>` in a second tab — confirm the status message, not results, is shown.
3. Manually flip a session's `status` to `'failed'` with an `error_message` (or trigger a real pipeline failure) and confirm the message renders on the page.
4. Visit a nonexistent session ID — confirm 404.
5. Sign out and visit any `/sessions/<id>` URL — confirm redirect to `/auth/signin`.

## Performance Considerations

None beyond the two SSR queries already scoped by indexed columns (`fitting_sessions(user_id)`, `analysis_results(session_id)` — both indexed per the initial migration).

## Migration Notes

None — no schema changes.

## References

- Roadmap: `context/foundation/roadmap.md` (S-03: `fitting-results-display`)
- PRD: `context/foundation/prd.md` (FR-008)
- Prior slice conventions: `context/changes/video-upload-and-status/plan.md`
- Data model: `src/types.ts`
- Existing "fetch by id, 404 on miss" pattern: `src/pages/api/sessions/[id].ts:17-25`
- Visual language to match: `src/pages/dashboard.astro`
- Status color convention to match: `src/components/VideoUpload.tsx` (`StatusBadge`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route protection

#### Automated

- [x] 1.1 TypeScript checks pass: `npx tsc --noEmit` — efe5a4b
- [x] 1.2 Lint passes: `npx eslint src/middleware.ts` — efe5a4b

#### Manual

- [ ] 1.3 Signed out, visiting `/sessions/00000000-0000-0000-0000-000000000000` redirects to `/auth/signin`
- [ ] 1.4 Signed in, visiting the same URL does not redirect

### Phase 2: Results page

#### Automated

- [x] 2.1 TypeScript checks pass: `npx tsc --noEmit`
- [x] 2.2 Lint passes: `npx eslint src/pages/sessions/[id].astro`

#### Manual

- [ ] 2.3 Real completed session renders recommendations + correctly-flagged body angles
- [ ] 2.4 Queued/processing session shows status message, no results
- [ ] 2.5 Failed session shows the stored error message
- [ ] 2.6 Nonexistent session ID returns 404
- [ ] 2.7 Another user's session ID returns 404 (if testable)
- [ ] 2.8 "Back to dashboard" link works
- [ ] 2.9 Signed out, any `/sessions/<id>` URL redirects to `/auth/signin`
