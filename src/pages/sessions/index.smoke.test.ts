import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { makeApiContext } from "@/test/helpers/api-context";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { renderPage } from "@/test/helpers/render-page";
import SessionsIndex from "./index.astro";

// Harness smoke for the `pages` Vitest project: proves a `.astro` import compiles under
// `getViteConfig`, the Container API renders it, and the Supabase client stub drives the
// two render branches (empty state / populated list). Hardening assertions land in Phase 3.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const user = { id: "user-1" } as User;

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]) {
  mockedCreateClient.mockReturnValue(makeSupabaseStub(script) as unknown as SupabaseClient);
}

describe("sessions/index.astro — harness smoke", () => {
  it("renders the empty state when the list query returns no rows", async () => {
    stubReturns({ "fitting_sessions.select": { data: [] } });

    const res = await renderPage(SessionsIndex, {
      request: makeApiContext({ user, url: "http://test.local/sessions" }).request,
      locals: { user },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("haven't submitted any bike-fitting sessions yet");
  });

  it("renders the list when the query returns rows", async () => {
    stubReturns({
      "fitting_sessions.select": {
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            video_filename: "morning-ride.mp4",
            status: "completed",
            created_at: "2026-09-01T08:00:00Z",
          },
        ],
      },
    });

    const res = await renderPage(SessionsIndex, {
      request: makeApiContext({ user, url: "http://test.local/sessions" }).request,
      locals: { user },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("morning-ride.mp4");
    expect(html).toContain("Completed");
  });

  // Risk #7 regression lock (test-plan §6.2 addendum): this branch is already correct
  // (archived S-04 fix) — pin it so a future refactor can't regress it back to a blank
  // list or a silently-empty state.
  it("renders the 'couldn't load your sessions' state — not an empty list — on a query error", async () => {
    stubReturns({ "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } } });

    const res = await renderPage(SessionsIndex, {
      request: makeApiContext({ user, url: "http://test.local/sessions" }).request,
      locals: { user },
    });

    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("Couldn't load your sessions");
    expect(html).not.toContain("haven't submitted any bike-fitting sessions yet");
  });

  // Risk #6 (test-plan §3 Phase 5): a session stuck `processing` past the staleness
  // threshold shows a "Failed" pill here instead of a permanent blue "Processing" one.
  it("renders a 'Failed' pill for a stale processing session", async () => {
    stubReturns({
      "fitting_sessions.select": {
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            video_filename: "stuck-ride.mp4",
            status: "processing",
            created_at: "2026-09-01T08:00:00Z",
            updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
          },
        ],
      },
    });

    const res = await renderPage(SessionsIndex, {
      request: makeApiContext({ user, url: "http://test.local/sessions" }).request,
      locals: { user },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Failed");
  });
});
