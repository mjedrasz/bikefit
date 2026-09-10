import { CRITERION_IDS, type CriterionId, type Review } from "./schemas.js";

export interface Decision {
  decision: "pass" | "fail";
  /** Echoed back for rendering. */
  failBelow: number;
  /** The lowest score across all five criteria. */
  minScore: number;
  /** Criteria scoring below `failBelow`, in `CRITERION_IDS` order. */
  failing: CriterionId[];
}

/**
 * Pure pass/fail decision. Hard floor across all five criteria: the review
 * fails iff at least one criterion scored below `failBelow` (boundary is `<`,
 * not `<=`). The general assessment does not affect the decision.
 *
 * `failBelow` is not clamped here — callers pass a validated integer.
 */
export function decide(review: Review, failBelow: number): Decision {
  const scores = CRITERION_IDS.map((id) => review.criteria[id].score);
  const minScore = Math.min(...scores);
  const failing: CriterionId[] = CRITERION_IDS.filter(
    (id) => review.criteria[id].score < failBelow,
  );
  return {
    decision: failing.length > 0 ? "fail" : "pass",
    failBelow,
    minScore,
    failing,
  };
}
