# Video Clip Limits Revision Implementation Plan

## Overview

Tighten BikeFit's MVP video-clip limits from **2–15 s / ≤100 MB** to **2–5 s / ≤3 MiB (3,145,728 bytes)**. The client-side gates in `VideoUpload.tsx` are the primary change. As a paired backstop, the two server-side `/api/analyze` payload caps — both currently sized only "to match the old 100 MB client cap" and never independently reasoned — are brought down to a value derived from the new 3 MiB ceiling, shrinking the direct-caller abuse surface ~30×. The per-user rate limit on the OpenRouter-backed routes is tightened from **10 → 3 requests per 10-minute window**, so an authenticated abuser's worst-case per-window vision spend drops from 10 to 3 capped clips. Two living docs (`README.md`, `test-plan.md` §6) are refreshed to match.

This change also adds an explicit **Security Model** section (below) making the layered threat model legible: which control stops what.

This is roadmap slice **S-08** (`video-clip-limits-revision`).

## Current State Analysis

The clip never reaches server storage, but the raw MP4 **is** base64-encoded client-side and sent to the vision LLM: `VideoAnalyzer.tsx` → `POST /api/analyze` → `llm.ts` (`video_url` data URI). So clip size directly drives vision-call payload size, latency, and provider cost — which is what makes the 3 MiB cap worth enforcing on both sides.

### Key Discoveries:

- **`src/components/VideoUpload.tsx:24-26`** — client gates: `MAX_SIZE = 104_857_600`, `MIN_DURATION = 2`, `MAX_DURATION = 15`. The floor is **already 2** — only the size and the ceiling change. Comparisons are `duration < MIN_DURATION` / `duration > MAX_DURATION` and `file.size > MAX_SIZE` — i.e. inclusive bounds, which we keep.
- **`src/components/VideoUpload.tsx`** user-facing strings: size error `"File must be 100 MB or smaller"` (line 60), max-duration error `"Video must be 15 seconds or shorter"` (line 78), helper text `"Select an MP4 file between 3 and 15 seconds. Maximum size 100 MB."` (line 155). The helper text is **already stale** — it says "3" while the code allows 2.
- **`src/lib/schemas.ts:22`** — `analyzeRequestSchema.video: z.string().min(1).max(140_000_000)`. Char cap on the base64 string. Per `context/archive/2026-09-04-testing-abuse-resource-protection/`, this was added reactively (impl-review finding F5) sized only to match the 100 MB client cap.
- **`src/pages/api/analyze.ts:14`** — `MAX_ANALYZE_BODY_BYTES = 140_100_000`, a pre-parse streaming/Content-Length cap on the raw HTTP body, deliberately ~100 K above the schema char cap for JSON-envelope overhead. Two explanatory comments (lines 12-14, 33-34) name the `140_000_000` figure.
- **`src/pages/api/sessions/index.ts`** + **`createSessionSchema`** (`schemas.ts:3-6`) — `video_duration_s: z.number().positive()`, no upper bound. **Left unchanged** (out of scope — see below).
- **`src/lib/services/rate-limit.ts:9-10`** — `RATE_LIMIT_MAX_REQUESTS = 10`, `RATE_LIMIT_WINDOW_MINUTES = 10`. App-side count comparison (`data <= RATE_LIMIT_MAX_REQUESTS` at line 37); the `check_and_increment_rate_limit` RPC (`supabase/migrations/20260905150000_add_rate_limits.sql`) just returns the incremented count — **no SQL change needed to move the ceiling**. The same constant gates both `analyze` and `recommend` (per-route counter, shared limit).
- **`readJsonWithCap`** (`src/lib/capped-json-body.ts:22-60`) — checks `Content-Length` for a fast 413, **then unconditionally streams and byte-counts the body**, aborting at `total > maxBytes` (lines 38-42). A spoofed-small `Content-Length` is caught by the streamed count, not bypassed. Worst-case buffering before abort ≈ one chunk over the cap.
- **Tests unaffected by the cap change:** no `VideoUpload` unit test exists. `src/pages/api/_analyze.test.ts:96` exercises the 413 path with a spoofed `content-length: "999999999"` (~1 GB) — still far above the new cap. `src/lib/capped-json-body.test.ts` calls `readJsonWithCap(req, <literal>)` with its own cap values, decoupled from `MAX_ANALYZE_BODY_BYTES`.
- **Tests that DO need updating for the rate-limit change:** `src/lib/services/rate-limit.test.ts` — the "boundary (10th request)" case (`data: 10` → expects `allowed: true`) fails once the ceiling is 3, and `expect(RATE_LIMIT_MAX_REQUESTS).toBe(10)` asserts the old value. The route suites' "429 when exceeded" cases stub `data: 11` (still `> 3`, pass unchanged, but updated to `data: 4` for legibility).
- **Fixture unaffected:** `e2e/fixtures/bike-fit-sample.mp4` is 2.807 s / 502 KB — passes the new 2–5 s / ≤3 MiB gates.
- **Docs with the old numbers:** `README.md:119` ("2–15 s side-view MP4 (≤100 MB)"), `README.md:249` ("MP4 only, side-view, 2–15 s, ≤100 MB"), and `README.md:184` ("rate-limited per user per route (10 requests / 10 min)"). `context/foundation/test-plan.md` §6 "Capped-JSON-body-reader pattern" bullet quotes `.max(140_000_000)` and "~100MB base64 video body" (it does **not** hard-code the rate-limit count). `context/domain/*.md` also snapshot the old constants but are dated DDD discovery artifacts — **not touched**.

## Desired End State

- Picking an MP4 in `/dashboard`: a clip is accepted only when it is `video/mp4`, **≤ 3,145,728 bytes**, and **2 s ≤ duration ≤ 5 s**. Outside any bound → a clear inline rejection naming the failed bound; no session row created, no API call.
- The helper text and both error messages state the new limits accurately.
- A direct `POST /api/analyze` with a `video` string larger than ~3 MiB base64 is rejected (413 for an oversized raw body, 400 for an over-cap `video` field) instead of being forwarded to the vision LLM.
- The 4th `POST /api/analyze` (or `POST /api/sessions/[id]/recommend`) from one account inside a 10-minute window returns 429; a legitimate one-fitting flow (≤3 of each) is never throttled.
- `README.md` (clip limits + rate-limit figure) and `test-plan.md` §6 (cap figure) state the new numbers.
- `npx tsc --noEmit`, `npx eslint`, and the full `vitest` suite pass.

### Verification:

- Manual: 4 s / 2 MB MP4 → accepted; 6 s MP4 → "Video must be 5 seconds or shorter"; 4 MB / 3 s MP4 → "File must be 3 MB or smaller"; 1 s MP4 → "Video must be at least 2 seconds"; 4 analyses in 10 min → 4th is 429.
- Automated: `rg -n "140_000_000|140_100_000|104_857_600|100 ?MB|2–15|2-15|RATE_LIMIT_MAX_REQUESTS = 10|10 requests / 10" src/ README.md context/foundation/test-plan.md` returns nothing.

## What We're NOT Doing

- **No `video_duration_s` bound on `createSessionSchema` / `POST /api/sessions`.** The duration there is a client-reported number, not derived from the file server-side, so a bound is weak defense for meaningful churn. (This was the "full enforcement" option, explicitly not chosen.)
- **No per-route split of `RATE_LIMIT_MAX_REQUESTS`.** The one shared constant drops 10 → 3 and governs both `analyze` and `recommend`; giving each route its own ceiling is more surface than the ask and a legit one-fitting flow fits inside 3 of each.
- **No rate-limit _window_ change** (stays 10 min) and **no RPC / migration change** — the ceiling is compared app-side.
- **No global / IP-based / signup-friction limits.** Cross-account volume abuse stays a documented residual (see Security Model); this slice only tightens the existing per-account knob.
- **No new `VideoUpload` unit test.** There is no React-component test infrastructure in the repo today; S-01 verified these gates manually and this change stays consistent with that. Adding component-test scaffolding is test-plan territory, not this slice.
- **No changes to `context/domain/*.md`.** Dated discovery snapshots, not living specs.
- **No fixture or e2e spec changes.** The committed fixture already passes the new gates.
- **No change to the `MIN_DURATION` floor** (stays 2) or to the inclusive-bound comparison style.
- **No change to `Landing.astro`** — its copy ("a few seconds of steady pedalling") carries no hard numbers.

## Implementation Approach

Three ordered phases, each independently revertable:

1. **Client gates** — three constant/string edits in one file. The user-visible change and the one that actually shrinks real uploads.
2. **Server `/api/analyze` payload caps + docs** — derive the new cap figures from 3 MiB, update the schema + route constant + their comments, then refresh the clip-limit docs. Grouped because the doc edits reference the new cap number.
3. **Rate-limit ceiling** — one shared constant `10 → 3`, plus the test fixtures pinned to the old value and the README figure. Separate because it touches a second route (`recommend`) and a different risk axis (volume, not per-request size).

### Definitions — the new cap figures

- **3 MiB** = `3 * 1024 * 1024` = **3,145,728 bytes** (binary, matching the existing `MAX_SIZE = 100 * 1024 * 1024` convention).
- **Base64 of 3,145,728 bytes** = `4 * ceil(3,145,728 / 3)` = `4 * 1,048,576` = **4,194,304 chars** (exact — the byte count is divisible by 3).
- **`analyzeRequestSchema.video.max`** → **`4_500_000`** chars (~7 % headroom over 4,194,304 for a direct caller; the client is the tight gate).
- **`MAX_ANALYZE_BODY_BYTES`** → **`4_600_000`** bytes (~100 K above the `video` char cap for JSON-envelope overhead — mirrors the existing `140_100_000` vs `140_000_000` delta).

---

## Security Model

The threat this change hardens against: **an authenticated user (their own account, or one of many from open self-service signup) drives cost or a content-flag on BikeFit's shared OpenRouter account** by pushing large or many videos through the vision LLM. `POST /api/analyze` is the only video→LLM path (`generateRecommendations` takes angles, not video); `POST /api/sessions/[id]/recommend` is the only other OpenRouter-backed route.

Defense is layered — each control has one job, and none is sufficient alone:

| Layer                 | Control                                                                                                                       | Stops                                                                                                                                                                                                                                   | Where                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Access                | `context.locals.user` check → 401                                                                                             | Anonymous callers — they never reach the body or the LLM                                                                                                                                                                                | `analyze.ts`, `sessions/[id]/recommend.ts` (existing)  |
| Access                | Session must be **owned** and in `processing` → 404 / 409                                                                     | Targeting another user's session; firing `/analyze` outside a real in-flight pipeline                                                                                                                                                   | `analyze.ts` (existing, project Risk #5)               |
| **Volume**            | Per-user, per-route rate limit — **3 requests / 10-min window** (this change; was 10)                                         | An authed abuser burning the vision/text budget through repeated calls. Worst case per window per account: `3 × ~3.4 MB` decoded video to the vision model                                                                              | `rate-limit.ts` → `check_and_increment_rate_limit` RPC |
| **Per-request size**  | Pre-parse raw-body cap `MAX_ANALYZE_BODY_BYTES = 4_600_000` → 413, enforced by `readJsonWithCap` **before** buffering/parsing | A single oversized POST. The reader checks `Content-Length` for a fast reject, then **streams and counts actual bytes regardless of that header** (`capped-json-body.ts:38-42`), so a spoofed-small `Content-Length` does not bypass it | `analyze.ts`                                           |
| **Per-request size**  | Post-parse schema cap `analyzeRequestSchema.video.max(4_500_000)` → 400                                                       | A `video` string over ~3 MiB base64 that slipped under the raw-body cap (small `session_id` envelope)                                                                                                                                   | `schemas.ts`                                           |
| Provider blast-radius | Fixed-string errors, upstream body to `console.error` only; provider 4xx/5xx → clean plain-language error                     | A provider error or flagged-content response leaking to the caller or hanging the UI                                                                                                                                                    | `llm.ts`, `analyze.ts` (existing)                      |

**What this does NOT do — accepted residual risk:**

- **The client-side 3 MiB / 2–5 s check (Phase 1) is UX, not a security control.** `VideoAnalyzer.tsx` POSTs the already-validated `File` and never re-checks; a direct `POST /api/analyze` skips `VideoUpload.tsx` entirely. Phases 2–3 are the enforcement.
- **Per-request Worker cost during an attack is bounded but non-zero** — `readJsonWithCap` reads up to ~4.6 MB into memory before aborting a chunked body. Bounded, rate-limited to 3/window, and Cloudflare's platform body limit is a final backstop.
- **The rate-limit window is a fixed wall-clock bucket, not sliding** (`date_trunc('hour') + floor(minute/10)·10min` in the RPC) — a user can send 3 requests at 10:09 and 3 more at 10:10. Existing behaviour, unchanged; acceptable for MVP.
- **Volume across many accounts is not addressed** — open self-service signup means an attacker can create accounts to multiply the per-account budget. Mitigating that (signup friction, global/IP limits, provider-side spend alerts) is out of scope for this slice and was noted as residual in `context/archive/2026-09-04-testing-abuse-resource-protection/`.

---

## Phase 1: Tighten client-side upload gates

### Overview

Change the three validation constants (two of them) and the three user-facing strings in `VideoUpload.tsx`. No state-machine, no control-flow changes.

### Changes Required:

#### 1. Upload validation constants + messages

**File**: `src/components/VideoUpload.tsx`

**Intent**: Enforce the revised MVP limits (2–5 s, ≤3 MiB) at file-selection time and state them accurately in the UI. `MIN_DURATION` stays `2`; only the size ceiling and the duration ceiling move.

**Contract**:

- `MAX_SIZE`: `104_857_600` → `3_145_728` (keep the `3 * 1024 * 1024` intent; a `_`-grouped literal matches the existing style).
- `MAX_DURATION`: `15` → `5`.
- `MIN_DURATION`: unchanged (`2`).
- Size-error string (line ~60): `"File must be 100 MB or smaller"` → `"File must be 3 MB or smaller"`.
- Max-duration-error string (line ~78): `"Video must be 15 seconds or shorter"` → `"Video must be 5 seconds or shorter"`.
- Min-duration-error string (line ~74): unchanged (`"Video must be at least 2 seconds"`).
- Helper text (line ~155): `"Select an MP4 file between 3 and 15 seconds. Maximum size 100 MB."` → `"Select an MP4 file 2–5 seconds long. Maximum size 3 MB."` (uses an en dash, matching the README's `2–5 s` style).
- Bound comparisons (`file.size > MAX_SIZE`, `duration < MIN_DURATION`, `duration > MAX_DURATION`) are left exactly as-is — bounds stay inclusive.

### Success Criteria:

#### Automated Verification:

- Type checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/components/VideoUpload.tsx`
- Prettier clean: `npx prettier --check src/components/VideoUpload.tsx`
- Full unit suite still green: `npm run test` (nothing references these constants, but confirm)
- No stale client numbers: `rg -n "104_857_600|100 MB|15 seconds|between 3 and 15" src/components/VideoUpload.tsx` returns nothing

#### Manual Verification:

- A ~4 s, ~2 MB MP4 → validation passes, session created, analysis starts
- A ~6 s MP4 (any size) → inline error "Video must be 5 seconds or shorter", no session created
- A ~4 MB MP4 (2–5 s) → inline error "File must be 3 MB or smaller", no API call (check DevTools Network)
- A ~1 s MP4 → inline error "Video must be at least 2 seconds"
- A clip right at the edges (≈2.0 s and ≈5.0 s, ≤3 MB) → accepted
- The dashboard helper text reads "Select an MP4 file 2–5 seconds long. Maximum size 3 MB."

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Retighten server `/api/analyze` payload caps + refresh docs

### Overview

Bring the two `/api/analyze` size caps down from ~140 M (100 MB-derived) to ~4.5 M (3 MiB-derived), update their inline comments, and refresh the two docs that quote the old figures.

### Changes Required:

#### 1. Schema char cap on the vision payload

**File**: `src/lib/schemas.ts`

**Intent**: Reject an over-cap `video` field after parsing, as the second of the two `/api/analyze` gates. Retarget the number to the new 3 MiB ceiling.

**Contract**: `analyzeRequestSchema.video` — `z.string().min(1).max(140_000_000)` → `z.string().min(1).max(4_500_000)`. No other field changes.

#### 2. Pre-parse raw-body cap on `/api/analyze`

**File**: `src/pages/api/analyze.ts`

**Intent**: Reject an oversized raw HTTP body before it is buffered, sized just above the new schema char cap. Keep the two explanatory comments truthful.

**Contract**:

- `MAX_ANALYZE_BODY_BYTES`: `140_100_000` → `4_600_000`.
- Comment at lines ~12-14: replace the `140,000,000`-char reference with `4,500,000` and note it corresponds to "≈3 MiB video, base64-encoded (4,194,304 chars)".
- Comment at lines ~33-34: replace `.max(140_000_000)` with `.max(4_500_000)`.
- No control-flow change — both gates and their ordering stay as they are.

#### 3. README limits

**File**: `README.md`

**Intent**: State the current MVP clip limits.

**Contract**: Line ~119 (`Getting Started`): `2–15 s side-view MP4 (≤100 MB)` → `2–5 s side-view MP4 (≤3 MB)`. Line ~249 (`Scope` / Non-Goals list): `**MP4 only**, side-view, 2–15 s, ≤100 MB, one rider in frame.` → `**MP4 only**, side-view, 2–5 s, ≤3 MB, one rider in frame.`

#### 4. test-plan §6 cap reference

**File**: `context/foundation/test-plan.md`

**Intent**: Keep the "Capped-JSON-body-reader pattern" cookbook bullet factually correct after the cap figure changes. Number/scale fix only — no restructuring of §6 (that is `/10x-test-plan`'s ownership).

**Contract**: In the `**Capped-JSON-body-reader pattern.**` bullet: `the existing \`.max(140_000_000)\` schema check`→`the existing \`.max(4_500_000)\` schema check`. In the stream-error bullet just below: `a route whose whole purpose is receiving a ~100MB base64 video body`→`... a ~3 MB base64 video body`.

### Success Criteria:

#### Automated Verification:

- Type checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/lib/schemas.ts src/pages/api/analyze.ts`
- `/api/analyze` route tests pass: `npm run test -- src/pages/api/_analyze.test.ts`
- Capped-body tests pass: `npm run test -- src/lib/capped-json-body.test.ts`
- Full unit suite green: `npm run test`
- Prettier clean: `npx prettier --check src/lib/schemas.ts src/pages/api/analyze.ts README.md`
- No stale figures remain: `rg -n "140_000_000|140_100_000|104_857_600|100 ?MB|100MB|2–15|2-15" src/ README.md context/foundation/test-plan.md` returns nothing

#### Manual Verification:

- `POST /api/analyze` (authenticated, valid owned session in `processing`) with a `video` string of ~4.19 M chars (a genuine ~3 MiB clip) → still succeeds end-to-end
- `POST /api/analyze` with a `video` string of ~5 M chars → `400` with a Zod error (schema gate)
- `POST /api/analyze` with a spoofed `Content-Length` of `10000000` → `413` before any DB/LLM call
- Full happy path from the dashboard with a valid 3 s clip → recommendations render (no regression)

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Tighten the OpenRouter-route rate limit

### Overview

Lower the per-user, per-route request ceiling from 10 to 3 per 10-minute window. The window itself is unchanged. `RATE_LIMIT_MAX_REQUESTS` is a shared, app-side constant compared in `checkRateLimit` — no migration, no RPC change. It governs **both** OpenRouter-backed routes (`analyze` and `recommend`), which is intended: a legitimate user runs ~1 analyze + ~1 recommend per fitting and rarely does more than three fittings inside ten minutes, while an abuser's per-window vision-model budget is cut to 3 calls.

### Changes Required:

#### 1. Rate-limit policy constant

**File**: `src/lib/services/rate-limit.ts`

**Intent**: Reduce the allowed request count per window on the OpenRouter-backed routes.

**Contract**: `RATE_LIMIT_MAX_REQUESTS`: `10` → `3`. `RATE_LIMIT_WINDOW_MINUTES` unchanged (`10`). No signature change; `checkRateLimit` still returns `{ ok: true, allowed: data <= RATE_LIMIT_MAX_REQUESTS }`. The `check_and_increment_rate_limit` RPC and its migration are untouched (the count comparison is app-side).

#### 2. Rate-limit unit tests

**File**: `src/lib/services/rate-limit.test.ts`

**Intent**: Realign the boundary fixtures and the policy-constant assertion to the new ceiling. Without this, the "boundary (10th request)" case fails (`10 <= 3` is now false).

**Contract**:

- "allows the request when the returned count is at the boundary" → stub `data: 3`, expect `allowed: true`; rename the count in the title to `3rd request`.
- "rejects the request when the returned count exceeds the max" → stub `data: 4`, expect `allowed: false`; rename to `4th request`.
- "exports the documented policy constants" → `expect(RATE_LIMIT_MAX_REQUESTS).toBe(3)` (`RATE_LIMIT_WINDOW_MINUTES` assertion stays `10`).

#### 3. Route-test rate-limit fixtures

**Files**: `src/pages/api/_analyze.test.ts`, `src/pages/api/sessions/[id]/_recommend.test.ts`

**Intent**: The "429 when the rate limit is exceeded" cases stub the RPC with `data: 11` — still `> 3`, so they pass unchanged, but the fixture now reads as an arbitrary number. Update it to sit just over the new ceiling for legibility.

**Contract**: In each file's rate-limit-exceeded case, change the stub from `{ data: 11 }` to `{ data: 4 }`. No assertion changes (still expects `429` before any ownership query or OpenRouter call).

#### 4. README rate-limit figure

**File**: `README.md`

**Intent**: State the current policy.

**Contract**: Line ~184: `rate-limited per user per route (10 requests / 10 min)` → `... (3 requests / 10 min)`.

### Success Criteria:

#### Automated Verification:

- Type checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/lib/services/rate-limit.ts src/lib/services/rate-limit.test.ts src/pages/api/_analyze.test.ts "src/pages/api/sessions/[id]/_recommend.test.ts"`
- Rate-limit suite passes: `npm run test -- src/lib/services/rate-limit.test.ts`
- Both route suites pass: `npm run test -- src/pages/api/_analyze.test.ts "src/pages/api/sessions/[id]/_recommend.test.ts"`
- Full unit suite green: `npm run test`
- Prettier clean: `npx prettier --check README.md`
- No stale ceiling figure: `rg -n "RATE_LIMIT_MAX_REQUESTS = 10|MAX_REQUESTS\).toBe\(10\)|10 requests / 10|10th request|11th request|data: 11" src/lib/services/rate-limit.ts src/lib/services/rate-limit.test.ts src/pages/api/_analyze.test.ts "src/pages/api/sessions/[id]/_recommend.test.ts" README.md` returns nothing (matches on `RATE_LIMIT_WINDOW_MINUTES` are fine — only the count moved)

#### Manual Verification:

- With a fresh account: 3 successive `/dashboard` analyses within 10 minutes all start; the 4th upload's `/api/analyze` call returns `429` with `"Too many requests. Please try again later."` and the pipeline surfaces it as a clean error (no stack trace, no hang)
- `POST /api/sessions/[id]/recommend` a 4th time within the window → `429`
- After the window rolls over, a new request is allowed again
- The e2e smoke (`e2e/upload-analysis-results.spec.ts`) still passes — it runs 1 analyze + 1 recommend per seeded user, well under 3

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation. Then mark the S-08 roadmap row `done` via `/10x-archive`.

---

## Testing Strategy

### Automated (existing suites — must stay green):

- `src/pages/api/_analyze.test.ts` — auth, rate-limit, 413 oversized-body, 400 missing-field, session-ownership paths. The 413 test's spoofed 1 GB `Content-Length` still exceeds the new `4_600_000` cap.
- `src/pages/api/sessions/[id]/_recommend.test.ts` — auth, rate-limit, ownership, provider-error paths.
- `src/lib/capped-json-body.test.ts` — `readJsonWithCap` unit behaviour; independent of the route constant.
- `src/lib/services/rate-limit.test.ts` — boundary + fail-closed behaviour; **fixtures updated in Phase 3** for the new ceiling.
- Full `npm run test` after each phase.

### Manual:

1. Boundary clips through `/dashboard`: 4 s/2 MB (pass), 6 s (duration reject), 4 MB (size reject), 1 s (min-duration reject), ≈2.0 s and ≈5.0 s edges (pass).
2. Confirm the helper text and both error strings read the new limits.
3. One full happy path with a valid 3 s clip → recommendations render.
4. Direct `POST /api/analyze` with an over-cap `video` string → 400; with a spoofed large `Content-Length` → 413.
5. 4 analyses within 10 minutes on one account → the 4th `/api/analyze` returns 429, surfaced as a clean error.

## Performance Considerations

Strictly positive: a 2–5 s clip capped at 3 MiB is a much smaller base64 payload to the vision LLM than the previous ceiling allowed, reducing `/api/analyze` latency and provider token cost. 2 s at ~60 rpm is still ~2 crank revolutions — ample for one BDC + one TDC keyframe. The rate-limit reduction (10 → 3) only ever _reduces_ load; no added round trips.

## Migration Notes

None. No schema migration, no persisted limit, no data backfill. Existing `fitting_sessions` rows (some with `video_duration_s` up to 15) are unaffected — the column stays nullable/positive and nothing reads a limit from it. The rate-limit change is an app-side constant only — the `rate_limits` table and `check_and_increment_rate_limit` RPC are untouched, and in-flight window buckets simply start rejecting at the 4th request instead of the 11th.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-08
- Client gates: `src/components/VideoUpload.tsx:24-26,55-80,155`
- Vision payload path: `src/components/VideoAnalyzer.tsx` → `src/pages/api/analyze.ts` → `src/lib/services/llm.ts:48-104`
- Origin of the server caps + rate limiter: `context/archive/2026-09-04-testing-abuse-resource-protection/` (plan + research — "Payload cap — `video`", rate-limit RPC pattern)
- Rate limit: `src/lib/services/rate-limit.ts`, RPC `supabase/migrations/20260905150000_add_rate_limits.sql` (unchanged), lockdown `20260905160000_lock_down_rate_limit_rpc.sql`
- `readJsonWithCap` behaviour: `src/lib/capped-json-body.ts:22-60`
- Original S-01 gates: `context/archive/2026-06-04-video-upload-and-status/plan.md`
- Lessons: `context/foundation/lessons.md` (`npx tsc --noEmit`, `z.treeifyError`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tighten client-side upload gates

#### Automated

- [x] 1.1 Type checks pass: `npx tsc --noEmit` — 844e9cc
- [x] 1.2 Lint passes: `npx eslint src/components/VideoUpload.tsx` — 844e9cc
- [x] 1.3 Prettier clean: `npx prettier --check src/components/VideoUpload.tsx` — 844e9cc
- [x] 1.4 Full unit suite still green: `npm run test` — 844e9cc
- [x] 1.5 No stale client numbers: `rg -n "104_857_600|100 MB|15 seconds|between 3 and 15" src/components/VideoUpload.tsx` returns nothing — 844e9cc

#### Manual

- [x] 1.6 ~4 s / ~2 MB MP4 → validation passes, session created, analysis starts — 844e9cc
- [x] 1.7 ~6 s MP4 → "Video must be 5 seconds or shorter", no session created — 844e9cc
- [x] 1.8 ~4 MB MP4 (2–5 s) → "File must be 3 MB or smaller", no API call — 844e9cc
- [x] 1.9 ~1 s MP4 → "Video must be at least 2 seconds" — 844e9cc
- [x] 1.10 ≈2.0 s and ≈5.0 s clips (≤3 MB) → accepted — 844e9cc
- [x] 1.11 Dashboard helper text reads "Select an MP4 file 2–5 seconds long. Maximum size 3 MB." — 844e9cc

### Phase 2: Retighten server `/api/analyze` payload caps + refresh docs

#### Automated

- [x] 2.1 Type checks pass: `npx tsc --noEmit` — d876d0c
- [x] 2.2 Lint passes: `npx eslint src/lib/schemas.ts src/pages/api/analyze.ts` — d876d0c
- [x] 2.3 `/api/analyze` route tests pass: `npm run test -- src/pages/api/_analyze.test.ts` — d876d0c
- [x] 2.4 Capped-body tests pass: `npm run test -- src/lib/capped-json-body.test.ts` — d876d0c
- [x] 2.5 Full unit suite green: `npm run test` — d876d0c
- [x] 2.6 Prettier clean: `npx prettier --check src/lib/schemas.ts src/pages/api/analyze.ts README.md` — d876d0c
- [x] 2.7 No stale figures: `rg -n "140_000_000|140_100_000|104_857_600|100 ?MB|100MB|2–15|2-15" src/ README.md context/foundation/test-plan.md` returns nothing — d876d0c

#### Manual

- [x] 2.8 `POST /api/analyze` with a genuine ~3 MiB clip's base64 (~4.19 M chars) → succeeds end-to-end — d876d0c
- [x] 2.9 `POST /api/analyze` with a ~5 M-char `video` string → 400 with Zod error — d876d0c
- [x] 2.10 `POST /api/analyze` with spoofed `Content-Length: 10000000` → 413 before any DB/LLM call — d876d0c
- [x] 2.11 Full dashboard happy path with a valid 3 s clip → recommendations render, no regression — d876d0c

### Phase 3: Tighten the OpenRouter-route rate limit

#### Automated

- [x] 3.1 Type checks pass: `npx tsc --noEmit` — 9cea406
- [x] 3.2 Lint passes: `npx eslint src/lib/services/rate-limit.ts src/lib/services/rate-limit.test.ts src/pages/api/_analyze.test.ts "src/pages/api/sessions/[id]/_recommend.test.ts"` — 9cea406
- [x] 3.3 Rate-limit suite passes: `npm run test -- src/lib/services/rate-limit.test.ts` — 9cea406
- [x] 3.4 Both route suites pass: `npm run test -- src/pages/api/_analyze.test.ts "src/pages/api/sessions/[id]/_recommend.test.ts"` — 9cea406
- [x] 3.5 Full unit suite green: `npm run test` — 9cea406
- [x] 3.6 Prettier clean: `npx prettier --check README.md` — 9cea406
- [x] 3.7 No stale figure: `rg -n "= 10;|10 requests / 10|10th request|toBe\(10\)" src/lib/services/rate-limit.ts src/lib/services/rate-limit.test.ts README.md` returns only the `RATE_LIMIT_WINDOW_MINUTES` line — 9cea406

#### Manual

- [x] 3.8 4 analyses within 10 min on one fresh account → 4th `/api/analyze` returns 429 (`"Too many requests. Please try again later."`), surfaced as a clean pipeline error — 9cea406
- [x] 3.9 4th `POST /api/sessions/[id]/recommend` within the window → 429 — 9cea406
- [x] 3.10 After the window rolls over → a new request is allowed — 9cea406
- [x] 3.11 e2e smoke (`e2e/upload-analysis-results.spec.ts`) still passes (1 analyze + 1 recommend per user, under the ceiling) — 9cea406
