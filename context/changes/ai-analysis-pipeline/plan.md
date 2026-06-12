# AI Analysis Pipeline — Implementation Plan

## Overview

Implement S-02: the browser-side analysis pipeline that transforms an already-uploaded cycling
video into gravel bike fitting recommendations. The pipeline runs in four steps entirely in the
browser: extract frames → call a vision LLM (via OpenRouter) to identify keyframes → run
MediaPipe WASM pose estimation locally → call a text LLM (via OpenRouter) for fitting
recommendations → submit results to the server. The server's role is thin: two new API routes
relay frames to the LLM and relay angles to the recommendation LLM.

## Current State Analysis

F-01 (schema) and F-02 (job pipeline) are both complete. The codebase has:
- `fitting_sessions` + `analysis_results` tables with RLS (`supabase/migrations/20260526120000_initial_schema.sql`)
- All three F-02 endpoints live: `GET /sessions/:id`, `POST /sessions/:id/start`, `POST /sessions/:id/results`
- `src/types.ts` — `FittingSession`, `AnalysisResult`, `Recommendation`, `BodyAngle` types
- `src/lib/schemas.ts` — `resultsPayloadSchema`, `bodyAngleSchema`, `recommendationSchema` (all reusable)
- `src/lib/services/supabase-admin.ts` — service_role client factory
- `VideoUpload.tsx` — React island; validates MP4 (3–15s, 100 MB), creates session via `POST /sessions`, starts polling. Currently transitions to `{ kind: "completed" }` with no sessionId — no analysis happens.
- `astro.config.mjs` — env schema has `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; no AI keys

**Gaps**: no `OPENROUTER_API_KEY`, no LLM service, no video analysis routes, no MediaPipe, no `VideoAnalyzer.tsx`. Both blocking unknowns from the roadmap are now resolved (OQ-2 via `bike-fitting-ref-angles.md` + `angle-to-adjustment-guide.md`; OQ-3 via `research.md`).

## Desired End State

After a user uploads a video and a session is created (by S-01 / `VideoUpload.tsx`), a new `VideoAnalyzer.tsx` component takes over, runs the full pipeline in-browser, and submits the result to the server. The pipeline:

1. Sets the session to "processing"
2. Initialises MediaPipe PoseLandmarker (CDN WASM, heavy model)
3. Extracts ~1fps frames from the video in-browser (canvas API)
4. Sends frames to `POST /api/analyze` → vision LLM returns labelled keyframe timestamps (BDC / TDC)
5. Seeks the video to each timestamp, scans ±2 frames (5 frames centered on t), picks the best pose for each type
6. Computes 5 joint angles (knee-BDC, knee-TDC, hip-TDC, torso, elbow) from `worldLandmarks`
7. Sends angles to `POST /api/sessions/:id/recommend` → text LLM returns fitting recommendations
8. POSTs the complete result to `POST /api/sessions/:id/results` (existing F-02 endpoint)

The user sees per-step progress throughout. On completion, `VideoUpload.tsx` shows a "View fitting recommendations" link to `/sessions/:id`.

### Key Discoveries

- `VideoUpload.tsx:30-31` — `MIN_DURATION=3`, `MAX_DURATION=15`. At 1fps that means 3–15 frames to send to the vision LLM — well within token budget.
- `src/lib/schemas.ts` — `resultsPayloadSchema` discriminates on `error` field; success path is `{ recommendations, body_angles, raw_llm_response }`. Browser assembles all three before calling `/results`. No schema changes needed.
- `src/pages/api/sessions/[id]/start.ts` — already exists; rejects if session not in `queued` state; returns 409 if called twice.
- `VideoUpload.tsx:163-180` — creates session and immediately transitions to `polling` state. For S-02, this is replaced by a new `analyzing` state that mounts `VideoAnalyzer.tsx`.
- Torso angle is **not** a three-point joint angle — it's the angle of the hip→shoulder vector from horizontal. This requires `atan2` rather than the `jointAngle()` function used for other angles (see Critical Implementation Details).
- `src/lib/services/supabase-admin.ts` — pattern to follow for `llm.ts`: module-level service functions, env vars from `astro:env/server`.

## What We're NOT Doing

- **No Cloudflare Container** — deferred to production accuracy upgrade path; browser WASM is the MVP compute
- **No R2 video storage** — video stays in-browser; no R2 binding added to `wrangler.jsonc`
- **No ankle angle** — ankle (heel/foot) landmarks are unreliably detected in side-view cycling video; excluded from MVP
- **No direct Gemini API** — everything goes through OpenRouter for LLM-agnostic design
- **No MediaPipe self-hosting** — model served from Google Storage CDN; self-hosting deferred to production
- **No S-03 results page** — `/sessions/:id` is just a link target; S-03 is a separate slice
- **No session history update** — roadmap S-04; out of scope
- **No video duration auto-capping** — `VideoUpload.tsx` already validates 3–15s; no change needed

## Implementation Approach

The browser is the pipeline worker (established in F-02 architecture). `VideoAnalyzer.tsx` is a new React island that receives the video `File` and `sessionId`, runs the five-step pipeline, and reports back to `VideoUpload.tsx` via callbacks. Server routes are thin relay layers that apply auth, call OpenRouter, and return structured data. The LLM service (`llm.ts`) is OpenRouter-only with model names as configurable constants at the top of the file — swapping models requires one line change.

## Critical Implementation Details

**Torso angle computation** — The `bike-fitting-ref-angles.md` defines torso angle as "from horizontal to a line from hip to shoulder." MediaPipe world coordinates have Y increasing downward. The correct formula is:
`Math.abs(Math.atan2(wl[11].y - wl[23].y, wl[11].x - wl[23].x) * 180 / Math.PI)`
This is different from `jointAngle()` which computes the included angle at a joint vertex. Using `jointAngle()` for torso would return the wrong value.

**±2 frame scan selection** — For BDC timestamps: pick the frame in the ±2-frame scan window (5 frames: t−0.066 through t+0.066) that has the **highest** knee angle (most extended leg). For TDC timestamps: pick the frame with the **lowest** knee angle (deepest flexion). Scanning both directions handles codec seek imprecision regardless of whether the seek under- or overshoots. This is deterministic and doesn't require a separate signal from Gemini.

**Gemini timestamp labelling** — The `/api/analyze` route should ask the vision LLM to return timestamps with their type: `{ timestamps: [{ t: number, type: "BDC" | "TDC" }] }`. The scan-frame-selection logic above requires knowing the type of each timestamp to choose the correct extremum.

**State machine ordering in VideoAnalyzer** — `POST /sessions/:id/start` must be the very first call (before MediaPipe init or frame extraction) because it sets the status to `processing`. If the user closes the tab during MediaPipe load (before `/start` is called), the session remains `queued` indefinitely. Calling `/start` first ensures the failure path (POST to `/results` with error) can always run.

---

## Phase 1: Foundation

### Overview

Add the `OPENROUTER_API_KEY` environment variable, install `@mediapipe/tasks-vision`, create the LLM-agnostic OpenRouter service, and extend `schemas.ts` with Zod types for the two new routes.

### Changes Required

#### 1. Environment variable

**File**: `astro.config.mjs`

**Intent**: Add `OPENROUTER_API_KEY` as a server-only secret to the Astro env schema, alongside the existing Supabase keys.

**Contract**: `envField.string({ context: "server", access: "secret" })` — same declaration pattern as `SUPABASE_SERVICE_ROLE_KEY`. The key must also be added to `.dev.vars` (gitignored) before Phase 2 can be manually tested.

#### 2. Install MediaPipe package

**File**: `package.json` (via `npm install @mediapipe/tasks-vision`)

**Intent**: Add the browser WASM MediaPipe Tasks Vision package. Required for `PoseLandmarker` in `VideoAnalyzer.tsx`.

**Contract**: `@mediapipe/tasks-vision` — check that the installed version matches the WASM CDN URL used in `VideoAnalyzer.tsx`. Use the version from the CDN path to avoid WASM/JS version mismatch.

#### 3. LLM service

**File**: `src/lib/services/llm.ts` (new)

**Intent**: OpenRouter HTTP client with two functions: one for the vision keyframe analysis call (sends base64 frames, returns labelled timestamps) and one for the text recommendation call (sends body angles, returns structured recommendations). Model names are constants at the top of the file.

**Contract**:
```
VISION_MODEL = "google/gemini-2.5-flash"   // top of file, swap to change model
TEXT_MODEL   = "google/gemini-2.5-flash"

analyzeFrames(frames: string[]): Promise<{ timestamps: { t: number; type: "BDC" | "TDC" }[] }>
generateRecommendations(angles: BodyAngle[]): Promise<{ recommendations: Recommendation[]; raw_llm_response: string }>
```

Both functions call `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer ${OPENROUTER_API_KEY}`. `analyzeFrames` passes frames as `image_url` content parts (format: `data:image/jpeg;base64,...`). `generateRecommendations` passes a user message with the angle array and a system prompt that embeds the full reference table and adjustment guide from `bike-fitting-ref-angles.md` and `angle-to-adjustment-guide.md`. Both use `response_format: { type: "json_object" }` to request structured JSON output. Both `JSON.parse` the response content and throw a typed error on malformed JSON or missing fields.

**System prompt for `generateRecommendations`** must embed:
- All 5 angle reference ranges (name, included-angle range, flexion range, target midpoint) from `bike-fitting-ref-angles.md`
- The adjustment order of operations (saddle height → fore/aft → bar height → stem length) from `angle-to-adjustment-guide.md`
- Per-angle adjustment rules (1 mm saddle ≈ 1° knee, 5 mm spacer ≈ 1–2° torso, 10 mm stem ≈ 5–10° elbow)
- Coupling effects (after saddle height change, recheck hip; after fore/aft, recheck knee-BDC)
- Instruction to return ONLY a JSON object matching `{ recommendations: [{adjustment, rationale}], raw_llm_response: string }`
- Rule: only recommend changes for angles outside their reference range; if all angles are in range, return an empty recommendations array with a positive summary in `raw_llm_response`

#### 4. Zod schemas for new routes

**File**: `src/lib/schemas.ts`

**Intent**: Add Zod schemas for the two new POST request bodies so the route handlers can validate input without defining schemas inline.

**Contract**: Two new exports alongside the existing ones:
```
analyzeRequestSchema   = z.object({ frames: z.array(z.string()).min(1).max(30) })
recommendRequestSchema = z.object({ body_angles: z.array(bodyAngleSchema).min(1) })
```

### Success Criteria

#### Automated Verification

- TypeScript check passes with new env field: `npx tsc --noEmit`
- `@mediapipe/tasks-vision` appears in `package.json` dependencies
- `src/lib/services/llm.ts` exports `analyzeFrames` and `generateRecommendations` with correct signatures
- `src/lib/schemas.ts` exports `analyzeRequestSchema` and `recommendRequestSchema`

#### Manual Verification

- `.dev.vars` updated with `OPENROUTER_API_KEY` (not checked into git)
- `npx tsc --noEmit` runs clean with no errors on the new files

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Server API Routes

### Overview

Add two new JSON API routes. Both follow the existing `src/pages/api/sessions/[id]/start.ts` pattern: JSON request/response, Zod validation, auth check, one purpose per route.

### Changes Required

#### 1. POST /api/analyze

**File**: `src/pages/api/analyze.ts` (new)

**Intent**: Stateless relay route — receives base64 JPEG frames from the browser, calls `llm.analyzeFrames()`, and returns labelled keyframe timestamps. Auth-gated (no session ID required; any authenticated user can call it).

**Contract**:
```
POST /api/analyze
Request:  { frames: string[] }  (validated by analyzeRequestSchema)
Response: { timestamps: { t: number; type: "BDC" | "TDC" }[] }
Errors:   401 if unauthenticated; 400 on invalid JSON or Zod failure; 500 if LLM call throws
```

Route pattern to follow: `src/pages/api/sessions/index.ts` — JSON parse with try/catch, `safeParse`, `Response.json()`. Does NOT need `createAdminClient` (no DB writes). Uses `context.locals.user` for auth check.

#### 2. POST /api/sessions/:id/recommend

**File**: `src/pages/api/sessions/[id]/recommend.ts` (new, inside `src/pages/api/sessions/[id]/` directory which already exists)

**Intent**: Session-scoped relay route — verifies the session belongs to the authenticated user, calls `llm.generateRecommendations()` with the provided angles, and returns structured recommendations. Does not write to the database (the browser calls `/results` separately with the combined payload).

**Contract**:
```
POST /api/sessions/:id/recommend
Request:  { body_angles: BodyAngle[] }  (validated by recommendRequestSchema)
Response: { recommendations: Recommendation[]; raw_llm_response: string }
Errors:   401 unauthenticated; 404 if session not found or belongs to another user;
          400 on invalid JSON or Zod failure; 500 if LLM call throws
```

Session ownership check: use `createClient(...)` (RLS-scoped) to `SELECT id FROM fitting_sessions WHERE id = :id` — RLS policy `sessions_select_own` enforces ownership; null result = 404. Pattern: mirror `src/pages/api/sessions/[id]/start.ts:13-28`. No admin client needed.

### Success Criteria

#### Automated Verification

- `npx tsc --noEmit` passes with both new route files
- Both routes export `const prerender = false` and a `POST` handler

#### Manual Verification

- `POST /api/analyze` with a valid base64 JPEG array (from a test script or curl) returns `{ timestamps: [...] }` (requires `OPENROUTER_API_KEY` in `.dev.vars`)
- `POST /api/sessions/:id/recommend` with a valid `body_angles` array returns `{ recommendations: [...], raw_llm_response: "..." }` for a `queued` or `processing` session owned by the user
- Both routes return 401 when called without a session cookie
- `/recommend` returns 404 for a session ID belonging to a different user

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: VideoAnalyzer.tsx

### Overview

New React island component that owns the entire browser-side analysis pipeline. Receives `sessionId` and `file` props; calls `/start`, runs MediaPipe, calls `/api/analyze`, extracts poses, computes angles, calls `/recommend`, submits `/results`. Shows per-step progress and per-step error messages. Calls `onComplete()` or `onError(message)` when finished.

### Changes Required

#### 1. Component file

**File**: `src/components/VideoAnalyzer.tsx` (new)

**Intent**: Pipeline orchestrator component. Renders a step-by-step progress UI. Handles all async operations, error boundaries per step, and the results submission. Does not poll — it drives the pipeline itself.

**Contract**:
```typescript
interface Props {
  sessionId: string;
  file: File;
  onComplete: (sessionId: string) => void;
  onError: (message: string) => void;
}
```

Step state machine — `AnalysisStep` union:
```
"starting"           → calls POST /sessions/:id/start
"loading-model"      → PoseLandmarker.createFromOptions(...)
"extracting-frames"  → canvas.toDataURL at 1fps over video duration
"identifying-frames" → POST /api/analyze with base64 frames
"measuring-angles"   → seek + scan + detect + compute per timestamp
"generating-recs"    → POST /api/sessions/:id/recommend
"submitting"         → POST /api/sessions/:id/results
```

Error at any step → call `POST /api/sessions/:id/results` with `{ error: true, error_message: "<step>: <detail>" }`, then call `onError(message)`.

**MediaPipe initialisation** — `FilesetResolver` WASM URL pattern:
`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{VERSION}/wasm`
where `{VERSION}` is the exact version installed by Phase 1's `npm install`. Read it from `node_modules/@mediapipe/tasks-vision/package.json` after install (do not use `latest` — WASM and JS must match exactly or init fails with a cryptic error). Model URL: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`. Delegate: `"GPU"` (fallback to `"CPU"` on error is optional for MVP). `runningMode: "IMAGE"`, `numPoses: 1`.

**Frame extraction** — seek video via `videoEl.currentTime = t` + await `seeked` event for each integer second `t ∈ [0, floor(duration)]`. Use `canvas.toDataURL("image/jpeg", 0.7)` and strip the `data:image/jpeg;base64,` prefix before sending to the server.

**Reference angle constants** — define as a typed constant object (not imported from a schema file; inline in the component):
```
KNEE_BDC:  { min: 137, max: 147, unit: "degrees", name: "Knee angle at BDC" }
KNEE_TDC:  { min: 65,  max: 75,  unit: "degrees", name: "Knee angle at TDC" }
HIP:       { min: 55,  max: 65,  unit: "degrees", name: "Hip angle at TDC" }
TORSO:     { min: 45,  max: 55,  unit: "degrees", name: "Torso angle" }
ELBOW:     { min: 150, max: 160, unit: "degrees", name: "Elbow angle" }
```

**Angle computation** — 4 of the 5 angles use the three-point `jointAngle()` function from `pose-estimation-research.md`:
- Knee: `jointAngle(wl[23], wl[25], wl[27])` (hip–knee–ankle)
- Hip at TDC: `jointAngle(wl[11], wl[23], wl[25])` (shoulder–hip–knee)
- Elbow: `jointAngle(wl[11], wl[13], wl[15])` (shoulder–elbow–wrist)

Torso angle uses `atan2` (see Critical Implementation Details above — do NOT use `jointAngle()` for this).

Filter: skip any angle where any of its three landmark `visibility` scores is below 0.5 — exclude that angle from the `body_angles` array (do not push a value). If fewer than 2 valid angles remain after filtering, treat as a pipeline error ("Pose not detected clearly — try a clearer side-view video").

**±2 frame scan for BDC/TDC keyframes** — for each Gemini timestamp `{ t, type }`:
1. Seek to `t - 0.066`, await `seeked`; detect pose; record `{ frame, kneeAngle }`
2. Seek to `t - 0.033`, detect; record
3. Seek to `t`, detect; record
4. Seek to `t + 0.033`, detect; record
5. Seek to `t + 0.066`, detect; record
6. For `type === "BDC"`: pick the frame with the **highest** knee angle (most extended)
7. For `type === "TDC"`: pick the frame with the **lowest** knee angle (deepest flex)

Clamp seek targets: if `t - 0.066 < 0`, start at 0 (the video element silently clamps seeks below 0).

Run MediaPipe on each scan frame via `poseLandmarker.detect(bitmap)` where `bitmap = await createImageBitmap(canvas)`.

**Results payload assembly**:
```
body_angles: computed BodyAngle[] (with reference_min / reference_max from constants above)
recommendations: from /recommend response
raw_llm_response: from /recommend response
```

Submit to `POST /api/sessions/:id/results` without the `error` field (schema accepts its absence).

### Success Criteria

#### Automated Verification

- `npx tsc --noEmit` passes with `VideoAnalyzer.tsx` in place
- Exported default component accepts `Props` interface without TypeScript errors

#### Manual Verification

- Upload a 3–15s side-view cycling MP4 via the dashboard; verify the step indicator advances through all 7 steps without hanging
- On step completion, `analysis_results` row exists in Supabase with non-empty `recommendations` and `body_angles` JSON arrays
- `fitting_sessions.status` flips to `completed` after a successful run
- Uploading a video with no person visible produces a clear "Pose not detected" error and flips session to `failed`
- Each step's error message is readable and describes the failure (not a raw exception string)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: VideoUpload.tsx Integration

### Overview

Extend `VideoUpload.tsx` to thread the video `File` into the pipeline, hand off to `VideoAnalyzer` after session creation, and show a results link on completion. The polling logic stays in place for future server-side paths but the `analyzing` state renders `VideoAnalyzer` instead of polling.

### Changes Required

#### 1. AppState extension

**File**: `src/components/VideoUpload.tsx`

**Intent**: Add two new state variants: `analyzing` (holds the file and session ID, renders `VideoAnalyzer`) and update `completed` to carry `sessionId` for the results link.

**Contract**: Replace `{ kind: "completed" }` with `{ kind: "completed"; sessionId: string }`. Add `{ kind: "analyzing"; sessionId: string; file: File }` between `creating` and `polling` in the union. No other state variants change.

#### 2. File ref and handoff

**File**: `src/components/VideoUpload.tsx`

**Intent**: Retain the `File` object after session creation so it can be passed to `VideoAnalyzer`. Currently the file is only used within `handleFileChange` and is not stored.

**Contract**: Add `const fileRef = useRef<File | null>(null)`. After `extractDuration()` succeeds, set `fileRef.current = file`. After session creation succeeds, transition to `{ kind: "analyzing", sessionId: data.id, file: fileRef.current! }` instead of `{ kind: "polling" }`. Do not start the polling interval in this path — `VideoAnalyzer` drives completion.

**Critical**: Replace lines 180–181 together — both statements must change:
```ts
// Before (lines 180–181):
setState({ kind: "polling", sessionId, status: "queued" });
startPolling(sessionId);

// After:
setState({ kind: "analyzing", sessionId, file: fileRef.current! });
// startPolling is removed — VideoAnalyzer drives completion
```
`startPolling` does not check current state; leaving line 181 in place causes a polling interval to fire unconditionally and race against the `analyzing` state.

#### 3. Render VideoAnalyzer in analyzing state

**File**: `src/components/VideoUpload.tsx`

**Intent**: Render `<VideoAnalyzer>` when in `analyzing` state, passing the callbacks that transition the outer state machine.

**Contract**:
```tsx
if (state.kind === "analyzing") {
  return (
    <VideoAnalyzer
      sessionId={state.sessionId}
      file={state.file}
      onComplete={(sessionId) => setState({ kind: "completed", sessionId })}
      onError={(msg) => setState({ kind: "failed", errorMessage: msg })}
    />
  );
}
```

#### 4. Update poll() completed setter

**File**: `src/components/VideoUpload.tsx`

**Intent**: The `poll()` function inside `startPolling` (line 106) calls `setState({ kind: "completed" })`. Once the `completed` variant gains a required `sessionId` field (change #1 above), this call becomes a TypeScript error and must be updated.

**Contract**: Change the `setState({ kind: "completed" })` call at line 106 to `setState({ kind: "completed", sessionId })` — `sessionId` is already in scope as the parameter of `startPolling(sessionId)`. This setter is kept so the polling path (if ever re-enabled) compiles correctly; in the S-02 flow it is never reached because polling is not started.

#### 5. Results link in completed state

**File**: `src/components/VideoUpload.tsx`

**Intent**: Replace the current `"Analysis complete!"` paragraph with a link to the results page. The `/sessions/:id` route is part of S-03 (not yet implemented), so the link is a navigation hook that will 404 until S-03 lands.

**Contract**: In the `completed` render branch, add a button/link element: `href={'/sessions/' + state.sessionId}`, label "View fitting recommendations". Keep the existing "Analysis complete!" heading.

### Success Criteria

#### Automated Verification

- `npx tsc --noEmit` passes with all VideoUpload.tsx changes

#### Manual Verification

- Uploading a valid MP4 via dashboard advances from "Creating session…" directly to the VideoAnalyzer step indicator (no polling UI flicker in between)
- On pipeline completion, the completed state shows "View fitting recommendations" button with the correct session ID in the href
- Clicking the button navigates to `/sessions/:id` (may 404 until S-03 is built — that is acceptable)
- On pipeline failure, the "failed" state shows the per-step error message from VideoAnalyzer and a "Try again" reset button

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests

- `jointAngle()` utility: three known vectors with expected degree output
- Torso angle formula: known hip/shoulder coordinates → expected degrees from horizontal
- `analyzeFrames` / `generateRecommendations` service functions: mock `fetch`, assert correct request shape and that JSON parse errors throw cleanly

### Integration Tests

- `POST /api/analyze`: authenticated request with a minimal base64 JPEG array → assert `200` and `{ timestamps: [...] }` shape
- `POST /api/sessions/:id/recommend`: authenticated + owned session → `200`; different user's session → `404`
- End-to-end: upload test video → verify `fitting_sessions.status = "completed"` and `analysis_results` row

### Manual Testing Steps

1. Upload a clear side-view cycling video (10–15s, good lighting, full body visible) — verify all 5 angles are populated in Supabase `body_angles` JSONB
2. Upload the same video twice — verify recommendations are deterministic (same input → same output per PRD NFR)
3. Upload a video with a blurry or partial view — verify "Pose not detected" error, session flips to `failed`
4. Upload a valid video but disconnect network mid-analysis — verify the step that fails reports a clear error and the session flips to `failed`
5. Inspect `raw_llm_response` in Supabase to verify the LLM received the full reference context and used it in its reasoning

## Performance Considerations

- MediaPipe WASM + model load: ~2–4s on first run (CDN, cached after); acceptable one-time cost per session
- Frame extraction at 1fps for a 15s video: 15 canvas.toDataURL calls, each ~50–100 KB JPEG — total ~1.5 MB sent to `/api/analyze`
- ±2-frame scan: 5 × 4–8 timestamps = 20–40 MediaPipe `detect()` calls; each ~50–200ms → total scan time 1–8s; acceptable for MVP (bidirectional scan handles seek imprecision in either direction)
- LLM calls: `/api/analyze` and `/api/recommend` are sequential from the browser's perspective — two network hops; each typically 1–3s latency via OpenRouter

## References

- Research: `context/changes/ai-analysis-pipeline/research.md`
- Pose estimation research: `context/changes/ai-analysis-pipeline/pose-estimation-research.md`
- Reference angles: `context/changes/ai-analysis-pipeline/bike-fitting-ref-angles.md`
- Adjustment guide: `context/changes/ai-analysis-pipeline/angle-to-adjustment-guide.md`
- F-02 job pipeline plan: `context/changes/async-job-pipeline/plan.md`
- Existing route pattern: `src/pages/api/sessions/[id]/start.ts`
- Existing schema: `src/lib/schemas.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation

#### Automated

- [x] 1.1 `npx tsc --noEmit` passes with `OPENROUTER_API_KEY` added to astro.config.mjs env schema — c493601
- [x] 1.2 `@mediapipe/tasks-vision` appears in `package.json` dependencies — c493601
- [x] 1.3 `src/lib/services/llm.ts` exports `analyzeFrames` and `generateRecommendations` with correct signatures — c493601
- [x] 1.4 `src/lib/schemas.ts` exports `analyzeRequestSchema` and `recommendRequestSchema` — c493601

#### Manual

- [x] 1.5 `.dev.vars` updated with `OPENROUTER_API_KEY` (not checked into git)
- [x] 1.6 `npx tsc --noEmit` runs clean with no errors on the new files

### Phase 2: Server API Routes

#### Automated

- [x] 2.1 `npx tsc --noEmit` passes with both new route files — 795e503
- [x] 2.2 Both routes export `const prerender = false` and a `POST` handler — 795e503

#### Manual

- [x] 2.3 `POST /api/analyze` with a base64-encoded video returns `{ timestamps: [...] }` — 795e503
- [x] 2.4 `POST /api/sessions/:id/recommend` with valid `body_angles` returns `{ recommendations: [...], raw_llm_response: "..." }` — 795e503
- [x] 2.5 Both routes return 401 when called without a session cookie — 795e503
- [x] 2.6 `/recommend` returns 404 for a session ID belonging to a different user — 795e503

### Phase 3: VideoAnalyzer.tsx

#### Automated

- [x] 3.1 `npx tsc --noEmit` passes with `VideoAnalyzer.tsx` in place — 5b42b18
- [x] 3.2 Exported default component accepts `Props` interface without TypeScript errors — 5b42b18

#### Manual

- [x] 3.3 Step indicator advances through all 7 steps on a valid cycling video
- [x] 3.4 `analysis_results` row exists with non-empty `recommendations` and `body_angles` after successful run
- [x] 3.5 `fitting_sessions.status` flips to `completed` after successful run
- [x] 3.6 Video with no person visible produces a clear "Pose not detected" error and flips session to `failed`
- [x] 3.7 Each step's error message is human-readable

### Phase 4: VideoUpload.tsx Integration

#### Automated

- [x] 4.1 `npx tsc --noEmit` passes with all VideoUpload.tsx changes — 5f6b60d

#### Manual

- [x] 4.2 Uploading a valid MP4 advances directly to VideoAnalyzer step indicator (no polling flicker) — 5f6b60d
- [x] 4.3 Completed state shows "View fitting recommendations" button with correct session ID in href — 5f6b60d
- [x] 4.4 On pipeline failure, "failed" state shows per-step error message and "Try again" button — 5f6b60d
