import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { POST } from "./results";

// Risk #7 hardening (test-plan §6.2 addendum): a genuine pre-check query failure is a
// distinct 500, never folded into "row absent" — and, critically, the admin write never
// runs when the pre-check itself failed. First test coverage for this route; staleness-
// related lifecycle tests (§3 Phase 5) extend this file further.
//
// Risk #5 ownership (test-plan §6.4, §3 Phase 4): the pre-check runs before the admin
// write, a no-row pre-check yields 404 with no write, and both admin writes (`completed`
// and `failed`) carry the `.eq("user_id")` guard. Stub-level ordering only — the real
// cross-user RLS check is §3 Phase 4's Playwright deferral (see §6.4).
//
// Risk #6 (test-plan §3 Phase 5): the status `UPDATE`s are now checked. A failed
// `completed`-status write is a 500 (documented orphan-row edge — see Critical
// Implementation Details); a failed `failed`-status write still reports success
// (best-effort, backstopped by the staleness rule).

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/supabase-admin", () => ({ createAdminClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const user = { id: "user-1" } as User;
const validBody = {
  recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee angle below reference band" }],
  body_angles: [{ name: "Knee extension", value: 145, reference_min: 140, reference_max: 150, unit: "°" }],
};

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]) {
  const stub = makeSupabaseStub(script);
  mockedCreateClient.mockReturnValue(stub as unknown as SupabaseClient);
  mockedCreateAdminClient.mockReturnValue(stub as unknown as SupabaseClient);
  return stub;
}

// Reset call history (not implementations) between tests — several tests below assert
// "no Supabase call at all" / "no admin write" and must not see a prior test's calls.
beforeEach(() => {
  mockedCreateClient.mockClear();
  mockedCreateAdminClient.mockClear();
});

describe("POST /api/sessions/[id]/results — error-vs-absent (Risk #7)", () => {
  it("500 — not 404 — when the pre-check query errors, and no admin write follows", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(500);
    expect(stub.calls).toEqual([
      expect.objectContaining({ table: "fitting_sessions", operation: "select", terminal: "maybeSingle" }),
    ]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions/[id]/results — ownership (Risk #5)", () => {
  it("401 when unauthenticated, no Supabase call at all", async () => {
    const res = await POST(makeApiContext({ params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("404 when the pre-check finds no row, and no admin write follows", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: null, error: null } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(404);
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
  });

  it("200 and the completed-status admin update carries the user_id guard, after the pre-check", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: { id: "s1", status: "processing" } } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(200);
    const operations = stub.calls.map((c) => c.operation);
    expect(operations).toEqual(["select", "insert", "update"]);
    const updateCall = stub.calls[operations.indexOf("update")];
    expect(updateCall.filters).toContainEqual({ column: "user_id", value: user.id });
  });

  it("200 and the failed-status admin update also carries the user_id guard", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: { id: "s1", status: "processing" } } });
    const errorBody = { error: true, error_message: "Analysis failed" };

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: errorBody }));

    expect(res.status).toBe(200);
    const operations = stub.calls.map((c) => c.operation);
    expect(operations).toEqual(["select", "update"]);
    const updateCall = stub.calls[operations.indexOf("update")];
    expect(updateCall.filters).toContainEqual({ column: "user_id", value: user.id });
  });
});

describe("POST /api/sessions/[id]/results — status UPDATE failures are checked (Risk #6)", () => {
  it("500 when the completed-status admin update fails, after the insert already succeeded", async () => {
    stubReturns({
      "fitting_sessions.select": { data: { id: "s1", status: "processing" } },
      "fitting_sessions.update": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: validBody }));

    expect(res.status).toBe(500);
  });

  it("still returns 200 (best-effort) when the failed-status admin update fails", async () => {
    stubReturns({
      "fitting_sessions.select": { data: { id: "s1", status: "processing" } },
      "fitting_sessions.update": { data: null, error: { message: "boom", code: "XX000" } },
    });
    const errorBody = { error: true, error_message: "Analysis failed" };

    const res = await POST(makeApiContext({ user, params: { id: "s1" }, body: errorBody }));

    expect(res.status).toBe(200);
  });
});
