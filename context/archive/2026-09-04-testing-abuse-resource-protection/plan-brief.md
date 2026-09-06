# Abuse & Resource Protection — Plan Brief

> Full plan: `context/changes/testing-abuse-resource-protection/plan.md`
> Research: `context/changes/testing-abuse-resource-protection/research.md`

## What & Why

Close test-plan §3 Phase 3 (Risks #3, #4): the OpenRouter dependency is an
unprotected single point of failure — no rate limiting, no real server-side
payload caps — so unintended use or an attacker could exhaust the API
budget or get BikeFit's provider account flagged, taking the product down
for everyone. A crafted video could also try to manipulate the vision model
via multimodal prompt injection. This phase builds the missing mitigations
and their tests together, since neither exists yet.

## Starting Point

Session-binding (the other half of Risk #3) already shipped in Phase 2. No
rate limiting exists anywhere in `src/`. A payload cap exists on the
`video` field but is checked only _after_ the full body is buffered and
parsed — it doesn't do the resource-protection job a cap should. The
`body_angles` array has no cap at all. The vision LLM call site already has
a hard, contract-tested output boundary; the recommendations call site has
a materially weaker one (a pre-parse type cast instead of Zod's validated
`.data`).

## Desired End State

Both LLM-backed routes reject a caller's 11th request in a 10-minute window
with 429, before touching the database or OpenRouter. An oversized upload
to `/api/analyze` is rejected with 413 before it's ever buffered. An
oversized `body_angles` payload is rejected with 400. Both LLM call sites —
vision and recommendations — return only Zod-validated data, and a small,
dated test corpus proves that boundary holds under injection-styled input.

## Key Decisions Made

| Decision                      | Choice                                                                                                                                         | Why (1 sentence)                                                                                       | Source          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| Rate-limit policy             | Per-route, per-user, 10 req / 10 min (fixed window)                                                                                            | Matches natural per-session cadence while bounding worst-case cost per route independently             | Plan            |
| Rate-limit mechanism          | Postgres RPC atomic counter only                                                                                                               | Reuses the app's only real datastore, fully testable today, no new test infra                          | Research → Plan |
| Payload caps                  | Video: streaming cap enforced before parsing (number unchanged — already correctly sized); `body_angles`: max 20 items, 200-char string fields | Closes the real gap (timing, not the number) for video; gives `body_angles` its first-ever bound       | Plan            |
| Provider-error handling       | Keep uniform (no change)                                                                                                                       | Already contract-tested and sufficient; avoids new branching logic not required by change.md's wording | Plan            |
| Output-contract scope         | Both LLM call sites (vision + recommendations)                                                                                                 | Applies the same "hard boundary" language consistently, closing a real (if currently inert) gap        | Plan            |
| Adversarial probe             | Include, dated, asserts the boundary's reaction (never real model output)                                                                      | Directly proves Risk #4's claim with real signal, reuses existing mock harness                         | Plan            |
| `video_duration_s` server cap | Out of scope                                                                                                                                   | Not an OpenRouter-backed route; the video byte cap already bounds actual cost                          | Plan            |

## Scope

**In scope:**

- Postgres-backed rate limiting on `/api/analyze` and
  `/api/sessions/[id]/recommend`
- Early (pre-buffer) payload-size enforcement on `/api/analyze`
- Array/field-length caps on `body_angles`
- Hardening `generateRecommendations`'s return to Zod-validated data
- A dated adversarial probe corpus in `llm.test.ts`

**Out of scope:**

- Cloudflare's native Rate Limiting binding (no secondary layer)
- Differentiated provider-error messaging by status code
- Prompt-wording changes for injection defense
- `rate_limits` row cleanup/TTL
- `video_duration_s` server-side re-validation
- The real cross-user RLS Playwright check (test-plan §3 Phase 4)

## Architecture / Approach

Both new checks slot into the existing route-handler shape as the earliest
possible rejection points: auth check (existing) → rate-limit check (new,
via a Postgres RPC called through the existing `createAdminClient()`) →
payload-cap check (new, `/api/analyze` only, before `.json()`) → existing
ownership pre-check → existing LLM call. The rate-limit counter is a new
table + `SECURITY INVOKER` RPC function, following the project's existing
RLS convention (enable + force, no policy for anything that shouldn't be
reachable directly). The output-contract fix and adversarial probe extend
the existing `llm.test.ts` corpus rather than introducing new test
infrastructure.

## Phases at a Glance

| Phase                                | What it delivers                                                                     | Key risk                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1. Rate limiting                     | `rate_limits` table + RPC, `rate-limit.ts` service, wired into both routes           | First `supabase.rpc()` call in the codebase — stub needs extending before it's testable                  |
| 2. Payload-size caps, enforced early | Streaming pre-parse cap for `/api/analyze`; `body_angles` array/field caps           | Streaming-abort correctness under chunked encoding (no `Content-Length`)                                 |
| 3. Output-contract boundary + probe  | `generateRecommendations` returns `.data`; dated adversarial corpus in `llm.test.ts` | Probe must assert boundary reaction, not model behavior — easy to drift into asserting real model output |

**Prerequisites:** local Supabase instance for migration testing; no other
dependencies — reuses existing harness (`makeSupabaseStub`,
`installOpenRouterMock`, `makeApiContext`).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- The existing 140,000,000-char `video` schema cap was already
  correctly sized for the client's 100MB raw-video cap (base64 inflation
  math checks out); this plan doesn't change that number, only when it's
  enforced. Confirm this reasoning still holds if the client-side cap ever
  changes.
- Cloudflare's own platform-level request-body ceiling (100MB on Free/Pro,
  higher on Business+) is independent of this plan and depends on which
  plan tier BikeFit is deployed on — not verified here. If on Free/Pro, a
  ~140MB request would already be rejected by Cloudflare itself before
  reaching the Worker, which is a separate, ops-level fact worth confirming
  outside this plan.
- `rate_limits` row growth is unbounded (no TTL) — accepted for MVP,
  mirroring the project's existing posture on the stuck-session reaper.

## Success Criteria (Summary)

- An 11th request to either LLM-backed route within a 10-minute window is
  rejected with 429, and neither the database ownership check nor the LLM
  call runs.
- An oversized `/api/analyze` upload is rejected with 413 before the body
  is buffered.
- Injection-styled mocked OpenRouter responses (both call sites) still
  resolve only to validated data or a thrown fixed-string error — never
  free text, never a broken schema, never a smuggled extra property.
