import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { GET } from "./[id]";

// Harness smoke for the `unit` Vitest project on the simplest route: proves a route module
// imports without throwing (the `astro:env/server` alias-stub works), `makeApiContext` +
// the Supabase stub drive the auth / not-found / found branches, and `stub.calls` records
// the query. Error-branch hardening lives in `[id].test.ts` (§3 Phase 3); ownership
// hardening lands in Phase 4.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const user = { id: "user-1" } as User;

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]) {
  const stub = makeSupabaseStub(script);
  mockedCreateClient.mockReturnValue(stub as unknown as SupabaseClient);
  return stub;
}

describe("GET /api/sessions/[id] — harness smoke", () => {
  it("401 when unauthenticated", async () => {
    const res = await GET(makeApiContext({ params: { id: "s1" } }));

    expect(res.status).toBe(401);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("404 when the query resolves to no row and no error", async () => {
    const stub = stubReturns({ "fitting_sessions.select": { data: null, error: null } });

    const res = await GET(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(404);
    expect(stub.calls).toEqual([
      expect.objectContaining({ table: "fitting_sessions", operation: "select", terminal: "maybeSingle" }),
    ]);
  });

  it("200 with the projected fields when the row exists", async () => {
    stubReturns({
      "fitting_sessions.select": {
        data: { status: "completed", updated_at: "2026-09-03T00:00:00Z", error_message: null },
      },
    });

    const res = await GET(makeApiContext({ user, params: { id: "s1" } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "completed",
      updated_at: "2026-09-03T00:00:00Z",
      error_message: null,
    });
  });
});
