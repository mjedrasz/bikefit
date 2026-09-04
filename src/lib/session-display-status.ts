import type { SessionStatus } from "@/types";

// The browser pipeline (vision LLM + CPU pose detection over 5 offsets/keyframe) runs
// single-digit minutes; 15 min is a safe "no client is coming back" threshold. Tune with
// real telemetry.
export const STALE_PROCESSING_MS = 15 * 60_000;

export const STALE_PROCESSING_MESSAGE =
  "Analysis timed out — the browser tab may have been closed before it finished. Please try again.";

/**
 * Maps a stored session status + `updated_at` + "now" to the status the UI should render.
 * Display-time only — the stored row is never written. A `processing` (or stuck `queued`)
 * session with no progress for longer than `STALE_PROCESSING_MS` renders as `"failed"`.
 *
 * The `queued` arm rescues a session whose `queued -> processing` `UPDATE` silently failed
 * (research §4c — a transient error, or the ownership guard matching 0 rows, neither of
 * which surfaces as an `error`): a normal `queued` row has `updated_at ≈ created_at` and the
 * client fires `/start` on mount, so it never trips the threshold on its own.
 *
 * A malformed `updatedAt` makes `Date.parse` return `NaN`; the comparison below is then
 * always `false`, so the stored status is returned unchanged rather than throwing.
 */
export function effectiveSessionStatus(status: SessionStatus, updatedAt: string, now: number): SessionStatus {
  const isPending = status === "processing" || status === "queued";
  if (isPending && now - Date.parse(updatedAt) > STALE_PROCESSING_MS) {
    return "failed";
  }
  return status;
}
