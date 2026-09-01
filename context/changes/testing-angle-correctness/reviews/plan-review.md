<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test Harness Bootstrap + Joint-Angle Correctness

- **Plan**: context/changes/testing-angle-correctness/plan.md
- **Mode**: Deep
- **Date**: 2026-09-01
- **Verdict**: REVISE → **SOUND** after triage (2026-09-01 — all 7 findings fixed in plan.md)
- **Findings**: 0 critical, 4 warnings, 3 observations — all FIXED

## Summary

The plan is fundamentally sound. Research is thorough; the `computeTorsoAngle`
left/right-facing bug and its `atan2(|dy|,|dx|)` fix are geometrically correct;
the oracle discipline (geometry + `bike-fitting-ref-angles.md`, never current
output, never the superseded `pose-estimation-research.md` convention) is right;
blast radius is genuinely tiny (all six symbols live only in
`VideoAnalyzer.tsx`); the `## Progress` block is well-formed and matches project
precedent. Findings are refinements, not approach problems.

## Verdicts

| Dimension | Verdict (at review) | After triage |
|-----------|---------|---------|
| End-State Alignment | WARNING | PASS (F5 fixed) |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS (F6, F7 fixed) |
| Blind Spots | WARNING | PASS (F1, F4 fixed) |
| Plan Completeness | WARNING | PASS (F2, F3 fixed) |

## Grounding

6/6 paths ✓, 8/8 symbols ✓, brief↔plan ✓, Progress↔Phase ✓. Line-number
citations in the plan (`ANGLE_REFS` 22–28, `jointAngle` 47–53,
`computeTorsoAngle` 55–58, `visible` 60–62, `convertKeypoints` 103–137, BDC/TDC
scan 264–283, emission 286–339, `[id].astro:40–44`, `format-angle.ts:6–8`) all
verified accurate. CI runs `npx astro sync` but not `npm test` (confirmed
`.github/workflows/ci.yml`). Astro Vitest config in the plan matches the Astro 6
docs verbatim (`getViteConfig` + `environment: "node"`, verified via Context7
2026-09-01).

## Findings

### F1 — pickExtremumFrame extraction: outer-loop + tie-break semantics unpinned

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Critical Implementation Details / Changes Required #2
- **Detail**: Phase 2 claims "byte-for-byte behaviour-preserving" but restructures
  the BDC/TDC scan (`VideoAnalyzer.tsx:260–284`) into a pure `pickExtremumFrame`.
  Two behaviours the plan never pins:
  (a) The current outer `for (const {t,type} of timestamps)` loop tries the NEXT
  timestamp when a timestamp yields no usable pick (`if (type==="BDC" &&
  bdcLandmarks) continue` — `null` is falsy). If the component instead collects
  candidates across ALL BDC timestamps into one array and calls
  `pickExtremumFrame` once, it picks a global extremum rather than "first usable
  timestamp's extremum" — a different frame for any video with multiple BDC/TDC
  timestamps.
  (b) Current code uses strict `>` / `<` seeded at ∓Infinity, so the FIRST
  (earliest-offset) candidate wins an exact tie; a `>=` or naive reducer flips
  that.
  Either drift silently changes which frame every knee/torso/elbow angle is
  measured from — squarely Risk #1 — and `npm run build` + one manual run won't
  catch it.
- **Fix**: In Phase 2's contract, state that the outer timestamps loop and its
  first-non-null-pick-wins guards are copied verbatim, and `pickExtremumFrame` is
  called once per timestamp on that timestamp's ≤5 offset candidates. Specify
  `pickExtremumFrame` keeps the first candidate on an exact tie (strict `>`/`<`).
  Add a spec case asserting first-wins-on-tie.
  - Strength: Makes the one genuine restructure in an otherwise pure move
    explicit and testable; the tie case becomes a real spec, not an assumption.
  - Tradeoff: Slightly more prescriptive plan text; the tie spec case is
    contrived (exact float ties never occur on real video).
  - Confidence: HIGH — verified against `VideoAnalyzer.tsx:260–284`.
  - Blind spot: None significant.
- **Decision**: FIXED — pinned outer-loop verbatim copy + per-timestamp call + strict-comparison/∓Infinity first-wins tie-break in Critical Implementation Details and Phase 2 contract; added tie spec case to Phase 3 and Testing Strategy.

### F2 — "exactly the two left-facing torso cases fail" undercounts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Success Criteria 3.2 (and plan narrative ~line 210)
- **Detail**: Phase 3's `computeTorsoAngle` spec list defines left-facing
  assertions at 45°, 50°, near-horizontal AND near-vertical ("both facings").
  Before the fix, left-facing returns `180−true`, so reverting the fix fails 4+
  left-facing assertions. Criterion 3.2 says "exactly the two left-facing torso
  cases fail"; the narrative says "confirm it fails with ~135". An implementer
  checking 3.2 literally will think the spec is over-broad or the fix is wrong.
- **Fix**: Reword 3.2 to "reverting the torso fix fails every left-facing torso
  assertion (and no right-facing one)".
- **Decision**: FIXED — reworded criterion 3.2, Progress step 3.2, and the Phase 3 narrative.

### F3 — Silent override of frozen test-plan §4 (DOM environment)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries / What We're NOT Doing / Phase 5
- **Detail**: `test-plan.md` §4 Stack row reads "DOM environment | happy-dom or
  jsdom | none yet — see Phase 1 | ... unit tests for its pure helpers still need
  a DOM global." The plan uses `environment: "node"` and defers happy-dom to
  Phase 2. The plan's call is CORRECT (all seven extracted functions are
  genuinely pure over plain objects — verified), but §1–§5 are frozen and changed
  only via `/10x-test-plan --refresh`. Phase 5 updates §6/§7, not §4, so §4 keeps
  misdirecting the next reader to a DOM env in Phase 1.
- **Fix**: Add one line to the plan noting the deviation from frozen §4 and that
  §4's DOM-env row needs a `/10x-test-plan --refresh` to move to Phase 2; call it
  out in the Phase 5 handoff back to the orchestrator.
- **Decision**: FIXED — added a "Deviation from frozen §4" bullet to Key Discoveries, a note in What We're NOT Doing, and a flag in the Phase 5 orchestrator handoff.

### F4 — `npm test` not self-contained (astro sync prerequisite)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Critical Implementation Details ("astro:env boundary")
- **Detail**: `.astro/` is gitignored, there is no `prepare`/`pretest` script, and
  CI runs `npx astro sync` as a standalone step (confirmed in `ci.yml`). The plan
  only says to add `astro sync` "as a `pretest` hint in the plan notes". A fresh
  `git clone && npm install && npm test` may fail at `getViteConfig`'s `astro:env`
  virtual-module resolution with no obvious cause. (Missing required secrets are
  NOT the risk — CI's `build` passes today without `SUPABASE_SERVICE_ROLE_KEY` /
  `OPENROUTER_API_KEY`, so secret vars validate lazily.)
- **Fix**: Decide explicitly in Phase 1 — add `"pretest": "astro sync"` to
  `package.json` (robust, ~1s slower per run) OR document the prerequisite in
  README's scripts section. Recommend the pretest script.
- **Decision**: FIXED (pretest script) — Phase 1 change #1 now adds `"pretest": "astro sync"`; the `astro:env` boundary note states it as a firm decision; Success Criterion 1.2, Progress 1.2, and Desired End State updated to a clean-state `npm test`.

### F5 — Risk #1's reference-band dimension left untracked

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: What We're NOT Doing / Phase 5 §7
- **Detail**: Risk #1 names "every in-range/outside-range verdict ... confidently
  wrong." This phase defends the geometry/convention dimension well, but the
  reference-band dimension — elbow `150–160` (road) vs `85–95` (gravel), which
  makes a correctly-fitted gravel rider's ~90° elbow read "Outside range" and
  triggers a bogus "shorten stem" rec — is PRD Open Question #2 (Block: yes). The
  plan correctly won't resolve it, but nothing in the plan ensures it gets
  resolved: it survives only as a §7 bullet and prose. "Defends Risk #1"
  overstates what ships.
- **Fix**: Add a tracked owner-decision item for PRD OQ#2 (a roadmap note or a
  stub `resolve-angle-reference-bands` change folder) and reword the framing to
  "defends the geometry/convention dimension of Risk #1; the reference-band
  dimension is tracked separately as OQ#2."
  - Strength: Keeps the highest-impact instance of Risk #1 from silently falling
    off the radar once Phase 1 is marked complete.
  - Tradeoff: Adds a tracking artifact the owner must actually action.
  - Confidence: HIGH — OQ#2 Block:yes confirmed `prd.md:128`;
    `angle-to-adjustment-guide.md:126–128` flags the conflict.
  - Blind spot: None significant.
- **Decision**: FIXED (reword + stub change folder) — Overview, What We're NOT Doing, and §7 now scope Phase 1 to the geometry/convention dimension; Phase 5 change #4 opens a `resolve-angle-reference-bands` stub and points Roadmap OQ-2 at it (new Success Criterion + Progress 5.6; Phase 5 manual steps renumbered to 5.7/5.8).

### F6 — `import type` requirement for the TF.js type not stated

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — Changes Required #1
- **Detail**: `convertKeypoints`'s signature needs `poseDetection.Keypoint`.
  `VideoAnalyzer.tsx:2` currently does `import type * as poseDetection` — a value
  import would pull TF.js into the SSR bundle and break the Cloudflare adapter
  (`lessons.md:19–24`). Phase 2 criterion 2.3 checks the build outcome but the
  plan never states the `import type` requirement, so a failure would be puzzling
  rather than expected.
- **Fix**: State in Phase 2 that `src/lib/pose/angles.ts` imports the pose type
  via `import type` only.
- **Decision**: FIXED — Phase 2 change #1's `convertKeypoints` bullet now specifies `import type * as poseDetection` (type-only), notes the SSR-bundle/Cloudflare hazard, and ties it to criterion 2.3.

### F7 — angleVerdict module placement vs. ANGLE_REFS

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 — Changes Required #1
- **Detail**: A one-line `value >= min && value <= max` gets its own module
  `src/lib/angle-verdict.ts` while `ANGLE_REFS` lands in `src/lib/pose/angles.ts`
  — three angle modules (`pose/angles.ts`, `angle-verdict.ts`, `format-angle.ts`).
  The verdict is meaningless without the refs it compares against. The extraction
  itself is justified (Risk #1 names the verdict); the placement is the nit.
- **Fix**: Consider `src/lib/pose/verdict.ts`, or export `angleVerdict` from
  `pose/angles.ts`. Cosmetic — fine to leave if the results page prefers a leaf
  import.
- **Decision**: FIXED (keep leaf module + cross-ref) — Phase 4 #1 now states the leaf-module placement is deliberate (keeps pose-math out of the SSR results page) and requires a doc-comment cross-ref to `ANGLE_REFS`; Phase 2 #1's `ANGLE_REFS` bullet gets the reciprocal cross-ref to `angleVerdict`.
