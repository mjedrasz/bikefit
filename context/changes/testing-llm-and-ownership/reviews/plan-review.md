<!-- PLAN-REVIEW-REPORT -->
# Plan Review: LLM boundary + API-route integration (test-plan Phase 2)

- **Plan**: context/changes/testing-llm-and-ownership/plan.md
- **Mode**: Deep
- **Date**: 2026-09-03
- **Verdict**: REVISE → **SOUND** after triage (2026-09-03 — all 6 findings fixed in the plan)
- **Findings**: 2 critical, 2 warnings, 2 observations — F1–F6 all FIXED

## Verdicts

| Dimension | Verdict (as reviewed) | After triage |
|-----------|-----------------------|--------------|
| End-State Alignment | WARNING | PASS — F6 annotated in Phase 6 #5 |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS — F1 two-project config; F4 pure module |
| Blind Spots | WARNING | PASS — F3 `queued` predicate; F4/F5 coverage |
| Plan Completeness | FAIL | PASS — F1 contradiction resolved; F2 checkboxes fixed |

## Grounding

13/13 file paths exist. Symbols verified: `recommendationSchema` / `bodyAngleSchema` /
`analyzeRequestSchema` / `resultsPayloadSchema` (src/lib/schemas.ts), `analyzeVideo` /
`generateRecommendations` (src/lib/services/llm.ts), `SESSION_STATUS_META`
(src/lib/session-status.ts), `postError` + `sessionId` prop (VideoAnalyzer.tsx),
`SessionStatus` + `updated_at` (src/types.ts). `undici` 7.24.8 resolvable at top level ✓.
Astro Container API present (`node_modules/astro/dist/container/`) ✓. Astro 6.3.7,
Vitest 4.1.11 ✓. `astro.config.mjs` env schema matches the stub export list ✓.
Only `astro:env/server` and `astro:middleware` virtual modules in the route/page import
graph (middleware not route-imported) ✓. brief↔plan consistent ✓.
**Grounding failure**: a plain `vitest.config.ts` (no Astro Vite plugin) cannot import a
`.astro` file — verified with a throwaway spec (`import Layout from "@/layouts/Layout.astro"`
→ `vite:import-analysis` parse error). Drives F1.

## Findings

### F1 — Container-API page tests can't run under the mandated plain Vitest config

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Completeness (internal contradiction) + Architectural Fitness
- **Location**: Phase 1 §3 (config contract) + §6 (`renderPage`) + §7 (page smoke); Desired End State; Phase 3 #4–#6 and Phase 5 #2/#3/#7 (rendered-markup assertions)
- **Detail**: Desired End State promises "SSR-page tests via Astro's Container API", and Phase 1 #6 (`renderPage`), #7 (smoke-render `sessions/index.astro`), Phase 3 #4–#6 (blank-card fix asserted in rendered markup) and Phase 5 #2/#3/#7 ("timed out" copy in rendered markup) all require importing `src/pages/sessions/*.astro` into a spec. Phase 1 #3 mandates "keep everything else (plain `defineConfig` …) exactly as is … No `getViteConfig`, no adapter, no `setupFiles`." A plain Vitest config has no Astro Vite plugin, so `.astro` is parsed as raw JS and fails (`Failed to parse source for import analysis … invalid JS syntax`, Layout.astro:19 — verified). The `astro:env/server` alias-stub fixes a different problem (the env-virtual-module throw for route-handler `.ts` specs) and does nothing for `.astro` compilation. Rendering `index.astro` additionally needs a React renderer registered for `DeleteSessionButton client:visible`, whose documented path (`loadRenderers` from `astro:container`) pulls in another virtual module. The plan's own Key Discoveries note `getViteConfig`'s second-arg override exists, then decline it — while keeping an end state that needs it.
- **Fix A ⭐ Recommended**: `getViteConfig` for the page-render layer, as a second Vitest project
  - Strength: Keeps the fast plain config for unit + route-handler + contract specs (the bulk); adds a `getViteConfig(vite, inlineAstro)` project only for the 2 page files — the officially documented Astro testing setup, which also registers framework renderers. Plan already found the adapter-dropping 2nd arg.
  - Tradeoff: Two test configs; the page project is slower and the Cloudflare-adapter exclusion needs a Phase 1 spike to confirm.
  - Confidence: HIGH — documented path; only the adapter override is unverified in this repo.
  - Blind spot: Whether `@astrojs/cloudflare` can be fully excluded via the inline Astro config without `astro sync` complaints.
- **Fix B**: Drop Container-API rendering; test page logic as extracted pure helpers
  - Strength: One fast config; consistent with §6.1 and the Stryker pure-module scope; zero adapter / virtual-module friction.
  - Tradeoff: Phases 3 & 5 lose "assert rendered markup" — the blank-card fix and the timed-out copy become logic assertions + a deferred Phase 4 e2e. Risk #7's "blank card" is a rendering bug by nature.
  - Confidence: MED — reduces signal for the scenario the phase most needs it.
  - Blind spot: How much of `[id].astro`'s branching is template-level vs cleanly extractable.
- **Decision**: FIXED via Fix A — Phase 1 #3 rewritten as a two-project Vitest config (`unit` plain + `pages` via `getViteConfig`, scoped to `src/pages/sessions/*.{test,spec}.ts`); Phase 1 spike added before `renderPage` with the pure-helper path as the documented fallback; Key Discoveries, Critical Implementation Details, Phase 1 #6/#8, Phase 1 success criteria + Progress 1.9 updated.

### F2 — Phase blocks use `- [ ]` checkboxes instead of plain bullets

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All six phase blocks — `#### Automated Verification` / `#### Manual Verification`
- **Detail**: Every phase's verification bullets are `- [ ]` checkboxes (~48). The mechanical Progress contract (`references/progress-format.md`; `10x-implement` SKILL.md line 48: "Phase blocks contain plain `- ` bullets (no checkboxes)") and the shipped sibling plan `testing-angle-correctness` reserve `[ ]`/`[x]` for `## Progress` only. The `## Progress` section here is otherwise correct and complete (6 phases, N.M numbering, Automated/Manual split, counts match). `10x-plan` SKILL.md contradicts itself (line 748 vs 401/481/543); the plan followed the stale line. Practical parse risk is limited (`/10x-implement` scopes its scan to `## Progress`) but the convention break invites ticking the wrong boxes and obscures which list is authoritative.
- **Fix**: Convert `- [ ]` → `- ` in the `#### Automated/Manual Verification` blocks of all six phases. Leave `## Progress` untouched.
- **Decision**: FIXED — all six phases' `#### Automated/Manual Verification` bullets converted to plain `- `; `## Progress` left as `- [ ]`.

### F3 — Staleness rule covers `processing` but not `queued`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 #1 (`effectiveSessionStatus`), #5, #6
- **Detail**: `effectiveSessionStatus` flips to `failed` only when `status === "processing"` and stale. Research §4c item 3: on a `/start` failure the admin `UPDATE queued→processing` fails (transient, or the new `.eq("user_id")` guard from Phase 4 #1 matches 0 rows — not an `error`, so Phase 5 #5's `if (error)` check misses it), the session stays `queued`, and `postError` → `/results` 409s because status isn't `processing`. Result: a permanently non-terminal session rendering "Still processing — check back soon." forever on `[id].astro` — the exact Risk #6 failure mode via `queued`. Phase 5 fixes the cause (check the start UPDATE → 500) but the DB row still has no terminal state and the display rule doesn't rescue it.
- **Fix**: Widen the predicate to `(status === "processing" || status === "queued") && now - Date.parse(updatedAt) > STALE_PROCESSING_MS`. A freshly created `queued` row has `updated_at ≈ created_at` and the client calls `/start` on mount, so a normal session never trips it. Add stale/fresh `queued` unit cases. Alternative: keep `processing`-only but add a "What We're NOT Doing" line explaining why `queued`-stuck is accepted.
  - Strength: One-line predicate change closes an identical failure mode; no new mechanism; pages already route through the helper.
  - Tradeoff: A user opening the results page 15 min after create but before `/start` lands would see "timed out" — practically impossible given `/start` is the first fetch on mount.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via "Widen predicate" — Phase 5 #1 predicate is now `(status === "processing" || status === "queued") && stale`; #2 render branch, #7 unit cases (stale/fresh `queued`), Phase 5 Overview, Desired End State and plan Overview Risk #6 updated.

### F4 — `stripJsonFence` under-covered and outside unit/mutation reach

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots (test coverage) + Architectural Fitness
- **Location**: Phase 2 #2; Testing Strategy → Unit Tests
- **Detail**: `stripJsonFence` is one of the two core Risk #2 behaviors, with real branching (leading ```json, bare ```, trailing ```, no-fence passthrough, fence-only→throw). The plan gives it one indirect case ("exercised indirectly through the contract suite (fenced-body case)"). As an un-exported local helper in `llm.ts` — which imports `astro:env/server` — it's also outside the §6.1 pure-unit pattern and the Stryker `mutate` scope (limited to `astro:env`-free modules).
- **Fix**: Extract fence-stripping (and optionally the per-item schema helpers) into a pure module e.g. `src/lib/llm-response.ts` (no I/O), unit-test the branch cases directly, and let Stryker mutate it. `llm.ts` imports from there.
- **Decision**: FIXED — Phase 2 #2 rewritten to create pure `src/lib/llm-response.ts` (`stripJsonFence`, optionally the per-item schemas); Phase 2 #1, Testing Strategy → Unit Tests, Phase 2 success criteria + Progress 2.9 updated.

### F5 — Corpus omits the legitimate empty-`timestamps` success case

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 #4 (contract corpus)
- **Detail**: `ANALYZE_VIDEO_SYSTEM_PROMPT` explicitly instructs the model to return `{ "timestamps": [] }` when unsure — a valid response. The corpus is all malformed cases + one fenced success. A regression that makes `timestampItemSchema` validation reject `[]` would pass the whole suite.
- **Fix**: Add a passing case — 200 + `{ timestamps: [] }` → `analyzeVideo` resolves `{ timestamps: [] }`, no throw. (The "no keyframes" error is a client-side `VideoAnalyzer` concern, out of `llm.ts` scope.)
- **Decision**: FIXED — Phase 2 #4 corpus gains the `{ timestamps: [] }` passing case; the "successful parse" note and Progress 2.2 updated.

### F6 — §3 "test-only against behavior that already exists" not reconciled

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 6 (cookbook / doc-sync steps)
- **Detail**: test-plan §3 states "All other phases [besides Phase 3] are test-only against behavior that already exists." Phase 2 ships real behavior changes: `effectiveSessionStatus` + page wiring, `/analyze` session-binding, an `analyzeRequestSchema` contract change + `VideoAnalyzer` client change, and the Step-7 `postError` change. Research OQ-1 explicitly asked the plan to flag that this stretches Phase 2 past test-only. The plan adds §7 and §4 notes but never touches §3's framing.
- **Fix**: Add a Phase 6 sub-step annotating the §3 Phase 2 row / that sentence (Phase 2 included the minimal display-time + client hardening the four risks required) and flag a `/10x-test-plan --refresh`, consistent with how Phase 6 #2 handles the §4 drift.
- **Decision**: FIXED — Phase 6 #5 added (annotate §3's "test-only" sentence / Phase 2 row + `/10x-test-plan --refresh` pointer); Phase 6 success criteria + Progress 6.8 updated.
