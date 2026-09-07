# Video Clip Limits Revision — Plan Brief

> Full plan: `context/changes/video-clip-limits-revision/plan.md`

## What & Why

Tighten BikeFit's MVP video-clip limits from **2–15 s / ≤100 MB** to **2–5 s / ≤3 MiB**, retighten the two now-stale server-side `/api/analyze` payload caps to match, and cut the per-user rate limit on the OpenRouter-backed routes from **10 → 3 requests / 10-min window**. The old ceilings were S-01 placeholders (100 MB "natural Cloudflare limit", 15 s guess); the server caps were sized "to match the client cap" and never reasoned about; 10/window was a first-pass number. For MVP a 2–5 s clip is all the pipeline needs — one BDC + one TDC keyframe — and the tighter size + volume limits shrink an authenticated abuser's per-window vision-model spend by ~10×. The plan also adds an explicit **Security Model** section spelling out which control stops what (access / volume / per-request size / provider blast-radius).

## Starting Point

`src/components/VideoUpload.tsx` validates the file at selection time: `MAX_SIZE = 100 MB`, `MIN_DURATION = 2` (already 2), `MAX_DURATION = 15`. The clip is never stored server-side but is base64-encoded and POSTed to `/api/analyze`, which has two payload caps (`schemas.ts` char cap `140_000_000`, `analyze.ts` raw-body cap `140_100_000`) — both sized reactively to "match the old 100 MB client cap". Both `/api/analyze` and `/api/sessions/[id]/recommend` are rate-limited by a shared app-side constant `RATE_LIMIT_MAX_REQUESTS = 10` (per-route counter, 10-min wall-clock buckets via a Postgres RPC).

## Desired End State

Picking an MP4 in `/dashboard` succeeds only for a `video/mp4` file ≤ 3,145,728 bytes and 2–5 s long; anything else gets a clear inline rejection with no session created. A direct `POST /api/analyze` above ~3 MiB base64 is rejected (413/400) before reaching the vision LLM. The 4th analyze-or-recommend call from one account inside a 10-min window returns 429; a normal one-fitting flow is never throttled. `README.md` (clip limits + rate-limit figure) and `test-plan.md` §6 (cap figure) state the new numbers.

## Key Decisions Made

| Decision                        | Choice                                                                          | Why (1 sentence)                                                                                                                                                                      | Source      |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Enforcement scope               | Client gates **+** the two `/api/analyze` payload caps **+** rate-limit ceiling | The server caps are documented-stale and ~30× looser than the new reality; the rate limit is the volume guard the size cap can't be — both cheap, both close real authed-abuser gaps. | Plan / user |
| Rate limit                      | `RATE_LIMIT_MAX_REQUESTS` 10 → 3, window unchanged (10 min)                     | User-requested; one shared app-side constant, no migration; a legit one-fitting flow (~1 analyze + ~1 recommend) fits inside 3 of each.                                               | User        |
| Rate limit — per-route split    | Not done; the one constant governs both `analyze` and `recommend`               | Splitting is more surface than the ask; 3-of-each still comfortably clears normal use.                                                                                                | Plan        |
| Server `video_duration_s` bound | Not added                                                                       | The duration on `POST /api/sessions` is a client-reported number, not file-derived, so a Zod bound is weak defense for the churn.                                                     | Plan        |
| 3 MB byte value                 | 3 MiB binary = `3_145_728`                                                      | Matches the existing `MAX_SIZE = 100 * 1024 * 1024` convention in the same file.                                                                                                      | Plan        |
| New `/api/analyze` caps         | `video.max(4_500_000)` chars, `MAX_ANALYZE_BODY_BYTES = 4_600_000`              | Base64 of 3 MiB = 4,194,304 chars; ~7 % headroom on the schema gate, ~100 K envelope headroom on the raw-body gate (mirrors the old delta).                                           | Plan        |
| Duration bound edges            | Inclusive both ends (2.0 s and 5.0 s pass)                                      | Matches the existing `< MIN` / `> MAX` comparison style and the plain reading of "2 to 5 seconds".                                                                                    | Plan        |
| `MIN_DURATION`                  | Unchanged at 2                                                                  | Already 2 in code; the request is "2 to 5".                                                                                                                                           | Plan        |
| Docs                            | `README.md` + `test-plan.md` §6 number fix; **not** `context/domain/*`          | README is user-facing; §6 quotes the cap figure; the domain docs are dated DDD snapshots, not living specs.                                                                           | Plan        |
| `VideoUpload` unit test         | Not added                                                                       | No React-component test infra in the repo; S-01 verified these gates manually and this stays consistent.                                                                              | Plan        |

## Scope

**In scope:**

- `src/components/VideoUpload.tsx` — `MAX_SIZE`, `MAX_DURATION`, size error, max-duration error, helper text (also fixes the already-stale "3 and 15 seconds" text).
- `src/lib/schemas.ts` — `analyzeRequestSchema.video.max()`.
- `src/pages/api/analyze.ts` — `MAX_ANALYZE_BODY_BYTES` + two inline comments.
- `src/lib/services/rate-limit.ts` — `RATE_LIMIT_MAX_REQUESTS` 10 → 3.
- Test fixtures: `src/lib/services/rate-limit.test.ts` (boundary + constant assertion), `_analyze.test.ts` + `_recommend.test.ts` (429 fixture `data: 11` → `4`).
- `README.md` (3 lines), `context/foundation/test-plan.md` §6 (2 figure references).

**Out of scope:**

- `createSessionSchema` / `POST /api/sessions` duration bound.
- Rate-limit window change, RPC/migration change, per-route split.
- Global / IP / signup-friction limits (cross-account volume abuse — documented residual).
- `context/domain/*.md` snapshots.
- e2e fixture / spec (committed fixture is 2.807 s / 502 KB — already passes).
- `Landing.astro` (no hard numbers in its copy).
- New unit/component tests.

## Architecture / Approach

Three ordered, independently-revertable phases. Phase 1 is the user-visible change: three constant/string edits in one client file. Phase 2 derives the new server cap figures from 3 MiB and updates the schema + route constant + comments + clip-limit docs. Phase 3 flips one shared rate-limit constant (10 → 3) and realigns the test fixtures pinned to the old value. No migration, no control-flow changes, no new files.

## Phases at a Glance

| Phase                                | What it delivers                                                                 | Key risk                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Client-side upload gates          | `VideoUpload.tsx` enforces 2–5 s / ≤3 MiB with accurate copy                     | Manual-only verification (no component test harness); must exercise all four boundary paths by hand                        |
| 2. Server `/api/analyze` caps + docs | Payload caps derived from 3 MiB; README + test-plan §6 refreshed                 | A too-tight `video.max()` could reject a legitimate ~3 MiB clip's base64 — mitigated by the 4,194,304 → 4,500,000 headroom |
| 3. Rate-limit ceiling 10 → 3         | Per-user OpenRouter-route budget cut to 3/10-min; README + test fixtures updated | Also applies to `recommend`; a power user running >3 fittings in 10 min hits 429 — accepted, matches the ask               |

**Prerequisites:** none — S-01 (upload flow) and S-02 (pipeline) are both shipped.
**Estimated effort:** ~1 session, 3 phases. Small diff (~4 source files + 3 test files + 2 docs).

## Open Risks & Assumptions

- Assumes the vision LLM produces usable BDC/TDC keyframes from as little as 2 s of footage. Non-blocking: the floor was already 2 s in production; if angle accuracy proves weak on very short clips, raise `MIN_DURATION` in a follow-up.
- Assumes no automated test allocates a `video` string between 4.5 M and 140 M chars expecting success — verified by inspection (`_analyze.test.ts` uses an 8-char string; the 413 test spoofs `Content-Length`).
- The rate-limit reduction also throttles `/api/sessions/[id]/recommend` (shared constant). Accepted: a legitimate flow is ~1 call to each per fitting.
- Cross-account volume abuse (many signups) is unaddressed — explicit residual in the Security Model, inherited from `2026-09-04-testing-abuse-resource-protection`.
- `test-plan.md` §6 is nominally owned by `/10x-test-plan`; this change makes a factual number fix only, no restructuring.

## Success Criteria (Summary)

- A 4 s / 2 MB clip uploads and analyses; a 6 s clip and a 4 MB clip are each rejected inline with the correct message; a 1 s clip is rejected.
- A direct `POST /api/analyze` above ~3 MiB is rejected before reaching the vision LLM.
- The 4th analyze-or-recommend call from one account in a 10-min window returns 429; a normal fitting is never throttled.
- `npx tsc --noEmit`, `npx eslint`, and `npm run test` all pass; no stale `100 MB` / `140_000_000` / `10`-ceiling figures remain in `src/`, `README.md`, or `test-plan.md`.
