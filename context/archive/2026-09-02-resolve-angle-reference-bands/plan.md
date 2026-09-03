# Resolve the Authoritative Gravel Angle Reference Bands Implementation Plan

## Overview

Resolve **PRD Open Question #2 / Roadmap OQ-2** (Block: yes) — *which numeric
range each of the five body angles is judged against*. This is the
**reference-band dimension of Risk #1**; the `testing-angle-correctness`
rollout phase deliberately scoped it out and left `ANGLE_REFS` untested and
`angleVerdict` exercised only with synthetic bands.

The change:

1. Blesses `context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`
   (a 13-source literature review — the deliverable OQ-2 asked for) as the
   authoritative source, promoted to `context/foundation/reference-angles.md`
   in reconciled form.
2. Reconciles the three drifted bands toward the gravel-adjustment guide's
   recreational tuning; widens the elbow slightly to the practitioner
   included-angle range for a relaxed hoods position; leaves torso unchanged.
3. Collapses the **triplicated** band copy — code constant, prompt table,
   prompt per-angle thresholds — into a single source: `ANGLE_REFS` drives a
   generated prompt.
4. Guards the result with tests that pin `ANGLE_REFS` to the doc and assert the
   generated prompt carries the same numbers.
5. Closes OQ-2 in every tracking artifact (PRD, roadmap, test-plan §6.6/§7,
   `change.md`).

## Current State Analysis

**The bands live in one data constant and are copied outward.**

| Location | Form | Notes |
|---|---|---|
| `src/lib/pose/angles.ts` `ANGLE_REFS` (lines ~23–29) | `as const` object: `{min, max, unit, name}` per key `KNEE_BDC / KNEE_TDC / HIP / TORSO / ELBOW` | The origin. Doc comment currently says "unresolved owner decision (PRD Open Question #2) — do not treat as authoritative". |
| `src/components/VideoAnalyzer.tsx` (lines ~223–268) | Reads `ANGLE_REFS.<KEY>.{name,min,max,unit}` field-by-field into each persisted `BodyAngle` | Bakes `reference_min` / `reference_max` into `analysis_results.body_angles` (JSONB). Historical rows carry a **frozen copy**. Does **not** spread `ANGLE_REFS` entries, so an added field is invisible to the payload. |
| `src/pages/sessions/[id].astro` (lines ~40–44, 79–80) | `angleVerdict(angle.value, angle.reference_min, angle.reference_max)` reads the **row**, then renders `formatAngle(...)` of both value and bounds | The verdict runs on the stored per-row bands, not on live `ANGLE_REFS`. |
| `src/lib/services/llm.ts` `RECOMMENDATIONS_SYSTEM_PROMPT` (lines ~9–63) | 2nd copy as a markdown "Reference angle ranges" table **and** a 3rd copy as inline thresholds in the "Per-angle adjustment rules" section (`<137°`, `>147°`, `<150°`, `>160°`, `<55°`, `>65°`, `<45°`, `>55°`) | Currently *consistent* with `ANGLE_REFS`. The user message (line ~166) also prints `reference: <min>–<max>` but that is fed from the `BodyAngle` data, so it is already single-sourced. |
| `context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md` | Sourced literature review, 13 citations | Referenced as the *convention* oracle by `src/lib/pose/angles.test.ts` (line ~18) and `test-plan.md` §7. Says knee-BDC 137–147, hip 55–65, knee-TDC ~65, torso 45–55, **elbow 150–160 included** (Burt 2014), and separately "upper arm to torso 80–90°". |
| `context/archive/2026-05-28-ai-analysis-pipeline/angle-to-adjustment-guide.md` | The "how to adjust" companion; the outlier | §1 knee-BDC **135–145**, §2 knee-TDC **68–74**, §3 hip "55–65 road; **up to 70° gravel/recreational**", §5 elbow **85–95°** with a *Convention note* framing 150–160 vs 85–95 as road-vs-gravel — but 85–95° is within rounding of the *upper-arm-to-torso* angle, likely a shoulder-angle mislabel (see Key Discoveries). |

**The actual conflict is narrow.** `bike-fitting-ref-angles.md` agrees with
the shipped `ANGLE_REFS` on knee-BDC, hip, torso. The guide differs on
knee-BDC / knee-TDC / hip (small, gravel-tuned). The elbow *looks* like a large
disagreement (85–95° vs 150–160°) but is a measurement mismatch, not a real
conflict: the guide's 85–95° "elbow" figure is within rounding of the
*upper-arm-to-torso* "shoulder forward angle" that `bike-fitting-ref-angles.md:57`
lists as a **separate** row (80–90°), not the shoulder–elbow–wrist included
angle `jointAngle(wl[11], wl[13], wl[15])` computes. Practitioner references
put that included angle on the hoods at 150–170° (BikeFittr printable angle
chart; Indoor Cycling Association goniometer protocol, "15–25° bend";
torger.se, "150–170"); ~90° *included* is the aggressive TT/aero position
(BikeFittr lists it as "90–110° for tri / extensions").

**No band regression coverage exists.** `src/lib/pose/angles.test.ts` tests
geometry/convention only; `src/lib/angle-verdict.test.ts` header states it
"deliberately does not assert against the contested `ANGLE_REFS` values (PRD
Open Question #2)".

**`astro:env` import hazard (from test-plan §6.6).** `src/lib/services/llm.ts`
imports `OPENROUTER_API_KEY` from `astro:env/server` at module top level —
importing that module in a Vitest spec throws at import time, and env-setup
wiring is deferred to a later test-plan rollout phase. Any new test that
touches the prompt must therefore run against a **pure** module that does not
transitively import `astro:env`.

## Desired End State

- `context/foundation/reference-angles.md` exists, is marked authoritative,
  states the five blessed bands, and explains the reconciliation. It supersedes
  the archived review (which stays in place — archive is read-only by
  convention).
- `ANGLE_REFS` carries the blessed values: **KNEE_BDC 135–145, KNEE_TDC 68–74,
  HIP 55–70, TORSO 45–55, ELBOW 150–165**, and a `measuredAt` field per entry.
  Its doc comment cites the foundation doc, not "an open question".
- `src/lib/services/llm.ts` no longer hard-codes any band. The recommendations
  system prompt is produced by a pure `buildRecommendationsSystemPrompt()` that
  renders its reference table from `ANGLE_REFS` and whose per-angle rules speak
  of "the reference range", not specific degrees.
- `npm test` includes: an `ANGLE_REFS`-pinned-to-the-doc block, and a
  prompt-generator spec asserting the built prompt carries the blessed numbers
  and none of the retired ones.
- PRD OQ#2, roadmap OQ-2 (+ the S-02 unknown + Backlog Handoff note),
  test-plan §6.6 follow-up and §7 entry all read **RESOLVED** and point to
  `context/foundation/reference-angles.md`. `change.md` has a `## Decision`
  section.
- `npx tsc --noEmit`, `npm run lint`, `npm test` all green.

**Verification:** `npm test && npx tsc --noEmit && npm run lint`; plus
`grep -rn "Open Question #2\|OQ-2\|OQ#2\|unresolved owner decision" context/foundation/ src/lib/pose/angles.ts src/lib/angle-verdict.ts src/lib/services/llm.ts src/lib/recommendations-prompt.ts`
returns only RESOLVED-annotated hits. `context/archive/` and
`context/changes/testing-angle-correctness/` are deliberately **out of scope** —
they reference OQ-2 as correct historical record (archive is read-only; the
sibling change is done) and are not edited by this plan.

### Key Discoveries:

- `VideoAnalyzer.tsx` reads `ANGLE_REFS` field-by-field (`src/components/VideoAnalyzer.tsx:223-268`)
  — adding `measuredAt` and `convention` fields is additive and does not reach
  the persisted `BodyAngle` shape or `bodyAngleSchema` (`src/lib/schemas.ts:13-19`).
- The verdict on the results page runs on **per-row** stored bands
  (`src/pages/sessions/[id].astro:44`), so changing `ANGLE_REFS` only affects
  *new* analyses — historical rows are self-consistent with their own frozen
  bands. This matches the torso-fix precedent (test-plan §6.6: "the app never
  recomputes persisted results").
- The elbow "conflict" is a measurement mismatch, not a real disagreement.
  `bike-fitting-ref-angles.md:57–58` lists the elbow *included* angle (20–30°
  flexion = 150–160°) and the *upper-arm-to-torso* "shoulder forward angle"
  (80–90°) as separate rows; the guide's 85–95° "elbow" figure is within
  rounding of the latter. Practitioner references put the included angle on the
  hoods at 150–170° (BikeFittr angle chart; ICA goniometer protocol;
  torger.se); ~90° included is the TT/aero position. `ANGLE_REFS.ELBOW` is
  therefore widened to **150–165°** (from 150–160°) so a relaxed, upright
  gravel arm sits inside the band. This supersedes the elbow assessment in
  `context/changes/testing-angle-correctness/research.md:310–343`, which read
  the guide's 85–95° as the same measurement the code computes.
- `src/lib/services/llm.ts:1` imports `astro:env/server` at module top — a spec
  covering the prompt must import a pure module, not `llm.ts`.
- `resolve-angle-reference-bands` is **not** a roadmap `Change ID` (it appears
  only in Open Roadmap Question 2), so `/10x-plan`'s roadmap status-sync is a
  no-op; the roadmap edits in Phase 3 are content edits, not status flips.
- Archive is read-only by convention (`context/archive/README.md`) — the two
  archived docs are **not** edited; the foundation doc carries the "supersedes"
  note.

## What We're NOT Doing

- **No backfill of historical `analysis_results` rows.** Existing rows keep
  their frozen `reference_min` / `reference_max`. Precedent: the torso fix
  (test-plan §6.6). The app never recomputes persisted results.
- **Not fixing the raw-vs-rounded display/pill contradiction** near a band
  boundary (raw `147.4` verdicts `false`, displays `147°` inside the band).
  Still tracked — it is a display-policy call that pairs with the S-05 rounding
  work (test-plan §6.6 / §7). `angle-verdict.test.ts` keeps pinning it.
- **Not editing** `context/archive/.../bike-fitting-ref-angles.md` or
  `angle-to-adjustment-guide.md` — archive is read-only.
- **Not touching** `ANALYZE_VIDEO_SYSTEM_PROMPT` or the vision path (no bands
  there).
- **Not adding server-side numeric-bounds validation** of the posted
  `reference_min` / `reference_max` — that is the LLM-boundary / API-route
  test-plan rollout phase (§3 Phase 2).
- **Not adding bike-type detection** or the gravel-only guardrail (test-plan §7
  — needs a classifier).
- **Not changing what the elbow measurement is** (stays shoulder–elbow–wrist
  included angle) and **not adding a sixth angle**.
- **Not re-deriving** the reference literature from scratch — the existing
  sourced review is blessed as-is (bands reconciled, sources untouched).
- **Not resolving** OQ-1 (min video duration) or OQ-3 (pose tool) — unrelated
  open questions.

## Implementation Approach

Three phases, each independently verifiable and committable:

1. **Make the decision concrete** — write the foundation doc, move `ANGLE_REFS`
   to the blessed values, repoint doc-comment citations, pin the constant with
   a spec. After this phase the app already judges new analyses against the
   authoritative bands.
2. **Kill the triplication** — extract a pure prompt builder driven by
   `ANGLE_REFS`, wire it into `llm.ts`, delete the inline copies, and add the
   generator spec. After this phase there is exactly one place a band number
   lives.
3. **Close the paper trail** — annotate every OQ-2 reference across PRD,
   roadmap, and test-plan as RESOLVED, and record the decision in `change.md`.

## Critical Implementation Details

**`astro:env` isolation.** The prompt builder MUST be a standalone pure module
(`src/lib/recommendations-prompt.ts`, no I/O, no transitive `astro:env`
import). Its spec imports the builder and `ANGLE_REFS` directly. Importing
`src/lib/services/llm.ts` from a spec throws at import time until the deferred
env-setup rollout phase — do not.

**Prompt formatting parity.** The current prompt uses an en-dash in ranges
(`137–147°`) and a `°` suffix. The generated table must reproduce that exact
formatting so the prompt corpus stays stable and the future OpenRouter
contract tests (test-plan §3 Phase 2) are not disturbed. **One deliberate
change:** every row's convention qualifier is rendered uniformly as
`<name> (<convention>)` — so the torso row becomes `Torso angle (from
horizontal) | 45–55° | …` instead of today's `Torso angle | 45–55° from
horizontal | …`. This is required to drive the qualifier from a single
`ANGLE_REFS.convention` field (F2) rather than per-key hard-coding; call it out
in the Phase 2 manual-verification step.

**Elbow widens 150–160 → 150–165.** Absence assertions target the four
**retired** ranges: `137–147`, `65–75`, `55–65`, `150–160`. The generated
prompt legitimately contains `150–165`.

## Phase 1: Blessed reference doc + reconciled `ANGLE_REFS`

### Overview

Promote the literature review into `context/foundation/` in reconciled form,
move `ANGLE_REFS` to the blessed bands, repoint the doc-comment citations, and
pin the constant to the doc with a regression spec.

### Changes Required:

#### 1. The authoritative reference doc

**File**: `context/foundation/reference-angles.md` (new)

**Intent**: Give the project one discoverable, citable home for the gravel
reference angles — the thing OQ-2 asked for. Promote the archived review's
content, reconcile the drifted bands, and explain the reconciliation so a
future reader knows why each number was chosen.

**Contract**: Sections — a top status line ("**Authoritative.** Resolves PRD
Open Question #2 / Roadmap OQ-2, 2026-09-02. Supersedes
`context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`,
kept for source detail."); a **canonical bands table** keyed to `ANGLE_REFS`
keys with columns `Angle | Band | Measured at | Convention`; a
**Reconciliation** subsection stating: knee-BDC (135–145) and knee-TDC (68–74)
follow `angle-to-adjustment-guide.md` §1–§2; hip widened to 55–70 per guide §3
(gravel/recreational, "opening the hip improves breathing capacity and reduces
lower-back stress"); elbow widened to 150–165 included — `bike-fitting-ref-angles.md:58`
gives 20–30° flexion (150–160° included) and practitioner references (BikeFittr
printable angle chart; Indoor Cycling Association goniometer protocol;
torger.se) put the included elbow angle on the hoods at 150–170°, so the band
is opened to 150–165 to cover a relaxed, upright gravel arm. The guide's 85–95°
"elbow" figure is a measurement mismatch — it is within rounding of the
*upper-arm-to-torso* "shoulder forward angle" that `bike-fitting-ref-angles.md:57`
lists separately at 80–90°, not the shoulder–elbow–wrist angle the app computes
(~90° included is the TT/aero position). State explicitly that this supersedes
the elbow assessment in `context/changes/testing-angle-correctness/research.md`,
which read the guide's 85–95° as the same measurement. Torso unchanged (both
docs agree 45–55). Carry the full 13-source list. Blessed values:

| Key | Band | Measured at | Convention |
|---|---|---|---|
| `KNEE_BDC` | 135–145° | Bottom of pedal stroke (6 o'clock) | included |
| `KNEE_TDC` | 68–74° | Top of pedal stroke (12 o'clock) | included |
| `HIP` | 55–70° | Top of pedal stroke (12 o'clock) | included |
| `TORSO` | 45–55° | Hands on hoods, cranks horizontal | from horizontal |
| `ELBOW` | 150–165° | Riding on hoods | included |

#### 2. `ANGLE_REFS` — reconcile the bands, add `measuredAt` + `convention`, rewrite the doc comment

**File**: `src/lib/pose/angles.ts`

**Intent**: Move the constant to the blessed values, give each entry the
`measuredAt` and `convention` labels the prompt generator (Phase 2) needs so it
can reproduce the current prompt table without per-key hard-coding, and stop the
doc comment from calling the bands unresolved.

**Contract**: `KNEE_BDC` → `{ min: 135, max: 145 }`; `KNEE_TDC` →
`{ min: 68, max: 74 }`; `HIP` → `{ min: 55, max: 70 }`; `ELBOW` →
`{ min: 150, max: 165 }`; `TORSO` unchanged. Add `measuredAt: string` and
`convention: string` to every entry (values from the table above —
`convention` is `"included"` for KNEE_BDC / KNEE_TDC / HIP / ELBOW and
`"from horizontal"` for TORSO). Keep `as const`. Doc comment: replace the
"unresolved owner decision (PRD Open Question #2) — do not treat as
authoritative" sentence with a reference to
`context/foundation/reference-angles.md` as the source of record.

#### 3. Repoint `computeTorsoAngle` doc-comment citations

**File**: `src/lib/pose/angles.ts`

**Intent**: The torso-angle definition and the frame-deviation note both quote
`bike-fitting-ref-angles.md` by name; point them at the new canonical doc.

**Contract**: Replace the two `bike-fitting-ref-angles.md` path/name mentions
in the `computeTorsoAngle` JSDoc with `context/foundation/reference-angles.md`.
No behaviour change.

#### 4. Repoint `angleVerdict` doc comment

**File**: `src/lib/angle-verdict.ts`

**Intent**: The bands are no longer an open question.

**Contract**: Reword "The `min`/`max` bands come from `ANGLE_REFS` … (themselves
an unresolved owner decision, PRD Open Question #2)" → cite
`context/foundation/reference-angles.md` as the resolved source. Keep the
raw-vs-rounded contradiction paragraph (still tracked).

#### 5. Pin `ANGLE_REFS` to the doc

**File**: `src/lib/pose/angles.test.ts`

**Intent**: Close the band dimension of Risk #1 — catch any future silent drift
of `ANGLE_REFS` away from the authoritative doc.

**Contract**: New `describe("ANGLE_REFS — blessed gravel bands", …)` block
asserting all five `min`/`max` pairs **and each entry's `convention`** against
literals, each with a comment citing `context/foundation/reference-angles.md` as
the oracle (per cookbook §6.1 — the value is traceable to the doc, not to
today's code). `convention` is pinned here because it now feeds the generated
prompt (Phase 2); silent drift would change the prompt wording. Update the
file-header oracle-path comment (line ~18) from the archive path to
`context/foundation/reference-angles.md`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Unit tests pass incl. the new `ANGLE_REFS` block: `npm test`
- Linting passes: `npm run lint`
- `context/foundation/reference-angles.md` exists and its canonical table
  matches `ANGLE_REFS`: `grep -E "135|145|68|74|55|70|165" context/foundation/reference-angles.md`
- No stale "unresolved owner decision" / "do not treat as authoritative" text
  remains in `src/lib/pose/angles.ts` or `src/lib/angle-verdict.ts`

#### Manual Verification:

- Read `context/foundation/reference-angles.md` end to end — the reconciliation
  rationale is correct, the elbow explanation is right, and all 13 sources
  survived the promotion
- In the running app, open a **completed** session's results page — historical
  rows still render their own (old) bands and a consistent verdict; a freshly
  run analysis renders 135–145 / 68–74 / 55–70 / 45–55 / 150–165

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: End the triplication — generate the prompt from `ANGLE_REFS`

### Overview

Extract a pure prompt builder that renders the reference table from
`ANGLE_REFS` and speaks of "the reference range" instead of hard-coded degrees;
wire it into `llm.ts`; delete the inline copies; guard it with a spec.

### Changes Required:

#### 1. The pure prompt builder

**File**: `src/lib/recommendations-prompt.ts` (new)

**Intent**: Make the recommendations system prompt a function of `ANGLE_REFS`
so a band number exists in exactly one place. Pure (no I/O, no `astro:env`) so
it is unit-testable in isolation — the established "pure logic comes out first"
pattern (test-plan §6.6).

**Contract**: `export function buildRecommendationsSystemPrompt(refs = ANGLE_REFS): string`.
Renders the `## Reference angle ranges (gravel, recreational)` markdown table
from `refs` — one row per entry, `<name> (<convention>) | <min>–<max>° | <measuredAt>`,
en-dash and `°` exactly as today. The convention qualifier is rendered
uniformly in the name cell for every row (see "Prompt formatting parity" — the
torso row's "from horizontal" moves out of the range cell); no per-key
branching. The "Order of adjustments", "Coupling effects", and "Output
instructions" blocks stay verbatim static prose. The
"Per-angle adjustment rules" block is reworded so each bullet names a direction
relative to the range, not a threshold — e.g. `**Knee BDC below the reference
range**: raise saddle ~1 mm per degree needed; never move >10 mm per session`.
The "within 10% of the range width" optimization rule stays as-is (already
generic). Imports `ANGLE_REFS` from `@/lib/pose/angles` only.

#### 2. Wire the builder into the LLM service

**File**: `src/lib/services/llm.ts`

**Intent**: Consume the builder; remove the inline band copies.

**Contract**: Delete the `RECOMMENDATIONS_SYSTEM_PROMPT` template literal.
`import { buildRecommendationsSystemPrompt } from "@/lib/recommendations-prompt"`
and use its return value where the constant was referenced in
`generateRecommendations`. `ANALYZE_VIDEO_SYSTEM_PROMPT` and the user-message
construction (line ~166) are untouched.

#### 3. Prompt-generator spec

**File**: `src/lib/recommendations-prompt.test.ts` (new)

**Intent**: Guard against band drift and against the retired numbers creeping
back into the prompt.

**Contract**: Against `buildRecommendationsSystemPrompt(ANGLE_REFS)`:
(a) the output contains each entry's `name`, its `"<min>–<max>"` string, and its
`convention` rendered next to the name (assert both `"(included)"` and
`"Torso angle (from horizontal)"` appear);
(b) the output does **not** contain `137–147`, `65–75`, `55–65`, or `150–160`;
(c) the "Per-angle adjustment rules" section contains no `<NN°` / `>NN°`
threshold token (regex). Pure imports only — no env setup.

#### 4. Drop the stale "contested / OQ#2" framing from the verdict spec

**File**: `src/lib/angle-verdict.test.ts`

**Intent**: The header comment says the suite "deliberately does not assert
against the contested `ANGLE_REFS` values (PRD Open Question #2)" — no longer
true.

**Contract**: Reword the header — synthetic bands remain (they exercise the
generic inclusive-bound contract), but replace the "contested / OQ#2" sentence
with a pointer to `angles.test.ts` for the band-pinning assertion. No test-body
changes.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- All specs pass incl. the new generator spec: `npm test`
- Lint clean: `npm run lint` (formatting is covered by lint + the pre-commit
  hook; `npm run format` is `prettier --write .` — it mutates and always exits 0,
  so it is not a gate)
- `llm.ts` no longer hard-codes the table:
  `grep -E "137–147|Reference angle ranges" src/lib/services/llm.ts` returns
  nothing (only the builder import/call remains)
- `grep -nE "150–160|150–165|85–95|137–147" src/lib/services/llm.ts` returns
  nothing (every band number now comes from the builder)

#### Manual Verification:

- Log or inspect `buildRecommendationsSystemPrompt(ANGLE_REFS)` — the rendered
  prompt reads naturally, the table shows the five blessed bands, and the
  per-angle rules make sense without inline degrees. Confirm the one intended
  wording change landed: `Torso angle (from horizontal) | 45–55° | …` (the
  qualifier is now in the name cell, uniform with the other rows)
- Run a real recommendations request against an out-of-range angle — the LLM
  still returns specific adjustments with rationale referencing the measured
  angle and target range (no quality regression)

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Close OQ-2 tracking

### Overview

Annotate every OQ-2 reference across the foundation docs as RESOLVED and record
the decision in the change identity file. No source code changes.

### Changes Required:

#### 1. Record the decision in the change file

**File**: `context/changes/resolve-angle-reference-bands/change.md`

**Intent**: The durable identity file should carry the decision, not just a
pointer to a plan that will later be archived.

**Contract**: Add a `## Decision (2026-09-02)` section — the five-row blessed-band
table, the source (`context/foundation/reference-angles.md`), and the
one-paragraph rationale (elbow widened to 150–165 to match the practitioner
included-angle range for a relaxed hoods position — the guide's 85–95° is the
shoulder angle, not the elbow; knee/hip = gravel-adjustment-guide recreational
tuning; torso unchanged; triplication collapsed to `ANGLE_REFS`). Also correct
the `### The unresolved decision` note in this file: the 150–160 vs 85–95 elbow
gap is a measurement mismatch (upper-arm-to-torso "shoulder forward angle" vs
shoulder–elbow–wrist included angle), not a road-vs-gravel convention split.
Leave `status:` as `planned` for `/10x-implement` / `/10x-archive` to advance.

#### 2. Close OQ#2 in the PRD

**File**: `context/foundation/prd.md`

**Intent**: OQ#2 is Block: yes on the north-star slice — it must not keep
reading as unresolved.

**Contract**: Open Question #2 (line ~128) — prefix
`**RESOLVED (2026-09-02):**` with a one-line summary and a pointer to
`context/foundation/reference-angles.md` and this change. §Business Logic
paragraph (line ~107) — replace "is an open question — … See Open Questions."
with a sentence stating the reference frame is now fixed in the foundation doc.

#### 3. Close OQ-2 in the roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: OQ-2 appears in four places; close all.

**Contract**: Open Roadmap Question 2 (line ~189) — mark
`**RESOLVED (2026-09-02)**` with the pointer, keep the "Tracked as change" line.
S-02 §Unknowns "Which gravel bike angle reference ranges are authoritative?"
(line ~116) — append `— RESOLVED (2026-09-02), see context/foundation/reference-angles.md`.
S-02 mitigation note "that mitigation only activates once OQ-2 is resolved"
(line ~118) — reword to past tense / append the RESOLVED pointer so criterion
3.1's grep passes. Backlog Handoff S-02 row note (line ~181) — same annotation.
Bump frontmatter `updated:` to `2026-09-02`. (S-02 status stays `done`; no row
flips.)

#### 4. Close the band dimension in the test-plan

**File**: `context/foundation/test-plan.md`

**Intent**: §6.6 and §7 both say the band dimension is unresolved.

**Contract**: §7 "The reference-band dimension of Risk #1" entry (lines
~320–331) — rewrite to RESOLVED: bands sourced from
`context/foundation/reference-angles.md`, `ANGLE_REFS` pinned to it in
`src/lib/pose/angles.test.ts`, prompt generated from `ANGLE_REFS`. §7 torso
entry — replace the parenthetical elbow-conflict mention with a one-liner:
the elbow band is resolved (ELBOW 150–165, practitioner included-angle range;
the archived guide's 85–95° was a shoulder-angle mislabel). §7
"measurement frame for torso and elbow" — leave (still an accepted gap). §6.6
Phase-1 "Open follow-ups" reference-band bullet (lines ~262–264) — mark
resolved with the pointer. §6.1 oracle rule (line ~180) — repoint the quotable
source from `context/archive/.../bike-fitting-ref-angles.md` to
`context/foundation/reference-angles.md` so the cookbook and the repointed
`angles.test.ts` header (Phase 1 §5) agree. §2 Risk Map / Risk Response
guidance for #1 — add a short note that the band dimension is now covered by
`resolve-angle-reference-bands`. Bump the "Last updated" header line (line ~9).

### Success Criteria:

#### Automated Verification:

- `grep -rn "Open Question #2\|OQ-2\|OQ#2" context/foundation/` — every hit is
  RESOLVED-annotated
- `grep -rn "unresolved owner decision\|contested\|synthetic bands only" context/ src/`
  — returns nothing stale (generic-helper synthetic-band note in
  `angle-verdict.test.ts` is fine)
- Sanity (no code touched this phase): `npm test`, `npx tsc --noEmit`,
  `npm run lint` still green

#### Manual Verification:

- Read PRD OQ#2, roadmap OQ-2, and test-plan §7 — each reads as resolved and
  points to the same `context/foundation/reference-angles.md`
- `change.md` `## Decision` table matches `ANGLE_REFS` exactly

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation. This closes the plan.

---

## Testing Strategy

### Unit Tests:

- `src/lib/pose/angles.test.ts` — `ANGLE_REFS` min/max **and `convention`** for
  all five keys asserted against literals traceable to
  `context/foundation/reference-angles.md` (oracle rule, cookbook §6.1).
- `src/lib/recommendations-prompt.test.ts` — generated prompt contains the five
  blessed `min–max` strings, each angle `name`, and each `convention` next to
  its name (incl. `Torso angle (from horizontal)`); contains none of `137–147`,
  `65–75`, `55–65`, `150–160`; per-angle rules carry no `<NN°`/`>NN°` token.
- `src/lib/angle-verdict.test.ts` — unchanged bodies; header reworded.

### Integration Tests:

- None. The persisted-payload path (`VideoAnalyzer` → route → `analysis_results`)
  and the OpenRouter boundary are the subject of test-plan §3 Phase 2, not this
  change.

### Manual Testing Steps:

1. Run a fresh analysis end to end; confirm the results page shows the five
   blessed bands and correct verdict pills.
2. Open a pre-existing completed session; confirm its (older) stored bands and
   verdicts are unchanged — no backfill.
3. Inspect the built recommendations prompt; confirm one source of truth and
   readable per-angle rules.
4. Run recommendations against a deliberately out-of-range angle; confirm
   output quality is unchanged.

## Performance Considerations

None. `buildRecommendationsSystemPrompt` runs once per recommendations request,
building a short string — negligible next to the OpenRouter round-trip.

## Migration Notes

**No data migration.** Existing `analysis_results.body_angles` rows keep their
frozen `reference_min` / `reference_max`. The results page verdict is computed
per-row, so historical sessions stay internally consistent; only analyses run
after this change use the blessed bands. This is the same call made for the
Phase-1 torso fix (test-plan §6.6).

**Verdict shifts on re-run.** Three bands change shape, so a returning user can
see a different verdict on a fresh analysis: HIP widens asymmetrically
(55–65 → 55–70), KNEE_BDC shifts down 2° (137–147 → 135–145), and **KNEE_TDC
narrows 65–75 → 68–74** (40% narrower — a knee-TDC at 65–67° or 74–75° flips to
"Outside range"). ELBOW only widens (150–160 → 150–165), so it can only
un-flag. All acceptable — historical rows are untouched; this only affects new
runs.

## References

- Change identity: `context/changes/resolve-angle-reference-bands/change.md`
- Scoped out by: `context/changes/testing-angle-correctness/plan.md` ("What
  We're NOT Doing" — no assertion against `ANGLE_REFS`, OQ-2 deferred)
- Source under blessing: `context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`
- Reconciliation source: `context/archive/2026-05-28-ai-analysis-pipeline/angle-to-adjustment-guide.md`
  §1–§3, §5 (Convention note)
- Open questions: `context/foundation/prd.md` Open Question #2;
  `context/foundation/roadmap.md` Open Roadmap Question 2
- Negative space: `context/foundation/test-plan.md` §6.6 (Phase-1 open
  follow-ups), §7 (reference-band dimension entry)
- Consumers: `src/lib/pose/angles.ts:23`, `src/components/VideoAnalyzer.tsx:223-268`,
  `src/pages/sessions/[id].astro:40-44`, `src/lib/services/llm.ts:9-63`
- Lesson priors: `context/foundation/lessons.md` (`npx tsc --noEmit`, not
  `npm run typecheck`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Blessed reference doc + reconciled `ANGLE_REFS`

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit` — 4a6acd0
- [x] 1.2 Unit tests pass incl. the new `ANGLE_REFS` block: `npm test` — 4a6acd0
- [x] 1.3 Linting passes: `npm run lint` — 4a6acd0
- [x] 1.4 `context/foundation/reference-angles.md` exists and its canonical table matches `ANGLE_REFS` — 4a6acd0
- [x] 1.5 No stale "unresolved owner decision" / "do not treat as authoritative" text in `angles.ts` or `angle-verdict.ts` — 4a6acd0

#### Manual

- [x] 1.6 `reference-angles.md` reads correctly end to end — reconciliation rationale, elbow explanation, all 13 sources present — 4a6acd0
- [x] 1.7 Running app: historical session unchanged; fresh analysis renders 135–145 / 68–74 / 55–70 / 45–55 / 150–165 — 4a6acd0

### Phase 2: End the triplication — generate the prompt from `ANGLE_REFS`

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — 18f9715
- [x] 2.2 All specs pass incl. the new generator spec: `npm test` — 18f9715
- [x] 2.3 Lint clean: `npm run lint` — 18f9715
- [x] 2.4 `llm.ts` no longer hard-codes the table (`grep -E "137–147|Reference angle ranges" src/lib/services/llm.ts` empty) — 18f9715
- [x] 2.5 `grep -nE "150–160|150–165|85–95|137–147" src/lib/services/llm.ts` returns nothing — 18f9715

#### Manual

- [x] 2.6 Built prompt reads naturally — table shows five blessed bands, per-angle rules make sense without inline degrees — 18f9715
- [x] 2.7 Real recommendations request against an out-of-range angle — no output-quality regression — 18f9715

### Phase 3: Close OQ-2 tracking

#### Automated

- [x] 3.1 `grep -rn "Open Question #2\|OQ-2\|OQ#2" context/foundation/` — every hit RESOLVED-annotated — a521fb7
- [x] 3.2 `grep -rn "unresolved owner decision\|contested\|synthetic bands only" context/ src/` — nothing stale — a521fb7
- [x] 3.3 Sanity: `npm test`, `npx tsc --noEmit`, `npm run lint` still green — a521fb7

#### Manual

- [x] 3.4 PRD OQ#2, roadmap OQ-2, test-plan §7 each read as resolved and point to `context/foundation/reference-angles.md` — a521fb7
- [x] 3.5 `change.md` `## Decision` table matches `ANGLE_REFS` exactly — a521fb7
