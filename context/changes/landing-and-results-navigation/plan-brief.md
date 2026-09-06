# Landing Page and Session-to-Results Navigation — Plan Brief

> Full plan: `context/changes/landing-and-results-navigation/plan.md`

## What & Why

Roadmap slice **S-07**. Two UI/routing fixes over flows that already exist: (1) replace the generic "10x Astro Starter" page at `/` with a BikeFit product landing page that sets expectations and drives sign-up; (2) replace the lone "← Back to dashboard" link on the session view with a breadcrumb so a user looking at one session can reach their full history in one click. No schema, pipeline, API, or auth-model impact.

## Starting Point

`/` renders the starter's `Welcome.astro` marketing page identically for logged-in and logged-out users (it is not a protected route; only `Topbar` is auth-aware). `Welcome.astro` has exactly one importer. `/sessions/[id]` already renders results inline for a completed session and a status message otherwise — its only navigation is a single `← Back to dashboard` link, so reaching session history from there is a two-hop trip through the dashboard.

## Desired End State

A logged-out visitor at `/` sees a BikeFit hero with a "Start your fitting" CTA (→ sign-up), a "Sign in" link, a 3-step "how it works" strip, and short gravel-bikes-only + process-and-discard-privacy notes; the tab reads "BikeFit". A logged-in visitor at `/` is redirected straight to `/dashboard`. On `/sessions/[id]`, every state (completed / processing / failed / couldn't-load) shows a `Dashboard / Session history / <current>` breadcrumb instead of the bare back-link.

## Key Decisions Made

| Decision                    | Choice                                                                | Why (1 sentence)                                                                                                 | Source |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| Logged-in user at `/`       | Server-side redirect to `/dashboard` in page frontmatter              | Matches the roadmap default; removes any logged-in vs logged-out ambiguity on the landing page                   | Plan   |
| Session-view navigation     | Breadcrumb: Dashboard / Session history / this session                | Fixes the real gap — history is otherwise a two-hop trip via the dashboard                                       | Plan   |
| Landing content depth       | Headline + CTA + 3-step "how it works" + gravel-only & privacy notes  | Sets the two PRD-guardrail expectations before a user invests in filming, without becoming a full marketing page | Plan   |
| Logged-out primary CTA      | `/auth/signup` primary, `/auth/signin` secondary                      | New visitors are the landing page's audience; mirrors the current two-button pattern                             | Plan   |
| Consistency scope           | Only `/` gets auth-aware behavior; `/auth/*` untouched                | Keeps the slice small and low-risk; auth pages already work for the logged-out audience that reaches them        | Plan   |
| Testing                     | Breadcrumb assertion in `_[id].test.ts`; nothing for the landing page | test-plan §7 parks the landing page and middleware redirect as deliberate negative space                         | Plan   |
| `Welcome.astro` disposition | Repurpose in place (rename to `Landing.astro` optional)               | Single importer, no external references — safe to replace wholesale                                              | Plan   |

## Scope

**In scope:**

- `src/components/Welcome.astro` — BikeFit landing content (hero, CTA, how-it-works, expectation notes)
- `src/pages/index.astro` — logged-in → `/dashboard` redirect guard
- `src/layouts/Layout.astro` — default `<title>` → "BikeFit"
- `src/pages/sessions/[id].astro` — breadcrumb replacing the back-link
- `src/pages/sessions/_[id].test.ts` — one breadcrumb render assertion

**Out of scope:**

- Middleware changes; `/auth/*` redirects for logged-in users
- Global site header/footer/nav; changes to `sessions/index.astro`'s own nav
- Landing-page tests, `/` render test, middleware/redirect test, e2e changes (per test-plan §7)
- FAQ / sample-results visual / accuracy caveats on the landing page
- Favicon / OG-image / metadata beyond `<title>`
- Any change to `VideoUpload.tsx` / `VideoAnalyzer.tsx` / dashboard

## Architecture / Approach

Phase 1 is presentation plus one redirect line: `index.astro` gains a first-statement `if (Astro.locals.user) return Astro.redirect("/dashboard")` (user is already resolved by middleware), and `Welcome.astro`'s body is rewritten with BikeFit copy inside the same `bg-cosmic` glass-card visual language. Phase 2 swaps one markup block at `sessions/[id].astro:69-71` (which already sits above the results card and outside every status branch) for a `<nav>` breadcrumb, and adds a matching assertion to the existing Container-API render test.

## Phases at a Glance

| Phase                        | What it delivers                                                                | Key risk                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. BikeFit landing page      | Product landing page at `/`, logged-in redirect, "BikeFit" title                | Low — logged-in/logged-out consistency at `/`; mitigated by a first-statement frontmatter redirect   |
| 2. Session-detail breadcrumb | Breadcrumb to Dashboard + Session history on every session-view state, one test | Low — must not regress the e2e smoke or the Risk #6/#7 tests; assertions are untouched by the change |

**Prerequisites:** S-01 (video upload) and S-03 (results display) — both done.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- The logged-in → `/dashboard` redirect is verified manually only (test-plan §7 parks the middleware redirect and landing page as negative space) — a future regression here wouldn't be caught by CI.
- Assumes `Welcome.astro`'s single-importer status holds (confirmed by grep at plan time).
- Assumes the breadcrumb's extra `<link>` elements don't collide with any Playwright `getByRole("link", …)` lookup — the smoke's only link lookup ("View fitting recommendations") is on `/dashboard`, not the session page.

## Success Criteria (Summary)

- A logged-out visitor lands on a BikeFit page that tells them what the product does, that it's gravel-only, and that video isn't retained — then can sign up in one click.
- A logged-in visitor never sees the landing page; `/` takes them to the dashboard.
- From any session view, a user reaches their session history (or the dashboard) in one click, in every session state, with no regression to the results display or the e2e smoke.
