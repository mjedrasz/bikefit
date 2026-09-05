import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user, per-route request counter (test-plan §3 Phase 3, Risk #3). Hides the RPC/
// count-comparison detail behind one call: "is this request allowed." The window itself is
// bucketed inside the `check_and_increment_rate_limit` Postgres function, not here — the app
// may run as multiple Worker instances with no shared clock guarantee (see plan's Critical
// Implementation Details).

export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_MINUTES = 10;

export type RateLimitRoute = "analyze" | "recommend";

export type RateLimitResult = { ok: true; allowed: boolean } | { ok: false };

/**
 * Atomically increments the caller's request count for `route` in the current window and
 * reports whether the request is still within the allowed count. Fails closed: an RPC error
 * returns `{ ok: false }` rather than letting the request through (project Risk #7's
 * error-vs-pass-through rule, applied to this new gate).
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  route: RateLimitRoute,
): Promise<RateLimitResult> {
  const { data, error } = (await supabase.rpc("check_and_increment_rate_limit", {
    p_user_id: userId,
    p_route: route,
    p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
  })) as { data: number | null; error: { message: string } | null };

  if (error || data === null) {
    return { ok: false };
  }

  return { ok: true, allowed: data <= RATE_LIMIT_MAX_REQUESTS };
}
