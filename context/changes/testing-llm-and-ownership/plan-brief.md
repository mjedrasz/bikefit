# LLM boundary + API-route integration (test-plan Phase 2) — Plan Brief

> Full plan: `context/changes/testing-llm-and-ownership/plan.md`
> Research: `context/changes/testing-llm-and-ownership/research.md`

## What & Why

§3 Phase 2 of the test rollout. BikeFit has one pure-logic unit suite (Phase 1) and nothing
that exercises a route, the OpenRouter boundary, or an SSR page. This phase stands up the
integration + contract layer **and** applies the code hardening that makes four risks
defensible: the OpenRouter response boundary is loose (`as`-casts, no fence tolerance, leaky
error bodies), session-mutation routes lean on a single RLS `SELECT` pre-check, a stuck
`processing` session shows "check back soon" forever, and DB query errors render as "not
found" across several surfaces.

## Starting Point

The server is a thin persistence + LLM-proxy layer; the analysis pipeline is a browser
orchestrator calling six routes in sequence. `vitest.config.ts` is a plain `defineConfig`,
`environment: "node"`, pure-logic only — no `astro:env`, no DOM, no HTTP mock, no Supabase
stub. Every route transitively imports `astro:env/server`, which throws at import if unset.
CI runs `lint` + `build` only. Cookbook §6.2–§6.4 all read "TBD — see §3 Phase 2".

## Desired End State

`npm test` runs a hermetic green suite (no network, no local Supabase) covering the OpenRouter
malformed-response corpus, every route's auth/ownership/error branches, and both SSR pages via
the Container API. `llm.ts` rejects every drifted response with a typed error and tolerates a
markdown-fenced body; `/analyze` is bound to an owned `processing` session; a stale
`processing` session renders as "Analysis timed out"; every query error surfaces as a 500 or a
distinct "couldn't load" state. `npm test` is a required CI gate.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Risk #6 mechanism | Display-time staleness rule (pure fn + render), **no reaper** | Cheapest real terminal signal; `updated_at` already maintained; no new infra | Plan (research OQ-1) |
| `/api/analyze` session binding | Bind to an owned `processing` session **in this phase** | It's an ownership fix (Risk #5); makes `/analyze` testable; small change | Plan (research OQ-3) |
| LLM boundary depth | Full: per-item Zod + fence-strip + generic route 500s | Closes every Risk #2 gap research found; contract tests assert real behaviour | Plan (research OQ-4) |
| `astro:env` in tests | Alias-stub the `astro:env/server` virtual module | Keeps the fast plain-config setup; no Astro build pipeline / adapter | Plan (research OQ-5) |
| Risk #5 cross-user in CI | Stub logic-floor only; real two-user RLS check → §3 Phase 4 (Playwright) | One harness tier now; real-RLS proof consolidated with e2e | Plan (research OQ-2) |
| OpenRouter mock | `undici` `MockAgent` (`setGlobalDispatcher`) | Zero new runtime deps; intercepts the exact global `fetch`; precise body control | Plan |
| Route-handler exercise | Hand-built `APIContext` (call exported `POST`/`GET`) | Official Astro recipe; routes touch only 4 context fields | Plan (Context7) |
| Risk #7 fix scope | Fix every site (5 routes + `recommend` + blank-card page) | Makes "distinct error state" the tested default; ends the reactive one-at-a-time pattern | Plan |
| CI gate wiring | Phase 2 adds `npm test`; §3 Phase 4 adds typecheck + e2e | Gate goes live with the tests it gates; matches §5 "required after Phase 2" | Plan |

## Scope

**In scope:** integration/contract harness (`astro:env` stub, `undici` OpenRouter mock,
Supabase stub, `makeApiContext`, `renderPage`); `llm.ts` per-item validation + fence strip;
generic route 500s; `.maybeSingle()` + error/absent split on 6 query sites + the blank-card
page; `user_id` guard on `start`/`results` admin writes; `/analyze` session binding + client
change; `effectiveSessionStatus` staleness rule on both SSR pages; checked status `UPDATE`s;
`VideoAnalyzer` Step-7 `postError`; cookbook §6.2–§6.4 + §6.6; `npm test` in CI.

**Out of scope:** server-side reaper/cron; real cross-user RLS test (→ Phase 4); rate
limiting / payload caps / provider-error degradation (→ Phase 3); adversarial probe (→ Phase
3); typecheck + e2e CI gates (→ Phase 4); DOM-level `VideoAnalyzer` unit tests; schema
migration; data backfill; the vision model name.

## Architecture / Approach

Harness first, then the four risks in dependency order. New test infrastructure lives under
`src/test/` (`stubs/`, `helpers/`); specs are co-located next to the route/module they cover
(matching §6.1). `astro:env/server` is resolved by a static Vitest `resolve.alias` (stops the
import throw); `createClient`/`createAdminClient` are neutralised per-file with `vi.mock` + a
chainable stub whose `stub.calls` log lets tests assert pre-check-before-admin-write ordering.
OpenRouter is mocked at the HTTP edge only. SSR pages render through
`experimental_AstroContainer`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness foundation | `astro:env` alias-stub, OpenRouter mock, Supabase stub, context/page helpers, smoke tests, §6.2 | Alias-stub must mirror `env.schema`; Container API behaviour on Astro 6 |
| 2. LLM boundary (Risk #2) | Per-item Zod + `stripJsonFence` in `llm.ts`; generic route 500s; contract corpus; §6.3 | Corpus completeness; fenced-body edge cases |
| 3. DB-error states (Risk #7) | `.maybeSingle()` + error/absent split on 6 sites + blank-card page fix; error-branch tests | SSR-page test pattern must be solid from Phase 1 |
| 4. Ownership (Risk #5) | `user_id` guard on `start`/`results`; `/analyze` bound to a session + client change; stub ordering tests; §6.4 | `/analyze` contract change touches the client; real RLS still unproven till Phase 4 |
| 5. Stuck processing (Risk #6) | `effectiveSessionStatus` + both SSR pages; checked `UPDATE`s; Step-7 `postError`; unit + lifecycle tests; §6.6 | Threshold value (15 min) is a judgement call; orphan-results-row edge |
| 6. CI gate + docs | `npm test` in `ci.yml`; §4 refresh note; §7 reaper entry; §6.6 wrap-up | Keeping frozen §4 strategy honest without rewriting it |

**Prerequisites:** none beyond the Phase 1 harness (self-contained). A hosted Supabase project
exists in `.dev.vars` but is not used this phase.
**Estimated effort:** ~5–6 sessions, one per phase (Phase 6 is light: a CI one-liner + doc
sync).

## Open Risks & Assumptions

- `experimental_AstroContainer.renderToResponse` / `renderToString` behaves as documented for
  our two pages under Astro 6.3 + `output: "server"` — verified conceptually via Context7, not
  yet run. If it fights the Cloudflare adapter, fall back to asserting the page's extracted
  logic (`effectiveSessionStatus`, an error-state helper) as pure units.
- The `astro:env/server` `resolve.alias` intercepts the virtual specifier in Vitest 4. High
  confidence (common pattern) but unproven in this repo — Phase 1 step 1.5 is the gate.
- `STALE_PROCESSING_MS = 15 min` is a defensible guess, not telemetry-backed. Tunable in one
  place; flagged in the code comment and §6.6.
- Binding `/analyze` to a session assumes no external direct caller (the route is app-internal)
  — stated in Migration Notes.
- The real cross-user RLS assertion does not exist until §3 Phase 4; the stub floor proves
  ordering discipline, not that `sessions_select_own` is enforced.

## Success Criteria (Summary)

- From a fresh checkout with no secrets and no network, `npm test` is green and covers the
  four risks' failure modes — and is a blocking CI step.
- A drifted / truncated / fenced / wrong-shape OpenRouter response produces a typed,
  plain-language failure with no partial DB write; a direct caller sees a generic 500.
- A second user's `session_id` gets 404 with no write on every mutation route (stub-level);
  `/analyze` is session-scoped.
- A `processing` session with no progress past 15 min renders as a readable "timed out"
  failure on the results page and history; no permanently stuck "Processing".
- A Supabase query error renders as a 500 or "couldn't load" — never a 404, empty list, or
  blank card.
