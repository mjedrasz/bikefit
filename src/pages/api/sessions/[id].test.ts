import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { GET } from "./[id]";

// Risk #7 hardening (test-plan §6.2 addendum): a genuine pre-check query failure is a
// distinct 500, never folded into "row absent". Complements the harness smoke in
// `[id].smoke.test.ts` (401 / 404-no-row / 200), which pre-dates this fix.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const user = { id: "user-1" } as User;

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]) {
  const stub = makeSupabaseStub(script);
  mockedCreateClient.mockReturnValue(stub as unknown as SupabaseClient);
  return stub;
}

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
