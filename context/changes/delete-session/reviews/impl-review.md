<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete Session

- **Plan**: context/changes/delete-session/plan.md
- **Scope**: Phase 1–2 of 2 (full plan)
- **Date**: 2026-09-03
- **Verdict**: NEEDS ATTENTION → all findings triaged 2026-09-03 (F1 fixed, F2 accepted, F3 fixed)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Activating "Delete" drops keyboard focus

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/DeleteSessionButton.tsx:64-72
- **Detail**: Clicking the idle trash trigger sets `confirming = true`, which unmounts
  that button and mounts the Confirm/Cancel pair. Focus is never moved, so a keyboard or
  screen-reader user who activates "Delete" lands on `<body>` with no announcement that a
  confirmation step appeared — they must blind-Tab to find "Confirm". The plan's Critical
  Implementation Details insisted keyboard/SR users "are not stranded on a control that has
  just been removed" and the component correctly handles that for Cancel and for
  error-after-Confirm (via `restoreFocus` + effect), but the same principle was not applied
  to the forward idle→confirming transition. Manual check 2.9 ("sensible focus order") was
  marked passed, so this is a judgment call on whether it clears the bar.
- **Fix**: Add a `ref` to the Confirm (or Cancel) button and focus it from a `useEffect`
  that runs when `confirming` becomes `true` — mirror the existing `restoreFocus` effect in
  the other direction. Focusing "Cancel" is the safer default (destructive action not
  pre-focused).
  - Strength: Closes the loop the plan explicitly opened for the reverse transitions;
    ~4 lines, same idiom already in the file.
  - Tradeoff: None significant — a second ref and a one-line effect.
  - Confidence: HIGH — the `restoreFocus` pattern in the same component is the template.
  - Blind spot: None significant.
- **Decision**: FIXED — added `cancelRef` + focus-on-open in the existing `confirming` effect (src/components/DeleteSessionButton.tsx). lint + tsc clean.

### F2 — Phase 1 ownership checks verified against the excluded local Supabase

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/delete-session/plan.md:506-511 (Progress rows 1.5–1.10)
- **Detail**: Rows 1.5–1.10 are recorded "— vs. local Supabase, 2026-09-02". The plan
  repeatedly and explicitly excluded the local stack: Phase 1's Implementation Note requires
  verification "against a real hosted/dev Supabase with two real accounts" and says "If a
  hosted project with two accounts is unavailable, stop and escalate rather than marking the
  phase done"; Migration Notes and the Manual Verification bullets say the same ("the local
  stack is unreliable in this environment"). The central risk of this change (Risk #5 —
  cross-user IDOR) is exactly the thing whose verification environment was downgraded. The
  checks did pass, and the load-bearing guards (`sessions_select_own` SELECT pre-check, which
  every production read path exercises, plus the belt-and-braces `.eq("user_id", …)` on the
  admin delete which is RLS-independent) give reasonable confidence — but the non-owner→404
  path was never exercised against a hosted multi-account project as the plan demanded.
- **Fix**: Before `/10x-archive`, run one spot check against a hosted/dev project — sign in
  as user B, `DELETE /api/sessions/<A's id>`, confirm 404 and that A's row survives — then
  update the Progress rows (or add an addendum) noting the project ref. Alternatively,
  explicitly record in the plan that local verification was accepted and why.
  - Strength: Directly retires the one residual doubt on the change's primary risk.
  - Tradeoff: Needs a hosted project with two accounts — the same blocker the plan
    anticipated.
  - Confidence: MED — local RLS generally mirrors hosted, but `auth.uid()` / JWT-claim
    behavior is the known soft spot (see Deviation 3 referenced in the plan).
  - Blind spot: Whether a hosted project is actually available in this environment.
- **Decision**: ACCEPTED — local verification accepted; rationale recorded as a
  verification-environment note under the Phase 1 Manual block in plan.md
  (guards are RLS-independent / prod-proven; non-owner→404 passed locally).

### F3 — Pre-check query error is reported as 404, not 500

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/[id].ts:51-59
- **Detail**: The ownership pre-check does `.maybeSingle()` then `if (error || !data) return
  404`. A genuine query failure (DB down, timeout) therefore returns 404, and the hook shows
  the user "This session is already gone — refresh the page." This is plan-sanctioned (Phase
  1 Contract step 3 maps both the missing-row and error cases to 404) and it fails closed on
  a destructive operation's ownership gate, which is defensible — but it is a small instance
  of the project's own Risk #7 (error-as-absent). The actual delete path correctly
  distinguishes `deleteError` → 500. Note also `.maybeSingle()` diverges from the `.single()`
  used by the sibling handlers `start.ts` / `results.ts`, though it is deliberate and
  well-commented (and arguably more correct).
- **Fix**: If tightening is wanted: `if (error) return new Response(null, { status: 500 });`
  before the `!data` → 404 check. Otherwise leave as-is (matches the plan) and treat this as
  acknowledged.
- **Decision**: FIXED — split the pre-check branch in src/pages/api/sessions/[id].ts
  (`error` → 500, `!data` → 404) and updated the handler comment + plan Contract step 3
  addendum. lint + tsc clean.
