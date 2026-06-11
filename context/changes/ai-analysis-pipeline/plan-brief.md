# AI Analysis Pipeline — Plan Brief

> Full plan: `context/changes/ai-analysis-pipeline/plan.md`
> Research: `context/changes/ai-analysis-pipeline/research.md`
> Reference angles: `context/changes/ai-analysis-pipeline/bike-fitting-ref-angles.md`
> Adjustment guide: `context/changes/ai-analysis-pipeline/angle-to-adjustment-guide.md`

## What & Why

S-02 is the north star slice: the product hypothesis (consumer video + off-the-shelf AI = usable gravel bike fitting guidance) lives entirely here. The plan wires up the full browser-side pipeline that converts an uploaded cycling video into structured fitting recommendations stored in Supabase. F-01 and F-02 are both done — the schema, job lifecycle endpoints, and `VideoUpload.tsx` already exist. What's missing is the analysis itself.

## Starting Point

`VideoUpload.tsx` validates and uploads a video, creates a session in Supabase (`status: queued`), and starts polling — but nothing ever changes the status. The three F-02 endpoints (`/start`, `/sessions/:id`, `/results`) are live and waiting. The codebase has all the types (`BodyAngle`, `Recommendation`, `resultsPayloadSchema`) and the admin client pattern ready. No LLM service, no MediaPipe, no analysis routes exist yet.

## Desired End State

A user uploads a 3–15s side-view cycling MP4. The browser runs the full analysis pipeline in-foreground with a step-by-step progress indicator: initialises MediaPipe WASM → extracts frames → calls a vision LLM to identify BDC/TDC keyframes → seeks to each keyframe and runs pose estimation → computes 5 joint angles → calls a text LLM for fitting recommendations → submits everything to Supabase. The session flips to `completed` and the user sees a "View fitting recommendations" link.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Pipeline executor | Browser (no server compute) | F-02 architecture established browser as worker; avoids Cloudflare Container infra for MVP | Research / F-02 |
| Pose estimation | MediaPipe WASM (`@mediapipe/tasks-vision`) | Runs in-browser with no GPU, proven in cycling apps, zero compute cost | Research |
| Keyframe pre-filter | Vision LLM via OpenRouter (Gemini 2.5 Flash) | Semantic understanding of BDC/TDC without crank-specific CV model | Research |
| LLM provider | OpenRouter (LLM-agnostic) | Swap model with one constant change; not locked to Gemini billing | Planning |
| Frame delivery | Base64 JPEG array (~1fps) → POST /api/analyze | No R2 binding needed for MVP; 15 frames ≈ 1.5 MB — within token budget | Planning |
| Seek precision | ±2-frame scan per keyframe (5 frames) | Handles codec seek imprecision in both directions; picks BDC max / TDC min knee angle | Planning |
| Angle set | Knee-BDC, knee-TDC, hip-TDC, torso, elbow (skip ankle) | 5 primary fitting angles with peer-reviewed reference ranges; ankle landmarks unreliable side-view | Planning |
| LLM output format | JSON schema in system prompt + `json_object` response format | Matches existing `resultsPayloadSchema`; reference ranges baked in prompt → low hallucination risk | Planning |
| Error UX | Per-step status + human-readable error per failure | Users know where it failed; diagnostic clarity for debugging | Planning |
| Model hosting | CDN (Google Storage) | Zero setup; browser caches after first load; 30 MB model not committed to git | Planning |

## Scope

**In scope:**
- `OPENROUTER_API_KEY` env var in astro.config.mjs
- `src/lib/services/llm.ts` — OpenRouter client with `analyzeFrames` + `generateRecommendations`
- `src/lib/schemas.ts` — two new Zod schemas for the new routes
- `POST /api/analyze` — base64 frames → labelled timestamps
- `POST /api/sessions/:id/recommend` — angles → recommendations
- `src/components/VideoAnalyzer.tsx` — 7-step browser pipeline component
- `VideoUpload.tsx` — new `analyzing` state, handoff to VideoAnalyzer, results link

**Out of scope:**
- Cloudflare Container / server-side MediaPipe (production upgrade path)
- R2 video storage (not needed while browser is the worker)
- S-03 results display page (`/sessions/:id` link is a placeholder)
- Ankle angle (landmark reliability)
- Direct Gemini API (all LLM calls go through OpenRouter)

## Architecture / Approach

```
VideoUpload.tsx
  │ creates session (POST /sessions) → { sessionId }
  │ mounts VideoAnalyzer with file + sessionId
  └─► VideoAnalyzer.tsx  [browser]
        │ POST /sessions/:id/start       → status: processing
        │ PoseLandmarker.createFromOptions(CDN WASM, heavy model)
        │ canvas.toDataURL at 1fps       → frames[]
        │ POST /api/analyze              → { timestamps: [{t, type}] }
        │ seek + ±2-frame scan (5 frames) → best frame per keyframe
        │ PoseLandmarker.detect(bitmap)  → worldLandmarks
        │ jointAngle() × 4 + atan2      → body_angles: BodyAngle[]
        │ POST /sessions/:id/recommend   → { recommendations, raw_llm_response }
        └ POST /sessions/:id/results     → status: completed
              ↑                    ↑
      /api/analyze              /sessions/:id/recommend
      [server: llm.analyzeFrames]  [server: llm.generateRecommendations]
      [OpenRouter vision model]    [OpenRouter text model + reference ranges in prompt]
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Foundation | OPENROUTER_API_KEY, llm.ts, @mediapipe/tasks-vision, 2 Zod schemas | `OPENROUTER_API_KEY` must be provisioned in `.dev.vars` before Phase 2 can be manually tested |
| 2. Server routes | POST /api/analyze + POST /sessions/:id/recommend, both with auth + Zod | OpenRouter vision format must match what Gemini 2.5 Flash expects for base64 images |
| 3. VideoAnalyzer.tsx | Full browser pipeline: 7 steps, per-step UI, angle constants, ±2-frame scan | MediaPipe WASM + model cold load is ~2–4s; ±2-frame scan adds 20–40 detect() calls |
| 4. VideoUpload.tsx integration | Handoff from upload to analyzer, results link in completed state | Current AppState union change may surface TypeScript errors in render branches |

**Prerequisites:** F-01 done ✓ · F-02 done ✓ · S-01 done ✓ · `OPENROUTER_API_KEY` from openrouter.ai  
**Estimated effort:** ~2–3 sessions across 4 phases

## Open Risks & Assumptions

- Gemini 2.5 Flash via OpenRouter accepts base64 JPEG images in the OpenAI `image_url` content-part format — unverified; check OpenRouter docs if the `/api/analyze` route returns vision errors
- LLM angle estimation accuracy against the ±10° PRD success criterion is unvalidated until Phase 3 manual testing against a reference fitting
- MediaPipe `GPU` delegate may not be available in all browsers (Safari, older iOS); a fallback to `CPU` can be added if GPU init throws
- The system prompt for `generateRecommendations` is long (~2–3k tokens); token usage per analysis is ~$0.005–0.01 at Gemini 2.5 Flash rates through OpenRouter

## Success Criteria (Summary)

- A valid side-view cycling MP4 produces an `analysis_results` row with non-empty `recommendations` and at least 3 populated `body_angles` entries
- Session status transitions cleanly `queued → processing → completed` (or `failed` on error)
- A video with no cyclist visible returns a human-readable error message and `status: failed`
