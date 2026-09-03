# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-02 (OQ-2 resolved — reference-band dimension of Risk #1 now covered by `resolve-angle-reference-bands`; §2, §6.1, §6.6, §7 updated. Earlier: Phase 1 implemented — §6.1, §6.6, §7 filled)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression. BikeFit's entire analysis pipeline runs client-side in the
   browser and the server persists whatever the browser posts — so the
   cheapest real signal for correctness is a unit test on the pure math,
   not an end-to-end run.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. The five Phase 2
   interview answers drove five of the seven risks below.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the ground
   truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excludes `dist`, `node_modules`, `.astro`, `.wrangler`, `context/`).
90-day window — the last 30 days are almost entirely `chore(archive)`
commits and carry no authoring signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|--------------------------------|
| 1 | Joint-angle / keypoint math is subtly wrong — the angles the app computes don't match the reference-frame definitions they're compared against — so every "in range / outside range" verdict and every fitting recommendation built on them is confidently wrong. | High | High | PRD §Success Criteria (±10° accuracy), FR-006; interview Q1(1), Q3(2), Q3(3); hot-spot dir `src/components/` (7 commits/90d) |
| 2 | OpenRouter returns a slightly different JSON shape, truncated body, or markdown-fenced JSON one day and the whole analysis dies for every user. | High | High | interview Q1(2), Q2; hot-spot dirs `src/lib/services/` and `src/lib/` (4 commits/90d each); archive `2026-05-28-ai-analysis-pipeline/reviews/impl-review.md` (F1/F2/F3 — criticals in the LLM service) |
| 3 | The OpenRouter dependency is an unprotected single point of failure — no rate limiting, no server-side payload caps, the vision route not scoped to an owned session — so unintended use or an attacker exhausts the API budget or gets BikeFit's provider account content-flagged, taking the product down for everyone. | High | High | interview Q1(4), Q1(5); no rate-limiting middleware in the request path; open self-service signup (PRD §Access Control) |
| 4 | A crafted or fabricated video manipulates the vision model into doing something other than keyframe detection (multimodal prompt injection) — leaked system prompt, or attacker-influenced output attributed to BikeFit. | High | Medium | interview Q1(3); PRD accepts arbitrary user-supplied video (abuse lens — untrusted input) |
| 5 | One user reads or mutates another user's session or analysis results — the ownership check erodes because routes verify "is logged in" while mutations run through the service-role client keyed by a path parameter. | High | Medium | PRD §Access Control; abuse lens (authorization / IDOR); mixed user-client-read / admin-client-write pattern across the session mutation routes; `src/middleware.ts` (2 commits/30d) |
| 6 | The browser tab closes mid-analysis (the client-side pipeline runs for minutes on CPU) and the session is orphaned in `processing` forever — no result, no failure message — contradicting the "no silent errors" guardrail. | Medium | High | PRD §Guardrails (no silent errors) + §NFR (async); archive `2026-05-28-ai-analysis-pipeline/plan.md` documents this as an accepted unmitigated risk; client-side pipeline architecture |
| 7 | A Supabase query errors and the UI renders it as "not found" / "no sessions yet" / a blank results card — a real backend failure is indistinguishable from absent data. | Medium | High | archive `2026-08-23-fitting-results-display/reviews/impl-review.md` (F2), `2026-08-23-session-history-list/reviews/impl-review.md` (F1); PRD §Guardrails (no silent errors); noted as an accepted convention across several read paths |

**Abuse / security lens.** BikeFit has self-service auth and accepts
arbitrary user video, so the map carries three abuse rows: untrusted-input
manipulation of the model (#4), resource / availability abuse of the shared
AI dependency (#3), and authorization / ownership (#5). Secret / PII
leakage was considered and not promoted: the only secrets are server-only
`astro:env/server` fields never sent to the client, and raw video is never
persisted (the `video_r2_key` column exists but is never populated) —
research should still confirm error bodies and `raw_llm_response` do not
echo secrets.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Given known keypoint fixtures, computed angles match the bike-fitting **reference definitions** (correct vertex, included-vs-flexion convention, torso-measured-from-horizontal axis) within a stated tolerance; a left-facing and a right-facing clip both resolve to the correct body side. | "The angle the code computes is the angle the fitting literature means." Also: "the server would catch a bad result" — it will not, it persists whatever the browser posts. | The angle formulas, the keypoint-index contract, the exact definitions in the archived reference-angle notes, how the pose model's coordinates map onto those. | unit (pure functions) | Oracle problem — asserting the function returns the value it happens to return today; a snapshot of current output. |
| #2 | A drifted, truncated, markdown-fenced, or wrong-shape OpenRouter response produces a typed, plain-language failure — never a crash, never a partial DB write. | "HTTP 200 from OpenRouter means the body is the shape we expect." | Both response-format paths (strict `json_schema` vs `json_object`), every parse-then-shape-check site, and what the browser does with a route 4xx/5xx. | contract + integration (mocked OpenRouter at the network edge) | Testing only the well-formed response; mocking the provider to always return perfect JSON. |
| #3 | Server-side rate limiting and payload-size caps are enforced on every OpenRouter-backed route; the vision route is bound to an owned session; a provider 4xx/5xx/403/451 degrades to a clean plain-language error rather than a stack trace or a silent hang. | "Auth on the route is enough" / "the client already caps size, so the server needn't." | The full request path for the vision and recommendation routes, where a limiter would sit, the current caps, and the provider-error branch. | integration (enforcement + provider-failure simulation) | Asserting a 429 against a mock with the limit hard-coded; testing the limiter in isolation from the route it protects. |
| #4 | The vision route's output contract is a hard boundary — nothing the model returns is used beyond the strictly-validated timestamp schema; an adversarial probe set cannot make the route emit free text or break the schema. | "The model only returns timestamps because the prompt asks for timestamps." | How the strict schema is actually enforced on the response, and whether raw model text is ever rendered unescaped or used in control flow. | integration (schema-boundary) + a small dated AI-native probe (optional) | Building a full red-team eval harness at MVP scale; asserting on specific model outputs. |
| #5 | A second user receives 404 / empty / 403 for every route and page that addresses the first user's session or results — reads *and* writes. | "The route checks `locals.user`, so it is safe" — authentication is not ownership, and the admin client bypasses RLS. | The RLS policies as deployed, which routes read with the user client vs write with the admin client, and the pre-check guarding each admin write. | integration (two distinct user fixtures) | Testing only that an anonymous request is blocked; trusting RLS without exercising a cross-user request against it. |
| #6 | A session with no client progress for longer than a defined interval reaches a terminal `failed` state with a readable message; the results page and history never show a permanently stuck `processing`. | "The client always posts an error on failure." It cannot if the tab is gone. | The status lifecycle and who writes each transition, whether any server-side sweep or TTL exists, and what the UI renders for a long-lived `processing` session. | integration (status lifecycle) + unit (UI state mapping) | Testing only the path where the client stays alive to report completion or failure. |
| #7 | When a Supabase query returns an error, the user sees a distinct error state (a 500 or a "couldn't load" message), never an empty list or a 404. | "`data` is null means the row does not exist." | Every query site that destructures only `data`, the difference between a query error and an empty result, and the guarantee that a `completed` session has a results row. | integration + unit (error branch) | Asserting the current `data ?? []` fallthrough behavior; mocking Supabase so it can only ever succeed. |

**Risk #1 has two dimensions.** The guidance above covers the *geometry /
convention* dimension — the angle the code computes vs. the angle the fitting
literature means. The complementary *reference-band* dimension — which
numeric range each angle is judged against — is OQ-2, **RESOLVED
(2026-09-02)** and covered by change `resolve-angle-reference-bands`:
`ANGLE_REFS` is pinned to `context/foundation/reference-angles.md` in
`src/lib/pose/angles.test.ts` and the recommendations prompt is generated
from it. See §7.

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Harness bootstrap + joint-angle correctness | Stand up the test runner and prove the angle and keypoint-mapping math matches the reference-frame definitions it is judged against, including left/right side selection. | #1 | unit | change opened | context/changes/testing-angle-correctness/ |
| 2 | LLM boundary + API-route integration | Make the OpenRouter response boundary strict and fail-clean, make every session route enforce ownership, surface DB errors as distinct states, and drive stuck-`processing` sessions to a terminal state. | #2, #5, #6, #7 | contract, integration, unit | not started | — |
| 3 | Abuse & resource protection | Add server-side payload caps and rate limiting on the OpenRouter-backed routes, scope the vision route to an owned session, degrade gracefully on provider errors, and add a small dated adversarial probe on the vision boundary. | #3, #4 | integration, AI-native probe (optional) | not started | — |
| 4 | Quality-gates wiring + one e2e smoke | Add typecheck and the new test suites as required CI gates and add a single Playwright happy-path smoke over upload → analysing → results. | cross-cutting | e2e (1 flow), gates | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

Phase 3 is partly feature work: rate limiting and server-side caps do not
exist yet, so that phase builds the mitigation and the test together. All
other phases are test-only against behavior that already exists.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | none yet — see Phase 1 | Configure through `getViteConfig` from `astro/config` so `astro:env`, the `@/*` alias, and the Vite plugin chain resolve in tests. |
| DOM environment | happy-dom or jsdom | none yet — see Phase 1 | The browser pipeline component uses `document`, `canvas` 2D context, `FileReader`, and `URL.createObjectURL`; unit tests for its pure helpers still need a DOM global. |
| API / network mocking | MSW, or undici `MockAgent` | none yet — see Phase 2 | Mock OpenRouter at the HTTP edge only. Supabase: use a thin client stub — the local Supabase stack has been unreliable in this environment (noted in two archived impl-reviews) so CI should not depend on it. |
| e2e | Playwright | none yet — see Phase 4 | One happy-path flow only; seed Supabase through the admin API as the archived `session-history-list` verification did. |
| validation | Zod | 4.4.3 (in use) | Format errors with `z.treeifyError`, never `.flatten()` (see `context/foundation/lessons.md`). |
| CI | GitHub Actions | in use | Today runs `lint` + `build` only. `astro build` does not type-check TS and `@astrojs/check` is installed but never invoked — typecheck is currently ungated. |

**Stack grounding tools (current session):**
- Docs: Context7 — available; use for Astro 6 SSR test configuration (`getViteConfig`), Vitest setup, and Playwright against an Astro SSR server; checked: 2026-09-01
- Search: Exa.ai — available; use only for discovery / current-status checks, then cite the official doc; checked: 2026-09-01
- Runtime/browser: `claude-in-chrome` browser automation — available; a possible manual-verification aid, not a test layer; no Playwright MCP in session; checked: 2026-09-01
- Provider/platform: `gh` and `supabase` CLIs via shell — available; no GitHub / Supabase / Cloudflare MCP server in session; checked: 2026-09-01

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint (eslint) | local + CI | required (wired) | syntactic drift, a11y-lint, deprecated-API lint |
| typecheck (`npx tsc --noEmit`) | local + CI | required after §3 Phase 4 | type drift; not gated today |
| unit + integration (Vitest) | local + CI | required after §3 Phase 2 | angle-math regressions, LLM-boundary regressions, ownership regressions, swallowed-error regressions |
| e2e smoke — happy path | CI on PR | required after §3 Phase 4 | the upload → analysing → results flow being broken end to end |
| post-edit hook (run related tests on save) | local (agent loop) | recommended after §3 Phase 4 | regressions at edit time; not a CI substitute |
| multimodal visual review | CI on PR | optional | visual regressions on the results screen only (1 screen); classic assertions cover the rest |
| pre-prod smoke | between merge and prod | optional | Cloudflare Workers environment-specific failures (`nodejs_compat`, adapter) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test (pure logic — angle math, formatters, state maps)

Established by §3 Phase 1 (`context/changes/testing-angle-correctness/`).

**Where specs live.** Colocated as `<unit>.test.ts` next to the unit under
test — `src/lib/pose/angles.test.ts` beside `src/lib/pose/angles.ts`,
`src/lib/angle-verdict.test.ts` beside `src/lib/angle-verdict.ts`. This is
Vitest's zero-config default glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`); the
runner's `include` is further narrowed to `src/**/*.{test,spec}.ts` so
`context/` and `node_modules` are never scanned.

**Run command.** `npm test` (→ `vitest run`, one-shot) or `npm run
test:watch` (→ `vitest`, re-runs on save). `npm test` is self-contained
from a fresh checkout with **no `pretest` step** — nothing in the
unit-test graph imports the `astro:env` virtual module, so `astro sync` /
a populated `.astro/` is not required (`rm -rf .astro && npm test` is
green).

**Environment.** `environment: "node"` — Astro 6 removed rendering Astro
components in client (`jsdom` / `happy-dom`) Vitest environments, and every
pure helper operates on plain objects, so `node` is both required and
sufficient. No DOM. The I/O helpers (`seekTo`, `loadVideoElement`,
`detectPoseAt`, …) are **not** unit-tested here — that needs a DOM env and
is a later rollout phase.

**Config.** `vitest.config.ts` is a plain `defineConfig` from
`vitest/config` that re-declares only the `@/*` path alias from
`tsconfig.json`. It does **not** use `getViteConfig` from `astro/config`
(what §4's Stack table still names): `getViteConfig` drags the full Astro
build pipeline — including the Cloudflare adapter, incompatible with
Vitest's `ssr` environment — into every run, and the pure-logic suite
needs none of it. If a later rollout phase needs `astro:env`, a DOM
global, or the plugin chain in tests, revisit this and refresh §4
(`/10x-test-plan --refresh`).

**The canonical reference test — the oracle rule.** For the joint-angle /
keypoint-mapping pattern: construct keypoint fixtures, call the pure
function, and assert the returned number against a value that is **either**
hand-derived from geometry (a straight limb is 180°; a right angle is 90°;
a hip→shoulder line 45° above horizontal is 45°) **or** quoted from
`context/foundation/reference-angles.md` (the authoritative reference-band
doc — it carries the full 13-source literature list forward from the
archived review it supersedes). **Never** assert that a function returns
what it returns today, never `toMatchSnapshot`, never a real-video keypoint
dump. If the only way you
can state the expected value is "what the code currently produces," the
test has no signal — stop and derive the oracle first.

**Fixtures.** Builder helpers (`makeLandmarks(slots)`, `mirrorX`,
`makeKeypoints`, …) live at the top of the spec file. Promote them to
`src/lib/pose/__fixtures__/` only once a second spec file needs them.

**Worked examples.** `src/lib/pose/angles.test.ts` (geometry oracle,
reflection/mirror invariance, extremum selection, documented `NaN` edge)
and `src/lib/angle-verdict.test.ts` (inclusive bounds, a documented-known
contradiction pinned rather than fixed).

### 6.2 Adding an integration test (API route + mocked Supabase + mocked OpenRouter)

TBD — see §3 Phase 2. Will cover: how a route handler is exercised, the
network-edge-only mocking policy for OpenRouter, the Supabase client stub,
and the two-user fixture pattern for ownership assertions.

### 6.3 Adding a contract test for the OpenRouter boundary

TBD — see §3 Phase 2. Will cover: the malformed / drifted / truncated
response corpus and how each is asserted to produce a typed plain-language
failure with no partial write.

### 6.4 Adding a test for a new API endpoint

TBD — see §3 Phase 2. Default to integration: assert request → response
shape and the DB side-effect, mock only the external HTTP edge. Promote to
e2e only if the failure mode needs the deployed auth + cookie + handler
crossing.

### 6.5 Adding an e2e test

TBD — see §3 Phase 4. Will cover: Playwright against the Astro SSR server,
Supabase seeding through the admin API, and why the suite holds exactly one
flow.

### 6.6 Per-rollout-phase notes

(Filled in by `/10x-implement` as each phase lands — anything surprising the
phase taught, e.g. a fixture directory later phases should reuse.)

#### Phase 1 — Harness bootstrap + joint-angle correctness

- **Extraction pattern.** The pure math lived module-scoped and un-exported
  inside the `VideoAnalyzer.tsx` React island. Phase 2 moved it verbatim to
  `src/lib/pose/angles.ts` (`jointAngle`, `computeTorsoAngle`, `visible`,
  `convertKeypoints`, `pickExtremumFrame`, `ANGLE_REFS`, keypoint-index
  constants) and imported it back — zero behaviour change — so a later
  failing spec is unambiguously a spec problem, not a refactor regression.
  The verdict boolean was similarly lifted from `sessions/[id].astro` into
  `src/lib/angle-verdict.ts` (Phase 4). Rule for future phases: **pure logic
  worth testing comes out of the island first**, into `src/lib/`.
- **`astro:env` import hazard.** `src/lib/services/llm.ts` imports
  `OPENROUTER_API_KEY` from `astro:env/server` (an `access: "secret"`
  *required* field) at module top level — importing that module in a test
  without the var set throws at import time. The Phase 1 smoke spec
  deliberately imports `@/lib/format-angle` (no `astro:env` anywhere in its
  transitive graph). Env-setup wiring for `astro:env`-touching modules is
  deferred to the integration-test rollout phase.
- **`pickExtremumFrame` is a byte-for-byte contract.** Strict `>` / `<`
  seeded at `∓Infinity` → earliest candidate wins an exact knee-angle tie;
  called **once per timestamp** on that timestamp's ≤5 offset candidates,
  never on a pool across all BDC/TDC timestamps. The spec pins the tie-break
  for both types.
- **Fixture builders** live at the top of each spec file
  (`makeLandmarks`, `mirrorX`, `makeKeypoints`, `mirrorKeypointsX`,
  `torsoPose`, `kneePose`). Promote to `src/lib/pose/__fixtures__/` when a
  second spec needs them — not before.
- **A fix shipped with its spec.** `computeTorsoAngle` returned `180° − true`
  for a left-facing rider (`Math.abs` folded the sign but not the 180°
  complement). Phase 3 wrote the left-facing 45° spec → watched it fail at
  `~135` → applied the fold-to-acute fix (`atan2(|dy|, |dx|)`) → green. No
  `.skip` / `.fails`; the failing spec and the fix land in one commit.
- **Historical data is not backfilled.** The torso fix changes computed
  output for **left-facing videos only**; existing `analysis_results` rows
  for left-facing clips keep their wrong stored torso value (the app never
  recomputes persisted results). Accepted for MVP — the wrong values were
  already user-visible; no migration.
- **Open follow-ups** (tracked, not fixed this phase):
  - The results-page **display/pill contradiction** near a reference
    boundary — the verdict is computed from the raw value but the page
    renders `formatAngle` (rounded), so a raw `147.4` verdicts `false` yet
    displays `147°` inside "137–147°". `angle-verdict.test.ts` pins it as
    documented-known. The fix is a display-policy call that pairs with the
    S-05 rounding work.
  - `jointAngle` returns **`NaN` for coincident keypoints** (two input
    points identical → zero-length vector). Callers gate on `visible()`
    only, never on coincidence. `angles.test.ts` documents the current
    behaviour; no fix this phase.
  - The **reference-band** dimension of Risk #1 (which numeric range each
    angle is judged against) — OQ-2 — is **RESOLVED (2026-09-02)** by change
    `resolve-angle-reference-bands`: bands sourced from
    `context/foundation/reference-angles.md`, `ANGLE_REFS` pinned to that doc
    in `src/lib/pose/angles.test.ts`, and the recommendations prompt
    generated from `ANGLE_REFS` (`src/lib/recommendations-prompt.test.ts`).
    Phase 1 itself still asserts geometry and convention only.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect
these unless the underlying assumption changes.

- **Exact LLM recommendation and rationale wording** — non-deterministic;
  assert structure and numeric bounds only, never prose. Re-evaluate only
  if output moves to a deterministic template. (Source: Phase 2 interview
  Q5.)
- **End-to-end determinism** ("the same video produces the same
  recommendations", a PRD NFR) — the vision-keyframe, pose, and frame-seek
  layers are irreducibly non-deterministic; not chased with tests. The
  deterministic core — angle math over fixed keypoints — is covered in
  Phase 1. Re-evaluate if a caching or pinning layer is added to make the
  NFR real.
- **The gravel-only guardrail** ("must not silently produce results for
  road / MTB geometry") — the product has no bike-type detection; reference
  ranges are hard-coded gravel. A test here would require building a
  classifier first. Tracked as a known product gap, not a test target.
  Re-evaluate if a bike-type input or detector is added.
- **Third-party model accuracy** (the pose model and the vision model) on
  cycling footage — validated offline against the ±10° acceptance
  criterion, not by the suite; a test cannot assert a model's accuracy.
- **Starter-provided auth flows** (signin / signup / signout endpoints and
  the middleware redirect) beyond the cross-user ownership check in Risk #5
  — shipped with the starter, stable, low churn.
- **Marketing `Welcome` / landing page and shadcn UI primitives** —
  cosmetic, no data effect.
- **A user posting a hand-crafted results payload for their own session** —
  it is their own fitting data with no cross-user impact; the real concern
  (the server has no correctness oracle) is covered by the Phase 1 unit
  tests on the math the browser runs.
- **The measurement frame for torso and elbow.** Both are consumed from the
  **BDC** keyframe, but `bike-fitting-ref-angles.md` defines them at
  cranks-horizontal (3/9 o'clock). Torso-to-horizontal shifts only ~5°
  across the pedal stroke so the practical error is small; closing the gap
  needs a third detected keyframe, which is out of MVP scope. Documented on
  `computeTorsoAngle` in `src/lib/pose/angles.ts`. Re-evaluate if a
  crank-horizontal keyframe detector is added.
- **The 2-D image-plane projection assumption.** `convertKeypoints`
  hard-codes `z = 0` (the shipped app runs MoveNet 2-D pixels; the abandoned
  design used MediaPipe `worldLandmarks`), so every angle is a planar
  projection valid only for a true perpendicular side view. Off-axis / rotated
  capture is a capture-quality concern already excluded under "third-party
  model accuracy"; no rotated-pose fixtures. The assumption is documented on
  the module, not tested.
- **The results-page display/pill contradiction near a reference boundary.**
  The in/out-of-range verdict runs on the raw stored value while the page
  renders `formatAngle` (rounded to whole degrees), so a value just outside
  a band can display as a rounded value that reads as inside it (raw `147.4`
  → verdict `false`, shown as `147°` inside "137–147°").
  `src/lib/angle-verdict.test.ts` pins this as documented-known. Not fixed
  here — it is a display-policy decision that pairs with the S-05 rounding
  work; see §6.6.
- **The reference-band dimension of Risk #1 — RESOLVED (2026-09-02).** OQ-2 /
  PRD Open Question #2 is closed; this is now covered, no longer negative
  space. *Which numeric range* each angle is judged against is fixed by change
  `resolve-angle-reference-bands`: the five bands come from
  `context/foundation/reference-angles.md` (authoritative), `ANGLE_REFS` is
  pinned to that doc in `src/lib/pose/angles.test.ts`, and the
  recommendations prompt is generated from `ANGLE_REFS` — with
  `src/lib/recommendations-prompt.test.ts` asserting the blessed numbers and
  the absence of the retired ones. The elbow band is resolved at
  `ELBOW 150–165` (the practitioner shoulder–elbow–wrist included-angle range
  for a relaxed hoods position); the archived guide's `85–95°` was an
  upper-arm-to-torso "shoulder forward angle" mislabel, not the angle the app
  computes. Phase 1's geometry/convention coverage plus this band pinning
  together defend the correctness dimension of Risk #1; kept here only as a
  pointer.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-01
- Stack versions last verified: 2026-09-01
- AI-native tool references last verified: 2026-09-01

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
