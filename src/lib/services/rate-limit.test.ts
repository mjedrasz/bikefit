import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeSupabaseStub, type ScriptEntry } from "@/test/helpers/supabase-stub";
import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MINUTES } from "./rate-limit";

// `checkRateLimit` against a scripted `.rpc()` stub (test-plan §3 Phase 3, Risk #3). The
// window bucketing itself lives in Postgres (`check_and_increment_rate_limit`) — this suite
// only proves the app-side interpretation of the returned count, the fail-closed behavior on
// an RPC error, and that the trusted server-resolved user id is what gets sent, never
// anything client-suppliable.

function stubWithRpc(entry: ScriptEntry) {
  return makeSupabaseStub({ "rpc.check_and_increment_rate_limit": entry }) as unknown as SupabaseClient;
}

describe("checkRateLimit", () => {
  it("allows the request when the returned count is at the boundary (10th request)", async () => {
    const supabase = stubWithRpc({ data: 10 });

    const result = await checkRateLimit(supabase, "user-1", "analyze");

    expect(result).toEqual({ ok: true, allowed: true });
  });

  it("rejects the request when the returned count exceeds the max (11th request)", async () => {
    const supabase = stubWithRpc({ data: 11 });

    const result = await checkRateLimit(supabase, "user-1", "analyze");

    expect(result).toEqual({ ok: true, allowed: false });
  });

  it("fails closed — { ok: false } — on an RPC error, never allowing the request through", async () => {
    const supabase = stubWithRpc({ data: null, error: { message: "boom", code: "XX000" } });

    const result = await checkRateLimit(supabase, "user-1", "analyze");

    expect(result).toEqual({ ok: false });
  });

  it("allows again once a fresh window's count comes back low (window reset)", async () => {
    const supabase = stubWithRpc({ data: 1 });

    const result = await checkRateLimit(supabase, "user-1", "analyze");

    expect(result).toEqual({ ok: true, allowed: true });
  });

  it("calls the RPC with the trusted user id, the given route, and the fixed window size", async () => {
    const stub = makeSupabaseStub({ "rpc.check_and_increment_rate_limit": { data: 1 } });

    await checkRateLimit(stub as unknown as SupabaseClient, "user-42", "recommend");

    expect(stub.calls).toEqual([
      expect.objectContaining({
        table: "check_and_increment_rate_limit",
        operation: "rpc",
        payload: { p_user_id: "user-42", p_route: "recommend", p_window_minutes: RATE_LIMIT_WINDOW_MINUTES },
      }),
    ]);
  });

  it("exports the documented policy constants", () => {
    expect(RATE_LIMIT_MAX_REQUESTS).toBe(10);
    expect(RATE_LIMIT_WINDOW_MINUTES).toBe(10);
  });
});
