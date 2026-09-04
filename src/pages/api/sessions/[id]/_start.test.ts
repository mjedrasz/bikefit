import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { POST } from "./start";

// Risk #7 hardening (test-plan §6.2 addendum): a genuine pre-check query failure is a
// distinct 500, never folded into "row absent" — and, critically, the admin `UPDATE`
// never runs when the pre-check itself failed. First test coverage for this route.
//
// Risk #5 ownership (test-plan §6.4, §3 Phase 4): the pre-check runs before the admin
// write, a no-row pre-check yields 404 with no write, and the admin write carries the
// `.eq("user_id")` guard. This is stub-level ordering, not a real cross-user RLS check
// (that is §3 Phase 4's Playwright deferral — see §6.4).
//
// Risk #6 (test-plan §3 Phase 5): the status `UPDATE` is now checked — a silently-failed
// `queued -> processing` write is how a session sticks in `queued` forever (research §4c
// item 4), so a failed write is a 500.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/supabase-admin", () => ({ createAdminClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const user = { id: "user-1" } as User;

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

describe("POST /api/sessions/[id]/start — error-vs-absent (Risk #7)", () => {
  it("500 — not 404 — when the pre-check query errors, and no admin write follows", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await POST(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(500);
    expect(stub.calls).toEqual([
      expect.objectContaining({ table: "fitting_sessions", operation: "select", terminal: "maybeSingle" }),
    ]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions/[id]/start — ownership (Risk #5)", () => {
  it("401 when unauthenticated, no Supabase call at all", async () => {
    const res = await POST(makeApiContext({ params: { id: "s1" } }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("404 when the pre-check finds no row, and no admin write follows", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: null, error: null } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(404);
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
  });

  it("200 and the admin update carries the user_id guard, after the pre-check", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: { id: "s1", status: "queued" } } });

    const res = await POST(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(200);
    const operations = stub.calls.map((c) => c.operation);
    expect(operations.indexOf("select")).toBeLessThan(operations.indexOf("update"));
    const updateCall = stub.calls[operations.indexOf("update")];
    expect(updateCall.filters).toContainEqual({ column: "user_id", value: user.id });
  });
});

describe("POST /api/sessions/[id]/start — status UPDATE failure is checked (Risk #6)", () => {
  it("500 when the admin update fails", async () => {
    stubReturns({
      "fitting_sessions.select": { data: { id: "s1", status: "queued" } },
      "fitting_sessions.update": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await POST(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(500);
  });
});
