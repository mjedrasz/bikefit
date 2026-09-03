# Resolve the Authoritative Gravel Angle Reference Bands — Plan Brief

> Full plan: `context/changes/resolve-angle-reference-bands/plan.md`

## What & Why

BikeFit judges every measured body angle "in range / outside range" against five
hard-coded reference bands, and generates fitting recommendations against them.
Those bands are **PRD Open Question #2 / Roadmap OQ-2** — Block: yes on the
north-star slice, never formally resolved — and they are **triplicated**: a code
constant (`ANGLE_REFS`), a markdown table in the LLM prompt, and inline
thresholds in that prompt's per-angle rules. Two archived reference docs
*appear* to disagree (most sharply on the elbow: 150–160° vs 85–95°), but the
elbow gap turns out to be a shoulder-angle-vs-elbow-angle measurement mismatch,
not a real conflict. This change makes the owner decision, propagates it to one
source of truth, guards it with tests, and closes OQ-2 everywhere.

## Starting Point

`ANGLE_REFS` in `src/lib/pose/angles.ts` holds KNEE_BDC 137–147, KNEE_TDC 65–75,
HIP 55–65, TORSO 45–55, ELBOW 150–160. `VideoAnalyzer.tsx` bakes these into each
persisted `BodyAngle`; the results page verdict reads the **stored per-row**
copy; `llm.ts` restates them twice in prose. `src/lib/services/llm.ts` imports
`astro:env/server` at module top, so anything testing the prompt must run
against a pure module. No test asserts `ANGLE_REFS`; `angleVerdict` is tested
with synthetic bands only.

## Desired End State

One authoritative doc — `context/foundation/reference-angles.md` — states the
blessed bands and the reasoning. `ANGLE_REFS` carries them and is the single
source: the LLM prompt's reference table is generated from it, and its per-angle
rules speak of "the reference range" rather than specific degrees. Tests pin
`ANGLE_REFS` to the doc and assert the generated prompt matches. PRD, roadmap,
and test-plan all read OQ-2 as RESOLVED. Historical sessions are untouched.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Authoritative source | Bless `bike-fitting-ref-angles.md` (13-source review), promoted to `context/foundation/reference-angles.md` | It is already the sourced literature synthesis OQ-2 asked for; 4 of 5 bands need no change | Plan |
| Elbow band | Widen to **150–165°** included | Practitioner references (BikeFittr printable angle chart, Indoor Cycling Association goniometer protocol, torger.se) put the elbow *included* angle on the hoods at 150–170°; ~90° included is the TT/aero position. The guide's 85–95° is within rounding of the *upper-arm-to-torso* "shoulder forward angle" (`bike-fitting-ref-angles.md:57`, a separate 80–90° row), not the angle the code computes. Opened to 150–165 to cover a relaxed upright gravel arm | Plan + web research |
| Knee-BDC / knee-TDC / hip | Reconcile toward the gravel guide → **135–145 / 68–74 / 55–70** | The adjustment guide is the more gravel/recreational-tuned of the two docs; hip widening has a cited rationale (breathing, back stress) | Plan |
| Torso band | **45–55°** unchanged | Both docs agree | Plan |
| Triplication | Generate the prompt table from `ANGLE_REFS`; strip inline threshold numbers from the per-angle rules | Makes `ANGLE_REFS` the sole source; future edits are one line | Plan |
| Doc location | Promote to `context/foundation/reference-angles.md`; leave archive untouched | Ends the "archaeology" framing; archive is read-only by convention | Plan |
| Historical data | Leave existing `analysis_results` rows untouched | Matches the Phase-1 torso-fix precedent — the app never recomputes persisted results | Plan |
| Regression test | Pin `ANGLE_REFS` to the doc + assert the generated prompt carries the numbers | Removes the "synthetic bands only" gap in Risk #1 | Plan |
| Tracking closure | Close OQ-2 in PRD + roadmap + test-plan §6.6/§7 + `change.md` Decision section | OQ-2 is Block: yes — one clean resolution, no stale markers | Plan |

## Scope

**In scope:** new `context/foundation/reference-angles.md`; `ANGLE_REFS` value +
`measuredAt` field + doc-comment updates; new pure `src/lib/recommendations-prompt.ts`
builder wired into `llm.ts`; two new/updated specs; OQ-2 closure across PRD,
roadmap, test-plan, `change.md`.

**Out of scope:** backfilling historical rows; the raw-vs-rounded display/pill
contradiction (tracked, pairs with S-05); editing archived docs; server-side
bounds validation (test-plan §3 Phase 2); bike-type detection; the vision
prompt; re-deriving the literature; OQ-1 / OQ-3.

## Architecture / Approach

`ANGLE_REFS` (single source)
  → `VideoAnalyzer.tsx` bakes bands into persisted `BodyAngle` (unchanged path)
  → `angleVerdict` on the results page (reads stored per-row bands)
  → `buildRecommendationsSystemPrompt(ANGLE_REFS)` renders the prompt table +
    range-relative rules → `llm.ts` `generateRecommendations`
  → `angles.test.ts` pins `ANGLE_REFS` to `context/foundation/reference-angles.md`;
    `recommendations-prompt.test.ts` pins the generated prompt to `ANGLE_REFS`.

The builder is a **pure** module (no I/O, no `astro:env`) so its spec never
imports `llm.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Blessed doc + reconciled `ANGLE_REFS` | Foundation doc; bands at 135–145 / 68–74 / 55–70 / 45–55 / 150–165; `measuredAt` field; repointed doc comments; `ANGLE_REFS` pin spec | `measuredAt` field or `as const` change disturbs a `VideoAnalyzer` / schema consumer |
| 2. End the triplication | Pure prompt builder from `ANGLE_REFS`; inline copies deleted from `llm.ts`; generator spec | Reworded per-angle rules degrade recommendation quality; prompt formatting drift |
| 3. Close OQ-2 tracking | RESOLVED annotations in PRD, roadmap (+ frontmatter), test-plan §6.6/§7; `change.md` Decision section | Missing one of the ~7 OQ-2 mentions |

**Prerequisites:** none — `testing-angle-correctness` Phase 1 already landed
(`ANGLE_REFS` extracted, `angle-verdict.ts` extracted, Vitest wired).
**Estimated effort:** ~1 session across 3 phases; mostly docs + one small
refactor.

## Open Risks & Assumptions

- Assumes `bike-fitting-ref-angles.md` is acceptable as the authoritative
  source without a certified-fitter consult (its own "[Author to verify]"
  citation caveat carried forward into the foundation doc).
- The hip widening to 55–70 shifts the band asymmetrically about its old
  midpoint — a returning user's borderline-open hip could flip verdict on a
  fresh run (accepted; historical rows unchanged).
- KNEE_TDC also **narrows**: 65–75 → 68–74 (10° wide → 6° wide). A returning
  user whose knee-TDC sits at 65–67° or 74–75° — inside the old band, outside
  the new one — flips to "Outside range" on a fresh run (accepted; historical
  rows unchanged; same class of effect as the hip shift).
- The elbow reconciliation assumes `angle-to-adjustment-guide.md` §5's 85–95°
  "elbow" figure is a shoulder-angle mislabel, not a genuine gravel convention
  — backed by multiple practitioner references but not confirmed with the
  guide's author. Widening ELBOW to 150–165 only loosens the band (max
  160 → 165), so no returning user is newly flagged.
- The reworded per-angle prompt rules must be checked for LLM output quality
  (Phase 2 manual step) — no automated signal for recommendation quality.

## Success Criteria (Summary)

- New analyses judge angles against 135–145 / 68–74 / 55–70 / 45–55 / 150–165,
  and the LLM prompt reflects the same numbers from one source.
- `npm test` fails if `ANGLE_REFS` or the generated prompt drifts from
  `context/foundation/reference-angles.md`.
- PRD OQ#2, roadmap OQ-2, and test-plan §7 all read RESOLVED and point to the
  foundation doc; `change.md` records the decision.
