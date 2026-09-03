import type * as poseDetection from "@tensorflow-models/pose-detection";

// Pure pose-geometry helpers extracted verbatim from `src/components/VideoAnalyzer.tsx`
// so they can be unit-tested and reused. No I/O, no DOM — plain arithmetic over plain
// objects.
//
// Coordinate space: the shipped app runs MoveNet SinglePose Lightning (CPU backend),
// which returns **2-D pixel** keypoints — `x` rightward, `y` downward, no depth. Every
// angle here is therefore an **image-plane projection**, valid only for a true
// perpendicular side view. The 3-D `z` field is a vestige of the abandoned MediaPipe
// `worldLandmarks` design (see `context/foundation/lessons.md`) and is always 0 in
// practice; the 3-D signatures are kept as future-proofing for a depth-capable model.
//
// The "33-slot / MediaPipe BlazePose" framing in `convertKeypoints` is likewise
// archaeology — the project pivoted MediaPipe → MoveNet — but the slot indices are a
// hard contract every downstream reader depends on, so they are preserved exactly.

/** The five bike-fitting reference ranges, in degrees. Measured values are judged against
 *  these bands by `angleVerdict` (`src/lib/angle-verdict.ts`), which turns a raw angle into
 *  the user-visible "in range / outside range" verdict; the recommendations system prompt
 *  is generated from them (`src/lib/recommendations-prompt.ts`), so each band number lives
 *  in exactly one place. `measuredAt` and `convention` are labels the prompt generator
 *  renders — no consumer of the persisted `BodyAngle` reads them.
 *
 *  The authoritative source of record for these values — and the reconciliation behind
 *  each one — is `context/foundation/reference-angles.md` (resolves PRD Open Question #2 /
 *  Roadmap OQ-2, 2026-09-02). `src/lib/pose/angles.test.ts` pins this constant to that
 *  doc. */
export const ANGLE_REFS = {
  KNEE_BDC: {
    min: 135,
    max: 145,
    unit: "degrees",
    name: "Knee angle at BDC",
    measuredAt: "Bottom of pedal stroke (6 o'clock)",
    convention: "included",
  },
  KNEE_TDC: {
    min: 68,
    max: 74,
    unit: "degrees",
    name: "Knee angle at TDC",
    measuredAt: "Top of pedal stroke (12 o'clock)",
    convention: "included",
  },
  HIP: {
    min: 55,
    max: 70,
    unit: "degrees",
    name: "Hip angle at TDC",
    measuredAt: "Top of pedal stroke (12 o'clock)",
    convention: "included",
  },
  TORSO: {
    min: 45,
    max: 55,
    unit: "degrees",
    name: "Torso angle",
    measuredAt: "Hands on hoods, cranks horizontal",
    convention: "from horizontal",
  },
  ELBOW: {
    min: 150,
    max: 165,
    unit: "degrees",
    name: "Elbow angle",
    measuredAt: "Riding on hoods",
    convention: "included",
  },
} as const;

/** COCO-17 keypoint indices for the **left**-side body landmarks, in the order
 *  `[shoulder, elbow, wrist, hip, knee, ankle]`. */
export const COCO_LEFT = [5, 7, 9, 11, 13, 15] as const;

/** COCO-17 keypoint indices for the **right**-side body landmarks, same order as
 *  `COCO_LEFT`. */
export const COCO_RIGHT = [6, 8, 10, 12, 14, 16] as const;

/** MediaPipe BlazePose 33-slot indices the chosen physical side is written into, same
 *  order as `COCO_LEFT` / `COCO_RIGHT`. Vestigial framing (the app runs MoveNet), but
 *  every angle call site reads these exact slots — `wl[11]` shoulder, `wl[13]` elbow,
 *  `wl[15]` wrist, `wl[23]` hip, `wl[25]` knee, `wl[27]` ankle. */
export const MP_SLOTS = [11, 13, 15, 23, 25, 27] as const;

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/**
 * Included angle at vertex `b` for the three points `a`–`b`–`c`, in degrees.
 * `180°` = a straight limb, `0°` = fully folded. Clamped to `[-1, 1]` before `acos`
 * so float error near a straight limb never produces `NaN`. Reflection-invariant, so
 * left- and right-facing riders give the same value.
 *
 * NOTE: operates on the 2-D image-plane projection (`z` is always 0 in practice — see
 * module doc). Two coincident input points yield a zero-length vector and `NaN`;
 * callers gate on `visible()` but not on coincidence.
 */
export function jointAngle(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const mag = (v: { x: number; y: number; z: number }) => Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  return Math.acos(Math.max(-1, Math.min(1, dot / (mag(ba) * mag(bc))))) * (180 / Math.PI);
}

/**
 * Angle of the hip→shoulder line from horizontal, as an **acute** angle in `[0, 90]`
 * degrees. `context/foundation/reference-angles.md` defines the torso angle as "measured
 * from horizontal to a line from hip to shoulder … 45–55° from horizontal".
 *
 * Direction-agnostic: the magnitude is taken on each component before `atan2`, folding
 * the result to its acute complement, so a left-facing and a right-facing rider at the
 * same true lean return the same value. (Before test-plan rollout Phase 3 this was
 * `Math.abs(atan2(dy, dx))`, which folded the sign but not the 180° complement and so
 * returned `180° − true` for a left-facing rider — a well-fitted left-facing rider was
 * scored "Outside range" and the LLM told the torso was far too upright.)
 *
 * Input is 2-D pixel space (`x` rightward, `y` downward — see the module doc); the result
 * is the image-plane projection, valid only for a true perpendicular side view.
 *
 * Frame deviation — accepted MVP gap, see `context/foundation/test-plan.md` §7: the
 * caller measures this from the **BDC** keyframe, but `context/foundation/reference-angles.md`
 * defines the torso angle at cranks-horizontal (3/9 o'clock). Torso-to-horizontal shifts only ~5° across
 * the pedal stroke so the practical error is small; closing it needs a third detected
 * keyframe (out of MVP scope). The **elbow** angle (`jointAngle(wl[11], wl[13], wl[15])`)
 * is likewise consumed from BDC while the reference implies cranks-horizontal — the same
 * accepted deviation.
 */
export function computeTorsoAngle(wl: PoseLandmark[]): number {
  // hip→shoulder vector; direction-agnostic angle from horizontal, 0–90°
  const dy = wl[11].y - wl[23].y;
  const dx = wl[11].x - wl[23].x;
  return Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
}

/** Visibility gate: a landmark is usable when its `visibility` (populated from MoveNet's
 *  keypoint `score`) is at least `0.5`. Missing landmark or missing field → `false`. */
export function visible(lm: PoseLandmark | undefined): boolean {
  return (lm?.visibility ?? 0) >= 0.5;
}

// Convert MoveNet COCO-17 keypoints to a 33-slot array matching the MediaPipe landmark indices
// used by jointAngle() and computeTorsoAngle(). Picks whichever side (left/right) has higher
// summed visibility so the component works for both left- and right-facing cycling videos;
// an exact tie resolves to the left side. Performs NO coordinate mirroring — facing
// direction survives in `x` and reaches computeTorsoAngle() unhandled.
export function convertKeypoints(keypoints: poseDetection.Keypoint[]): PoseLandmark[] {
  const score = (i: number) => keypoints[i]?.score ?? 0;
  const leftScore = COCO_LEFT.reduce((sum, i) => sum + score(i), 0);
  const rightScore = COCO_RIGHT.reduce((sum, i) => sum + score(i), 0);
  const cocoSide = leftScore >= rightScore ? COCO_LEFT : COCO_RIGHT;
  const landmarks: PoseLandmark[] = Array(33)
    .fill(null)
    .map(() => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  MP_SLOTS.forEach((mpIdx, k) => {
    const kp = keypoints.at(cocoSide[k]);
    if (kp) landmarks[mpIdx] = { x: kp.x, y: kp.y, z: 0, visibility: kp.score ?? 0 };
  });
  return landmarks;
}

/**
 * Pure BDC/TDC keyframe selection lifted from `VideoAnalyzer.tsx`'s inline scan. Given
 * the already-detected candidate landmark sets for **one** vision-LLM timestamp (its
 * ±2-frame offset scan, ≤5 entries), return the frame with the extremum knee angle:
 * the **highest** hip–knee–ankle angle for `"BDC"` (most-extended leg), the **lowest**
 * for `"TDC"` (deepest flexion).
 *
 * Behaviour contract (must stay byte-for-byte with the original loop):
 * - candidates failing `visible()` on any of slots 23/25/27 are skipped;
 * - the comparison is strict (`>` / `<`) seeded at `∓Infinity`, so on an **exact**
 *   knee-angle tie the earliest candidate (lowest array index) wins;
 * - no qualifying candidate → `null`.
 *
 * Call this **once per timestamp** on that timestamp's own offset candidates — never on
 * a pool of every BDC (or every TDC) timestamp, which would pick a global extremum and
 * change the measured frame for a multi-BDC/TDC video. The narrow ±0.066 s scan window
 * cannot rescue a poor LLM timestamp — a known, accepted accuracy gap.
 */
export function pickExtremumFrame(candidates: PoseLandmark[][], type: "BDC" | "TDC"): PoseLandmark[] | null {
  let bestLandmarks: PoseLandmark[] | null = null;
  let bestKneeAngle = type === "BDC" ? -Infinity : Infinity;

  for (const wl of candidates) {
    if (!visible(wl[23]) || !visible(wl[25]) || !visible(wl[27])) continue;

    const ka = jointAngle(wl[23], wl[25], wl[27]);
    if (type === "BDC" && ka > bestKneeAngle) {
      bestKneeAngle = ka;
      bestLandmarks = wl;
    } else if (type === "TDC" && ka < bestKneeAngle) {
      bestKneeAngle = ka;
      bestLandmarks = wl;
    }
  }

  return bestLandmarks;
}
