import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { makeSupabaseStub } from "@/test/helpers/supabase-stub";
import { renderPage } from "@/test/helpers/render-page";
import { STALE_PROCESSING_MESSAGE } from "@/lib/session-display-status";
import SessionDetail from "./[id].astro";

// Risk #7 hardening (test-plan §6.2 addendum): a genuine query failure is a distinct
// state — never a 404 for the session lookup, never the blank card (no status branch
// matches) for a `completed` session whose results query fails or comes back empty.
//
// Risk #6 (test-plan §3 Phase 5): a `processing` session with no progress past
// `STALE_PROCESSING_MS` renders the terminal "timed out" state instead of "check back
// soon" — display-time only, no DB write.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const mockedCreateClient = vi.mocked(createClient);
const user = { id: "user-1" } as User;
const completedSession = {
  id: "s1",
  status: "completed",
  error_message: null,
  video_filename: "clip.mp4",
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-01T08:05:00Z",
};

function stubReturns(script: Parameters<typeof makeSupabaseStub>[0]) {
  mockedCreateClient.mockReturnValue(makeSupabaseStub(script) as unknown as SupabaseClient);
}

describe("sessions/[id].astro — error-vs-absent (Risk #7)", () => {
  it("500 — not 404 — when the session query errors", async () => {
    stubReturns({
      "fitting_sessions.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await renderPage(SessionDetail, { params: { id: "s1" }, locals: { user } });

    expect(res.status).toBe(500);
  });

  it("renders the 'couldn't load your results' state — not a blank card — when the results query errors", async () => {
    stubReturns({
      "fitting_sessions.select": { data: completedSession },
      "analysis_results.select": { data: null, error: { message: "boom", code: "XX000" } },
    });

    const res = await renderPage(SessionDetail, { params: { id: "s1" }, locals: { user } });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("We couldn't load your results");
    expect(html).not.toContain("Your fitting results");
  });

  it("renders the same 'couldn't load your results' state when a completed session's results row is genuinely absent", async () => {
    stubReturns({
      "fitting_sessions.select": { data: completedSession },
      "analysis_results.select": { data: null, error: null },
    });

    const res = await renderPage(SessionDetail, { params: { id: "s1" }, locals: { user } });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("We couldn't load your results");
    expect(html).not.toContain("Your fitting results");
  });
});

describe("sessions/[id].astro — stuck-processing terminal state (Risk #6)", () => {
  it("renders the timed-out failure for a stale processing session", async () => {
    stubReturns({
      "fitting_sessions.select": {
        data: {
          id: "s1",
          status: "processing",
          error_message: null,
          video_filename: "clip.mp4",
          created_at: "2026-09-01T08:00:00Z",
          updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        },
      },
    });

    const res = await renderPage(SessionDetail, { params: { id: "s1" }, locals: { user } });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(STALE_PROCESSING_MESSAGE);
    expect(html).not.toContain("check back soon");
  });

  it("still shows 'check back soon' for a fresh processing session", async () => {
    stubReturns({
      "fitting_sessions.select": {
        data: {
          id: "s1",
          status: "processing",
          error_message: null,
          video_filename: "clip.mp4",
          created_at: "2026-09-01T08:00:00Z",
          updated_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        },
      },
    });

    const res = await renderPage(SessionDetail, { params: { id: "s1" }, locals: { user } });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("check back soon");
    expect(html).not.toContain(STALE_PROCESSING_MESSAGE);
  });
});
