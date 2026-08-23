<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Analysis Pipeline

- **Plan**: context/changes/ai-analysis-pipeline/plan.md
- **Scope**: All Phases (1–4 of 4)
- **Date**: 2026-06-14
- **Verdict**: REJECTED → APPROVED after triage fixes
- **Findings**: 2 critical  4 warnings  4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Dead devDependency import in production LLM service

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/llm.ts:3
- **Detail**: `import { name } from "eslint-plugin-prettier/recommended"` was unused and imported a devDependency into a production service, crashing the Cloudflare Workers runtime.
- **Fix**: Deleted line 3.
- **Decision**: FIXED

### F2 — Non-existent vision model name

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/llm.ts:5
- **Detail**: `VISION_MODEL = "google/gemini-3.5-flash"` — flagged as non-existent model. User confirmed the model is valid.
- **Decision**: DISMISSED — user confirmed model exists on OpenRouter

### F3 — generateRecommendations JSON schema conflicts with runtime check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/llm.ts:179–200
- **Detail**: `response_format` had `type: "json_object"` with orphaned `json_schema`-style fields (`name`, `strict`, `schema`) including `additionalProperties: false`. The schema didn't declare `raw_llm_response` or `rationale`, but the runtime check at line 236 threw if `raw_llm_response` was missing. Removed the orphaned fields, keeping only `{ type: "json_object" }`.
- **Decision**: FIXED (Fix A — cleaned up to `{ type: "json_object" }`)

### F4 — Unplanned change to sessions/index.ts (createAdminClient swap)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/sessions/index.ts:2, 27
- **Detail**: File not in any phase's "Changes Required" but in diff. Switched session creation to `createAdminClient()` bypassing RLS on the INSERT path.
- **Decision**: FIXED (documented as Deviation 3 in plan's Implementation Deviations section)

### F5 — No server-side size cap on base64 video payload in /api/analyze

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schemas.ts:21–23
- **Detail**: `analyzeRequestSchema` had no upper bound on video field.
- **Fix**: Added `.max(140_000_000)` to match 100 MB client-side cap.
- **Decision**: FIXED

### F6 — Supabase query error silently masked as 404 in /recommend

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/sessions/[id]/recommend.ts:19
- **Detail**: Only `{ data }` was destructured, ignoring `error`. Combined with F7 fix (status check), now destructures `{ data: session, error }` and returns 404 on error (consistent with start.ts pattern).
- **Decision**: FIXED (combined with F7)

### F7 — /recommend allows LLM call on terminal-state sessions

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/api/sessions/[id]/recommend.ts
- **Detail**: No status check before calling LLM — completed/failed sessions could be re-processed.
- **Fix**: Added `select("id, status")` and `if (session.status !== "processing") return 409`.
- **Decision**: FIXED

### F8 — VideoUpload.tsx error message says "3 seconds" but MIN_DURATION is 2

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/VideoUpload.tsx:156
- **Detail**: MIN_DURATION=2 but error message said "at least 3 seconds".
- **Fix**: Updated error message to "at least 2 seconds".
- **Decision**: FIXED

### F9 — Error detail leaked in /api/analyze JSON parse error response

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/analyze.ts:17
- **Detail**: `"Invalid JSON" + err` concatenated SyntaxError into user-facing response.
- **Fix**: Changed to `{ error: "Invalid JSON" }` and removed caught variable.
- **Decision**: FIXED

### F10 — VideoAnalyzer.tsx blob URL cleanup relies on caller convention

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/components/VideoAnalyzer.tsx:86–101
- **Detail**: `loadVideoElement` blob URL only revoked in onerror path. Happy path cleanup relied on callers calling `URL.revokeObjectURL`.
- **Fix**: Hoisted `let videoEl: HTMLVideoElement | undefined` to `runPipeline` scope; wrapped function body in `try/finally` that always calls `if (videoEl) URL.revokeObjectURL(videoEl.src)`.
- **Decision**: FIXED
