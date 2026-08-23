# Session History List — Plan Brief

> Full plan: `context/changes/session-history-list/plan.md`

## What & Why

Build a standalone `/sessions` page listing every bike-fitting session a signed-in user has ever submitted — filename, date, status — newest first, each linking through to that session's results. This is S-04 on the BikeFit roadmap, delivering FR-009: history is what makes the iterative "adjust, re-film, re-analyze" fitting cycle visible to the user over time.

## Starting Point

`VideoUpload.tsx` already links to `/sessions/${sessionId}` on completion, and the `fitting_sessions` table + RLS (scoped to the owning user) already exist and are populated by the upload flow — this is a pure read/query slice, no schema work needed. The one thing it links *into*, `/sessions/[id]` (results detail), is itself still just a sibling plan (`fitting-results-display`), not yet built.

## Desired End State

A signed-in user visits `/sessions` and sees every session they've created, newest first, as glass-card rows with filename, date, and a color-coded status badge — clicking any row navigates to `/sessions/<id>`. Zero sessions shows a friendly empty state pointing back to `/dashboard`. Signed-out visitors are redirected to sign-in, and `/dashboard` gains a link to reach the new page.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Link-target sequencing | Build now, link ahead to `/sessions/${id}` unconditionally | Matches `VideoUpload.tsx`'s existing precedent of linking to the page before it exists; keeps the two roadmap slices independently shippable |
| Page location | Standalone `/sessions` page | Matches the routing the sibling plan already assumes, keeps `/dashboard` focused on starting a new analysis |
| Row preview content | Filename + date + status only | Zero added query complexity; the LLM's recommendation output has no defined "top" item to excerpt anyway |
| Empty state | Friendly message + CTA back to `/dashboard` | Standard pattern, avoids a dead end for first-time users |
| List visual style | Glass-cards matching `dashboard.astro` | Zero new dependencies; matches the only visual language this app has established |
| Row clickability | All rows clickable regardless of status | One consistent interaction model, reusing the sibling page's own status-branching instead of duplicating it in the list |
| Query scale | Unpaginated, `ORDER BY created_at DESC`, no limit | Matches PRD's `target_scale: small`; zero pagination precedent anywhere else in the repo |
| Status badge source | Extract into shared `src/lib/session-status.ts`, used by both `VideoUpload.tsx` and the new page | Avoids two hardcoded copies of the same 4-color map drifting apart |

## Scope

**In scope:**
- `src/middleware.ts` — add `/sessions` to `PROTECTED_ROUTES`
- `src/lib/session-status.ts` (new) — shared status→label/class mapping
- `src/pages/sessions/index.astro` (new) — the list page, all states (populated / empty)
- `src/pages/dashboard.astro` — add nav link to `/sessions`
- `src/components/VideoUpload.tsx` — refactor `StatusBadge` to use the shared helper

**Out of scope:**
- `/sessions/[id]` (results detail) — sibling change `fitting-results-display` (S-03)
- Any new `GET /api/sessions` API route — direct SSR query instead
- Pagination, filtering, search, or sort controls
- Recommendation preview/excerpt per row
- Side-by-side comparison (FR-010, parked)

## Architecture / Approach

A single SSR Astro page queries `fitting_sessions` via the RLS-respecting `createClient(headers, cookies)` in its frontmatter — no new API surface, same pattern the sibling results-detail plan uses. RLS scopes rows to the signed-in user automatically. A small shared TS module centralizes the status→color mapping so the upload flow and the new list page render identical badges.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Route protection | `/sessions/*` redirects unauthenticated visitors, like `/dashboard` | Low — one-line change, may already be done by the sibling change |
| 2. Session history list page | The full list view (populated + empty states), shared status helper, dashboard nav link | Low-medium — several small pieces (query, empty state, badge extraction, nav link) but each follows an existing pattern |

**Prerequisites:** F-01 (schema + RLS) and S-01 (video upload) — both already done.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes `fitting-results-display` (S-03) ships independently; until it does, every row link 404s. This was a deliberate choice (link ahead) rather than an oversight — see Key Decisions.
- No automated test suite exists in this repo (only lint/typecheck); verification here is automated checks + manual testing, consistent with the sibling plan.

## Success Criteria (Summary)

- A signed-in user can see every session they've submitted, newest first, with correct filename/date/status per row.
- Zero-session and null-filename edge cases render sensibly instead of blank or broken.
- Another user's sessions never leak into the list (RLS holds); signed-out access redirects correctly.
