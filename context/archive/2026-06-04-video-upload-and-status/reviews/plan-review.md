<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Video Upload and Status Implementation Plan

- **Plan**: context/changes/video-upload-and-status/plan.md
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: REVISE
- **Findings**: 1 critical | 2 warnings | 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

5/5 paths ✓ (`src/types.ts`, `src/lib/schemas.ts`, `src/lib/services/supabase-admin.ts`, `src/pages/api/sessions/[id].ts`, `src/pages/dashboard.astro`), 4/4 symbols ✓ (`FittingSession`, `SessionStatus`, `video_filename`/`video_duration_s`, `createAdminClient`), brief↔plan ✓. Lessons check: plan correctly uses `npx tsc --noEmit` ✓. Progress format: structure, phase matching, checkbox placement all correct ✓.

## Findings

### F1 — GET /api/sessions/:id doesn't return error_message

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — VideoUpload React Island + existing [id].ts
- **Detail**: The Phase 2 component contract explicitly states the `failed` state must "show error_message". The Testing Strategy (item 4) says "confirm the component shows the error". But the existing polling endpoint at `src/pages/api/sessions/[id].ts` (line 20) selects only `"status, updated_at"` and returns `{ status, updated_at }`. The `error_message` field exists on `FittingSession` (`src/types.ts:10`) but is never fetched or returned. No phase in the plan modifies this endpoint. When the component receives `{ status: "failed" }` from polling, it has no error_message to display.
- **Fix A ⭐ Recommended**: Add `error_message` to the GET endpoint and note it in Phase 1. Modify `[id].ts`: change `.select("status, updated_at")` to `.select("status, updated_at, error_message")`, update the `Pick<>` type, and include `error_message` in the JSON response. Add as a Phase 1 step so it lands before the component that needs it.
  - Strength: One-line select change; keeps the failure UX meaningful and satisfies the component contract as written.
  - Tradeoff: Broadens the scope of Phase 1 by one small step.
  - Confidence: HIGH — the field already exists in the DB and the type.
  - Blind spot: Should verify no existing consumer of this endpoint breaks on the added field (none exist yet).
- **Fix B**: Remove the `error_message` display requirement; show a generic "Analysis failed" message. No endpoint change needed; component is simpler. But guts a stated end-state requirement and makes Testing Strategy item 4 meaningless.
- **Decision**: FIXED via Fix A

### F2 — Phase 1 contract omits the 201 status code

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — POST /api/sessions route contract
- **Detail**: Success criteria say "201 with `{ id, status: 'queued' }`" but the contract says only "Returns `{ id, status }` on success" with no HTTP status code. The F-02 pattern uses plain `Response.json({...})` which defaults to 200. An implementer following the contract prose could return 200, causing the success criteria to fail without knowing why.
- **Fix**: Add "Returns **201** with `{ id, status }`" to the contract description — one-word change.
- **Decision**: FIXED (applied during F1 fix — "Returns **201** with `{ id, status }`" added to POST contract)

### F3 — No error handling defined for polling failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — VideoUpload React Island, Polling section
- **Detail**: The component contract specifies the happy-path polling loop but says nothing about what happens when `GET /api/sessions/:id` returns a non-2xx response (network error, 503, 404). The seven-state machine has no "networkError" state. Under Cloudflare Workers cold starts or transient Supabase errors, a single failed poll silently leaves the user staring at a `queued` card forever.
- **Fix A ⭐ Recommended**: Specify a retry-then-fail policy. Add to Phase 2 contract: "On fetch error, log to console and continue polling. After N consecutive errors (e.g. 5), transition to `error` state with a 'Connection lost' message."
  - Strength: Explicit policy the implementer can code to; prevents silent infinite polling.
  - Tradeoff: Requires a small additional counter.
  - Confidence: HIGH — standard polling resilience pattern.
  - Blind spot: Threshold of 5 is arbitrary; plan should note it's adjustable.
- **Fix B**: Specify silent-continue-only. Add: "On fetch error, log and continue polling — never surface network errors to the user in MVP." Simpler, but broken connectivity is invisible to the user.
- **Decision**: FIXED via Fix A
