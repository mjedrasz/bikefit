import { describe, it, expect } from "vitest";
import type * as poseDetection from "@tensorflow-models/pose-detection";
import {
  ANGLE_REFS,
  COCO_LEFT,
  COCO_RIGHT,
  MP_SLOTS,
  computeTorsoAngle,
  convertKeypoints,
  jointAngle,
  pickExtremumFrame,
  visible,
  type PoseLandmark,
} from "@/lib/pose/angles";

// Oracle-driven unit suite for the pure pose-math module. Every expected value is derived
// from geometry (a straight limb is 180°, a right angle is 90°, a hip→shoulder line 45°
// above horizontal is 45°) or quoted from the reference-angle definitions in
// `context/foundation/reference-angles.md` — never from the value a function returns today,
// and never a snapshot.

const DEG = 180 / Math.PI;

type LandmarkSlots = Partial<Record<number, PoseLandmark>>;

/** A 33-slot landmark array; every slot is zeroed and invisible unless overridden. */
function makeLandmarks(slots: LandmarkSlots = {}): PoseLandmark[] {
  return Array.from({ length: 33 }, (_unused, i): PoseLandmark => slots[i] ?? { x: 0, y: 0, z: 0, visibility: 0 });
}

/** Reflect a landmark across the vertical axis (negate x). */
function mirrorX(p: PoseLandmark): PoseLandmark {
  return { ...p, x: -p.x };
}

/** A COCO-17 keypoint set; every slot is `{ x: 0, y: 0, score: 0 }` unless overridden.
 *  `length` under 17 leaves the trailing indices genuinely absent (`keypoints.at(i)` →
 *  `undefined`), which exercises `convertKeypoints`' missing-keypoint guard. */
function makeKeypoints(
  overrides: Partial<Record<number, poseDetection.Keypoint>> = {},
  length = 17,
): poseDetection.Keypoint[] {
  return Array.from({ length }, (_unused, i): poseDetection.Keypoint => overrides[i] ?? { x: 0, y: 0, score: 0 });
}

/** Mirror a COCO-17 keypoint set across the vertical axis: negate every x and swap the
 *  left/right index pairs, so the same physical landmarks are re-detected on the opposite
 *  side — what a real horizontal image flip does. */
function mirrorKeypointsX(kps: poseDetection.Keypoint[]): poseDetection.Keypoint[] {
  const flipped = kps.map((k): poseDetection.Keypoint => ({ ...k, x: -k.x }));
  const pairs: [number, number][] = [
    [5, 6],
    [7, 8],
    [9, 10],
    [11, 12],
    [13, 14],
    [15, 16],
  ];
  for (const [l, r] of pairs) {
    const tmp = flipped[l];
    flipped[l] = flipped[r];
    flipped[r] = tmp;
  }
  return flipped;
}

describe("ANGLE_REFS — blessed gravel bands", () => {
  // Oracle: the "Canonical bands" table in `context/foundation/reference-angles.md`
  // (authoritative, resolves PRD Open Question #2 / Roadmap OQ-2, 2026-09-02). Each literal
  // below is the doc's number, NOT a snapshot of today's constant — any drift of ANGLE_REFS
  // away from the foundation doc must fail here (cookbook §6.1 oracle rule). `convention` is
  // pinned because it feeds the generated recommendations prompt
  // (`src/lib/recommendations-prompt.ts`); silent drift would change the prompt wording.

  it("KNEE_BDC is 135–145°, included", () => {
    expect(ANGLE_REFS.KNEE_BDC.min).toBe(135);
    expect(ANGLE_REFS.KNEE_BDC.max).toBe(145);
    expect(ANGLE_REFS.KNEE_BDC.convention).toBe("included");
  });

  it("KNEE_TDC is 68–74°, included", () => {
    expect(ANGLE_REFS.KNEE_TDC.min).toBe(68);
    expect(ANGLE_REFS.KNEE_TDC.max).toBe(74);
    expect(ANGLE_REFS.KNEE_TDC.convention).toBe("included");
  });

  it("HIP is 55–70°, included", () => {
    expect(ANGLE_REFS.HIP.min).toBe(55);
    expect(ANGLE_REFS.HIP.max).toBe(70);
    expect(ANGLE_REFS.HIP.convention).toBe("included");
  });

  it("TORSO is 45–55°, from horizontal", () => {
    expect(ANGLE_REFS.TORSO.min).toBe(45);
    expect(ANGLE_REFS.TORSO.max).toBe(55);
    expect(ANGLE_REFS.TORSO.convention).toBe("from horizontal");
  });

  it("ELBOW is 150–165°, included", () => {
    expect(ANGLE_REFS.ELBOW.min).toBe(150);
    expect(ANGLE_REFS.ELBOW.max).toBe(165);
    expect(ANGLE_REFS.ELBOW.convention).toBe("included");
  });
});

describe("jointAngle", () => {
  const p = (x: number, y: number, z = 0): PoseLandmark => ({ x, y, z });

  it("is 180° for a straight limb — proves it is the included angle, not flexion", () => {
    expect(jointAngle(p(0, 0), p(1, 0), p(2, 0))).toBeCloseTo(180, 3);
  });

  it("is 90° for a right angle", () => {
    expect(jointAngle(p(0, 1), p(0, 0), p(1, 0))).toBeCloseTo(90, 3);
  });

  it("matches a constructed 140° angle at the vertex", () => {
    const r = 140 / DEG;
    expect(jointAngle(p(1, 0), p(0, 0), p(Math.cos(r), Math.sin(r)))).toBeCloseTo(140, 2);
  });

  it("is ~0° when fully folded — a and c coincident on one side of b", () => {
    expect(jointAngle(p(1, 0), p(0, 0), p(1, 0))).toBeCloseTo(0, 3);
  });

  it("is reflection-invariant — a pose and its x-mirror give the same angle", () => {
    const r = 140 / DEG;
    const a = p(1, 0);
    const b = p(0, 0);
    const c = p(Math.cos(r), Math.sin(r));
    expect(jointAngle(mirrorX(a), mirrorX(b), mirrorX(c))).toBeCloseTo(jointAngle(a, b, c), 6);
  });

  it("clamps dot/(|ba||bc|) to [-1, 1] before acos, so float error never yields NaN", () => {
    // ba = (1,1,1), bc = (2,2,2): the ratio computes to 1.0000000000000002 > 1 in
    // floating point; an unclamped Math.acos would return NaN.
    const angle = jointAngle(p(1, 1, 1), p(0, 0, 0), p(2, 2, 2));
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeCloseTo(0, 3);
  });

  it("returns NaN for coincident keypoints — documented current behaviour, not fixed this phase", () => {
    // Callers gate on visible() only, never on coincidence. Tracked in test-plan §6.6.
    expect(Number.isNaN(jointAngle(p(0, 0), p(0, 0), p(1, 0)))).toBe(true);
  });
});

describe("computeTorsoAngle", () => {
  // hip→shoulder line at `angleDeg` above horizontal; `facing` picks which way along x the
  // rider points. The shoulder sits above the hip (smaller y — y increases downward).
  function torsoPose(angleDeg: number, facing: "left" | "right"): PoseLandmark[] {
    const rad = angleDeg / DEG;
    const dir = facing === "right" ? 1 : -1;
    return makeLandmarks({
      11: { x: 100 + dir * Math.cos(rad) * 100, y: 300 - Math.sin(rad) * 100, z: 0, visibility: 1 },
      23: { x: 100, y: 300, z: 0, visibility: 1 },
    });
  }

  it("measures a right-facing 45° torso as 45° from horizontal", () => {
    expect(computeTorsoAngle(torsoPose(45, "right"))).toBeCloseTo(45, 4);
  });

  it("measures a left-facing 45° torso as 45° from horizontal — direction-agnostic", () => {
    // Fails before the Phase 3 fix: the old Math.abs(atan2(...)) returns 135° here.
    expect(computeTorsoAngle(torsoPose(45, "left"))).toBeCloseTo(45, 4);
  });

  it("gives the same 50° for both facings", () => {
    expect(computeTorsoAngle(torsoPose(50, "right"))).toBeCloseTo(50, 4);
    expect(computeTorsoAngle(torsoPose(50, "left"))).toBeCloseTo(50, 4);
  });

  it("handles a near-horizontal torso line for both facings", () => {
    expect(computeTorsoAngle(torsoPose(5, "right"))).toBeCloseTo(5, 4);
    expect(computeTorsoAngle(torsoPose(5, "left"))).toBeCloseTo(5, 4);
  });

  it("handles a near-vertical torso line for both facings", () => {
    expect(computeTorsoAngle(torsoPose(85, "right"))).toBeCloseTo(85, 4);
    expect(computeTorsoAngle(torsoPose(85, "left"))).toBeCloseTo(85, 4);
  });
});

describe("convertKeypoints", () => {
  const order = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"] as const;

  /** COCO keypoints for one body side, each landmark tagged with distinct coordinates. */
  function sidedKeypoints(dominant: "left" | "right"): poseDetection.Keypoint[] {
    const kps = makeKeypoints();
    COCO_LEFT.forEach((idx, k) => {
      kps[idx] = { x: 10 + k, y: 20 + k, score: dominant === "left" ? 0.9 : 0.1, name: `left-${order[k]}` };
    });
    COCO_RIGHT.forEach((idx, k) => {
      kps[idx] = { x: -10 - k, y: -20 - k, score: dominant === "right" ? 0.9 : 0.1, name: `right-${order[k]}` };
    });
    return kps;
  }

  it("maps the left-side COCO keypoints into slots 11/13/15/23/25/27 when left scores dominate", () => {
    const result = convertKeypoints(sidedKeypoints("left"));
    MP_SLOTS.forEach((slot, k) => {
      expect(result[slot]).toEqual({ x: 10 + k, y: 20 + k, z: 0, visibility: 0.9 });
    });
  });

  it("maps the right-side COCO keypoints into the same slots when right scores dominate", () => {
    const result = convertKeypoints(sidedKeypoints("right"));
    MP_SLOTS.forEach((slot, k) => {
      expect(result[slot]).toEqual({ x: -10 - k, y: -20 - k, z: 0, visibility: 0.9 });
    });
  });

  it("resolves an exact score tie to the left side", () => {
    const kps = makeKeypoints();
    COCO_LEFT.forEach((idx, k) => {
      kps[idx] = { x: 10 + k, y: 20 + k, score: 0.5 };
    });
    COCO_RIGHT.forEach((idx, k) => {
      kps[idx] = { x: -10 - k, y: -20 - k, score: 0.5 };
    });
    const result = convertKeypoints(kps);
    MP_SLOTS.forEach((slot, k) => {
      expect(result[slot]).toEqual({ x: 10 + k, y: 20 + k, z: 0, visibility: 0.5 });
    });
  });

  it("leaves a slot zeroed and invisible when its keypoint is missing", () => {
    // length 15 → COCO index 15 (left ankle) is genuinely absent.
    const kps = makeKeypoints({}, 15);
    for (const idx of [5, 7, 9, 11, 13]) kps[idx] = { x: 5, y: 5, score: 0.9 };
    for (const idx of [6, 8, 10, 12, 14]) kps[idx] = { x: 1, y: 1, score: 0.1 };
    const result = convertKeypoints(kps);
    expect(result[27]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
    expect(visible(result[27])).toBe(false);
  });

  it("produces equal knee, hip, and elbow angles for a pose and its x-mirror", () => {
    const left = makeKeypoints();
    left[5] = { x: 200, y: 100, score: 0.9 }; // shoulder
    left[7] = { x: 230, y: 150, score: 0.9 }; // elbow
    left[9] = { x: 210, y: 190, score: 0.9 }; // wrist
    left[11] = { x: 180, y: 250, score: 0.9 }; // hip
    left[13] = { x: 240, y: 330, score: 0.9 }; // knee
    left[15] = { x: 200, y: 410, score: 0.9 }; // ankle
    COCO_RIGHT.forEach((idx) => {
      left[idx] = { x: 0, y: 0, score: 0.05 };
    });

    const a = convertKeypoints(left);
    const b = convertKeypoints(mirrorKeypointsX(left));

    const knee = (wl: PoseLandmark[]): number => jointAngle(wl[23], wl[25], wl[27]);
    const hip = (wl: PoseLandmark[]): number => jointAngle(wl[11], wl[23], wl[25]);
    const elbow = (wl: PoseLandmark[]): number => jointAngle(wl[11], wl[13], wl[15]);

    expect(knee(b)).toBeCloseTo(knee(a), 6);
    expect(hip(b)).toBeCloseTo(hip(a), 6);
    expect(elbow(b)).toBeCloseTo(elbow(a), 6);
  });
});

describe("pickExtremumFrame", () => {
  /** A 33-slot frame whose hip–knee–ankle angle is exactly `kneeAngleDeg`. */
  function kneePose(kneeAngleDeg: number, opts: { visible?: boolean } = {}): PoseLandmark[] {
    const vis = opts.visible === false ? 0 : 1;
    const rad = kneeAngleDeg / DEG;
    return makeLandmarks({
      23: { x: 0, y: -100, z: 0, visibility: vis }, // hip: straight up from the knee
      25: { x: 0, y: 0, z: 0, visibility: vis }, // knee at the origin
      27: { x: Math.sin(rad) * 100, y: -Math.cos(rad) * 100, z: 0, visibility: vis }, // ankle
    });
  }

  it("returns the highest-knee-angle frame for BDC and the lowest for TDC", () => {
    const candidates = [kneePose(120), kneePose(150), kneePose(90)];
    expect(pickExtremumFrame(candidates, "BDC")).toBe(candidates[1]);
    expect(pickExtremumFrame(candidates, "TDC")).toBe(candidates[2]);
  });

  it("skips a candidate that fails the visibility gate on slot 23/25/27", () => {
    const usable = kneePose(150);
    const moreExtremeButInvisible = kneePose(175, { visible: false });
    expect(pickExtremumFrame([usable, moreExtremeButInvisible], "BDC")).toBe(usable);
  });

  it("returns null when no candidate qualifies", () => {
    expect(pickExtremumFrame([], "BDC")).toBeNull();
    expect(pickExtremumFrame([kneePose(140, { visible: false })], "TDC")).toBeNull();
  });

  it("returns the earliest candidate on an exact knee-angle tie, for both types", () => {
    const first = kneePose(140);
    const second = kneePose(140);
    expect(pickExtremumFrame([first, second], "BDC")).toBe(first);
    expect(pickExtremumFrame([first, second], "TDC")).toBe(first);
  });
});

describe("visible", () => {
  it("is false for undefined", () => {
    expect(visible(undefined)).toBe(false);
  });

  it("is false when the visibility field is absent", () => {
    expect(visible({ x: 0, y: 0, z: 0 })).toBe(false);
  });

  it("is false just below the 0.5 threshold", () => {
    expect(visible({ x: 0, y: 0, z: 0, visibility: 0.49 })).toBe(false);
  });

  it("is true at the 0.5 threshold", () => {
    expect(visible({ x: 0, y: 0, z: 0, visibility: 0.5 })).toBe(true);
  });
});
