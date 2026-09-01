---
date: 2026-09-01T21:08:15+02:00
researcher: maro
git_commit: ebd9351b174ed6f1185a9c9c76513585357d63c4
branch: master
repository: mjedrasz/bikefit
topic: "Joint-angle & keypoint-mapping correctness — grounding for test-plan Phase 1 (Risk #1)"
tags: [research, codebase, angle-math, pose-detection, keypoints, video-analyzer, test-plan, risk-1]
status: complete
last_updated: 2026-09-01
last_updated_by: maro
---

# Research: Joint-angle & keypoint-mapping correctness (test-plan Phase 1 / Risk #1)

**Date**: 2026-09-01T21:08:15+02:00
**Researcher**: maro
**Git Commit**: ebd9351b174ed6f1185a9c9c76513585357d63c4
**Branch**: master
**Repository**: mjedrasz/bikefit

## Research Question

Rollout Phase 1 of `context/foundation/test-plan.md` defends **Risk #1**: the joint-angle / keypoint
math is subtly wrong — the app computes angles that do not match the reference-frame definitions they
are judged against — so every in-range verdict and every fitting recommendation built on them is
confidently wrong.

Before a plan can be written, this phase needs the code grounded:

1. The exact **angle formulas** and their conventions (vertex, included-vs-flexion, torso axis).
2. The **keypoint-index contract** and how the pose model's coordinates map onto the reference
   definitions (`context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`,
   `.../angle-to-adjustment-guide.md`).
3. Whether the two "must challenge" claims hold: *"the angle the code computes is the angle the
   fitting literature means"* and *"the server would catch a bad result."*
4. What is unit-testable today, what must be **extracted** first, and where the **oracle** comes from.

## Summary

**All of the angle math lives in a single un-exported block inside one React island,
`src/components/VideoAnalyzer.tsx` (lines 22–151, 251–339).** Nothing else in `src/` does
trigonometry, keypoint mapping, or pose work. To unit-test the pure math, it must first be
**extracted** into a `src/lib/` module — this is the mandatory sub-phase 1 of the plan.

Findings against the two "must challenge" claims:

- **"The server would catch a bad result" — FALSE, confirmed.** `bodyAngleSchema`
  (`src/lib/schemas.ts:13-19`) is a type-only shape check. `POST /api/sessions/[id]/results`
  (`src/pages/api/sessions/[id]/results.ts:47-52`) inserts `body_angles` **verbatim** through the
  RLS-bypassing service-role client. There is no DB `CHECK` on the `body_angles` JSONB column
  (`supabase/migrations/20260526120000_initial_schema.sql:51-58`). **The browser supplies both the
  measured `value` AND the `reference_min`/`reference_max` it will be judged against**
  (`src/components/VideoAnalyzer.tsx:290-338`), and the in/out-of-range verdict is then computed from
  those client-authored numbers on the results page (`src/pages/sessions/[id].astro:43`).

- **"The angle the code computes is the angle the fitting literature means" — MIXED.**
  - `jointAngle()` (knee at BDC, knee at TDC, hip, elbow) computes the **included angle at the
    vertex** (180° = straight limb), is correctly clamped, and is **orientation-invariant**
    (verified numerically) — its convention **matches** the reference docs.
  - `computeTorsoAngle()` **has a confirmed left/right-facing bug**: it returns the true
    from-horizontal angle for a **right-facing** rider but `180° − true` for a **left-facing** rider
    (verified numerically: a true 50° torso → `50.00` right-facing, `130.00` left-facing). This is
    exactly the "a left-facing and a right-facing clip both resolve to the correct body side" case
    the test plan calls out. `convertKeypoints()` selects the correct *body side* but does **not**
    mirror coordinates, so facing direction survives in `x` and reaches this formula unhandled.
  - **Torso and elbow are measured from the BDC frame**, but both reference docs define torso (and
    imply elbow) at **"cranks horizontal"** (3/9 o'clock). No crank-horizontal keyframe is ever
    detected — a structural gap, not just a wrong constant.
  - The **reference-range constants themselves are contested and partly untraceable.** The two
    archived reference docs disagree; the shipped `ANGLE_REFS` matches one, the other, or neither,
    depending on the angle. **Elbow is the worst**: code uses `150–160°` (road/competitive
    convention) while `angle-to-adjustment-guide.md:126-128` explicitly recommends `85–95°` included
    for gravel/recreational *and flags this exact conflict*. This is PRD Open Question #2
    (`context/foundation/prd.md:128`, Block: yes) and **must be resolved by the owner** before any
    range-membership assertion can be written. Geometry/convention assertions do **not** depend on it.

**The oracle** for Phase 1 must be hand-constructed geometry (a straight limb = 180°, a right angle
= 90°, a 45°-from-horizontal torso = 45° for *both* facings, mirrored poses produce equal angles) and
the *convention* statements in `bike-fitting-ref-angles.md` — never the value a function returns today
and never a snapshot of real-video output.

## Detailed Findings

### 1. Where the angle math lives — and why it is not testable yet

Every piece of trig, keypoint, and pose logic in the project is **module-scoped (not exported)**
inside `src/components/VideoAnalyzer.tsx`:

| Symbol | Lines | What it is | Pure? |
|---|---|---|---|
| `ANGLE_REFS` | 22–28 | The five reference ranges, hard-coded | data |
| `PoseLandmark` | 40–45 | `{ x, y, z, visibility? }` local type | type |
| `jointAngle(a, b, c)` | 47–53 | 3-point included angle at vertex `b`, degrees | ✅ pure |
| `computeTorsoAngle(wl)` | 55–58 | `atan2`-based hip→shoulder vector angle from horizontal | ✅ pure |
| `visible(lm)` | 60–62 | visibility ≥ 0.5 gate | ✅ pure |
| `convertKeypoints(keypoints)` | 103–137 | MoveNet COCO-17 → 33-slot array, side auto-select | ✅ pure |
| `seekTo` / `fileToBase64` / `loadVideoElement` / `detectPoseAt` | 64–151 | DOM + video + detector I/O | ❌ I/O |
| BDC/TDC extremum scan + angle emission | 251–339 | inline in `runPipeline()`, interleaved with `await detectPoseAt` | ❌ as written |

Grep confirmation (whole `src/` tree): no `Math.acos`, `Math.atan2`, `jointAngle`, `computeTorsoAngle`,
`estimatePoses`, `keypoint`, or `landmark` occurrences outside `VideoAnalyzer.tsx`. The only
angle-adjacent code elsewhere is:

- `src/lib/format-angle.ts:6-8` — `formatAngle = Math.round`, display-only, imported **only** by
  `src/pages/sessions/[id].astro`.
- `src/pages/sessions/[id].astro:40-44` — the **in/out-of-range verdict** (see §6), computed inline,
  imported from nothing.
- `src/lib/services/llm.ts:12-18, 29-37` — the reference ranges duplicated as **prose** in the
  recommendations system prompt.
- `src/lib/schemas.ts:13-19` — `bodyAngleSchema`, type-only.

**Implication for the plan:** the first sub-phase is a pure-refactor extraction. Candidate target
(consistent with `CLAUDE.md` — "pure utilities (no I/O) go in `src/lib/`"): a new module such as
`src/lib/pose/angles.ts` exporting `jointAngle`, `computeTorsoAngle`, `visible`, `convertKeypoints`,
`ANGLE_REFS`, the `PoseLandmark` type, and the COCO/MediaPipe index constants; `VideoAnalyzer.tsx`
then imports them. The BDC/TDC extremum selector (lines 264–283) is currently welded to the async
seek loop; extracting a pure `pickExtremumFrame(candidates, type)` helper is optional but would make
the "BDC = most-extended, TDC = deepest-flexion" rule testable.

Note: `jointAngle`, `computeTorsoAngle`, `convertKeypoints`, and `visible` are pure functions over
plain objects — they need **no DOM**. The test-plan §4 note about a `happy-dom`/`jsdom` env applies
only to the I/O helpers (`seekTo`, `loadVideoElement`, `fileToBase64`), which are **out of Phase 1
scope**. Phase 1's pure-math specs can run in the default Node env.

### 2. `jointAngle()` — convention is correct

```
src/components/VideoAnalyzer.tsx:47-53
function jointAngle(a, b, c): number {
  ba = a - b;  bc = c - b;
  return acos( clamp( dot(ba,bc) / (|ba|·|bc|), -1, 1 ) ) · 180/π
}
```

- **Vertex** = middle argument `b`. **Result** = included angle, `0°` = folded, `180°` = straight.
- Clamped to `[-1, 1]` before `acos` → no `NaN` from float error. (A **zero-length** vector — two
  coincident keypoints — still yields `0/0 = NaN`; the callers gate on `visible()` but not on
  coincidence.)
- `z` is **always 0** (`convertKeypoints` line 134 hard-codes it), so this is a **2-D image-plane**
  angle despite the 3-D signature.
- **Orientation-invariant** — verified numerically: a constructed 140° knee, then mirrored in `x`
  (left-facing), both return `140.00`. Dot-product / magnitudes are unchanged by reflection.

Per-angle usage (`src/components/VideoAnalyzer.tsx:286-339`), against
`bike-fitting-ref-angles.md`:

| Angle | Code (MediaPipe slots) | Vertex | Reference definition | Frame used | Verdict |
|---|---|---|---|---|---|
| Knee @ BDC | `jointAngle(wl[23], wl[25], wl[27])` hip–knee–ankle | knee | "Included angle (180° = straight leg)… bottom of pedal stroke (6 o'clock)" | BDC | ✅ vertex + convention + frame |
| Knee @ TDC | `jointAngle(wl[23], wl[25], wl[27])` hip–knee–ankle | knee | "Minimum knee angle (top of stroke, 12 o'clock)" | TDC | ✅ vertex + convention + frame |
| Hip @ TDC | `jointAngle(wl[11], wl[23], wl[25])` shoulder–hip–knee | hip | "between thigh and torso at the top of the pedal stroke (12 o'clock)" | TDC | ✅ vertex + convention + frame |
| Elbow | `jointAngle(wl[11], wl[13], wl[15])` shoulder–elbow–wrist | elbow | "Elbow flexion from straight 20–30° (150–160° included)… riding on hoods" | **BDC** | ✅ vertex + convention; ⚠️ frame (see §4) |

### 3. `computeTorsoAngle()` — confirmed left/right-facing bug

```
src/components/VideoAnalyzer.tsx:55-58
// Torso angle: angle of hip→shoulder vector from horizontal (Y increases downward in world coords)
function computeTorsoAngle(wl): number {
  return Math.abs( Math.atan2( wl[11].y - wl[23].y, wl[11].x - wl[23].x ) · 180/π )
}
```

`wl[11]` = shoulder, `wl[23]` = hip (the slots `convertKeypoints` writes the chosen side into).
The reference definition (`bike-fitting-ref-angles.md:27`): *"Measured from horizontal to a line
from hip to shoulder… 45–55° from horizontal."*

**The `Math.abs()` folds the sign but not the 180° complement.** MoveNet returns **pixel
coordinates** (`x` rightward, `y` downward — no `keypoints3D` for MoveNet). Working through it:

- **Right-facing rider** (nose toward +x): shoulder is forward (+x) and up (−y of hip) →
  `atan2(negative, positive)` ∈ (−90°, 0°) → `abs` → correct acute angle.
- **Left-facing rider** (nose toward −x): shoulder is forward (−x) and up →
  `atan2(negative, negative)` ∈ (−180°, −90°) → `abs` → **≈ 180° − true angle**.

Verified numerically (reproduction script, hip at (100,300), true torso lean 50°):

```
computeTorsoAngle right-facing: 50.00
computeTorsoAngle left-facing : 130.00
```

A perfectly-fitted left-facing rider (true 50°) is measured at **130°**, scored **"Outside range"**
against `45–55`, and fed to the LLM as "torso far too upright" → a bogus "remove ~25 mm of spacers"
recommendation. `jointAngle`-based angles are immune (they are reflection-invariant); **only the
torso angle carries this fault.**

`convertKeypoints` (§5) chooses the correct *body side* but performs **no coordinate mirroring**, and
this formula sits downstream of it. The `estimatePoses` call passes no `flipHorizontal` config
(`src/components/VideoAnalyzer.tsx:148`), so facing direction is preserved end-to-end. The code
comment "Y increases downward in world coords" is a stale leftover from the abandoned MediaPipe
`worldLandmarks` design (see §7).

**A correct formula** would be direction-agnostic, e.g. `atan2(|dy|, |dx|)`, or fold to the acute
complement: `θ = abs(...); return θ > 90 ? 180 - θ : θ`. Whether this phase **fixes** it or only lands
the failing test is an open question (see §9) — the change brief says Phase 1 is "test-only," but a
test asserting the *current* left-facing output (130) would enshrine the bug (the oracle
anti-pattern).

### 4. Frame-selection mismatches vs the reference definitions

The pipeline only ever detects **BDC** and **TDC** keyframes (via the vision LLM,
`src/lib/services/llm.ts:64-76`). Each angle is then emitted from one of those two frames
(`src/components/VideoAnalyzer.tsx:286-339`):

| Angle | `bike-fitting-ref-angles.md` "measured at" | Code measures at | Match? |
|---|---|---|---|
| Knee @ BDC | 6 o'clock (BDC) | BDC frame | ✅ |
| Knee @ TDC | 12 o'clock (TDC) | TDC frame | ✅ |
| Hip | 12 o'clock (TDC) | TDC frame | ✅ |
| **Torso** | **"hands on hoods, cranks horizontal"** (3/9 o'clock) | **BDC frame** | ❌ |
| **Elbow** | **"riding on hoods"** (crank-horizontal implied) | **BDC frame** | ⚠️ |

Torso-to-horizontal changes only a few degrees across the pedal stroke (it is set by saddle-to-bar
drop and reach, not pedal position — pelvic rock is ~5°), so the practical error is small. But it is
a **real deviation from the reference frame**, it is **undocumented** (the archived deviation note,
`plan.md:467`, says only "Angle computation: unchanged in intent"), and against a 10°-wide band with
a ±10° PRD acceptance criterion it is not negligible. Closing it properly requires detecting a third
keyframe type — out of MVP scope. Recommended handling: document as an accepted deviation in
`test-plan.md §7` (or a §6 cookbook note); it is not itself a Phase 1 unit-test target beyond a
comment on the extracted function.

### 5. Keypoint-index contract & body-side selection — `convertKeypoints()`

```
src/components/VideoAnalyzer.tsx:103-137
```

**Input**: MoveNet **COCO-17** keypoints, `{ x, y, score, name }`, in **pixel** coordinates
(confirmed via Context7 / tfjs-models docs — MoveNet & PoseNet return 17 keypoints; only BlazePose
returns 33 and `keypoints3D`). Model: **MoveNet SinglePose Lightning**, CPU backend
(`src/components/VideoAnalyzer.tsx:200-202`).

COCO-17 index order (relevant subset): `5/6` L/R shoulder, `7/8` L/R elbow, `9/10` L/R wrist,
`11/12` L/R hip, `13/14` L/R knee, `15/16` L/R ankle.

**Side selection** (`:107-109`): `leftScore = Σ score(5,7,9,11,13,15)`,
`rightScore = Σ score(6,8,10,12,14,16)`. If `leftScore >= rightScore` (**ties → left**) the left
COCO keypoints are used, else the right.

**Remap** (`:111-128`): the six chosen-side keypoints are written into a 33-slot array at the
**MediaPipe BlazePose LEFT-side indices** `[11, 13, 15, 23, 25, 27]` (shoulder, elbow, wrist, hip,
knee, ankle) — regardless of which physical side was detected. The other 27 slots are
`{ x:0, y:0, z:0, visibility:0 }` (`:129-131`). Every downstream reader uses only those six slots.
`visibility` is populated from MoveNet's `kp.score` (`:134`).

This is **mechanically correct** but the "33-slot / MediaPipe" framing is **vestigial** — the code
never runs MediaPipe (see §7). A maintainer could be misled into thinking BlazePose semantics apply.
Not a correctness bug.

**`visible()` gate** (`:60-62`): `visibility >= 0.5`. Applied per-angle at the call sites
(`:270, 289, 298, 307, 321, 330`) — an angle whose three keypoints are not all visible is simply not
pushed. If fewer than two angles survive, the pipeline throws "Pose not detected clearly" (`:341-343`).

**Testable invariants for Phase 1:**
- Left-side scores dominate → mapped points come from COCO `5/7/9/11/13/15`; right-side dominate →
  from `6/8/10/12/14/16`; exact tie → left.
- **Mirror invariance**: a pose and its `x`-mirror (with the dominant side's scores swapped) must
  produce **equal** knee / hip / elbow angles. (Torso will **fail** this today — see §3; that is the
  point of the test.)
- Missing keypoints → the corresponding slot stays `{0,0,0,0}` and `visible()` is false.

### 6. The verdict path & a rounding contradiction (Risk #1-adjacent)

The only place a `BodyAngle` becomes a user-visible judgement is `src/pages/sessions/[id].astro`:

```
:40-44   inRange: angle.value >= angle.reference_min && angle.value <= angle.reference_max
:82-91   <span>{ angle.inRange ? "In range" : "Outside range" }</span>   // green / amber pill
:77-80   {formatAngle(angle.value)}° (reference: {formatAngle(angle.reference_min)}–{formatAngle(angle.reference_max)}°)
```

- The **verdict** uses the **raw** stored `value` and **raw** stored bounds (inclusive both ends).
- The **displayed digits** are independently `Math.round`ed (`src/lib/format-angle.ts:6-8`).
- **Consequence**: a stored `value = 147.4` renders as `147° (reference: 137–147°)` — visually inside
  the range — but is labelled **"Outside range"**. `136.6` renders as `137°` inside `137–147°` but is
  labelled "Outside range". The rendered numbers can contradict the pill.
- Only two states exist. No "too high / too low" is ever rendered — that language exists only inside
  the LLM prompt (`src/lib/services/llm.ts:29-37`).

This mapping is a pure function of `(value, reference_min, reference_max)`. The change brief scopes
Phase 1 to "unit (pure functions) only"; this verdict **is** the "in range / outside range verdict"
named in Risk #1. Recommendation: fold a small `angleVerdict()` helper into the extraction and
unit-test it (including the round-vs-raw boundary contradiction) — flag the minor scope stretch to
the owner. The archived review already saw the ignored-`error` half of this file
(`context/archive/2026-08-23-fitting-results-display/reviews/impl-review.md:34-41`, "SKIPPED").

### 7. The 2-D projection assumption (design → shipped drift)

The original design computed angles from MediaPipe `worldLandmarks` — "33 points, meters, origin =
hip midpoint" (`context/archive/2026-05-28-ai-analysis-pipeline/pose-estimation-research.md:190-191`;
`plan.md:36`). The shipped app uses **MoveNet**, which returns 2-D pixel keypoints only;
`convertKeypoints` forces `z = 0`, so `jointAngle`'s z-terms vanish and **every angle is an
image-plane projection**. The archived deviation note (`plan.md:452-467`) documents the MediaPipe→
MoveNet swap (driven by the WebGL2 crash, now `context/foundation/lessons.md:19-24`) but does **not**
flag the 3-D→2-D reduction as a risk.

Practical meaning: the angles are only valid for a **true perpendicular side view**. An off-axis
camera makes the projected angle diverge from the sagittal angle the reference frames assume. This is
**third-party-model / capture-quality accuracy** — `test-plan.md §7` already excludes it from the
suite ("validated offline against the ±10° acceptance criterion, not by the suite"). Phase 1 should
**document the assumption** on the extracted function and not attempt a rotated-pose fixture.

Also shipped below the original intent: MoveNet **Lightning** (fastest, least accurate) rather than
Thunder or the "heavy" model the research recommended for "fitting accuracy"
(`pose-estimation-research.md:164`; `plan.md:255`). Not a Phase 1 test target; relevant to the
offline ±10° validation.

### 8. The reference ranges — triplicated, contested, partly untraceable

The five ranges exist in **three** places that can drift apart:

1. `src/components/VideoAnalyzer.tsx:22-28` — `ANGLE_REFS` (source of truth in code).
2. `src/lib/services/llm.ts:12-18` — prose table in the recommendations system prompt.
3. The per-angle `reference_min` / `reference_max` in the payload the browser POSTs (copied from
   `ANGLE_REFS`), which are then **persisted** and used for the verdict.

Shipped values vs the two archived reference docs:

| Angle | Shipped (`ANGLE_REFS`) | `bike-fitting-ref-angles.md` | `angle-to-adjustment-guide.md` | Assessment |
|---|---|---|---|---|
| Knee @ BDC | `137–147` | `137–147` included `[3][12]` | `135–145` included (`:23`); perf riders `135–140` (`:25`) | matches doc 1; 2° above doc 2 |
| Knee @ TDC | `65–75` | "~65°; **floor 70**" (`:79`) — self-contradictory | `68–74` included, "no primary research consensus" (`:61`) | **matches neither**; looks like ±5 on "~65" |
| Hip @ TDC | `55–65` | `55–65` (`:46`) | `55–65` road; **up to 70 gravel/recreational** (`:69`) | uses the tighter road value for a gravel product |
| Torso | `45–55` from horizontal | `45–55` from horizontal (`:27`) | `45–55` from horizontal (`:97`) | ✅ ranges agree (frame differs — §4) |
| **Elbow** | **`150–160` included** | `20–30°` flexion = `150–160` included `[13]` (`:58`) | **`85–95` included** for gravel/hoods (`:126`); **explicitly flags the conflict** (`:128`) | **largest discrepancy (~60–75°)** — code took the road/competitive convention |

`angle-to-adjustment-guide.md:128` verbatim: *"sources targeting competitive road cyclists (Burt
2014) recommend 20–30° flexion from full extension (≈ 150–160° included)… The 85–95° included-angle
target here is consistent with a gravel/recreational position where the upper body is more upright."*
The shipped app judges gravel riders by the competitive-road elbow band — so a correctly bent,
upright-posture elbow (~90°) is scored "Outside range" and the LLM is told to "shorten stem by 10 mm
increments" (`llm.ts:36`).

This is **PRD Open Question #2** — *"Which gravel bike angle reference ranges are authoritative?"* —
marked **Block: yes** (`context/foundation/prd.md:128`). Two archived docs that were supposed to
resolve it disagree, and the code sometimes matches neither.

**Bearing on Phase 1:** range-**membership** assertions ("value X is in/out of range") cannot be
written until the owner freezes one canonical band per angle. **Geometry and convention assertions
are independent of that decision** and can proceed now:
- `jointAngle` on a straight limb → ~180 (not ~0) — proves *included*, not *flexion*.
- `jointAngle` on a constructed 140° → 140 ± tol.
- `computeTorsoAngle` on a 45°-from-horizontal hip→shoulder line → 45 for **both** facings.
- mirror invariance of knee/hip/elbow.

### 9. "Server would catch a bad result" — it does not

| Route | Validation | Persists / forwards |
|---|---|---|
| `POST /api/analyze` (`src/pages/api/analyze.ts:20-26`) | `{ video: z.string().min(1).max(140_000_000) }` — auth-gated, **not session-scoped** | forwards video to vision LLM |
| `POST /api/sessions/[id]/recommend` (`recommend.ts:39-45`) | `{ body_angles: z.array(bodyAngleSchema).min(1) }` — type-only | forwards angles **incl. client `reference_min/max`** to text LLM (`llm.ts:164-168`) |
| `POST /api/sessions/[id]/results` (`results.ts:22, 47-52`) | `resultsPayloadSchema` — type-only; requires session `status === 'processing'` | **`admin.from('analysis_results').insert({ body_angles: payload.body_angles, … })` verbatim**, RLS bypassed |

`bodyAngleSchema` (`src/lib/schemas.ts:13-19`): `{ name: string, value: number, reference_min:
number, reference_max: number, unit: string }`. No numeric bounds, no `0 ≤ value ≤ 180` plausibility
check, no check that `name` is one of the five known angles, no check that
`reference_min ≤ reference_max`, no check that the bounds equal any canonical constant.

DB (`supabase/migrations/20260526120000_initial_schema.sql:51-58`): `body_angles JSONB NOT NULL
DEFAULT '[]'::jsonb` — **no `CHECK`, no trigger, no shape validation.** Writes go through
`createAdminClient()` (`src/lib/services/supabase-admin.ts`), `service_role`, which has `BYPASSRLS`
(`:60-61` `FORCE ROW LEVEL SECURITY`, only service_role escapes).

The only server-side gate on `/results` is: `401` if no user, `404` if the RLS-scoped `select` sees
no session row (the sole ownership check), `409` unless status is `processing`. **No `user_id`
comparison on the write, no recomputation, no correctness oracle.** `test-plan.md:206-208` states
this explicitly; this research confirms it against the code.

### 10. BDC/TDC keyframe selection (context; mostly out of Phase 1 scope)

Two-stage (`context/archive/2026-05-28-ai-analysis-pipeline/plan.md:70`;
`src/components/VideoAnalyzer.tsx:251-284`):

1. **Vision LLM** (`google/gemini-3.5-flash`, whole video as base64 data-URI,
   `src/lib/services/llm.ts:78-159`) returns `{ timestamps: [{ t, f, type: "BDC"|"TDC" }] }` under a
   `strict` JSON schema. Local parsing only checks `Array.isArray(result.timestamps)` then casts
   (`llm.ts:153-158`) — no per-item check that `type ∈ {BDC, TDC}`.
2. **Deterministic ±0.066 s scan** (5 offsets `[-0.066, -0.033, 0, 0.033, 0.066]`): for a BDC
   timestamp keep the frame with the **highest** knee angle (most-extended leg); for TDC the
   **lowest** (deepest flexion). First usable BDC and first usable TDC win.

Stage 1 is **non-deterministic** → `test-plan.md §7` excludes it. Stage 2's selector *is*
deterministic and unit-testable **if extracted** (feed synthetic landmark sets, assert the pick).
Known accuracy gap, already deferred (`plan.md:51`, "No Cloudflare Container"): the scan window
(±0.066 s ≈ ±2 frames) is far narrower than the documented ±0.5 s decoder-seek error
(`pose-estimation-research.md:250-252`), so a poor LLM timestamp cannot be rescued. Not Phase 1's
problem; worth a one-line note on the extracted helper.

## Code References

Permalink base: `https://github.com/mjedrasz/bikefit/blob/ebd9351b174ed6f1185a9c9c76513585357d63c4/`

- `src/components/VideoAnalyzer.tsx:22-28` — `ANGLE_REFS` (KNEE_BDC 137–147, KNEE_TDC 65–75, HIP 55–65, TORSO 45–55, ELBOW 150–160)
- `src/components/VideoAnalyzer.tsx:47-53` — `jointAngle(a,b,c)` — included angle at vertex `b`, clamped, degrees
- `src/components/VideoAnalyzer.tsx:55-58` — `computeTorsoAngle(wl)` — **left/right-facing bug** (§3)
- `src/components/VideoAnalyzer.tsx:60-62` — `visible(lm)` — visibility ≥ 0.5
- `src/components/VideoAnalyzer.tsx:103-137` — `convertKeypoints()` — COCO-17 → 33-slot remap + side auto-select
- `src/components/VideoAnalyzer.tsx:139-151` — `detectPoseAt()` — no `flipHorizontal`, `z` unused
- `src/components/VideoAnalyzer.tsx:251-284` — BDC/TDC ±0.066 s extremum scan
- `src/components/VideoAnalyzer.tsx:286-339` — per-angle emission; **torso & elbow from BDC frame** (§4)
- `src/components/VideoAnalyzer.tsx:290-338` — browser writes `reference_min`/`reference_max` into the payload
- `src/lib/format-angle.ts:6-8` — `formatAngle = Math.round` (display only)
- `src/lib/schemas.ts:13-19` — `bodyAngleSchema` — type-only, no bounds
- `src/lib/schemas.ts:29-40` — `resultsPayloadSchema` — discriminated on `error`
- `src/lib/services/llm.ts:12-18` — reference-range prose table (2nd copy)
- `src/lib/services/llm.ts:29-37` — per-angle "<137° / >147°" thresholds in the prompt (3rd copy)
- `src/lib/services/llm.ts:78-159` — `analyzeVideo()` — vision LLM, weak local validation of `timestamps`
- `src/lib/services/llm.ts:161-221` — `generateRecommendations()` — forwards client-authored ranges
- `src/pages/api/analyze.ts:20-26` — video-only schema, not session-scoped
- `src/pages/api/sessions/[id]/recommend.ts:39-45` — type-only validation, forwards to LLM
- `src/pages/api/sessions/[id]/results.ts:22,47-52` — verbatim insert of `body_angles` via admin client
- `src/pages/sessions/[id].astro:40-44` — the **in/out-of-range verdict** (raw value vs raw bounds)
- `src/pages/sessions/[id].astro:77-91` — displays `Math.round`ed value/bounds → can contradict the pill
- `supabase/migrations/20260526120000_initial_schema.sql:51-58` — `analysis_results`, no `CHECK` on `body_angles`
- `supabase/migrations/20260526120000_initial_schema.sql:60-76` — `FORCE ROW LEVEL SECURITY`, no INSERT policy for `authenticated`

Reproduction script (not committed):
`/tmp/claude-1000/-home-marek-workspace-10x/590b7e7d-e00d-405f-9d1b-b8377b9ceb71/scratchpad/torso_check.mjs`
— confirms torso 50°→{50 right, 130 left}, knee straight→180, knee mirror-invariance.

## Architecture Insights

- **The "analysis pipeline" is a browser orchestrator.** `VideoAnalyzer.tsx` calls `/start` →
  `/analyze` (vision LLM) → runs pose detection locally → `/recommend` (text LLM) → `/results`. The
  server is a thin persistence + LLM-proxy layer. Every number the user eventually sees is **computed
  on the client**; the server never re-derives anything.
- **The correctness boundary is the pure math, and only the pure math.** Everything upstream (video
  decode, LLM keyframe pick, pose inference) is non-deterministic and excluded from the suite by
  `test-plan.md §7`. Everything downstream (verdict, LLM prose) consumes the math's output. So a
  small, fast unit suite on `jointAngle` / `computeTorsoAngle` / `convertKeypoints` / the verdict map
  is the **cheapest real signal** for Risk #1 — matching `test-plan.md §1` principle #1.
- **Duplication is the standing hazard.** Reference ranges live in 3 code locations + 2 archive docs;
  "in range" is defined once in code (`[id].astro:43`), described again in the LLM prompt, and
  implied by the payload's `reference_min/max`. An extraction that makes `ANGLE_REFS` the single
  exported source (imported by both `VideoAnalyzer.tsx` and, ideally, surfaced to `llm.ts`) removes
  one drift axis for free.
- **`convertKeypoints`' MediaPipe framing is archaeology.** The project pivoted MediaPipe→MoveNet
  (`lessons.md:19-24`); the 33-slot array and BlazePose indices are a compatibility shim for angle
  code that was written against the old design. Safe, but rename/comment during extraction.

## Historical Context (from prior changes)

- `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:46,66-68,273` — **torso was explicitly
  called out** as "not a three-point joint angle… requires `atan2`", with the exact shipped formula
  given. The plan authors knew the axis convention; the **left/right-facing** case was not
  considered.
- `context/archive/2026-05-28-ai-analysis-pipeline/pose-estimation-research.md:219` — a **superseded,
  contradictory** torso definition `jointAngle(wl[23], wl[11], wl[12])` (hip–shoulder–shoulder). The
  plan overrode it. **Anyone taking the oracle from the research doc would get the wrong convention**
  — take it from `bike-fitting-ref-angles.md` only.
- `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:452-467` — MediaPipe→MoveNet deviation
  (WebGL2 crash). States "Angle computation: unchanged in intent" — the **3-D→2-D** reduction and the
  **Lightning vs heavy-model** accuracy drop are not flagged.
- `context/archive/2026-05-28-ai-analysis-pipeline/plan.md:53` — "No ankle angle — ankle landmarks
  unreliably detected in side-view cycling video; excluded from MVP." (So five angles, not six.)
- `context/archive/2026-05-28-ai-analysis-pipeline/reviews/plan-review.md` (F2) — the BDC/TDC scan
  was **forward-only** until review; fixed to the 5-offset bidirectional scan now in the code.
- `context/archive/2026-05-28-ai-analysis-pipeline/reviews/impl-review.md` (F2) — `VISION_MODEL =
  "google/gemini-3.5-flash"` flagged as non-existent, **DISMISSED** on the user's assertion that it
  exists; plan text still says `gemini-2.5-flash`. Unresolved; affects keyframe quality/reproducibility.
- `context/archive/2026-05-28-ai-analysis-pipeline/reviews/impl-review.md` (F5) — server had **no
  size cap** on the base64 video; fixed with `.max(140_000_000)`. (F6) — a Supabase error in
  `/recommend` is deliberately conflated with 404 (Risk #7 lineage).
- `context/archive/2026-05-31-async-job-pipeline/reviews/plan-review.md:45-52` (F2, **ACCEPTED**) —
  the `analysis_results` INSERT and the `fitting_sessions` status UPDATE are **non-atomic**; a
  failure between them orphans a `processing` session with a results row. MVP-acceptable.
- `context/archive/2026-08-23-fitting-results-display/reviews/impl-review.md:34-41` (**SKIPPED**) —
  `sessions/[id].astro` ignores the `error` half of both Supabase results — the same file that hosts
  the verdict logic.
- `context/foundation/prd.md:31,128` — ±10° acceptance criterion; **Open Question #2** (authoritative
  gravel ranges) still Block: yes. `prd.md:103` — Business Logic says per-angle deviations are
  "inputs to the assessment, not outputs shown to the user" — but the shipped results page **does**
  show per-angle ranges and an in/out pill (FR-008 / US-01 AC won), so per-angle correctness is
  user-visible.

## Related Research

- `context/archive/2026-05-28-ai-analysis-pipeline/research.md` — pipeline architecture decision
  (browser-side, external LLMs).
- `context/archive/2026-05-28-ai-analysis-pipeline/pose-estimation-research.md` — pose-model
  evaluation (MediaPipe chosen, later swapped); seek-precision analysis.
- `context/foundation/test-plan.md` §2 (Risk #1 response guidance), §4 (stack), §6.1 (the cookbook
  entry this phase must fill), §7 (exclusions this phase relies on).

## Open Questions

1. **Does Phase 1 fix `computeTorsoAngle` or only land the failing test?** The change brief says
   "test-only," and `test-plan.md:97` lists only Phase 3 as feature work. But a test asserting the
   current left-facing output (130°) is the oracle anti-pattern; a correct-oracle test (expects ~50°)
   will fail on `master`. Options: (a) land the correct-oracle test **and** the ~1-line fix as an
   in-scope correction; (b) land it `.skip`/`.fails` + a bug ticket for a later phase; (c) owner
   decides. **Recommend (a)** — the fix is trivial and the bug is squarely Risk #1.
2. **Which reference band is canonical per angle — especially elbow (150–160 vs 85–95)?** PRD Open
   Question #2, Block: yes. The owner must pick before any range-**membership** assertion is written.
   Geometry/convention assertions do not wait on this.
3. **Is the verdict map (`sessions/[id].astro:43`) + the round-vs-raw display contradiction in
   Phase 1 scope?** It is a pure `(value, min, max) → bool` and it *is* the "in range / outside
   range verdict" Risk #1 names, but the brief says "pure functions only." Recommend: extract a tiny
   `angleVerdict()` and include it; flag the scope nuance.
4. **Torso/elbow measured at BDC, not crank-horizontal** — accept and document in `test-plan.md §7`,
   or open a follow-up to detect a third keyframe? (Detection work → not MVP.) Recommend: document as
   an accepted deviation.
5. **Extraction module path & surface.** Proposed `src/lib/pose/angles.ts` exporting `jointAngle`,
   `computeTorsoAngle`, `visible`, `convertKeypoints`, `ANGLE_REFS`, `PoseLandmark`, index constants,
   and optionally `pickExtremumFrame`. Confirm the name/location in `/10x-plan` against `CLAUDE.md`
   conventions.
6. **`z`/3-D signature** — keep `jointAngle`'s `{x,y,z}` signature (future-proofing for a 3-D model)
   or simplify to 2-D now? Cosmetic; decide in plan.
