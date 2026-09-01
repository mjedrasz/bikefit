# Fitting Results Display — Plan Brief

> Full plan: `context/changes/fitting-results-display/plan.md`

## What & Why

Build the page that shows a user their completed bike-fitting analysis: recommendations in plain language, alongside the body angles and reference ranges that back them up. This is S-03 on the BikeFit roadmap — the visible payoff of the upload → pose-detect → recommend pipeline that F-01/F-02/S-01/S-02 already built, and the direct target of the "View fitting recommendations" link `VideoUpload.tsx` already renders on completion.

## Starting Point

`VideoUpload.tsx` links to `/sessions/${sessionId}` today, but that route doesn't exist. The data it needs (`fitting_sessions`, `analysis_results`) is already modeled in `src/types.ts` and already readable under RLS scoped to the owning user — no schema or migration work is needed, this is a pure read/display slice.

## Desired End State

A signed-in user visiting `/sessions/<id>` for their own completed session sees their recommendations plus each body angle with a color-coded "in range" / "outside range" badge against its reference range, and a link back to `/dashboard`. A still-processing or failed session shows a status message instead. A missing or not-owned session ID 404s. Signed-out visitors get redirected to sign-in.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Auth gating | Add `/sessions` to `PROTECTED_ROUTES` in middleware | Matches the existing `/dashboard` pattern exactly; also auto-covers S-04's future `/sessions` list route | Plan |
| Non-completed session visited directly | Show a status message, no results | Reuses `status`/`error_message` already on the row; no extra fetch | Plan |
| Missing / not-owned session | 404 | RLS makes the two cases indistinguishable at the query level anyway — no manual ownership check needed | Plan |
| Data fetching | Direct Supabase query in the Astro page's SSR frontmatter | One round trip, matches how other `.astro` pages in this repo work; no new API endpoint needed | Plan |
| Angle vs. reference range | Color-coded in/out-of-range badge (green / amber) | Directly serves FR-008's intent — raw numbers alone were called out in the PRD as meaningless to amateurs | Plan |
| Page architecture | Plain Astro page, no React island | Read-only, fully server-resolved content — no client interactivity needed | Plan |
| Navigation | "Back to dashboard" link included | Without it a bookmarked/direct visit is a dead end; trivial to add | Plan |

## Scope

**In scope:**
- `src/pages/sessions/[id].astro` — the results page (all states: completed / processing / failed / 404)
- `src/middleware.ts` — add `/sessions` to `PROTECTED_ROUTES`

**Out of scope:**
- A `GET` handler on `/api/sessions/[id]/results` (superseded by the direct-SSR-query decision)
- Session history / list view (S-04, separate change)
- Side-by-side comparison (FR-010, parked)
- Any pipeline, upload, or schema changes

## Architecture / Approach

The page is a single SSR Astro route. Its frontmatter queries `fitting_sessions` by ID (RLS-scoped to the signed-in user), 404s on an empty result, then branches on `status`: `completed` triggers a second query for `analysis_results` and renders the full results view; `queued`/`processing`/`failed` render a status message instead. No client-side JS, no new API surface.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Route protection | `/sessions/*` redirects unauthenticated visitors, like `/dashboard` | Low — one-line, well-established pattern |
| 2. Results page | The full results view across all session states, plus 404 handling | Medium — several branches (completed/processing/failed/404) to get right; mitigated by reusing the existing "fetch, 404 on miss" pattern from the API routes |

**Prerequisites:** F-01 (schema + RLS) — already done.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes a completed session always has a matching `analysis_results` row (guaranteed by the existing pipeline's write order — see plan's Key Discoveries). If that invariant is ever violated, the page has no defensive fallback for it by design.
- No second test account may be available to manually verify the "another user's session → 404" case; RLS coverage for this is already exercised by existing API route tests/usage patterns, so risk is low.

## Success Criteria (Summary)

- A user can complete an analysis and immediately view its recommendations and angles via the link already in the UI.
- Visiting a results URL for a non-completed, missing, not-owned, or unauthenticated case behaves correctly and doesn't leak data.
- No regressions to the existing upload/analysis flow or to `/dashboard`.
