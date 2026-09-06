<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Abuse & Resource Protection Implementation Plan

- **Plan**: context/changes/testing-abuse-resource-protection/plan.md
- **Scope**: Phase 3 of 3 (full plan — all phases complete)
- **Date**: 2026-09-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — `check_and_increment_rate_limit` is directly callable by `anon`/`authenticated` via PostgREST

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260905150000_add_rate_limits.sql:23-45
- **Detail**: The migration's own comment claims "All access goes through
  check_and_increment_rate_limit(), invoked exclusively via the
  service-role admin client" — but nothing in the SQL enforces that.
  Verified live against the local instance: `\df+
check_and_increment_rate_limit` shows `anon=X/postgres` and
  `authenticated=X/postgres` in the access-privileges list (Postgres
  grants EXECUTE to PUBLIC by default; this is the first RPC this
  codebase has ever shipped, so there's no prior GRANT/REVOKE precedent
  to have followed). I confirmed reachability directly: `SET ROLE
authenticated; SELECT check_and_increment_rate_limit(...)` executes the
  function body as `authenticated` and fails only when the inner INSERT
  hits `rate_limits`' RLS wall (`new row violates row-level security
policy`). So today this is blocked — but only by RLS, a second,
  independent gate the function's own privileges don't need to rely on.
  If any future migration ever adds so much as a permissive
  `SELECT`/`INSERT` policy to `rate_limits` (e.g. a "view my own usage"
  feature), this function becomes directly callable by any authenticated
  user with an arbitrary `p_user_id`, letting one user poison another
  user's rate-limit counter. Related: `p_window_minutes` is
  caller-suppliable through this same unguarded path, and `0` would
  divide-by-zero in the window-bucket computation before RLS is reached.
- **Fix**: Add a new migration that runs `REVOKE EXECUTE ON FUNCTION
check_and_increment_rate_limit(uuid, text, int) FROM PUBLIC;` and
  `GRANT EXECUTE ON FUNCTION check_and_increment_rate_limit(uuid, text,
int) TO service_role;` (Supabase's own hardening docs recommend exactly
  this pattern for service-role-only RPCs). Add as a new migration file,
  not an edit to the already-applied one.
- **Decision**: FIXED — `supabase/migrations/20260905160000_lock_down_rate_limit_rpc.sql`.
  Verified live against a fresh `supabase db reset`: `authenticated` now
  gets `permission denied for function check_and_increment_rate_limit`;
  `service_role` still reaches the function body unchanged. Did **not**
  also pin `search_path = ''` (an extra hardening step floated in the
  original finding) — tested it locally and it breaks the function at
  call time, since its body references `rate_limits` unqualified; fixing
  that would mean schema-qualifying the table inside the already-shipped
  function body, a separate, larger change than this lock-down. Full
  suite re-verified green after the fix: `tsc`, lint, 169/169 tests.

### F2 — `readJsonWithCap`'s stream-read loop has no error handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/capped-json-body.ts:24-32
- **Detail**: The `for (;;) { const { done, value } = await reader.read(); ... }`
  loop has no try/catch. `reader.read()` rejects if the underlying stream
  errors — a real possibility for this specific route, whose whole
  purpose is receiving a ~100MB base64 video body over a connection that
  can drop mid-upload. The code this replaced explicitly caught this:
  `try { body = await context.request.json(); } catch { return
Response.json({ error: "Invalid JSON" }, { status: 400 }); }`. Neither
  `analyze.ts` nor `recommend.ts` wraps the new `readJsonWithCap` call in
  try/catch, so a mid-stream failure now propagates as an unhandled
  rejection instead of the app's structured `{ error: string }` JSON
  convention used everywhere else in these routes, and the reader is
  never released on that path (the existing `too-large` abort path does
  correctly `await reader.cancel()` — only the error path is uncovered).
- **Fix**: Wrap the read loop in try/catch; on catch, `await
reader.cancel().catch(() => {})` and `return { ok: false, reason:
"invalid-json" }` (reuses the existing return type, no signature
  change needed).
- **Decision**: FIXED — `src/lib/capped-json-body.ts` (read loop wrapped
  in try/catch, cancels the reader, returns `invalid-json`). Added a
  regression test (`requestWithErroringBody` — a `ReadableStream` that
  calls `controller.error(...)`) proving `readJsonWithCap` resolves to
  `{ ok: false, reason: "invalid-json" }` instead of rejecting. Full
  suite re-verified green: `tsc`, lint, 170/170 tests (was 169, +1 new).

### F3 — Uncommitted manual-test scratch files in the working tree

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: repo root (cookie.txt, payload.json, review.md, test.base64, test.sh, video.json, video_fixed\*.mp4, zzz, supabase/snippets/)
- **Detail**: Not part of the plan's diff and not committed, but sitting
  untracked in the working tree — leftover artifacts from manually
  verifying Phase 1/2 (the `scripts/test-analyze.sh` diff that adds the
  spoofed `Content-Length` header for the Phase 2 manual-verification
  step is good corroborating evidence the manual tests were actually run,
  not rubber-stamped). Pure housekeeping, no functional impact.
- **Fix**: `git clean` these or add them to `.gitignore` before the branch
  is considered done.
- **Decision**: SKIPPED

## Notes on verification performed

- **Plan drift**: all 9 numbered "Changes Required" contract items across
  Phases 1–3 verified MATCH against actual file content (migration
  schema/RPC, `rate-limit.ts`, `capped-json-body.ts`, schema caps, both
  route wirings, `llm.ts`'s tightened return, the adversarial probe
  corpus). No MISSING, no DRIFT. One complementary-but-unlisted test file
  (`rate-limit.test.ts`) — benign, not scope creep.
- **Git scope**: diff file list (`faf9692^..1e05b03`) matches the plan's
  file list exactly; no unplanned files.
- **Automated verification**: `npx tsc --noEmit` clean; `npm run lint`
  clean (3 pre-existing warnings in unrelated files only); `npm test` —
  169/169 passing across 18 files. Migration applies cleanly on a fresh
  `npx supabase db reset` against the local instance. Directly verified
  in Postgres: `rate_limits` has RLS enabled+forced with zero policies;
  the atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is a single
  statement (no read-then-write race); the `user_id → auth.users(id) ON
DELETE CASCADE` FK (not spelled out in the plan's contract table, but
  matching the exact FK pattern already used on `fitting_sessions`) is a
  benign, convention-consistent addition.
- **Manual verification**: Progress marks 1.5/1.6/2.4 as done. 2.4 has
  corroborating evidence (uncommitted `scripts/test-analyze.sh` diff adds
  the spoofed `Content-Length` header used for that exact test). 1.5/1.6
  are inherently ephemeral (an 11-request curl loop against local dev)
  and have no artifact either way — no reason to doubt them, not flagged.
- **Pattern compliance**: rate-limit-before-ownership-check ordering
  correct in both routes; fail-closed convention genuinely holds (no path
  where an RPC error resolves to "allowed"); dual-client
  (admin + request-scoped) structure matches the existing DELETE-handler
  precedent, with the admin-client-first ordering being an intentional,
  plan-specified difference (gating before the ownership query, not
  after); error-response shape, file placement (`services/` vs. flat
  `lib/`), and test conventions (`makeApiContext`, `SupabaseStub`
  scripting) all match existing precedent.
