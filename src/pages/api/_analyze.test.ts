import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { installOpenRouterMock, type OpenRouterMock } from "@/test/helpers/openrouter-mock";
import { POST } from "./analyze";

// Route-level integration for the LLM boundary (test-plan §6.3, Risk #2). A malformed
// upstream response must surface as a 500 with the GENERIC body — never the upstream text,
// never a 200 partial. Auth + payload branches are covered too.
//
// Risk #5 ownership (test-plan §6.4, §3 Phase 4): `/analyze` is now bound to an owned,
// `processing` session — the pre-check runs before any vision-model call, so a missing or
// not-owned / not-in-flight session never burns vision budget. Stub-level ordering only;
// the real cross-user RLS check is §3 Phase 4's Playwright deferral (see §6.4).
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
let openrouter: OpenRouterMock;
const user = { id: "user-1" } as User;
const sessionId = "11111111-1111-4111-8111-111111111111";
const validBody = { video: "dGVzdA==", session_id: sessionId };

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]) {
  const stub = makeSupabaseStub(script);
  mockedCreateClient.mockReturnValue(stub as unknown as SupabaseClient);
  return stub;
}

function stubAdminRpc(script: Parameters<typeof makeSupabaseStub>[0]) {
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

describe("POST /api/analyze", () => {
  it("401 when unauthenticated (no Supabase, no OpenRouter call)", async () => {
    const res = await POST(makeApiContext({ body: validBody }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("429 when the rate limit is exceeded, before any ownership query or OpenRouter call", async () => {
    stubAdminRpc({ "rpc.check_and_increment_rate_limit": { data: 11 } });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests. Please try again later." });
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  it("500 when the rate-limit RPC errors, before any ownership query or OpenRouter call", async () => {
    stubAdminRpc({ "rpc.check_and_increment_rate_limit": { data: null, error: { message: "boom" } } });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not verify request. Please try again." });
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  it("400 when the payload is missing `video`", async () => {
    const res = await POST(makeApiContext({ user, body: { session_id: sessionId } }));

    expect(res.status).toBe(400);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("400 when the payload is missing `session_id`", async () => {
    const res = await POST(makeApiContext({ user, body: { video: "dGVzdA==" } }));

    expect(res.status).toBe(400);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("200 with the parsed timestamps on a well-formed upstream response", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: { id: sessionId, status: "processing" } },
    });
    openrouter.replyWith(200, { timestamps: [{ t: 1.25, f: 40, type: "BDC" }] });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timestamps: [{ t: 1.25, f: 40, type: "BDC" }] });
    openrouter.assertCalledOnce();
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
  });

  it("500 with a generic body — not the upstream text — on an upstream error", async () => {
    stubReturns({ "fitting_sessions.select": { data: { id: sessionId, status: "processing" } } });
    openrouter.replyRaw(500, '{"error":{"message":"secret upstream reason"}}');

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Video analysis failed. Please try again." });
  });

  it("500 with the generic body on a malformed (drifted-shape) upstream response", async () => {
    stubReturns({ "fitting_sessions.select": { data: { id: sessionId, status: "processing" } } });
    openrouter.replyWith(200, { timestamps: [{ t: 1, type: "MIDDLE" }] });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Video analysis failed. Please try again." });
  });

  // Risk #7 (test-plan §6.2 addendum): a genuine pre-check query failure is a distinct
  // 500 — never the same "Session not found" 404 as a missing/not-owned row.
  it("500 — not 404 — when the session pre-check query errors, and no OpenRouter call follows", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load session" });
    expect(stub.calls).toEqual([
      expect.objectContaining({ table: "fitting_sessions", operation: "select", terminal: "maybeSingle" }),
    ]);
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  it("404 when the session doesn't exist (or isn't owned), and no OpenRouter call follows", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: null, error: null } });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });

  it("409 when the session is not in the processing state, and no OpenRouter call follows", async () => {
    stubReturns({ "fitting_sessions.select": { data: { id: sessionId, status: "queued" } } });

    const res = await POST(makeApiContext({ user, body: validBody }));

    expect(res.status).toBe(409);
    expect(() => {
      openrouter.assertCalledOnce();
    }).toThrow();
  });
});
