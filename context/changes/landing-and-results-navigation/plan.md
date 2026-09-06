# Landing Page and Session-to-Results Navigation Implementation Plan

## Overview

Two independent UI/routing improvements over flows that already exist (roadmap slice **S-07**):

1. Replace the generic "10x Astro Starter" page at `/` with a **BikeFit product landing page** that sets expectations and drives sign-up. Logged-in visitors are redirected on to `/dashboard`.
2. Replace the single `← Back to dashboard` link on the session view (`/sessions/[id]`) with a **breadcrumb** so a user looking at one session can reach their full session history in one click.

No schema, pipeline, API, or auth-model changes.

## Current State Analysis

**Landing page (`/`)**

- `src/pages/index.astro` renders `<Welcome />` inside `<Layout>`. `src/components/Welcome.astro` is the starter's cosmic marketing page: a "10x Astro Starter" hero with "Sign In" / "Sign Up" buttons, three generic feature cards ("Authentication Ready", "Modern Stack", "Developer Experience"), and an auth-aware `<Topbar />`.
- `Welcome.astro` is imported **only** by `index.astro` (`grep` confirmed — no other references).
- `/` is **not** in `PROTECTED_ROUTES` (`src/middleware.ts:4`). The page renders identically for logged-in and logged-out users; only `Topbar.astro` branches on `Astro.locals.user`.
- `Layout.astro:10` sets the default `<title>` to `"10x Astro Starter"`.
- The app is fully SSR (`output: "server"` in `astro.config.mjs`); pages read `Astro.locals.user` (populated by middleware on every request) directly in frontmatter. No page currently calls `Astro.redirect()` — redirects live in `src/middleware.ts` via `context.redirect()`.
- `test-plan.md` §7 (negative space): _"Marketing `Welcome` / landing page and shadcn UI primitives — cosmetic, no data effect."_ and _"Starter-provided auth flows … and the middleware redirect"_ are deliberately **not** covered by the suite.

**Session view (`/sessions/[id]`)**

- `src/pages/sessions/[id].astro` is simultaneously the "session details" page and the "results" page. Its frontmatter queries `fitting_sessions` (RLS-scoped) with `.maybeSingle()`, 404s on absent, 500s on query error, then branches on `status`/`displayStatus`:
  - `completed` + results row → full results view ("Your fitting results" heading, recommendations, body-angle badges).
  - `completed` + results error/absent → "We couldn't load your results".
  - `queued` / `processing` → "Still processing".
  - `failed` / stale-processing → "Analysis failed".
- The **only** navigation element is `<a href="/dashboard" class="text-sm text-blue-100/70 hover:text-white">&larr; Back to dashboard</a>` at `src/pages/sessions/[id].astro:70`, rendered above the results card and outside every status branch.
- There is no link from here to `/sessions` (session history). Reaching history from a session view today is a two-hop trip: back to dashboard → "View session history".
- `src/pages/sessions/index.astro` (the history list) links each row to `/sessions/${id}` and has its own `Back to dashboard` link.

**Test infrastructure**

- `src/pages/sessions/_[id].test.ts` renders the page via `renderPage(SessionDetail, { params: { id }, locals: { user } })` (`src/test/helpers/render-page.ts`, Astro Container API) and drives Supabase responses with `makeSupabaseStub`. Asserts on `res.status` and `await res.text()` markup.
- `e2e/upload-analysis-results.spec.ts` (the one Playwright smoke) navigates `page.goto("/dashboard")` directly, uploads a fixture, clicks "View fitting recommendations", and asserts the "Your fitting results" heading + an "In range"/"Outside range" badge. It never visits `/`.

**Decisions carried in from the planning interview**

| Decision                | Choice                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| Logged-in user at `/`   | Server-side redirect to `/dashboard`                                    |
| Session-view navigation | Breadcrumb: Dashboard / Session history / this session                  |
| Landing content depth   | Headline + CTA + a 3-step "how it works" + gravel-only & privacy notes  |
| Logged-out primary CTA  | `/auth/signup` primary, `/auth/signin` secondary                        |
| Consistency scope       | Only `/` gets auth-aware behavior; auth pages untouched                 |
| Testing                 | Nav assertion on `_[id].test.ts`; nothing for the landing page (per §7) |

## Desired End State

- A logged-out visitor hitting `/` sees a BikeFit landing page: a hero explaining the product, a primary "Start your fitting" button to `/auth/signup` and a secondary "Sign in" link, a three-step "how it works" strip, and short notes that BikeFit is for **gravel bikes only** and that **uploaded video is processed and discarded**. The browser tab reads "BikeFit", not "10x Astro Starter".
- A logged-in visitor hitting `/` is redirected (302) straight to `/dashboard` and never sees the landing page.
- On `/sessions/[id]` — in every state (completed, processing, failed, couldn't-load) — the top of the page shows a breadcrumb `Dashboard / Session history / <current>` where "Dashboard" links to `/dashboard` and "Session history" links to `/sessions`. The bare "← Back to dashboard" link is gone.
- The existing upload → analyse → results flow, `/dashboard`, `/sessions`, and the e2e smoke are unregressed.

### Verification

- `npx tsc --noEmit`, `npm run lint`, `npm run test` all pass.
- Manual: visit `/` logged out (see BikeFit page); log in and visit `/` (land on `/dashboard`); open a completed session and a processing session (breadcrumb present and links work in both).

### Key Discoveries

- `Welcome.astro` has exactly one importer (`src/pages/index.astro:2`) — safe to repurpose or replace wholesale.
- Pages are SSR and can redirect in frontmatter with `return Astro.redirect("/dashboard")` — `Astro.locals.user` is already populated by `src/middleware.ts:6-16`.
- The session-view back-link at `src/pages/sessions/[id].astro:69-71` sits **outside** all `{ session.status === ... }` branches, so replacing that one block updates navigation for every state at once.
- `src/pages/sessions/_[id].test.ts` already renders across states with `makeSupabaseStub` — a breadcrumb assertion drops into the existing file with no new harness.
- `test-plan.md` §7 explicitly parks the landing page and the middleware redirect as negative space — adding tests for `/` or the redirect would contradict the frozen strategy and is deliberately out of scope here.
- The e2e smoke (`e2e/upload-analysis-results.spec.ts`) asserts a `heading` "Your fitting results" and a `link` "View fitting recommendations" (the latter on `/dashboard`, not the session page) — a breadcrumb adds `link` elements but touches neither assertion.

## What We're NOT Doing

- **No middleware changes.** The `/` redirect lives in `index.astro` frontmatter, not `PROTECTED_ROUTES`.
- **No redirect for logged-in users on `/auth/signin` or `/auth/signup`.** They still see the forms (harmless, rare). Symmetric auth-page redirects were considered and deferred (interview "Scope" answer).
- **No global site header/footer or shared nav component.** The breadcrumb is local to `sessions/[id].astro`; `sessions/index.astro`'s existing "Back to dashboard" link is left as-is.
- **No landing-page tests, no `/` render test, no middleware/redirect test, no e2e changes.** Honors `test-plan.md` §7.
- **No FAQ, sample-results visual, or accuracy caveats on the landing page** (interview "Landing scope" answer — rich option rejected).
- **No favicon / OG-image / metadata work** beyond the `<title>`. The starter `/favicon.png` stays.
- **No copy for road/MTB support, pricing, or account tiers** — out of PRD scope.
- **No changes to `VideoUpload.tsx` / `VideoAnalyzer.tsx`** or the dashboard's post-upload "View fitting recommendations" link.

## Implementation Approach

Two small, independently shippable phases. Phase 1 is pure presentation plus one redirect line; Phase 2 is a markup swap plus one test. Neither depends on the other — Phase 2 could ship first — but Phase 1 is listed first because it is the larger user-facing win and carries the roadmap's named risk (logged-in vs logged-out consistency at `/`).

Both phases stay inside the app's single visual language: the `bg-cosmic` background, white/glass cards (`border-white/10 bg-white/10 backdrop-blur-xl`), and the gradient-text headings already used across `dashboard.astro`, `sessions/index.astro`, and `Welcome.astro`.

## Critical Implementation Details

**Redirect ordering (Phase 1).** The `Astro.locals.user` check and `return Astro.redirect("/dashboard")` must be the first statements in `index.astro`'s frontmatter, before any rendering. A 302 with no body is correct; do not render `<Layout>` on the redirect path.

**Breadcrumb placement (Phase 2).** Replace the single `<div class="mb-4 w-full max-w-2xl">…</div>` wrapper at `src/pages/sessions/[id].astro:69-71` in place — it is already positioned above the results card and outside the status conditionals, so the breadcrumb inherits "shows in every state" for free. Do not move it inside a branch.

## Phase 1: BikeFit landing page

### Overview

Replace the starter marketing content with a BikeFit landing page and redirect authenticated visitors to the dashboard.

### Changes Required

#### 1. Landing page content

**File**: `src/components/Welcome.astro`

**Intent**: Replace the "10x Astro Starter" hero, buttons, and three developer-experience feature cards with BikeFit product content: a headline + subhead conveying "upload a short side-view clip, get plain-language gravel bike fitting recommendations backed by body angles"; a primary CTA button "Start your fitting" → `/auth/signup` and a secondary "Sign in" link → `/auth/signin`; a three-step "how it works" strip (reusing the existing 3-column card grid) — e.g. _Film your ride_ / _Upload the clip_ / _Get your recommendations_; and two short expectation-setting lines — gravel bikes only, and video is processed then discarded (no raw video retained). Keep `<Topbar />`, the `bg-cosmic` wrapper, the cosmic orbs/star-field, and the glass-card styling.

**Contract**: Astro component, no props, no client JS. Public anchors: primary `href="/auth/signup"`, secondary `href="/auth/signin"`. Still the sole child of `index.astro`. No import of `Astro.locals` here (the redirect lives in the page — see change 2). Consider renaming the file to `Landing.astro` for clarity; if renamed, update the import in `src/pages/index.astro:2` and delete `Welcome.astro`.

#### 2. Redirect logged-in visitors

**File**: `src/pages/index.astro`

**Intent**: Before rendering, if `Astro.locals.user` is set, return a redirect to `/dashboard` so authenticated users never see the landing page.

**Contract**: Frontmatter guard as the first statement: `if (Astro.locals.user) return Astro.redirect("/dashboard");`. Page stays SSR (no `prerender` export needed — server output is the default).

#### 3. Default document title

**File**: `src/layouts/Layout.astro`

**Intent**: Change the fallback `<title>` from "10x Astro Starter" to "BikeFit" so pages that don't pass an explicit title (including `/`) read correctly.

**Contract**: `Layout.astro:10` — `const { title = "BikeFit" } = Astro.props;`. Optionally have `index.astro` pass a fuller `<Layout title="BikeFit — self-service gravel bike fitting">`.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit/integration tests pass: `npm run test`
- Build succeeds: `npm run build`

#### Manual Verification

- Visiting `/` while logged out shows the BikeFit landing page — no "10x Astro Starter" text anywhere, browser tab reads "BikeFit".
- The primary CTA navigates to `/auth/signup`; the secondary link navigates to `/auth/signin`.
- The "how it works" steps and the gravel-only + privacy notes are visible and readable on mobile widths (no horizontal scroll).
- Visiting `/` while logged in lands on `/dashboard` (302, no flash of the landing page).
- `Topbar` still shows the correct auth-aware links.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Session-detail breadcrumb navigation

### Overview

Replace the lone "← Back to dashboard" link on the session view with a breadcrumb that also reaches session history.

### Changes Required

#### 1. Breadcrumb on the session view

**File**: `src/pages/sessions/[id].astro`

**Intent**: Replace the single back-link block (lines 69–71) with a breadcrumb trail: `Dashboard` (→ `/dashboard`) / `Session history` (→ `/sessions`) / a non-link current-page label. Keep it above the results card and outside all status branches so it renders for completed, processing, failed, and couldn't-load states alike. Match the existing muted link styling (`text-blue-100/70 hover:text-white`) and use a consistent separator.

**Contract**: Static markup in the `.astro` template. Anchors: `href="/dashboard"` and `href="/sessions"`. Current-page segment is plain text (e.g. "Fitting results", or the session's `video_filename` when present — `session.video_filename` is already selected in the frontmatter). Wrap in `<nav aria-label="Breadcrumb">`. No frontmatter/query changes.

#### 2. Navigation assertion

**File**: `src/pages/sessions/_[id].test.ts`

**Intent**: Add a test that renders a session and asserts the breadcrumb is present — both the `/dashboard` and `/sessions` links appear in the markup — and that the bare "← Back to dashboard" wording is gone. One case (e.g. against the existing `completedSession` stub) is enough since the breadcrumb is state-independent.

**Contract**: New `it(...)` in the existing describe block, using the established `stubReturns(...)` + `renderPage(SessionDetail, { params: { id: "s1" }, locals: { user } })` pattern. Assertions: `html` contains `href="/sessions"` and `href="/dashboard"`; `html` does not contain `"Back to dashboard"`.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit/integration tests pass: `npm run test` (including the new assertion in `_[id].test.ts`)
- Existing `sessions/[id].astro` tests (Risk #6 / Risk #7 cases) still pass unchanged

#### Manual Verification

- Opening a **completed** session shows the breadcrumb; "Dashboard" and "Session history" links both navigate correctly.
- Opening a **processing** or **failed** session shows the same breadcrumb (state-independent).
- The e2e smoke (`npm run test:e2e`) still passes — "Your fitting results" heading and the badge assertion are unaffected.
- No visual regression to the results card layout.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests

- `src/pages/sessions/_[id].test.ts` — one new case: the breadcrumb renders with `/dashboard` and `/sessions` links and the old back-link text is gone.

### Integration Tests

- None. No new API surface or data flow.

### Manual Testing Steps

1. Logged out, visit `/` → BikeFit landing page, tab title "BikeFit", no "10x Astro Starter" text.
2. Click "Start your fitting" → `/auth/signup`. Back, click "Sign in" → `/auth/signin`.
3. Log in, visit `/` → redirected to `/dashboard`.
4. From the dashboard, open session history, open a completed session → breadcrumb present; click "Session history" → back to `/sessions`; click "Dashboard" → `/dashboard`.
5. Open a still-processing session directly by URL → breadcrumb still present.
6. Run `npm run test:e2e` → smoke passes.

### Explicitly Not Tested (per `test-plan.md` §7)

- The `/` landing page markup and the logged-in → `/dashboard` redirect — deliberate negative space ("cosmetic, no data effect"; "the middleware redirect" parked). Verified manually only.

## Performance Considerations

Negligible. The `/` redirect is one boolean check on an already-resolved `Astro.locals.user`. The landing page is static SSR markup with no client JS. The breadcrumb adds two anchors.

## Migration Notes

None. No data, schema, or config changes. If `Welcome.astro` is renamed to `Landing.astro`, that is a single-importer rename with no external references.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-07 (lines 174–185)
- PRD: `context/foundation/prd.md` — US-01, FR-003, FR-008, §Non-Goals (gravel-only), §NFR (process-and-discard)
- Negative space: `context/foundation/test-plan.md` §7 ("Marketing `Welcome` / landing page"; "Starter-provided auth flows … the middleware redirect")
- Current landing page: `src/components/Welcome.astro`, `src/pages/index.astro`
- Current session view + back-link: `src/pages/sessions/[id].astro:69-71`
- Session history list (breadcrumb target): `src/pages/sessions/index.astro`
- Test pattern: `src/pages/sessions/_[id].test.ts`, `src/test/helpers/render-page.ts`
- e2e smoke (must not regress): `e2e/upload-analysis-results.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: BikeFit landing page

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Unit/integration tests pass: `npm run test`
- [x] 1.4 Build succeeds: `npm run build`

#### Manual

- [x] 1.5 `/` logged out shows the BikeFit landing page; no "10x Astro Starter" text; tab title "BikeFit"
- [x] 1.6 Primary CTA → `/auth/signup`; secondary link → `/auth/signin`
- [x] 1.7 "How it works" steps + gravel-only & privacy notes visible; no horizontal scroll on mobile
- [x] 1.8 `/` logged in redirects to `/dashboard` with no flash of the landing page
- [x] 1.9 `Topbar` auth-aware links still correct

### Phase 2: Session-detail breadcrumb navigation

#### Automated

- [ ] 2.1 Type checking passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Unit/integration tests pass: `npm run test` (including the new `_[id].test.ts` assertion)
- [ ] 2.4 Existing `sessions/[id].astro` Risk #6 / Risk #7 tests still pass

#### Manual

- [ ] 2.5 Completed session shows the breadcrumb; "Dashboard" and "Session history" links navigate correctly
- [ ] 2.6 Processing / failed session shows the same breadcrumb
- [ ] 2.7 e2e smoke (`npm run test:e2e`) still passes
- [ ] 2.8 No visual regression to the results card layout
