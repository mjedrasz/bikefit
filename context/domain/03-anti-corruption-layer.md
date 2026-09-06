---
title: "Anti-Corruption Layer — the pose-estimation vendor leak"
created: 2026-09-06
type: refactor-plan
---

# Anti-Corruption Layer — the pose-estimation vendor leak

> Product of a DDD pass focused on **discovering, choosing, and fencing off one
> leaking external dependency**. This is a refactor _plan_ — no production code is
> changed by this document. Discovery → identification → classification →
> diagnosis → ACL design → isolation proof → phased plan.
>
> Sibling documents: [[01-domain-distillation]] is the wider domain map and
> refactor ranking; [[02-invariant-aggregate-refactor]] hardens the `FittingSession`
> lifecycle (and already designs the `FittingSessionRepository` — the persistence
> ACL for the `fitting_sessions` / `analysis_results` slice of Supabase). This
> document takes the **anti-corruption** angle: which external dependency has
> leaked across the most layer boundaries _against the clearest written intent
> that it stay swappable_. The answer is the **browser pose-estimation library**
> (`@tensorflow-models/pose-detection`), not Supabase.

All `file:line` citations verified against `master` @ `5b42fd0`. Vendor-contract
facts (§4.4) verified against the `@tensorflow-models/pose-detection` docs via
Context7 on 2026-09-06.

---

## Step 0 — Context discovered

**Product.** BikeFit (`README.md`, `context/foundation/prd.md`). A logged-in
cyclist uploads a short side-view MP4; the **browser** loads a pose model, sends
the clip to a vision LLM for BDC/TDC keyframe timestamps, runs the pose model on a
±2-frame scan around each timestamp, computes five joint angles, sends those to a
text LLM for advice, and POSTs the result back. The server persists what the
browser posts.

**Stack (from `package.json`).**

| Dependency                                                                                   | Role                                      | Touches the domain?                                                     |
| -------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `astro` 6 (SSR), `@astrojs/react`, `react` 19                                                | app shell / islands                       | framework — out of scope                                                |
| `@astrojs/cloudflare`, `wrangler`                                                            | deploy target (Workers)                   | infra — out of scope (but see `infrastructure.md:72,108`)               |
| `@supabase/ssr`, `@supabase/supabase-js`                                                     | auth + Postgres + RLS client              | **yes** — candidate **L-2**                                             |
| `@tensorflow-models/pose-detection`                                                          | browser pose estimation (MoveNet)         | **yes** — candidate **L-1**                                             |
| `@tensorflow/tfjs-core`, `@tensorflow/tfjs-backend-cpu`, `@tensorflow/tfjs-converter`        | TF.js runtime for the above               | **yes** — pulled in with L-1                                            |
| `@mediapipe/tasks-vision` `^0.10.35`                                                         | **abandoned** pose backend (`lessons.md`) | **yes** — declared at `package.json:25`, **imported nowhere in `src/`** |
| `zod` 4                                                                                      | request/response validation               | partially — candidate **L-4**                                           |
| OpenRouter (no SDK — raw `fetch` in `llm.ts`)                                                | vision + text LLM                         | **yes** — candidate **L-3**                                             |
| `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-slot` | UI utilities                              | out of scope                                                            |

**Layers where logic lives** (condensed from [[01-domain-distillation]] Step 0):

| Layer           | Where                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Persistence     | `supabase/migrations/*.sql`                                                                                        |
| Services        | `src/lib/services/` — `llm.ts`, `rate-limit.ts`, `supabase-admin.ts`                                               |
| Pure helpers    | `src/lib/` — `pose/angles.ts`, `angle-verdict.ts`, `recommendations-prompt.ts`, `schemas.ts`, `llm-response.ts`, … |
| API routes      | `src/pages/api/**`                                                                                                 |
| SSR pages       | `src/pages/**/*.astro`                                                                                             |
| Client pipeline | `src/components/VideoAnalyzer.tsx`, `VideoUpload.tsx`                                                              |

**Declarations that a component is meant to stay swappable** (the strong signal —
Step 2 axis c):

| #   | Where                                                             | Quote                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1 | `prd.md:73` (FR-005)                                              | _"System detects body keypoints from video using a **third-party pose estimation tool**."_                                                                                                       |
| S-2 | `prd.md:74` (FR-005 Socrates)                                     | _"own pose estimation is explicitly out of scope… **Tool accuracy on cycling video should be validated against the ±10° success criterion before committing to a specific service**."_           |
| S-3 | `prd.md:115` (Non-Goals)                                          | _"**No own pose estimation or keypoint detection.** The system integrates a **third-party pose estimation service**…"_                                                                           |
| S-4 | `prd.md:130` (**Open Question #3**, `Block: yes`, **unresolved**) | _"**Which third-party pose estimation tool/API will be used?** The chosen service must be validated for accuracy on side-view cycling video **before committing**."_                             |
| S-5 | `prd.md:126` (**Open Question #1**, `Block: yes`)                 | min video duration _"should be validated against **the chosen pose estimation tool's accuracy requirements**."_                                                                                  |
| S-6 | `lessons.md:19-24`                                                | _"Prefer TF.js CPU backend over MediaPipe…"_ + _"Always load TF.js packages via dynamic `import()` **to keep them out of the Cloudflare Workers SSR bundle**."_                                  |
| S-7 | `src/lib/pose/angles.ts:11-12`                                    | _"the 3-D signatures are kept as **future-proofing for a depth-capable model**."_                                                                                                                |
| S-8 | `src/lib/pose/angles.ts:14-16`                                    | _"The '33-slot / MediaPipe BlazePose' framing… is **archaeology** — the project pivoted MediaPipe → MoveNet — but the slot indices are **a hard contract every downstream reader depends on**."_ |
| S-9 | `infrastructure.md:108` (Risk Register, stated for Cloudflare)    | _"**Encapsulate all Cloudflare-specific code… behind thin service interfaces from day one.**"_ — the same ACL principle the codebase already knows it should apply.                              |

The pose library is the **only** runtime dependency the requirements explicitly
frame as _a vendor to be chosen and validated_ — and that choice (**OQ #3**) is
**still open**. The project has already swapped this dependency once
(MediaPipe → MoveNet, `lessons.md:19`).

---

## Step 1 — Leaking dependencies identified

For each candidate: every file that "knows" it today, verified `file:line`.

### L-1 — `@tensorflow-models/pose-detection` (+ the vestigial `@mediapipe/tasks-vision` shape)

**Direct knowledge:**

| File:line                                          | What it knows                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/pose/angles.ts:1`                         | `import type * as poseDetection from "@tensorflow-models/pose-detection"` — in the **pure-helper layer** (`src/lib/`, "no I/O" per `CLAUDE.md` → _Services/helpers_)                                                                                              |
| `src/lib/pose/angles.ts:152`                       | `export function convertKeypoints(keypoints: poseDetection.Keypoint[]): PoseLandmark[]` — **vendor type in an exported helper signature**                                                                                                                         |
| `src/lib/pose/angles.ts:86-91`                     | `interface PoseLandmark { x; y; z; visibility? }` — a hand-rebuild of MediaPipe BlazePose's landmark record (`z` + `visibility`), **not** MoveNet's actual `Keypoint` (`{ x, y, score, name? }`)                                                                  |
| `src/lib/pose/angles.ts:74-78`                     | `COCO_LEFT = [5,7,9,11,13,15]`, `COCO_RIGHT = [6,8,10,12,14,16]` — MoveNet/COCO-17 index convention                                                                                                                                                               |
| `src/lib/pose/angles.ts:84`                        | `MP_SLOTS = [11,13,15,23,25,27]` — the **second, competing** vendor convention (BlazePose 33-slot)                                                                                                                                                                |
| `src/lib/pose/angles.ts:147-165`                   | `convertKeypoints` — its whole reason to exist is bridging COCO-17 → 33-slot; hardcodes `z: 0` (`angles.ts:158-162`)                                                                                                                                              |
| `src/lib/pose/angles.ts:141-145`                   | `visible()` gates on a hardcoded `0.5` — a **model-specific score threshold** in the "pure" layer                                                                                                                                                                 |
| `src/components/VideoAnalyzer.tsx:2`               | `import type * as poseDetection from "@tensorflow-models/pose-detection"`                                                                                                                                                                                         |
| `src/components/VideoAnalyzer.tsx:84`              | `detector: poseDetection.PoseDetector` parameter                                                                                                                                                                                                                  |
| `src/components/VideoAnalyzer.tsx:131`             | `let detector: poseDetection.PoseDetector`                                                                                                                                                                                                                        |
| `src/components/VideoAnalyzer.tsx:134-143`         | `import("@tensorflow/tfjs-core")`, `import("@tensorflow-models/pose-detection")`, `import("@tensorflow/tfjs-backend-cpu")`, `tfCore.setBackend("cpu")`, `pd.createDetector(pd.SupportedModels.MoveNet, { modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING })` |
| `src/components/VideoAnalyzer.tsx:89-91`           | `detector.estimatePoses(canvas)`, `poses[0].keypoints`, `convertKeypoints(...)`                                                                                                                                                                                   |
| `src/components/VideoAnalyzer.tsx:164,188,279,284` | `detector.dispose()`                                                                                                                                                                                                                                              |
| `src/lib/pose/angles.test.ts:2,39-65,201-211`      | fixtures typed `poseDetection.Keypoint`, `mirrorKeypointsX`, `sidedKeypoints`                                                                                                                                                                                     |
| `package.json:25`                                  | `"@mediapipe/tasks-vision": "^0.10.35"` — a **declared dependency with zero imports** in `src/`                                                                                                                                                                   |

**Transitive knowledge — the leak crosses into the server bundle:**

```
src/pages/api/analyze.ts:7              ─┐
src/pages/api/sessions/[id]/recommend.ts:5 ─┤ import { …Video } from "@/lib/services/llm"
                                            ▼
src/lib/services/llm.ts:4    import { buildRecommendationsSystemPrompt } from "@/lib/recommendations-prompt"
                                            ▼
src/lib/recommendations-prompt.ts:1   import { ANGLE_REFS } from "@/lib/pose/angles"
                                            ▼
src/lib/pose/angles.ts:1     import type * as poseDetection from "@tensorflow-models/pose-detection"
```

`angles.ts` therefore sits on **both** bundle graphs — the client island
(`VideoAnalyzer.tsx`) _and_ the Cloudflare Worker (`/api/analyze`,
`/api/sessions/[id]/recommend`). Today the Worker is spared the ~1 MB of TF.js
**only** because line 1 is `import type` (erased before bundling).

**Wire-contract knowledge** — the pose pipeline's output shape travels four layers:

| File:line                                      | Carries the pose output                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts:20-26`                           | `interface BodyAngle { name; value; reference_min; reference_max; unit }`                                              |
| `src/components/VideoAnalyzer.tsx:194,222-271` | browser builds `BodyAngle[]` from `PoseLandmark` slots + stamps `reference_min/max/unit` off `ANGLE_REFS` (`:224-227`) |
| `src/lib/schemas.ts:13-19,27,34`               | `bodyAngleSchema`, `body_angles` in `recommendRequestSchema` / `resultsPayloadSchema`                                  |
| `src/pages/api/sessions/[id]/recommend.ts:64`  | `generateRecommendations(parsed.data.body_angles)`                                                                     |
| `src/lib/services/llm.ts:134`                  | `generateRecommendations(angles: BodyAngle[])`                                                                         |
| `src/pages/api/sessions/[id]/results.ts:62`    | `admin.from("analysis_results").insert({ body_angles: payload.body_angles, … })`                                       |
| `src/pages/sessions/[id].astro:47,60-64`       | SSR reads `body_angles`, recomputes the in/out-of-range verdict from the **persisted** bands                           |

### L-2 — `@supabase/ssr` + `@supabase/supabase-js`

Files that know it (verified `grep`):

- `src/lib/supabase.ts:1` — `createServerClient`, `parseCookieHeader`
- `src/lib/services/supabase-admin.ts:1` — `createClient` (service_role factory — **duplicated config** vs. `supabase.ts`)
- `src/middleware.ts:2,7,11` — `supabase.auth.getUser()`
- `src/env.d.ts:3` — `App.Locals.user: import("@supabase/supabase-js").User | null`
- `src/lib/services/rate-limit.ts:1,23` — `SupabaseClient` as a **parameter type** on a domain-ish port
- API routes: `analyze.ts:3-4,24,48,59`, `sessions/index.ts:2,28-32`, `sessions/[id].ts:2-3,13,21,46,58,74-79`, `sessions/[id]/start.ts:2-3,13,21,38-47`, `sessions/[id]/recommend.ts:2-3,19,28,36`, `sessions/[id]/results.ts:3-4,27,34,52,59,73,89`, `auth/{signin,signup,signout}.ts` — each hand-rolls `createClient(...)`, `.from("fitting_sessions")`, `.eq("user_id", …)`, a `status !== "processing"` guard
- SSR pages: `sessions/index.astro:4,11,19`, `sessions/[id].astro:5,11,19,46`
- `src/types.ts:1-35` — `FittingSession` / `AnalysisResult` are **snake_case DB rows** (`video_r2_key`, `created_at`, `updated_at`) surfacing as the domain entities
- 9 test files import `SupabaseClient` / `User`

Breadth: **4 layers, ~15 production files.** **But** [[02-invariant-aggregate-refactor]]
§4.4 already designs `FittingSessionRepository` + `SupabaseFittingSessionRepository`

- the `advance_fitting_session` RPC as the ACL for the `fitting_sessions` /
  `analysis_results` slice — the largest part of this surface is already spoken for.
  The residual (auth `User`, the two client factories, `SupabaseClient` as a param
  type) is real but is a **doc-02 addendum**, not a fresh finding.

### L-3 — OpenRouter (raw `fetch`, no SDK)

- `src/lib/services/llm.ts:8-15,36-46,48-131,133-196` — `VISION_MODEL`/`TEXT_MODEL` string constants, `OPENROUTER_URL`, `OpenRouterEnvelope` (**local** interface), request/response shapes
- `src/lib/llm-response.ts` — `stripJsonFence`, `timestampListSchema` (parses `message.content`)
- Wire leak: `raw_llm_response` (`types.ts:33`, `schemas.ts:35`, `results.ts:63`, `analysis_results` column) — an OpenRouter-completion concept persisted and shipped to the client

`llm.ts` is **already an adapter** (single file, fixed-string errors, local
envelope type, model IDs behind constants). The leak is the missing _port
interface_ and the `raw_llm_response` wire concept — a much smaller job than L-1.

### L-4 — `zod`

`src/lib/schemas.ts`, `src/lib/llm-response.ts`, `src/lib/services/llm.ts:2`,
`src/pages/api/analyze.ts:2`, `sessions/index.ts:5`, `sessions/[id]/results.ts:2`,
`sessions/[id]/recommend.ts:7` — 7 files, 3 layers. This is **ubiquitous
validation glue**, not a domain vendor; `zod` schemas _are_ the wire-contract
definition. Not an ACL target. Noted for completeness.

---

## Step 2 — Classification, and the #1 pick

| Axis                                                            | L-1 pose                                                                                                                                                                      | L-2 Supabase                                                            | L-3 OpenRouter                            | L-4 zod                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- | --------------------------- |
| **(a) layers / files touched**                                  | 3 direct files + transitive server graph + a 4-layer wire contract (`BodyAngle`)                                                                                              | **4 layers, ~15 files** (raw largest)                                   | 2 files + `raw_llm_response` wire concept | 7 files / 3 layers          |
| **(b) cost / risk of swapping today**                           | **High & live** — OQ #3 unresolved; the 33-slot "hard contract every downstream reader depends on" (`angles.ts:16`) is indexed at 5 call sites in `VideoAnalyzer.tsx:221-271` | **Highest** — auth + DB + RLS; a swap means re-deriving RLS in app code | Low — already isolated in one file        | Low — but no reason to swap |
| **(c) docs declare it replaceable (intent-vs-code divergence)** | **Strongest in the repo** — S-1…S-8; OQ #3 open+blocking; already swapped once                                                                                                | Weak — general lock-in awareness only (`infrastructure.md:72,108`)      | Implicit ("using an LLM", FR-007)         | None                        |
| **already being addressed?**                                    | **No** — untouched by [[01-domain-distillation]] / [[02-invariant-aggregate-refactor]]                                                                                        | **Yes** — doc 02 §4.4 owns the main slice                               | No                                        | n/a                         |

### #1 pick — **L-1, the pose-estimation library**. Why:

1. **Axis (c) is decisive and unique.** L-1 is the _only_ dependency the PRD
   frames as "a third-party service to be chosen and validated" (S-1, S-3), and
   that choice is an **open, blocking question** (S-4). The project already
   executed one swap of this exact dependency (MediaPipe → MoveNet). Intent
   ("integrate a third-party service", "future-proof for a depth-capable model")
   versus code (the vendor's `Keypoint` type in a `src/lib/` helper signature; a
   React component orchestrating `createDetector` / `estimatePoses` / `dispose`
   inline) is the widest gap in the codebase.

2. **The dangerous leak the brief asks for is present here.** A **browser-only ML
   library** (`lessons.md:22`: _"static imports also break Cloudflare Workers SSR
   at module-evaluation time"_) is **named in a module that two API routes import
   transitively** (`angles.ts` ← `recommendations-prompt.ts` ← `llm.ts` ←
   `analyze.ts` / `recommend.ts`). It is inert today only because the import is
   `import type`. `angles.ts` also _exports a runtime function_
   (`convertKeypoints`) whose signature references the vendor namespace — one
   `import type` → `import` edit (e.g. to read `poseDetection.SupportedModels`)
   silently ships TF.js into the Worker and fails at module-eval with an obscure
   message. This is a _latent_ leak, not a live bug — but it is exactly the class
   `lessons.md` was written to prevent.

3. **Axis (a) is closer than the raw file count suggests.** L-2 touches more
   files, but (i) doc 02 already carries its ACL, and (ii) L-1's true blast
   radius is the two direct files **plus** the transitive server-bundle edge
   **plus** the `BodyAngle` wire contract that crosses client → API → DB → SSR
   (`types.ts:20` → `VideoAnalyzer.tsx:194` → `recommend.ts:64` →
   `results.ts:62` → `sessions/[id].astro:61`).

4. **Genuine duplication.** Two competing vendor coordinate conventions live
   side by side (`COCO_*` and `MP_SLOTS`), joined by a function that exists only
   to translate between them; a landmark record type re-derived from an
   _abandoned_ vendor; a model-specific confidence threshold in the "pure" layer;
   and a package (`@mediapipe/tasks-vision`) still in `package.json` whose data
   shape outlived its code.

Supabase (L-2) is acknowledged as the larger raw surface and is handled as an
**addendum** in Step 6.4; OpenRouter (L-3) is already close to an adapter; zod
(L-4) is acceptable ubiquitous use.

---

## Step 3 — Diagnosis of L-1

### 3.1 Duplication (verified quotes)

**Two vendor conventions, one bridge function.**

```
src/lib/pose/angles.ts:74   export const COCO_LEFT  = [5, 7, 9, 11, 13, 15] as const;
src/lib/pose/angles.ts:78   export const COCO_RIGHT = [6, 8, 10, 12, 14, 16] as const;
src/lib/pose/angles.ts:84   export const MP_SLOTS   = [11, 13, 15, 23, 25, 27] as const;
```

`convertKeypoints` (`angles.ts:147-165`) does nothing but map the first
convention onto the second:

```
src/lib/pose/angles.ts:157   const landmarks: PoseLandmark[] = Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 0 }));
src/lib/pose/angles.ts:160   MP_SLOTS.forEach((mpIdx, k) => { const kp = keypoints.at(cocoSide[k]); if (kp) landmarks[mpIdx] = { x: kp.x, y: kp.y, z: 0, visibility: kp.score ?? 0 }; });
```

Every downstream reader then indexes the 33-slot array by raw number —
`wl[11]` (shoulder), `wl[23]` (hip), `wl[25]` (knee), `wl[27]` (ankle):

```
src/components/VideoAnalyzer.tsx:221   if (visible(wl[23]) && visible(wl[25]) && visible(wl[27])) { … jointAngle(wl[23], wl[25], wl[27]) … }
src/components/VideoAnalyzer.tsx:230   if (visible(wl[11]) && visible(wl[23])) { … computeTorsoAngle(wl) … }
src/components/VideoAnalyzer.tsx:239   if (visible(wl[11]) && visible(wl[13]) && visible(wl[15])) { … jointAngle(wl[11], wl[13], wl[15]) … }
src/components/VideoAnalyzer.tsx:253   … jointAngle(wl[23], wl[25], wl[27]) …   // TDC knee
src/components/VideoAnalyzer.tsx:262   … jointAngle(wl[11], wl[23], wl[25]) …   // hip
src/lib/pose/angles.ts:134            export function computeTorsoAngle(wl: PoseLandmark[]): number { const dy = wl[11].y - wl[23].y; … }
```

**A landmark type re-derived from the wrong vendor.** The real MoveNet keypoint
(verified against the `@tensorflow-models/pose-detection` docs) is
`{ x: number; y: number; score?: number; name?: string }` — **2-D, no depth**.
The code instead models MediaPipe BlazePose's record:

```
src/lib/pose/angles.ts:86   export interface PoseLandmark { x: number; y: number; z: number; visibility?: number; }
```

`z` is always `0` in practice (`angles.ts:158-162`, and the module doc
`angles.ts:10-12` confirms it); `score` is renamed to `visibility` on the way
in. `jointAngle` then carries a dead `z`-term through every dot product and
magnitude (`angles.ts:104-108`).

**A model-specific threshold in the pure layer.**

```
src/lib/pose/angles.ts:143   export function visible(lm: PoseLandmark | undefined): boolean { return (lm?.visibility ?? 0) >= 0.5; }
```

The vendor docs are explicit that _"confidence values are not standardized
across models, so experimentation may be needed to find optimal thresholds"_ —
`0.5` is a MoveNet-tuning constant, not a domain rule.

**Dead weight.** `package.json:25` still declares `@mediapipe/tasks-vision`
`^0.10.35`; `grep -rn "@mediapipe" src/` returns **nothing**. The 3-D
"future-proofing" (S-7) future-proofs toward _one specific abandoned vendor's
shape_, not toward a domain abstraction.

### 3.2 Boundary leaks

| Leak                                               | Evidence                                                                                                                                 | Why it matters                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vendor type in the pure-helper layer**           | `angles.ts:152` — `convertKeypoints(keypoints: poseDetection.Keypoint[])`                                                                | `CLAUDE.md` → _"pure utilities (no I/O) go in `src/lib/`"_. A pure module should not name an npm ML package in a public signature.                                                                                                                                                                                                                                                   |
| **Client-only library on the server import graph** | chain in Step 1 (L-1); `lessons.md:22-23`                                                                                                | `import type` is the only thing keeping ~1 MB of TF.js out of the Worker. Fragile by construction.                                                                                                                                                                                                                                                                                   |
| **Same module pulled into both bundles**           | `angles.ts` imported by `VideoAnalyzer.tsx:5-13` (client) _and_, transitively, by `analyze.ts` / `recommend.ts` (Worker)                 | The module that owns the vendor coupling has no side it belongs to.                                                                                                                                                                                                                                                                                                                  |
| **Vendor output shape as the wire contract**       | `BodyAngle` (`types.ts:20`) is built from `PoseLandmark` slots (`VideoAnalyzer.tsx:222-271`) and persisted verbatim (`results.ts:59-64`) | The browser also stamps `reference_min/max/unit` from its copy of `ANGLE_REFS` (`VideoAnalyzer.tsx:224-227`); the SSR read path (`sessions/[id].astro:61-64`) then judges "in range" against that client-authored copy — this is [[01-domain-distillation]] **D-09 / C-3**, re-seen here: the pose ACL should emit a _domain_ object and the bands should be joined **server-side**. |

### 3.3 Intent vs. code

| Doc says (X)                                                                                   | Code does (Y)                                                                                                                                                                                                    | Evidence                                                        |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| _"integrates a **third-party pose estimation service**"_ — an integration, i.e. behind a seam  | The vendor's `Keypoint` type is a parameter of a `src/lib/` helper; `VideoAnalyzer.tsx` calls `createDetector` / `estimatePoses` / `dispose` inline; there is **no port and no adapter module**                  | `prd.md:115` vs `angles.ts:152`, `VideoAnalyzer.tsx:89-143`     |
| OQ #3 open — the tool _"must be validated… before committing"_                                 | Committed in the worst way: MoveNet specifics (`SupportedModels.MoveNet`, `movenet.modelType.SINGLEPOSE_LIGHTNING`, the 33-slot mapping, the `0.5` cutoff) are spread across a pure helper and a React component | `prd.md:130` vs `VideoAnalyzer.tsx:141-142`, `angles.ts:84,143` |
| _"keep them **out of the Cloudflare Workers SSR bundle**"_                                     | `angles.ts` — a module on the SSR import graph — is the module that names the package                                                                                                                            | `lessons.md:23` vs Step 1 chain                                 |
| _"3-D signatures… **future-proofing for a depth-capable model**"_                              | The chosen "future-proof" abstraction is MediaPipe BlazePose's concrete record (`{x,y,z,visibility}` + 33 slots), not a domain type                                                                              | `angles.ts:11-12` vs `angles.ts:86-91`                          |
| _"Encapsulate… behind **thin service interfaces from day one**"_ (the codebase's own ACL rule) | Not applied to the pose vendor                                                                                                                                                                                   | `infrastructure.md:108` vs all of the above                     |

---

## Step 4 — ACL design

Three pieces: a **domain value object** (`RiderPose`) that is the single home of
knowledge about "the shape of a detected pose"; a **narrow port**
(`PoseDetector`); a **vendor adapter** (`MoveNetPoseDetector`) that is the only
file allowed to import `@tensorflow-models/pose-detection`.

### 4.1 Domain value object — `RiderPose`

Lives in `src/lib/domain/rider-pose.ts` (aligning with [[02-invariant-aggregate-refactor]]
§5.4, which puts domain types under `src/lib/domain/`). **Pure. Zero I/O. Zero
vendor import.** Speaks _named joints_, not slot indices; 2-D image-plane points;
an explicit confidence.

```ts
// src/lib/domain/rider-pose.ts

export type Joint = "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle";

/** Image-plane pixels: +x rightward, +y downward. No depth — see §4.4. */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

interface Detected {
  readonly at: Point2D;
  readonly confidence: number;
}

export class RiderPose {
  static readonly MIN_CONFIDENCE = 0.5; // domain default; a port caller MAY override

  private constructor(private readonly joints: ReadonlyMap<Joint, Detected>) {}

  /** The ONLY constructor. Adapters hand in whichever joints they resolved. */
  static fromSideView(joints: Partial<Record<Joint, Detected>>, minConfidence = RiderPose.MIN_CONFIDENCE): RiderPose;

  /** Replaces `visible()`. */
  has(j: Joint, minConfidence?: number): boolean;

  point(j: Joint): Point2D | null; // null when absent or below threshold

  // ---- domain operations: the only angle math any caller sees ----

  /** Included angle a–vertex–c in degrees (180 = straight limb, 0 = folded).
   *  `null` when any of the three joints is missing/low-confidence OR two of the
   *  points coincide — fixes the documented NaN bug (`angles.test.ts:142-145`). */
  includedAngle(a: Joint, vertex: Joint, c: Joint): number | null;

  /** Hip→shoulder line vs. horizontal, folded to an acute [0,90] angle,
   *  direction-agnostic (current `computeTorsoAngle` semantics). `null` if
   *  hip or shoulder is unavailable. */
  torsoFromHorizontal(): number | null;
}
```

Pseudocode for the two operations (the arithmetic is lifted verbatim from
`jointAngle` / `computeTorsoAngle`, minus the dead `z` term):

```
includedAngle(a, vertex, c):
    pa, pv, pc = point(a), point(vertex), point(c)
    if any is null: return null
    ba = pa - pv ;  bc = pc - pv
    if |ba| == 0 or |bc| == 0: return null           # coincident → was NaN
    return acos( clamp(dot(ba,bc) / (|ba|*|bc|), -1, 1) ) * 180/π

torsoFromHorizontal():
    ps, ph = point("shoulder"), point("hip")
    if ps is null or ph is null: return null
    return atan2( |ps.y - ph.y|, |ps.x - ph.x| ) * 180/π
```

### 4.2 Measurement mapper — `BodyAngleSet` (adjacency, not the core target)

`RiderPose` produces **angles**; turning a `(bdc, tdc)` pair into the five
persisted `BodyAngle`s — _joined to server-side `ANGLE_REFS`_ — belongs in a
small domain builder:

```ts
// src/lib/domain/body-angle-set.ts
export function measureBodyAngles(input: { bdc: RiderPose | null; tdc: RiderPose | null }): BodyAngle[];
//  KNEE_BDC  = bdc.includedAngle("hip","knee","ankle")
//  TORSO     = bdc.torsoFromHorizontal()
//  ELBOW     = bdc.includedAngle("shoulder","elbow","wrist")
//  KNEE_TDC  = tdc.includedAngle("hip","knee","ankle")
//  HIP       = tdc.includedAngle("shoulder","hip","knee")
//  each: skip if null; reference_min/max/unit ← ANGLE_REFS (server copy), never the client's
```

This is where [[01-domain-distillation]] **#2 (the angle/verdict trust boundary)**
plugs in: once the server builds `BodyAngle` from `ANGLE_REFS`, the browser stops
stamping bands (`VideoAnalyzer.tsx:224-227`) and the SSR verdict
(`sessions/[id].astro:63`) is trustworthy. Fully designing that is doc 01/02
territory; this document only needs it to exist as the consumer of `RiderPose`.

### 4.3 The narrow port — `PoseDetector`

```ts
// src/lib/services/pose-detector.ts        (domain-facing; no vendor import)
import type { RiderPose } from "@/lib/domain/rider-pose";

export interface PoseDetector {
  init(): Promise<void>; // load model / open session
  detect(frame: CanvasImageSource): Promise<RiderPose | null>; // one still frame → one rider (null = nobody found)
  dispose(): void;
}

export function makePoseDetector(): PoseDetector; // factory — the ONE switch point
```

Three methods. No `Keypoint`, no `PoseDetector` (the vendor's), no
`SupportedModels`. The ±2-frame scan and BDC/TDC extremum selection
(`pickExtremumFrame`, `angles.ts:185`) move to a vendor-free domain helper:

```ts
// src/lib/domain/keyframe-selector.ts
export function pickExtremumPose(candidates: RiderPose[], type: "BDC" | "TDC"): RiderPose | null;
//  BDC → max includedAngle("hip","knee","ankle"); TDC → min; strict >/<; earliest wins a tie
//  (byte-for-byte with today's pickExtremumFrame, RiderPose in place of PoseLandmark[])
```

### 4.4 Vendor adapter — `MoveNetPoseDetector`

```ts
// src/lib/services/pose-detector.movenet.ts
//   ── the ONLY module in the repo that imports @tensorflow-models/pose-detection ──
import type * as poseDetection from "@tensorflow-models/pose-detection";
import { RiderPose, type Joint } from "@/lib/domain/rider-pose";
import type { PoseDetector } from "./pose-detector";

// COCO-17 indices — the vendor's convention lives HERE and nowhere else.
const COCO: Record<"left" | "right", Record<Joint, number>> = {
  left: { shoulder: 5, elbow: 7, wrist: 9, hip: 11, knee: 13, ankle: 15 },
  right: { shoulder: 6, elbow: 8, wrist: 10, hip: 12, knee: 14, ankle: 16 },
};
const MOVENET_MIN_SCORE = 0.5; // model-specific; not standardized across models

export class MoveNetPoseDetector implements PoseDetector {
  #detector?: poseDetection.PoseDetector;

  async init(): Promise<void> {
    const [tfCore, pd] = await Promise.all([
      import("@tensorflow/tfjs-core"),
      import("@tensorflow-models/pose-detection"),
    ]);
    await import("@tensorflow/tfjs-backend-cpu");
    await tfCore.setBackend("cpu");
    await tfCore.ready();
    this.#detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
      modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
    });
  }

  async detect(frame: CanvasImageSource): Promise<RiderPose | null> {
    const poses = await this.#detector!.estimatePoses(frame);
    if (!poses.length) return null;
    return this.#toRiderPose(poses[0].keypoints);
  }

  dispose(): void {
    this.#detector?.dispose();
  }

  // COCO-17 → RiderPose. Picks the higher-confidence body side (tie → left),
  // maps 6 joints, drops the other 11 keypoints. No 33-slot array, no `z`.
  #toRiderPose(kps: poseDetection.Keypoint[]): RiderPose {
    const score = (i: number) => kps[i]?.score ?? 0;
    const sum = (side: Record<Joint, number>) => Object.values(side).reduce((s, i) => s + score(i), 0);
    const side = sum(COCO.left) >= sum(COCO.right) ? COCO.left : COCO.right;

    const joints: Partial<Record<Joint, { at: { x: number; y: number }; confidence: number }>> = {};
    for (const j of Object.keys(side) as Joint[]) {
      const kp = kps[side[j]];
      if (kp) joints[j] = { at: { x: kp.x, y: kp.y }, confidence: kp.score ?? 0 };
    }
    return RiderPose.fromSideView(joints, MOVENET_MIN_SCORE);
  }
}
```

### 4.5 Open questions resolved from the vendor contract

Per the brief: resolve library-contract-dependent questions from the docs, and
say **where to encode the decision** (in the ACL, not the API layer).

| Question                                                | Resolution (from `@tensorflow-models/pose-detection` docs)                                                                                                                                               | Where to encode                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ #3 dependency** — what shape does the tool return? | MoveNet `Keypoint` = `{ x, y, score, name? }` — **2-D pixels, COCO-17, no `keypoints3D`** (only BlazePose returns 3-D).                                                                                  | `RiderPose` is 2-D **by contract** (`Point2D`). Drop the `z`/`worldLandmarks` future-proofing. If a depth model is later chosen, `Point2D → Point3D` is one edit _inside the domain_ + a new adapter — no route/schema/UI change.                                                                                                                                                                                                               |
| **OQ #1** — minimum video duration?                     | MoveNet is **stateless per frame** — no minimum sequence length, no temporal warm-up; `estimatePoses` runs on a single image and _"faster than real time"_. The pose tool imposes **no** duration floor. | The real constraint is domain: the clip must contain **≥ 1 full crank revolution** so a BDC _and_ a TDC frame both exist, plus ~2 frames of headroom for the ±0.066 s scan (`VideoAnalyzer.tsx:195`). Encode as the duration window on `FittingSession.queue()` ([[02-invariant-aggregate-refactor]] INV-10), citing this finding; retire the phantom "10 s" (D-07). The current client 2–15 s (`VideoUpload.tsx:25-26`) is a reasonable floor. |
| Confidence threshold                                    | _"not standardized across models… experimentation may be needed."_                                                                                                                                       | `RiderPose.MIN_CONFIDENCE` is the domain default; the port's `fromSideView(..., minConfidence)` lets each adapter pass its own. MoveNet keeps `0.5` **in the adapter** (`MOVENET_MIN_SCORE`).                                                                                                                                                                                                                                                   |
| Coordinate normalization                                | vendor ships `poseDetection.calculators.keypointsToNormalizedKeypoints(kps, imageSize)`.                                                                                                                 | If normalization is ever wanted, it is an **adapter** concern; `RiderPose` stays in one space (raw pixels today).                                                                                                                                                                                                                                                                                                                               |

---

## Step 5 — Proof of isolation + before / after

### 5.1 Isolation proof

Success grep (Step 6.1 has the exact command). **After** the refactor, every
token that names the vendor resolves to the adapter and its test only:

| File                                                                                | Knows the vendor **today**                                                                                                                                              | Knows it **after**                                                                                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/pose/angles.ts`                                                            | package import; `poseDetection.Keypoint` in `convertKeypoints` signature; `PoseLandmark`/`MP_SLOTS`/`COCO_*`; `z:0`; `0.5`                                              | **deleted** — geometry moves into `RiderPose`; `ANGLE_REFS` moves to `src/lib/domain/reference-angles.ts`                                         |
| `src/components/VideoAnalyzer.tsx`                                                  | `import type * as poseDetection`; `createDetector`, `SupportedModels.MoveNet`, `movenet.modelType`, `estimatePoses`, `.dispose()`, `poses[0].keypoints`, `PoseDetector` | `const detector: PoseDetector = makePoseDetector()`; `await detector.detect(canvas)` → `RiderPose`; `pickExtremumPose(...)`; **no vendor import** |
| `src/lib/recommendations-prompt.ts`                                                 | imports `ANGLE_REFS` from the module that names TF.js                                                                                                                   | imports `ANGLE_REFS` from `src/lib/domain/reference-angles.ts` — **server graph no longer transitively touches the package**                      |
| `src/pages/api/analyze.ts`, `sessions/[id]/recommend.ts`, `src/lib/services/llm.ts` | transitive (type-only, fragile)                                                                                                                                         | chain severed at `recommendations-prompt.ts`                                                                                                      |
| `src/types.ts` `BodyAngle`                                                          | de-facto pose output shape; bands client-stamped                                                                                                                        | unchanged as the wire DTO — now produced by `measureBodyAngles()` from `RiderPose` + server `ANGLE_REFS`                                          |
| `src/lib/pose/angles.test.ts`                                                       | `poseDetection.Keypoint` fixtures                                                                                                                                       | becomes `rider-pose.test.ts` — `RiderPose.fromSideView({...})` fixtures, **vendor-free**                                                          |
| `src/lib/services/pose-detector.movenet.ts`                                         | — (new)                                                                                                                                                                 | **the one allowed home**: package import + `#toRiderPose`                                                                                         |
| `package.json`                                                                      | `@tensorflow-models/pose-detection`, `@tensorflow/tfjs-*`, `@mediapipe/tasks-vision`                                                                                    | same minus `@mediapipe/tasks-vision` (Step 6.2 P7)                                                                                                |

### 5.2 Before / after for the duplicated sites

| Site                                                                                     | Before                                                                                                   | After                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COCO → 33-slot bridge                                                                    | `convertKeypoints` (`angles.ts:147-165`), ~18 lines translating **two** vendor conventions, `z:0` filler | adapter `#toRiderPose` (§4.4), COCO → `RiderPose` **directly**, ~10 lines, one convention                                                                                     |
| `VideoAnalyzer.tsx:221`                                                                  | `visible(wl[23]) && visible(wl[25]) && visible(wl[27])` then `jointAngle(wl[23], wl[25], wl[27])`        | `pose.includedAngle("hip","knee","ankle")` — returns `null` if unavailable; the builder skips it                                                                              |
| `VideoAnalyzer.tsx:230-238`                                                              | `visible(wl[11]) && visible(wl[23])` then `computeTorsoAngle(wl)`                                        | `pose.torsoFromHorizontal()`                                                                                                                                                  |
| `VideoAnalyzer.tsx:239`                                                                  | `visible(wl[11]) && visible(wl[13]) && visible(wl[15])` then `jointAngle(wl[11], wl[13], wl[15])`        | `pose.includedAngle("shoulder","elbow","wrist")`                                                                                                                              |
| `jointAngle` NaN on coincident points (`angles.test.ts:142-145`, "not fixed this phase") | returns `NaN`, callers don't guard                                                                       | `includedAngle` returns `null` — designed out                                                                                                                                 |
| `angles.ts:1` type import on the SSR graph                                               | fragile (`import type` is load-bearing)                                                                  | gone — `angles.ts` deleted; server never sees the name                                                                                                                        |
| UI verdict (`sessions/[id].astro:60-64`)                                                 | `angleVerdict(value, reference_min, reference_max)` over **client-persisted** bands                      | `measureBodyAngles` attaches the verdict computed server-side from `ANGLE_REFS`; the page renders `angle.verdict`, does no math (closes D-09 / [[01-domain-distillation]] #2) |

The UI layer receives **domain data** (`BodyAngle` with a trustworthy verdict),
never a `Keypoint`, a `PoseLandmark`, or a 33-slot array.

### 5.3 What a vendor swap touches, after the ACL

Scenario — OQ #3 resolves to a different tool (hosted API, or BlazePose, or a
depth model):

**Add / change**

- `src/lib/services/pose-detector.<vendor>.ts` — new adapter implementing `PoseDetector` (new file)
- `makePoseDetector()` — one line
- `src/lib/services/pose-detector.<vendor>.test.ts` — adapter test with that vendor's fixtures

**Not touched**

- `src/lib/domain/rider-pose.ts`, `keyframe-selector.ts`, `body-angle-set.ts`, `reference-angles.ts`
- `src/types.ts` `BodyAngle`; `src/lib/schemas.ts`
- `analysis_results` schema / RLS / any migration
- every `src/pages/api/**` route; every `src/pages/**/*.astro` page
- `src/components/VideoAnalyzer.tsx` (unless the model's _frame input_ type differs — then one call site)

**Edge cases the port already absorbs**

- _Depth-capable model_: change `Point2D → Point3D` in `rider-pose.ts`; `includedAngle` already computes a 3-D dot product; adapters map `z`. One domain edit, not a cross-cutting one.
- _Server-side hosted API_: the port shape becomes `detect(frame: Uint8Array)` and gains a call site in an API route — still no change to `RiderPose`, geometry, or persistence. (An honest caveat: client→server is a bigger move than client→client, because a frame must now leave the browser — a privacy-guardrail decision, `prd.md:38` — but the _ACL_ holds.)

---

## Step 6 — Verification and phased plan

### 6.1 Success criterion (grep)

```bash
grep -rnE '@tensorflow|@mediapipe|SupportedModels|movenet|estimatePoses|\bKeypoint\b|PoseLandmark|MP_SLOTS' src/
```

**Expected after the refactor** — matches only:

- `src/lib/services/pose-detector.movenet.ts`
- `src/lib/services/pose-detector.movenet.test.ts`

(`package.json` still lists the dependency — that is correct; it is used, just
from one module.) Every other file resolves `PoseDetector` (port) and `RiderPose`
(domain).

**Files that know the vendor today → after:**

| Today (8 `src/` files)                                                                                                                                                                                                                                                                                                                                     | After (2 `src/` files)                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `lib/pose/angles.ts`, `lib/pose/angles.test.ts`, `components/VideoAnalyzer.tsx`, `lib/recommendations-prompt.ts` (transitive), `lib/services/llm.ts` (transitive), `pages/api/analyze.ts` (transitive), `pages/api/sessions/[id]/recommend.ts` (transitive), + the `BodyAngle` wire contract in `types.ts`/`schemas.ts`/`results.ts`/`sessions/[id].astro` | `lib/services/pose-detector.movenet.ts`, `lib/services/pose-detector.movenet.test.ts` |

### 6.2 Phased refactor plan

The project is **test-first** (`test-plan.md` §1; Vitest; lefthook runs
`vitest related` + full `tsc --noEmit` pre-commit; StrykerJS on selected modules).
Contract-preserving throughout — the four `/api` response shapes and the SSR
markup stay byte-identical until P6.

| Phase                                                                                    | Scope                                                                                                                                                                                                                                                                                       | Test-first?                                                                                                                                                                                                          | Gate                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **P1 — Domain: `RiderPose` + geometry**                                                  | `src/lib/domain/rider-pose.ts` (joints map, `has`, `includedAngle` **null-safe**, `torsoFromHorizontal`). Move `ANGLE_REFS` → `src/lib/domain/reference-angles.ts` (re-export from `angles.ts` for now). Add `rider-pose.ts` to `stryker.config.json` `mutate`.                             | **Yes** — port the oracle suite from `angles.test.ts` (straight limb = 180°, right angle = 90°, 45° torso, mirror-invariance, clamp-before-acos) onto `RiderPose` fixtures; add the coincident-points → `null` case. | `npx tsc --noEmit`, `vitest`, mutation score on the new module |
| **P2 — Domain: `KeyframeSelector` + `BodyAngleSet`**                                     | `keyframe-selector.ts` (`pickExtremumPose` over `RiderPose[]` — tie/visibility rules byte-for-byte with `pickExtremumFrame`); `body-angle-set.ts` (`measureBodyAngles({bdc,tdc})` joining server `ANGLE_REFS`).                                                                             | **Yes** — re-express the existing `pickExtremumFrame` cases (`angles.test.ts:276-346`); new cases for `measureBodyAngles` (missing joint → angle skipped; bands come from `ANGLE_REFS`).                             | `vitest`, `tsc`                                                |
| **P3 — Port + adapter**                                                                  | `src/lib/services/pose-detector.ts` (interface + `makePoseDetector`); `src/lib/services/pose-detector.movenet.ts` (`#toRiderPose` = today's side-pick + mapping, minus the 33-slot detour; dynamic imports retained; `0.5` as `MOVENET_MIN_SCORE`).                                         | **Yes** — adapter test with recorded `Keypoint[]` fixtures: the mirror-invariance, side-pick, exact-tie, and missing-keypoint cases (`angles.test.ts:198-273`) move here.                                            | `vitest`, `tsc`, `lint`                                        |
| **P4 — Rewire the client pipeline**                                                      | `VideoAnalyzer.tsx`: `detectPoseAt` → `detector.detect(canvas)`; Step-2 block → `detector.init()`; Step-5 loop consumes `RiderPose`; delete `import type * as poseDetection`, `convertKeypoints`, direct `ANGLE_REFS` slot reads. Output `BodyAngle[]` unchanged (via `measureBodyAngles`). | Component/e2e: `testing-quality-gates-e2e-smoke` must stay green; add a unit test that a `RiderPose` pair → the same `BodyAngle[]` the old path produced for a golden fixture.                                       | e2e smoke, `tsc`, `lint`                                       |
| **P5 — Sever the server graph**                                                          | `recommendations-prompt.ts` imports `ANGLE_REFS` from `src/lib/domain/reference-angles.ts`; **delete `src/lib/pose/angles.ts`** and `angles.test.ts` (superseded by P1–P3). Run `npx astro build`; confirm the Worker bundle no longer resolves `@tensorflow-models/pose-detection`.        | grep criterion (§6.1) as a CI check; `recommendations-prompt.test.ts` stays green.                                                                                                                                   | `astro build`, grep, `vitest`                                  |
| **P6 — Server-side `BodyAngle` + verdict** (closes D-09 / [[01-domain-distillation]] #2) | `/api/sessions/[id]/recommend` and `/results` build `BodyAngle` server-side from `ANGLE_REFS` keyed by angle name; `sessions/[id].astro` renders `angle.verdict` (no `angleVerdict` call). Client stops sending `reference_min/max/unit`.                                                   | **Yes** — a session persisted with stale bands renders the _correct_ verdict; `_results.test.ts` / `_recommend.test.ts` updated.                                                                                     | `vitest`, e2e smoke                                            |
| **P7 — Cleanup**                                                                         | Remove `@mediapipe/tasks-vision` from `package.json` (verified unused). Retire the `z` / 3-D vestige from any remaining signatures. Append a `lessons.md` entry: "pose vendor lives behind `PoseDetector`; never import `@tensorflow-models/*` outside its adapter."                        | —                                                                                                                                                                                                                    | `npm i`, `tsc`, `build`                                        |

**Rollback.** P1–P3 add code without touching routes or the client → revert by
deleting files. P4 is the switchover on one component → revert that file. P5 is
mechanical (one import path + two deletions). P6 is independent of P1–P5 and can
ship separately. P7 is housekeeping.

### 6.3 New load-bearing names to register

Home: `context/domain/` (the pattern this doc series establishes) + the code
paths below.

| Name                                                                | Kind                 | Home                                        | Note                                                                                                                               |
| ------------------------------------------------------------------- | -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RiderPose`                                                         | domain value object  | `src/lib/domain/rider-pose.ts`              | the single home of "shape of a detected pose"; joints by name, 2-D, confidence                                                     |
| `Joint`                                                             | value type           | ″                                           | `"shoulder" \| "elbow" \| "wrist" \| "hip" \| "knee" \| "ankle"` — replaces `COCO_*` / `MP_SLOTS` integer indexing                 |
| `Point2D`                                                           | value type           | ″                                           | image-plane pixels; the contract that encodes "MoveNet is 2-D" (§4.5)                                                              |
| `RiderPose.includedAngle` / `torsoFromHorizontal` / `has` / `point` | domain methods       | ″                                           | the only angle math callers see; `includedAngle` is `null`-safe (kills the NaN bug)                                                |
| `pickExtremumPose`                                                  | domain function      | `src/lib/domain/keyframe-selector.ts`       | `pickExtremumFrame` over `RiderPose[]`                                                                                             |
| `measureBodyAngles`                                                 | domain function      | `src/lib/domain/body-angle-set.ts`          | `(bdc,tdc) → BodyAngle[]`, bands from server `ANGLE_REFS`                                                                          |
| `ANGLE_REFS` (relocated)                                            | constant             | `src/lib/domain/reference-angles.ts`        | moved out of `pose/angles.ts` so the server graph is vendor-free; still pinned to `context/foundation/reference-angles.md` by test |
| `PoseDetector`                                                      | **port** (interface) | `src/lib/services/pose-detector.ts`         | `init` / `detect(frame) → RiderPose \| null` / `dispose` — no vendor types                                                         |
| `makePoseDetector`                                                  | factory              | ″                                           | the single switch point for OQ #3                                                                                                  |
| `MoveNetPoseDetector`                                               | **adapter**          | `src/lib/services/pose-detector.movenet.ts` | the ONLY module importing `@tensorflow-models/pose-detection`; owns `COCO`, `MOVENET_MIN_SCORE`, the dynamic-import dance          |

### 6.4 Not in scope (and why)

- **L-2 Supabase** — [[02-invariant-aggregate-refactor]] §4.4 already designs
  `FittingSessionRepository` + `SupabaseFittingSessionRepository` +
  `advance_fitting_session`, the ACL for the `fitting_sessions` /
  `analysis_results` slice. The **residual** Supabase leak — `User` from
  `@supabase/supabase-js` in `App.Locals` (`env.d.ts:3`) and every route/page;
  the two near-duplicate client factories (`supabase.ts`, `supabase-admin.ts`);
  `SupabaseClient` as a parameter type on `checkRateLimit` (`rate-limit.ts:23`) —
  is a **follow-up to doc 02**, best expressed as an `AuthenticatedUser` domain
  type + a `SessionUser` port resolved in `middleware.ts`. Sketch only; not this
  document's #1.
- **L-3 OpenRouter** — `llm.ts` is already a single-file adapter with a local
  envelope type and fixed-string errors. Worth a `RecommendationGenerator` /
  `KeyframeDetector` port and removing the `raw_llm_response` wire concept, but
  it is not a _leak across boundaries_ — it is one boundary missing an interface.
- **L-4 zod** — ubiquitous validation glue; the schemas _are_ the wire
  contract. Not corruption.

### 6.5 Constraints honored

- **No production code changed by this document** — design only.
- Every `file:line` verified against `master` @ `5b42fd0`.
- Vendor-contract claims (§4.5) verified against the
  `@tensorflow-models/pose-detection` documentation (Context7, 2026-09-06):
  MoveNet returns 17 COCO keypoints `{x, y, score, name?}`, no `keypoints3D`;
  only BlazePose returns 33 keypoints + 3-D; confidence thresholds are not
  standardized across models; MoveNet runs per-frame with no sequence
  requirement.
- Fail-fast: `includedAngle` / `torsoFromHorizontal` return `null` (not `NaN`,
  not a silent `0`) on unusable input; `detect` returns `null` when no rider is
  found; the adapter never swallows a TF.js init error (surfaced to the pipeline
  exactly as today, `VideoAnalyzer.tsx:144-147`).
- `context/archive/` is not written.

---

## Summary

BikeFit's worst anti-corruption failure is the **browser pose-estimation
library** (`@tensorflow-models/pose-detection`). It is the only runtime
dependency the PRD explicitly frames as a _third-party service to be chosen and
validated_ (FR-005, Non-Goals), the choice is still an **open, blocking question**
(OQ #3), and the project has already swapped it once (MediaPipe → MoveNet) — yet
the vendor's `Keypoint` type sits in an exported signature in the _pure-helper_
layer (`src/lib/pose/angles.ts:152`), MoveNet setup is orchestrated inline in a
React component, and an **abandoned** vendor's data shape (MediaPipe BlazePose's
33-slot `{x,y,z,visibility}` record) is still the lingua franca of every angle
function, with `@mediapipe/tasks-vision` declared in `package.json` but imported
nowhere. The most dangerous strand: `angles.ts` is on the **Cloudflare Worker
import graph** (`analyze.ts` / `recommend.ts` → `llm.ts` →
`recommendations-prompt.ts` → `angles.ts`), inert today only because line 1 is
`import type` — exactly the failure class `lessons.md` was written to prevent.
The fix is a domain value object **`RiderPose`** (named joints, 2-D points,
null-safe angle operations — which also designs out the documented `jointAngle`
NaN bug), a three-method port **`PoseDetector`**, and a single adapter
**`MoveNetPoseDetector`** that is the only module allowed to import the package;
the BDC/TDC scan and the `BodyAngle` build move to vendor-free domain helpers,
and `ANGLE_REFS` relocates to `src/lib/domain/` so the server graph stops
touching TF.js entirely. After a seven-phase, test-first, contract-preserving
rollout, `grep -rnE '@tensorflow|@mediapipe|Keypoint|MP_SLOTS' src/` resolves to
the adapter and its test only, and answering OQ #3 becomes a one-line change to a
factory plus one new adapter file — no route, schema, migration, or page is
touched. The vendor-contract facts needed to close OQ #1 and OQ #3 (MoveNet is
2-D COCO-17, stateless per frame, no minimum clip length) are resolved from the
library docs and belong in the adapter and the `FittingSession` duration window,
never in an API route.
