<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Delete Session Implementation Plan

- **Plan**: `context/changes/delete-session/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE → **SOUND after fixes** (2026-09-02 triage — all 5 findings fixed in the plan)
- **Findings**: 0 critical, 3 warnings, 2 observations — F1–F5 all FIXED

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS (F2, F4, F5 fixed) |
| Plan Completeness | WARNING | PASS (F1, F3 fixed) |

## Grounding

10/10 paths ✓ (2 new files — `src/components/hooks/useDeleteSession.ts`,
`src/components/DeleteSessionButton.tsx` — correctly flagged as new; hooks dir
confirmed absent). 6/6 symbols ✓: `createAdminClient`
(`src/lib/services/supabase-admin.ts`), `createClient` (`src/lib/supabase.ts`),
`sessions_select_own` + `analysis_results … ON DELETE CASCADE`
(`supabase/migrations/20260526120000_initial_schema.sql:37,53`), no
UPDATE/DELETE policy (`:44-46`), `Button variant="destructive"`
(`src/components/ui/button.tsx:13`), `lucide-react` `^1.14.0` installed
(`package.json:36`), `PROTECTED_ROUTES` does not cover `/api/*`
(`src/middleware.ts:4,18`). brief↔plan ✓ (2 phases, same names; all 8
decisions match; scope in/out matches). No existing `DELETE` handler and no
`.delete()` / `.eq("user_id")` anywhere in `src/` — this is the first of each.
Only two tables in the schema; no job/queue/notification table — cascade is
the whole cleanup story, as claimed.

**Progress↔Phase mechanical contract**: PASS. Exactly one `## Progress` at the
bottom; `### Phase 1` / `### Phase 2` mirror the body headings; every Success
Criteria bullet (1.1–1.10, 2.1–2.10) traces to a Progress checkbox; phase
bodies contain plain `- ` bullets only.

## Findings

### F1 — `.select()` on the admin-client delete vs. the documented null-inference quirk

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 — DELETE handler, Contract steps 4 & 6
- **Detail**: The handler's 200-vs-404 distinction (the crux of the Risk #7
  "distinct error states" design) rests on
  `const { data: deleted } = await admin.from("fitting_sessions").delete().eq("id",…).eq("user_id",…).select("id");`
  then `if (!deleted || deleted.length === 0) return 404;`. The plan names
  `start.ts` / `results.ts` as templates, but neither chains `.select()` on an
  admin-client write. The only precedent that does —
  `src/pages/api/sessions/index.ts:40-46` — carries an explicit code comment:
  "supabase-js infers `data` as `null` for a string `.select()` on the admin
  client," and works around it with `const row: unknown = data; if (error || !row) …; row as Pick<…>`.
  Following the plan's contract verbatim will either fail `tsc --noEmit`
  (check 1.2) on `deleted.length`, or push the implementer to an ad-hoc
  `as any`. The plan doesn't reference this.
- **Fix**: In Phase 1 §2 step 4/6, cite `src/pages/api/sessions/index.ts:40-46`
  and specify the same treatment — `const rows: unknown = deleted;` then
  `if (deleteError) 500` / `if (!Array.isArray(rows) || rows.length === 0) 404`
  / else 200. Keeps the count-based 404 signal without a raw `any`.
- **Decision**: FIXED — Phase 1 §2 step 6 now specifies `const rows: unknown = deleted;`
  + `if (!Array.isArray(rows) || rows.length === 0) 404`, citing
  `src/pages/api/sessions/index.ts:40-46`.

### F2 — Delete handler has no verification that survives without hosted Supabase

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Success Criteria / Testing Strategy
- **Detail**: The plan's own words: this DELETE is "the highest-risk instance"
  of Risk #5 — "destructive, irreversible, cascading, no status window." Its
  entire correctness proof is manual (1.5–1.10) against "a hosted/dev Supabase"
  with "two real accounts." Automated checks 1.1–1.4 are lint / tsc / build / a
  filename regex — none exercise the handler. The plan also states the local
  Supabase stack is unreliable in this environment. So: (a) a green Phase-1
  automation run says nothing about whether the ownership guard works, and a
  reviewer skimming Progress could mistake it for "done"; (b) there is no
  contingency if the implementer can't reach a hosted project + two accounts.
  Research OQ7 raised "build a two-user test now" vs. "defer"; the plan defers
  (reasonable — §6.2 harness doesn't exist) but doesn't own the consequence.
- **Fix A ⭐ Recommended**: Make the manual gate un-skippable and explicit
  - Strength: Zero new tooling; matches the test-plan's deliberate sequencing
    (§6.2 harness is Phase 2's job); prevents a false "done" on the app's most
    dangerous route.
  - Tradeoff: Phase 1 can stall on infra availability with no code-level safety
    net.
  - Confidence: HIGH — consistent with plan-brief's own "Open Risks."
  - Blind spot: Doesn't reduce the window where the handler ships unexercised if
    the human signs off loosely.
  - Edit: Add to Phase 1 — "Phase 1 is BLOCKED (not complete) until 1.5–1.10
    pass against a real Supabase with two accounts; automated checks alone do
    not close this phase." Record in Progress which manual checks ran, against
    which project.
- **Fix B**: Pull a minimal handler test forward into this change
  - Strength: Real automated signal on the ownership guard before any UI exists;
    Phase 2 rollout inherits the harness.
  - Tradeoff: Does §6.6 env-setup work ahead of its planned phase; mild scope
    creep against the test-plan's rollout order.
  - Confidence: MED — the stub pattern is named in §4 but unbuilt; first use
    always costs more than budgeted.
  - Blind spot: A stub can pass while real RLS/cascade behaves differently —
    doesn't replace the two-account check.
  - Edit: One `undici MockAgent` / thin-Supabase-stub test of the handler:
    owner→200+deleted, non-owner→404+present, unauth→401, already-gone→404,
    db-error→500.
- **Decision**: FIXED via Fix A — Phase 1 Implementation Note now marks the phase
  "BLOCKED — not complete" until 1.5–1.10 pass against a real Supabase with two
  accounts; a Progress blockquote requires recording project ref + date per
  check and says automated checks alone do not close the phase; escalation path
  added if hosted infra is unavailable.

### F3 — History-row restructure under-specified (hover target, pill, click area)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3 — History-list row restructure
- **Detail**: Today the whole row card is one
  `<a class="flex … justify-between … hover:bg-white/20">`
  (`sessions/index.astro:72-81`) — full-card click target, full-card hover.
  Phase 2 says split the `<a>` down to the text/pill area with the island
  beside it and "Preserve the current hover / layout styling" — now ambiguous:
  does hover-highlight stay on the whole card (then it fires on delete-button
  hover too) or only the link? Where does the status pill sit relative to the
  delete button (both currently pushed right by `justify-between`)? Is the whole
  `<li>` still clickable? Manual check 2.4 pins only "filename/pill area still
  navigates."
- **Fix**: In Phase 2 §3, specify: `<li>` becomes the bordered card + hover
  owner; an inner flex row holds [link(filename+date) · status pill ·
  DeleteSessionButton]; the `<a>` covers filename+date+pill, the island is a
  non-nested sibling. State that whole-card click is dropped (link area only).
- **Decision**: FIXED — Phase 2 §3 Contract rewritten as a 4-point spec (`<li>`
  = card + hover owner; inner flex row with non-nested link/island siblings;
  `<a>` scoped to filename/date/pill; whole-card click dropped). Manual checks
  2.11 (hover) and 2.12 added.

### F4 — `sessions_delete_own` is non-load-bearing; research's simplification spike unaddressed

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 — migration / Implementation Approach
- **Detail**: The plan adds `sessions_delete_own` but the handler deliberately
  bypasses it (admin client), exactly as `sessions_insert_own` became dead code
  after Deviation 3. The plan is honest that it's "not the load-bearing guard."
  But research OQ1 flagged a cheap spike the plan never mentions: "verify
  whether the JWT-propagation issue still reproduces on the current
  `@supabase/ssr` version — if it's fixed, an RLS-only user-client delete
  becomes viable and simpler." Deviation 3 is ~3 months old. If it no longer
  repros, the handler could collapse to
  `supabase.from("fitting_sessions").delete().eq("id",id).select()` relying on
  the new policy — no admin client, no pre-check, and the migration stops being
  dead code.
- **Fix**: Add a decision note to Phase 1: either (a) time-box a spike
  (re-test the Deviation-3 JWT propagation on current `@supabase/ssr`); if
  fixed, simplify to a user-client delete + `sessions_delete_own` as the real
  guard — or (b) explicitly accept the belt-and-braces handler and label the
  migration "forward-compat DDL, not active enforcement" rather than
  "defense-in-depth guard."
- **Decision**: FIXED via Fix B — Overview, Implementation Approach, and Phase 1
  §1 Intent now label the policy "forward-compatible DDL, not active
  enforcement" and explicitly record that research OQ1's JWT-propagation spike
  was weighed and declined for this change. plan-brief decision row updated to
  match.

### F5 — Destructive-action error lacks `role="alert"`; post-cancel focus unspecified

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 — DeleteSessionButton
- **Detail**: The plan copies the `VideoUpload.tsx:168` idiom
  (`<p className="text-destructive text-sm">`) for the error. On an
  upload-validation message that's fine; on "couldn't delete your session" it's
  a silent DOM change for screen-reader users. Manual check 2.9 covers
  focusability of the controls but not focus *return* after Cancel or after a
  failed Confirm.
- **Fix**: Give the error `<p>` `role="alert"`; on Cancel and on error, move
  focus back to the delete trigger.
- **Decision**: FIXED — Phase 2 §2 Contract now specifies
  `<p role="alert" …>` for the error and a `ref` on the idle trigger with
  focus-return on Cancel and on a failed Confirm. Manual check 2.12 added.
