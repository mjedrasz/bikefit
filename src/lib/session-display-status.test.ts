import { describe, expect, it } from "vitest";
import { effectiveSessionStatus, STALE_PROCESSING_MESSAGE, STALE_PROCESSING_MS } from "./session-display-status";

// Risk #6 (test-plan §3 Phase 5): the display-time staleness state map. Pure and I/O-free —
// no `astro:*` import, so this sits inside Stryker's `mutate` scope alongside §6.1's other
// pure-unit modules.

const NOW = Date.parse("2026-09-04T12:00:00Z");

function minutesAgo(mins: number): string {
  return new Date(NOW - mins * 60_000).toISOString();
}

describe("effectiveSessionStatus", () => {
  it("returns 'processing' unchanged when fresh (age below threshold)", () => {
    expect(effectiveSessionStatus("processing", minutesAgo(5), NOW)).toBe("processing");
  });

  it("returns 'failed' for a stale 'processing' session (age past threshold)", () => {
    expect(effectiveSessionStatus("processing", minutesAgo(20), NOW)).toBe("failed");
  });

  it("returns 'queued' unchanged when fresh", () => {
    expect(effectiveSessionStatus("queued", minutesAgo(1), NOW)).toBe("queued");
  });

  it("returns 'failed' for a stuck 'queued' session past threshold (queued -> processing UPDATE may have silently failed)", () => {
    expect(effectiveSessionStatus("queued", minutesAgo(20), NOW)).toBe("failed");
  });

  it("does not flip exactly at the threshold boundary (not strictly past it)", () => {
    const atThreshold = new Date(NOW - STALE_PROCESSING_MS).toISOString();
    expect(effectiveSessionStatus("processing", atThreshold, NOW)).toBe("processing");
  });

  it("flips one ms past the threshold boundary", () => {
    const pastThreshold = new Date(NOW - STALE_PROCESSING_MS - 1).toISOString();
    expect(effectiveSessionStatus("processing", pastThreshold, NOW)).toBe("failed");
  });

  it("returns 'completed' unchanged regardless of age", () => {
    expect(effectiveSessionStatus("completed", minutesAgo(9999), NOW)).toBe("completed");
  });

  it("returns 'failed' unchanged regardless of age", () => {
    expect(effectiveSessionStatus("failed", minutesAgo(9999), NOW)).toBe("failed");
  });

  it("returns the stored status unchanged (no throw) for a malformed updated_at", () => {
    expect(() => effectiveSessionStatus("processing", "not-a-date", NOW)).not.toThrow();
    expect(effectiveSessionStatus("processing", "not-a-date", NOW)).toBe("processing");
  });
});

describe("STALE_PROCESSING_MESSAGE", () => {
  it("reads as a timed-out message", () => {
    expect(STALE_PROCESSING_MESSAGE).toContain("timed out");
  });
});
