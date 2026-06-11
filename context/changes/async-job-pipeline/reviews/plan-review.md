<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Async Job Pipeline Implementation Plan

- **Plan**: context/changes/async-job-pipeline/plan.md
- **Mode**: Deep
- **Date**: 2026-05-31
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, 5/5 symbols ✓, brief↔plan ✓

Verified paths: `supabase/migrations/20260526120000_initial_schema.sql`, `src/types.ts`, `src/lib/supabase.ts`, `astro.config.mjs`, `src/pages/api/auth/signin.ts`. All present. `src/lib/services/` correctly absent (plan creates it).

## Verified Claims

- **Zod discriminatedUnion with optional error field**: safe. Zod v4 (4.4.3, already in node_modules as transitive dep) registers `undefined` as a valid discriminator value for `z.literal(false).optional()`. A success payload without an `error` key resolves to the success branch correctly. Note: plan must import from `'zod'` (v4 default), not `'zod/v3'`.
- **Astro `[id].ts` + `[id]/` coexistence**: supported. Astro 6's router registers files and directories independently; segment-count difference (3 vs 4) prevents collision detection from firing. 4-segment routes sort higher and are matched first. No config change needed.
- **Progress section format**: valid. One `## Progress` heading, phase headings match exactly, all success criteria have matching `- [ ]` items, no checkboxes in phase bodies.
- **Blast radius of astro.config.mjs edit**: minimal. Only `src/lib/supabase.ts` and `src/lib/config-status.ts` import from `astro:env/server`. Adding `SUPABASE_SERVICE_ROLE_KEY` is purely additive.

## Findings

### F1 — Route contracts omit null-guard for createClient()

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 (both routes), Phase 3
- **Detail**: `createClient()` returns null when `SUPABASE_URL` or `SUPABASE_KEY` are absent — both are declared `optional: true` in `astro.config.mjs`. The original route contracts said "use the cookie-based client" without specifying null handling. Calling `.from()` on a null client throws `TypeError` at runtime. Every existing route has this guard (`signin.ts:11-14` is the canonical example referenced by the plan).
- **Fix**: Add null-guard bullet before cookie-based client usage in each of the three route contracts: "If `createClient()` returns `null`, return `new Response('Service unavailable', { status: 503 })`."
- **Decision**: FIXED — null-guard bullets added to Phase 2 GET, Phase 2 POST /start, and Phase 3 POST /results contracts.

### F2 — Non-atomic two-step write in Phase 3 (already acknowledged)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Results Submission Endpoint
- **Detail**: INSERT into `analysis_results` then UPDATE `fitting_sessions` status are two separate statements. If the UPDATE fails after the INSERT succeeds, the session stays stuck in `processing` with an orphaned results row. The plan brief explicitly documents this as "acceptable for MVP".
- **Decision**: ACCEPTED — documented in plan brief as MVP-acceptable risk.
