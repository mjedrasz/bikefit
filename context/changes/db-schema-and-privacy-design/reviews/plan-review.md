<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Database Schema and Privacy Design

- **Plan**: context/changes/db-schema-and-privacy-design/plan.md
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: SOUND (after fixes applied)
- **Findings**: 0 critical | 0 warnings | 0 observations (all 3 findings fixed during triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (fixed) |
| Plan Completeness | PASS (fixed) |

## Grounding

5/5 paths verified (2 absent as plan states — to be created), 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Missing seed.sql breaks supabase db reset

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis + Phase 1 & Phase 3 Success Criteria
- **Detail**: `supabase/config.toml` has `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`. The file doesn't exist. `supabase db reset` runs the seed after migrations and fails on the missing file, blocking Phase 1 (step 1.1) and Phase 3 (step 3.1).
- **Fix**: Added empty `supabase/seed.sql` creation as Phase 1 step 1. Updated Current State Analysis and "What We're NOT Doing" for consistency.
- **Decision**: FIXED

### F2 — Progress section missing Phase 3 manual checkboxes

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress → Phase 3 Manual section
- **Detail**: Phase 3 Manual Verification had 5 bullets in the plan body but only 3 checkboxes in Progress. Missing: "Insert without user_id rejected (NOT NULL)" and "Three policies visible in Studio." Also noted: Phase 1 Manual had 4 bullets merged into 3 checkboxes.
- **Fix**: Added checkboxes 3.4 (NOT NULL check) and 3.7 (three policies visible); renumbered existing 3.4–3.6 to 3.5–3.6 and 3.8.
- **Decision**: FIXED

### F3 — No index on analysis_results.session_id

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — SQL Migration
- **Detail**: The `results_select_own` RLS policy uses a correlated subquery on `analysis_results.session_id`. No index on that column or on `fitting_sessions.user_id` (used in both RLS policies). Sequential scans on every authenticated read.
- **Fix**: Added `CREATE INDEX ON fitting_sessions(user_id)` and `CREATE INDEX ON analysis_results(session_id)` to the migration SQL.
- **Decision**: FIXED
