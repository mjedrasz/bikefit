---
date: 2026-05-29T00:00:00+00:00
researcher: maro
git_commit: 583c9bb7f6a109386b3c87d74d5a493e786e058d
branch: master
repository: 10x
topic: "Compatibility assessment: pose-estimation-research.md options vs. current codebase for S-02"
tags: [research, codebase, mediapipe, gemini, cloudflare-containers, ai-analysis-pipeline, s-02]
status: complete
last_updated: 2026-05-29
last_updated_by: maro
---

# Research: Compatibility Assessment — pose-estimation-research.md vs. Codebase (S-02)

**Date**: 2026-05-29  
**Researcher**: maro  
**Git Commit**: 583c9bb7f6a109386b3c87d74d5a493e786e058d  
**Branch**: master  
**Repository**: bikefit

## Research Question

Review the codebase and assess whether the options described in `pose-estimation-research.md` are
compatible with it, in the context of implementing S-02 (AI analysis pipeline) from the roadmap.

## Summary

All three pipeline options from the research doc are feasible with this stack. The **recommended
MVP path** (browser WASM MediaPipe + Gemini 2.5 Flash server route) has **no blocking
compatibility issues** — it requires npm install, one new env var, a new API route, and a React
island component. The **Cloudflare Containers path** is technically compatible (wrangler 4.90.0
supports it) but requires meaningful infra additions to `wrangler.jsonc`. The single largest
open dependency for S-02 is **F-02 (async job queue)**, whose mechanism (Cloudflare Queues vs.
Supabase polling) is not yet decided and changes what gets added to `wrangler.jsonc`.

---

## Detailed Findings

### Current Stack (baseline for compatibility)

| Layer | Reality |
|---|---|
| Framework | Astro 6.3.7, SSR (`output: "server"`), Cloudflare Workers adapter v13.5.4 |
| UI | React 19.2.6 islands, Tailwind 4, shadcn/ui (new-york) |
| Runtime | Cloudflare Workers, `compatibility_date: 2026-05-08`, `nodejs_compat` flag |
| Database | Supabase (auth wired; no domain tables yet) |
| Wrangler | 4.90.0 — supports Containers (GA 2026-04-13) |
| Bindings | Only `ASSETS` — no Queues, KV, R2, Durable Objects, or Containers declared |
| AI/ML packages | None installed |
| API routes | `src/pages/api/auth/{signin,signup,signout}.ts` — redirect-based, no Zod validation, no JSON responses yet |
| Services | No `src/lib/services/` directory exists yet |
| Types | `src/types.ts` does not exist yet; only `App.Locals` in `src/env.d.ts` |

Key source references:
- `wrangler.jsonc` — complete config, only ASSETS binding
- `package.json` — no AI/ML packages installed
- `astro.config.mjs` — server SSR, Cloudflare adapter, env schema has only `SUPABASE_URL` + `SUPABASE_KEY`
- `src/lib/supabase.ts` — factory pattern, returns `null` when env vars missing
- `src/pages/api/auth/signin.ts:1-21` — canonical API route pattern (form data, redirect responses)

---

### Option 1 — Browser WASM MediaPipe (`@mediapipe/tasks-vision`)

**Verdict: Compatible. No breaking changes to Workers config.**

WASM runs inside a React island (`client:load`) in the user's browser — it never touches
the Cloudflare Worker. Astro's `output: "server"` mode is not a constraint here; the island
hydrates in the browser and owns the `<video>` element, canvas frame extraction, and
`PoseLandmarker.detect()` calls.

| Question | Answer |
|---|---|
| Does WASM work in Astro 6 islands? | Yes. React 19 + `client:load` directive; WASM loading is browser-native. |
| Does `nodejs_compat` flag interfere? | No. That flag affects the Worker runtime, not browser JS. |
| Model files (`.task`) hosting | Either self-hosted under `dist/models/` (add to `public/models/`) or loaded from `jsdelivr.net` CDN. CDN is simplest for MVP. |
| Seek precision issue | Present (±0.5s, codec-dependent). Research doc mitigation (scan ±N frames via `requestVideoFrameCallback`) applies unchanged. |

**What needs to be added:**

1. `npm install @mediapipe/tasks-vision` — no existing package conflicts.
2. A React island component (`src/components/VideoAnalyzer.tsx`) that owns:
   - The `<video>` element + frame seek logic
   - Canvas → `ImageBitmap` → `PoseLandmarker.detect()`
   - `worldLandmarks` → `jointAngle()` calculations
3. Model file(s) served from `public/models/` or CDN reference.

---

### Option 2 — Gemini 2.5 Flash (server-side API route)

**Verdict: Compatible. Needs one new env var and one new API route.**

Cloudflare Workers can make outbound HTTP requests freely. Gemini calls are I/O-bound
(network wait), not CPU-bound, so the Workers CPU time limit is not a constraint. With
`nodejs_compat` and a paid Workers plan the 30s wall-clock limit is more than enough for
a Gemini API round-trip (~1–3s for a prompt returning timestamps).

**Critical caveat — video delivery to Gemini from the Worker:**

| Delivery approach | Feasibility | Notes |
|---|---|---|
| Browser extracts frames → sends as base64 batch → Worker → Gemini (image batch) | ✅ MVP-friendly | No R2 needed; request body ≤ 100MB limit; ~1 fps × 60s = 60 JPEG frames ≈ 5–15MB base64 |
| Worker uploads full video to Gemini File API | ⚠️ Risky | 30–60s H.264 video can be 100–500MB; exceeds Workers 100MB request body limit on the upload leg |
| Video stored in R2 → presigned URL → Gemini File API from Worker | ✅ Clean production path | Needs R2 binding added to `wrangler.jsonc`; Worker never holds full video in memory |

**MVP recommendation:** browser extracts frames at 1 fps, POSTs as base64 array to
`POST /api/analyze`, Worker calls Gemini with images. This avoids R2 entirely for the prototype.

**What needs to be added:**

1. `GEMINI_API_KEY` added to `astro.config.mjs` env schema (under `astro:env/server`) and to `.dev.vars`.
2. `src/pages/api/analyze.ts` — new POST route following existing pattern:
   - Validates auth via `context.locals.user`
   - Accepts `{ sessionId, frames: base64[] }`
   - Calls Gemini API, returns `{ timestamps: number[] }`
3. `src/lib/services/gemini.ts` — Gemini HTTP client (per CLAUDE.md: services that call external APIs go in `src/lib/services/`).

---

### Option 3 — Cloudflare Containers (Python MediaPipe server-side)

**Verdict: Technically compatible (wrangler 4.90.0 ✅), but requires significant infra additions.**

Containers went GA 2026-04-13. Wrangler 4.90.0 (installed) supports them. The current
`wrangler.jsonc` has zero container config — adding it is not a breaking change but is
non-trivial.

**What needs to be added to `wrangler.jsonc`:**

```jsonc
"containers": [
  { "name": "POSE_CONTAINER", "image": "./pose-service/Dockerfile", "max_instances": 5 }
],
"durable_objects": {
  "bindings": [{ "name": "POSE_CONTAINER", "class_name": "PoseContainer" }]
}
```

**New artifacts required:**

- `pose-service/Dockerfile` + `pose-service/app.py` (FastAPI + mediapipe + opencv-python-headless)
- A Durable Object class (`PoseContainer`) in the Worker codebase
- R2 binding for video storage (container reads video from R2 presigned URL)

**Cold start:** 1–3s (image ~300–400MB). Acceptable after first warm, but adds latency to first analysis per cold region.

**Benefit vs. browser WASM:** Frame-accurate seeks via OpenCV `CAP_PROP_POS_MSEC` —
eliminates the ±0.5s seek imprecision of `HTMLVideoElement.currentTime`.

**Recommendation:** defer to production path. For S-02 prototype, the seek imprecision
is acceptable with the scan-±N-frames mitigation from the research doc.

---

### F-02 Async Job Queue — Open Decision Affecting wrangler.jsonc

S-02 depends on F-02 (async job pipeline). The queue mechanism is not yet decided and
directly affects what gets added to `wrangler.jsonc`.

| Mechanism | wrangler.jsonc change | Complexity | Notes |
|---|---|---|---|
| **Cloudflare Queues** | Add `queues` producer + consumer binding | Medium | Event-driven, native Workers primitive; needs paid plan |
| **Supabase polling** | None | Low | Client polls a `status` column every N seconds; no new binding; works now |
| **Durable Objects** (timer-based) | Add `durable_objects` binding | High | Overkill for MVP |

Given the current minimal `wrangler.jsonc`, **Supabase polling** is the lowest-friction
F-02 implementation and unblocks S-02 without adding infra. Cloudflare Queues is the
cleaner long-term primitive and can be added in a later pass.

---

## Code References

- `wrangler.jsonc` — current bindings (ASSETS only); baseline for all additions
- `astro.config.mjs` — env schema; add `GEMINI_API_KEY` here
- `src/pages/api/auth/signin.ts:1-21` — canonical API route pattern to follow for `POST /api/analyze`
- `src/lib/supabase.ts:1-27` — factory + null-guard pattern to mirror in `src/lib/services/gemini.ts`
- `src/env.d.ts` — `App.Locals` interface; extend with session/analysis locals if needed
- `package.json` — no AI/ML packages; add `@mediapipe/tasks-vision` for browser WASM path

---

## Architecture Insights

**API route pattern:** existing routes use redirect responses and form data. For S-02,
JSON request/response bodies are more appropriate. The codebase does not have this pattern
yet — it must be introduced. Zod validation (recommended in CLAUDE.md) is also absent from
current routes and should be added for the analysis endpoints.

**Service layer:** CLAUDE.md specifies that modules calling external APIs go in
`src/lib/services/`. This directory does not exist. S-02 implementation must create it
alongside `gemini.ts` (and optionally `supabase-sessions.ts`).

**Type definitions:** `src/types.ts` does not exist. S-02 needs `FittingSession`,
`AnalysisResult`, and `PoseLandmark` types. Create `src/types.ts` as a first step.

**React island for video:** MediaPipe WASM must live in a React island with
`client:load` directive. It cannot run inside a `.astro` page's `<script>` tag because
it needs the full React component lifecycle for `useRef` on the `<video>` element.

---

## Historical Context

- `context/changes/ai-analysis-pipeline/pose-estimation-research.md` — full option analysis,
  pipeline architecture diagrams, MediaPipe API reference (Stages 1–4). This research doc
  builds directly on that work.
- `context/foundation/roadmap.md` — S-02 status: blocked on OQ-2 (gravel reference ranges)
  and OQ-3 (tool choice). This research resolves OQ-3 in favour of MediaPipe + Gemini for MVP.
- `context/foundation/roadmap.md` — F-01 status: `ready`. F-02 status: `proposed`.
  S-02 cannot start until F-01 and F-02 land.

---

## Open Questions

1. **OQ-2 (still open):** Which gravel bike angle reference ranges are authoritative? Required
   for LLM prompt engineering in S-02. Not resolved by this research.

2. **F-02 queue mechanism:** Cloudflare Queues vs. Supabase polling. This research recommends
   Supabase polling for MVP (no new binding), Cloudflare Queues as production upgrade.

3. **Video delivery to Gemini in MVP:** Browser frame extraction (base64 batch) is recommended
   for prototype. If video files exceed ~15MB in practice after frame extraction, the R2 + presigned
   URL path should be adopted — requires adding R2 binding to `wrangler.jsonc`.

4. **Model file hosting for WASM:** Self-host `pose_landmarker_heavy.task` in `public/models/`
   or reference CDN? CDN is simplest for prototype; self-hosting avoids external dependency in production.
