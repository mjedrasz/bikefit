import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { DELETE, GET } from "./[id]";

// Risk #7 hardening (test-plan §6.2 addendum): a genuine pre-check query failure is a
// distinct 500, never folded into "row absent". Complements the harness smoke in
// `[id].smoke.test.ts` (401 / 404-no-row / 200), which pre-dates this fix.
//
// Risk #5 ownership (test-plan §6.4, §3 Phase 4): `DELETE` already shipped the hardened
// pattern (pre-check + `.eq("user_id")` admin delete + `sessions_delete_own` policy) in
// `2026-09-02-delete-session` — these are the first regression tests locking it in, mirroring
// how `sessions/index.astro` got regression-only coverage in §3 Phase 3. Stub-level ordering
// only; the real cross-user RLS check is §3 Phase 4's Playwright deferral (see §6.4).

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

describe("GET /api/sessions/[id] — error-vs-absent (Risk #7)", () => {
  it("500 — not 404 — when the pre-check query errors", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await GET(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(500);
    expect(stub.calls).toEqual([
      expect.objectContaining({ table: "fitting_sessions", operation: "select", terminal: "maybeSingle" }),
    ]);
  });
});

describe("DELETE /api/sessions/[id] — ownership (Risk #5)", () => {
  it("401 when unauthenticated, no Supabase call at all", async () => {
    const res = await DELETE(makeApiContext({ params: { id: "s1" } }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("500 — not 404 — when the pre-check query errors, and no admin delete follows", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await DELETE(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(500);
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("404 when the pre-check finds no row, and no admin delete follows", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: null, error: null } });

    const res = await DELETE(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(404);
    expect(stub.calls.map((c) => c.operation)).toEqual(["select"]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("200 and the admin delete carries the user_id guard, after the pre-check", async () => {
    const stub = stubReturns({
      "fitting_sessions.select": { data: { id: "s1" } },
      "fitting_sessions.delete": { data: [{ id: "s1" }] },
    });

    const res = await DELETE(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(200);
    const operations = stub.calls.map((c) => c.operation);
    expect(operations.indexOf("select")).toBeLessThan(operations.indexOf("delete"));
    const deleteCall = stub.calls[operations.indexOf("delete")];
    expect(deleteCall.filters).toContainEqual({ column: "user_id", value: user.id });
  });
});
