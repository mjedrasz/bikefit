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
 *  these bands by `angleVerdict` (`src/lib/angle-verdict.ts`), which is the consumer that
 *  turns a raw angle into the user-visible "in range / outside range" verdict. The bands
 *  themselves are an unresolved owner decision (PRD Open Question #2) — do not treat them
 *  as authoritative for gravel/recreational positions. */
export const ANGLE_REFS = {
  KNEE_BDC: { min: 137, max: 147, unit: "degrees", name: "Knee angle at BDC" },
  KNEE_TDC: { min: 65, max: 75, unit: "degrees", name: "Knee angle at TDC" },
  HIP: { min: 55, max: 65, unit: "degrees", name: "Hip angle at TDC" },
  TORSO: { min: 45, max: 55, unit: "degrees", name: "Torso angle" },
  ELBOW: { min: 150, max: 160, unit: "degrees", name: "Elbow angle" },
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

// Torso angle: angle of hip→shoulder vector from horizontal (Y increases downward in world coords)
// MOVED UNCHANGED from VideoAnalyzer.tsx — carries a known left/right-facing bug (returns
// `180° − true` for a left-facing rider); fixed in test-plan rollout Phase 3.
export function computeTorsoAngle(wl: PoseLandmark[]): number {
  return Math.abs(Math.atan2(wl[11].y - wl[23].y, wl[11].x - wl[23].x) * (180 / Math.PI));
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
