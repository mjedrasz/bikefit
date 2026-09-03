import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub, type SupabaseStub } from "@/test/helpers/supabase-stub";
import { installOpenRouterMock, type OpenRouterMock } from "@/test/helpers/openrouter-mock";
import { POST } from "./recommend";

// Route-level integration for the recommendations LLM boundary (test-plan §6.3, Risk #2).
// A malformed upstream response → 500 with the GENERIC body and no DB write. Session
// pre-check runs against the Supabase stub; OpenRouter is mocked at the HTTP edge.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
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

beforeEach(() => {
  openrouter = installOpenRouterMock();
});

afterEach(() => {
  openrouter.restore();
});

describe("POST /api/sessions/[id]/recommend", () => {
  it("401 when unauthenticated (no Supabase, no OpenRouter call)", async () => {
    const res = await POST(makeApiContext({ params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
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
});
