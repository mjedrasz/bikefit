---
project: "BikeFit"
version: 1
status: draft
created: 2026-05-26
updated: 2026-05-29
prd_version: 1
main_goal: market-feedback
top_blocker: decisions
---

# Roadmap: BikeFit

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Amateur cyclists who notice discomfort or wonder whether their position is efficient lack access to affordable self-service fitting tools — professional fittings are expensive and overkill for what might be a minor adjustment. BikeFit combines AI pose estimation and LLM reasoning to let a cyclist upload a short side-view video and receive plain-language fitting recommendations (saddle height, fore/aft position) alongside the body angles that back them up. The product is built to validate a specific technical hypothesis: that consumer video plus off-the-shelf AI services can together produce gravel bike fitting guidance accurate enough to be useful.

## North star

**S-02: user's uploaded video is fully processed and fitting recommendations are ready to view** — this slice is the technical gate on the core product hypothesis (AI pose estimation + LLM = usable gravel bike fitting guidance) and maps directly to both primary Success Criteria. S-03 (results display, built in parallel) makes the recommendations visible to the user; S-02 is the blocker.

> The north star is the smallest end-to-end slice whose successful delivery proves the core product hypothesis — placed as early as Prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID                    | Outcome (user can …)                                                               | Prerequisites    | PRD refs                              | Status   |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------- | ---------------- | ------------------------------------- | -------- |
| F-01 | db-schema-and-privacy-design | (foundation) session and result tables exist; schema enforces no-raw-video privacy | —                | NFR-privacy, FR-001, FR-002           | done     |
| F-02 | async-job-pipeline           | (foundation) analysis jobs can be queued, executed, and their status tracked       | F-01             | NFR-async                             | ready    |
| S-01 | video-upload-and-status      | upload a short MP4 cycling video and see live processing status                    | F-01, F-02       | FR-001, FR-002, FR-003, US-01         | blocked  |
| S-02 | ai-analysis-pipeline         | have uploaded video fully processed — pose keypoints, angles, LLM recommendations | F-01, F-02, S-01 | FR-004, FR-005, FR-006, FR-007, US-01 | blocked  |
| S-03 | fitting-results-display      | view fitting recommendations and body angles for a completed session               | F-01             | FR-008, US-01                         | ready    |
| S-04 | session-history-list         | browse all past fitting sessions and navigate to any completed result              | S-01, F-01       | FR-009                                | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                              | Note                                                                                      |
| ------ | ---------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| A      | Core analysis pipeline | `F-01` → `F-02` → `S-01` → `S-02` | North star lives at S-02; entire analysis path flows here; blocked by 3 open decisions    |
| B      | Results display        | `S-03`                             | Branches from Stream A at F-01; parallel with F-02, S-01, S-02 — build with mock data while pipeline is unblocked |
| C      | Session history        | `S-04`                             | Branches from Stream A at S-01; parallel with S-02 — opens once video upload is working  |

## Baseline

What's already in place in the codebase as of 2026-05-26 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19, file-based routing; pages: index, dashboard, auth pages (astro.config.mjs)
- **Backend / API:** partial — Astro API routes wired; only auth routes exist (src/pages/api/auth/*); no video upload, analysis, or session routes
- **Data:** partial — Supabase SDK configured (src/lib/supabase.ts); no migrations or domain models
- **Auth:** present — Supabase auth fully wired: middleware, signin/signup/signout, session management (src/middleware.ts)
- **Deploy / infra:** present — Cloudflare Workers (wrangler.jsonc), GitHub Actions CI (.github/workflows/ci.yml)
- **Observability:** absent — no logging library, error tracking, or metrics

## Foundations

### F-01: Database schema and privacy design

- **Outcome:** (foundation) `fitting_sessions` and `analysis_results` tables exist in Supabase with row-level security; schema enforces the privacy NFR (no raw video column); user ownership is foreign-keyed from existing auth users.
- **Change ID:** db-schema-and-privacy-design
- **PRD refs:** NFR (video data leaves no trace in operator-accessible storage), FR-001 (schema accounts for authenticated user ownership of sessions), FR-002 (sessions tied to login identity)
- **Unlocks:** S-01 (upload creates a session row), S-02 (pipeline worker writes result rows), S-03 (display reads result rows against typed schema), S-04 (history queries session rows)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because every downstream slice reads or writes to this schema; a mistake here (e.g., storing raw video, wrong user-ownership model) costs rework across all four slices. The privacy NFR is a hard constraint — baking it into the schema now prevents a costly retrofit.
- **Status:** done

### F-02: Async job pipeline

- **Outcome:** (foundation) an analysis job can be enqueued when a video upload completes, picked up by a background worker, executed, and its status (`queued` / `processing` / `completed` / `failed`) tracked in the database and surfaced to the UI as polling or an in-page notification.
- **Change ID:** async-job-pipeline
- **PRD refs:** NFR (analysis may take 5–10 minutes; user must see processing status and receive in-page notification when done)
- **Unlocks:** S-01 (upload endpoint enqueues a job and returns a status to poll), S-02 (background worker dequeues and executes the analysis pipeline)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced second because both S-01 and S-02 depend on the job queue contract; choosing the wrong async primitive (e.g., Supabase Edge Function with polling vs. Cloudflare Queues) couples tightly into the upload and pipeline designs. Resolve the queue mechanism here before either downstream slice starts.
- **Status:** ready

## Slices

### S-01: Video upload and processing status

- **Outcome:** user can upload a short side-view MP4 cycling video, have it validated (format and duration), enqueued for analysis, and see a live processing status indicator while the job runs.
- **Change ID:** video-upload-and-status
- **PRD refs:** FR-001 (upload requires authenticated user), FR-002 (session tied to account), FR-003 (MP4 upload with duration validation), US-01 (first leg of the analysis user story)
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - What is the minimum video duration for reliable angle extraction? — Owner: user. Block: yes. (Affects the file-validation logic in FR-003; the current 10s cap is arbitrary and must be grounded in the chosen tool's accuracy requirements before upload validation can be implemented.)
  - Which pose estimation tool/API will be used? — Owner: user. Block: yes. (The upload endpoint must route the video file to the chosen service; input format requirements and API call shape differ per tool, so this can't be implemented blind.)
- **Risk:** First user-facing slice on the critical analysis path; the upload flow must be solid before the pipeline in S-02 can be meaningfully tested end-to-end. The tool-selection unknown gates both the routing logic and the duration validation — don't begin implementation until OQ-3 is resolved.
- **Status:** blocked

### S-02: AI analysis pipeline

- **Outcome:** user's uploaded video is fully processed — pose keypoints extracted via the chosen third-party service, body angles calculated from those keypoints, fitting recommendations generated by the LLM against gravel reference ranges, and the results (recommendations + angles) stored in the database for display.
- **Change ID:** ai-analysis-pipeline
- **PRD refs:** FR-004 (keyframe extraction + pose detection via AI service), FR-005 (body keypoint detection via third-party tool), FR-006 (angle calculation from keypoints), FR-007 (LLM generates fitting recommendations), US-01 (core of the analysis user story)
- **Prerequisites:** F-01, F-02, S-01
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - Which gravel bike angle reference ranges are authoritative? — Owner: user. Block: yes. (The LLM prompt must embed domain reference ranges; without them recommendations cannot be validated against the ±10° success criterion or the reference-range success criterion. Source from bike fitting literature or certified fitter consultation before implementation.)
  - Which pose estimation tool/API will be used? — Owner: user. Block: yes. (Pipeline integration, input/output format, latency budget, and accuracy on side-view cycling video all depend on which service is chosen. Must be validated on cycling footage before committing, as training data typically covers standing/walking poses.)
- **Risk:** This is the north star slice — the product's core hypothesis lives here. Both blocking unknowns must be resolved before implementation begins. LLM hallucination risk is mitigated by embedding reference ranges in the prompt (per PRD §Business Logic), but that mitigation only activates once OQ-2 is resolved.
- **Status:** blocked

### S-03: Fitting results display

- **Outcome:** user can view a completed session's fitting recommendations in plain language alongside the relevant body angles and reference ranges that back them up, in a clear and readable layout.
- **Change ID:** fitting-results-display
- **PRD refs:** FR-008 (recommendations in plain language with angles and reference ranges for context), US-01 (visible outcome of the analysis user story)
- **Prerequisites:** F-01
- **Parallel with:** F-02, S-01, S-02
- **Blockers:** —
- **Unknowns:**
  - Which body angles will be surfaced alongside recommendations? — Owner: system (emerges from LLM output at runtime). Block: no. (The set of angles shown is determined by the LLM response per PRD §FR-006 rationale; the display component must handle a variable list rather than a fixed schema. Non-blocking: design the component to render whatever the LLM returns.)
- **Risk:** Lightest-prerequisite slice in the roadmap — depends only on F-01 (schema types). Building against mock data while the pipeline is blocked allows early UI validation and reduces integration risk when S-02 lands. The variable-angle display is a mild design consideration, not a blocker.
- **Status:** ready

### S-04: Session history list

- **Outcome:** user can browse all their past fitting sessions (showing date, status, and a preview), and navigate from the list into any completed session's results display.
- **Change ID:** session-history-list
- **PRD refs:** FR-009 (user can view past bike-fitting sessions)
- **Prerequisites:** S-01, F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Lightweight slice once S-01 and F-01 are in place — it is a list query and navigation wrapper over data that already exists. Sequenced after S-01 because the history list is only meaningful when sessions are being created. Can be built in parallel with S-02 (the pipeline) once S-01 ships.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                    | Ready for `/10x-plan` | Notes                                                            |
| ---------- | ---------------------------- | -------------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| F-01       | db-schema-and-privacy-design | Design session + result schema with privacy-first RLS    | done                  | Implemented 2026-05-29                                           |
| F-02       | async-job-pipeline           | Wire async analysis job queue and status tracking        | yes                   | F-01 done; run `/10x-plan async-job-pipeline`                    |
| S-01       | video-upload-and-status      | Build video upload flow with processing-status indicator | no                    | Blocked: resolve OQ-1 (min duration) and OQ-3 (tool) first      |
| S-02       | ai-analysis-pipeline         | Integrate pose estimation + angle calc + LLM pipeline    | no                    | Blocked: resolve OQ-2 (reference ranges) and OQ-3 (tool) first  |
| S-03       | fitting-results-display      | Build results display: recommendations + angles + ranges | yes                   | F-01 done; run `/10x-plan fitting-results-display`               |
| S-04       | session-history-list         | Build session history list and navigation                | no                    | Depends on S-01 completing                                       |

## Open Roadmap Questions

1. **What is the minimum video duration for reliable angle extraction?** The 10s cap was challenged as arbitrary in the PRD; a single crank rotation (1–2s at 60 rpm) may suffice. Must be validated against the chosen pose estimation tool's accuracy requirements before upload validation (FR-003) can be implemented. Owner: user. Block: S-01.

2. **Which gravel bike angle reference ranges are authoritative?** The ±10° success criterion and the reference-range recommendation criterion both require a sourced reference frame for gravel bike geometry. Must be obtained from bike fitting literature or a certified fitter consultation before LLM prompt engineering (FR-007) can begin. Owner: user. Block: S-02.

3. **Which third-party pose estimation tool/API will be used?** The chosen service must be validated specifically for accuracy on side-view cycling video before committing — training data typically covers standing/walking poses, which may differ materially from a pedalling cyclist. Tool choice gates both the upload routing design (S-01) and the pipeline integration (S-02). Owner: user. Block: S-01, S-02.

## Parked

- **Side-by-side session comparison (FR-010)** — Why parked: PRD §Session history labels this nice-to-have; build only if the core analysis flow ships with time to spare within the 3-week window.
- **Mobile app** — Why parked: PRD §Non-Goals; web-only in MVP; potential v2 if the product proves useful on desktop first.
- **Road / MTB bike geometry** — Why parked: PRD §Non-Goals; reference ranges are calibrated for gravel only; other geometries must not produce silent results.
- **Real-time / live video analysis** — Why parked: PRD §Non-Goals; analysis is async by design.
- **Multi-format video (non-MP4)** — Why parked: PRD §Non-Goals; MP4 only in MVP; format conversion out of scope.
- **Equipment / component recommendations** — Why parked: PRD §Non-Goals; app recommends bike adjustments, not parts to purchase.
- **Social / sharing features** — Why parked: PRD §Non-Goals; sessions are private to the user.
- **Medical / injury advice** — Why parked: PRD §Non-Goals; not a physiotherapy tool.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)
