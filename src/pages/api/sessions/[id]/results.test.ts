import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { POST } from "./results";

// Risk #7 hardening (test-plan §6.2 addendum): a genuine pre-check query failure is a
// distinct 500, never folded into "row absent" — and, critically, the admin write never
// runs when the pre-check itself failed. First test coverage for this route; ownership
// assertions (§3 Phase 4) and staleness-related lifecycle tests (§3 Phase 5) extend this
// file.

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
  return stub;
}

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
