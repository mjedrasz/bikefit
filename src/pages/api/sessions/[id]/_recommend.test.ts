import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub, type SupabaseStub } from "@/test/helpers/supabase-stub";
import { installOpenRouterMock, type OpenRouterMock } from "@/test/helpers/openrouter-mock";
import { POST } from "./recommend";

// Route-level integration for the recommendations LLM boundary (test-plan §6.3, Risk #2).
// A malformed upstream response → 500 with the GENERIC body and no DB write. Session
// pre-check runs against the Supabase stub; OpenRouter is mocked at the HTTP edge.
//
// Risk #3 rate limiting (test-plan §3 Phase 3): the rate-limit RPC (via the admin client) is
// the new first gate after auth, ahead of the ownership pre-check and the OpenRouter call.
// Every test below scripts the admin client's `.rpc()` with a default "allowed" response via
// `beforeEach` so unrelated tests aren't coupled to the rate-limit path; the dedicated
// rate-limit tests override it per case.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/supabase-admin", () => ({ createAdminClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const user = { id: "user-1" } as User;
const validBody = {
  body_angles: [{ name: "Knee extension", value: 145, reference_min: 140, reference_max: 150, unit: "°" }],
};

let openrouter: OpenRouterMock;

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]): SupabaseStub {
  const stub = makeSupabaseStub(script);
  mockedCreateClient.mockReturnValue(stub as unknown as SupabaseClient);
  return stub;
}

function stubAdminRpc(script: Parameters<typeof makeSupabaseStub>[0]): SupabaseStub {
  const stub = makeSupabaseStub(script);
  mockedCreateAdminClient.mockReturnValue(stub as unknown as SupabaseClient);
  return stub;
}

beforeEach(() => {
  openrouter = installOpenRouterMock();
  stubAdminRpc({ "rpc.check_and_increment_rate_limit": { data: 1 } });
});

afterEach(() => {
  openrouter.restore();
});

describe("POST /api/sessions/[id]/recommend", () => {
  it("401 when unauthenticated (no Supabase, no OpenRouter call)", async () => {
    const res = await POST(makeApiContext({ params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("429 when the rate limit is exceeded, before any ownership query or OpenRouter call", async () => {
    stubAdminRpc({ "rpc.check_and_increment_rate_limit": { data: 11 } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests. Please try again later." });
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  it("500 when the rate-limit RPC errors, before any ownership query or OpenRouter call", async () => {
    stubAdminRpc({ "rpc.check_and_increment_rate_limit": { data: null, error: { message: "boom" } } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not verify request. Please try again." });
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  it("200 with the recommendations on a well-formed upstream response", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: { id: "s1", status: "processing" } } });
    openrouter.replyWith(200, {
      recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee angle below reference band" }],
      raw_llm_response: "raw",
    });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee angle below reference band" }],
      raw_llm_response: "raw",
    });
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
  });

  it("500 with a generic body — not the upstream text — and no DB write on an upstream error", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: { id: "s1", status: "processing" } } });
    openrouter.replyRaw(500, '{"error":{"message":"secret upstream reason"}}');

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not generate recommendations. Please try again." });
    expect(stub.calls.some((c) => c.operation !== "select")).toBe(false);
  });

  it("500 with the generic body on a malformed (drifted-shape) upstream response", async () => {
    stubReturns({ "fitting_sessions.select": { data: { id: "s1", status: "processing" } } });
    openrouter.replyWith(200, { recommendations: [{ foo: 1 }], raw_llm_response: "x" });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not generate recommendations. Please try again." });
  });

  // Risk #7 (test-plan §6.2 addendum): a genuine pre-check query failure is a distinct
  // 500 — never the same "Session not found" 404 as a missing/not-owned row.
  it("500 — not 404 — when the session pre-check query errors, and no OpenRouter call follows", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load session" });
    expect(stub.calls).toEqual([
      expect.objectContaining({ table: "fitting_sessions", operation: "select", terminal: "maybeSingle" }),
    ]);
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  // Risk #5 ownership (test-plan §6.4, §3 Phase 4): a no-row pre-check is 404 with no
  // OpenRouter call — `recommend` has no admin write, so the pre-check IS the ownership
  // guard here (no `.eq("user_id")` write to additionally assert, unlike `start`/`results`).
  it("404 when the pre-check finds no row, and no OpenRouter call follows", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: null, error: null } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(404);
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });
});
