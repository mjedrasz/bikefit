import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { makeApiContext } from "@/test/helpers/api-context";
import { installOpenRouterMock, type OpenRouterMock } from "@/test/helpers/openrouter-mock";
import { POST } from "./analyze";

// Route-level integration for the LLM boundary (test-plan §6.3, Risk #2). A malformed
// upstream response must surface as a 500 with the GENERIC body — never the upstream text,
// never a 200 partial. Auth + payload branches are covered too.
//
// `/api/analyze` touches no Supabase in this phase (session-binding lands in Phase 4), so
// there is no DB stub here — the "no partial write" guarantee is that the route returns 500
// and not a 200 result.

let openrouter: OpenRouterMock;
const user = { id: "user-1" } as User;

beforeEach(() => {
  openrouter = installOpenRouterMock();
});

afterEach(() => {
  openrouter.restore();
});

describe("POST /api/analyze", () => {
  it("401 when unauthenticated (no OpenRouter call)", async () => {
    const res = await POST(makeApiContext({ body: { video: "dGVzdA==" } }));

    expect(res.status).toBe(401);
  });

  it("400 when the payload is missing `video`", async () => {
    const res = await POST(makeApiContext({ user, body: {} }));

    expect(res.status).toBe(400);
  });

  it("200 with the parsed timestamps on a well-formed upstream response", async () => {
    openrouter.replyWith(200, { timestamps: [{ t: 1.25, f: 40, type: "BDC" }] });

    const res = await POST(makeApiContext({ user, body: { video: "dGVzdA==" } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timestamps: [{ t: 1.25, f: 40, type: "BDC" }] });
    openrouter.assertCalledOnce();
  });

  it("500 with a generic body — not the upstream text — on an upstream error", async () => {
    openrouter.replyRaw(500, '{"error":{"message":"secret upstream reason"}}');

    const res = await POST(makeApiContext({ user, body: { video: "dGVzdA==" } }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Video analysis failed. Please try again." });
  });

  it("500 with the generic body on a malformed (drifted-shape) upstream response", async () => {
    openrouter.replyWith(200, { timestamps: [{ t: 1, type: "MIDDLE" }] });

    const res = await POST(makeApiContext({ user, body: { video: "dGVzdA==" } }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Video analysis failed. Please try again." });
  });
});
