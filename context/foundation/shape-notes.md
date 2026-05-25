---
project: "BikeFit"
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
created: 2026-05-22
updated: 2026-05-22  # finalized
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction — professional bike fitting exists but is expensive and not accessible for amateur self-assessment"
    - topic: "primary persona"
      decision: "amateur road/gravel cyclist, 25–45, owns a quality bike, rides regularly for fitness"
    - topic: "key insight"
      decision: "combination of AI pose estimation + LLM reasoning together unlock an end-to-end MVP; neither alone is sufficient"
    - topic: "auth method"
      decision: "login with email + password or OAuth; supports session history"
    - topic: "user roles"
      decision: "flat model — all registered users have the same access; no admin role in MVP"
  frs_drafted: 10
  quality_check_status: accepted
---

## Vision & Problem Statement

Professional bike fitting is a real service that solves a real problem — suboptimal riding position causes discomfort, inefficiency, and injury risk. But professional fittings are expensive and inaccessible for casual or budget-constrained amateur cyclists who want only a first-pass assessment and general adjustment guidance.

The insight: AI-based pose estimation can now reliably detect body keypoints from consumer video, and LLMs can translate angle measurements into plain-language recommendations without a domain expert. Neither was production-accessible a few years ago; together they make a self-service bike fitting tool feasible as a web product.

## User & Persona

**Primary persona**: An amateur road/gravel cyclist, 25–45 years old, who owns a quality bike and rides regularly for fitness. They notice discomfort or wonder whether their position is efficient — but a professional fitting appointment doesn't feel justified for what might be a small adjustment. They want to film themselves cycling from the side, upload the clip, and get actionable feedback: saddle up/down, forward/back, numbers with meaning.

## Access Control

Multi-user web app. Users register and log in with email + password, or via OAuth. All registered users have the same capabilities — flat model, no role separation in MVP. An unauthenticated user hitting a gated route is redirected to login. Session history (past bike-fitting analyses) is tied to the user account.

## Success Criteria

### Primary
- Body angle measurements from uploaded video are within ±10° of the true angle (validation against a reference fitting or manual measurement).
- Fitting recommendations (saddle height, saddle fore/aft, etc.) fall within accepted reference ranges for gravel bike geometry.

### Secondary
- User can compare two sessions side by side to observe change over time (before/after an adjustment).

### Guardrails
- No raw video is retained in operator-accessible storage after analysis completes — process and discard.
- The app explicitly supports gravel bikes only in MVP; it must not silently produce results for road or MTB geometries without flagging the mismatch.
- Every analysis attempt returns either a result or a clear, human-readable failure message — no silent errors.

## User Stories

### US-01: User analyzes their riding position

- **Given** a logged-in user who has not yet uploaded a video for this session
- **When** they upload a ≤10s side-view cycling video and submit it for analysis
- **Then** they see their body angle measurements and AI-generated fitting recommendations (saddle height, saddle fore/aft, etc.)

#### Acceptance Criteria
- Each recommendation names the specific adjustment (e.g., "raise saddle ~5mm")
- Relevant angle measurements are shown alongside each recommendation with reference ranges for context (e.g., "Knee angle: 142° / ideal: 140–150°")
- If analysis fails, user sees a plain-language error explaining why (e.g., "no cyclist detected in video")

## Functional Requirements

### Authentication

- FR-001: User can register with email + password or OAuth. Priority: must-have
  > Socrates: Counter-argument considered: "accounts add onboarding friction; anonymous one-time analysis converts better." Resolution: kept as-is — accounts are necessary for session history, which is a core MVP feature. No auth = no history.

- FR-002: User can log in and log out. Priority: must-have
  > Socrates: Counter-argument considered: same as FR-001. Resolution: stands; login/logout flows from the same auth requirement.

### Video upload & analysis

- FR-003: User can upload a short side-view cycling video (≤10s). Priority: must-have
  > Socrates: Counter-argument accepted: 10s is arbitrary — a single crank rotation (1–2s at 60 rpm) is sufficient for angle extraction. The duration limit should be validated against pose estimation tool requirements. Exact limit left as an open question for implementation.

- FR-004: System extracts keyframes and detects poses from the uploaded video using an AI/pose estimation service. Priority: must-have
  > Socrates: Clarified that keyframe extraction and pose detection will both be delegated to an AI service — they are not separate manual steps. FR-004 and FR-005 are effectively one operation via the chosen service.

- FR-005: System detects body keypoints from video using a third-party pose estimation tool. Priority: must-have
  > Socrates: Counter-argument considered: "external API adds latency, cost, and a single point of failure." Resolution: own pose estimation is explicitly out of scope (non-goal). External tool dependency accepted. Tool accuracy on cycling video should be validated against the ±10° success criterion before committing to a specific service.

- FR-006: System calculates body angles from all detected keypoints and passes them to AI for interpretation. Priority: must-have
  > Socrates: Decision: calculating all possible angles is safe; the AI will determine which angles are relevant for fitting recommendations. No pre-selection of angles in MVP — the LLM interprets the full keypoint set.

- FR-007: System generates fitting recommendations from angle data using an LLM. Priority: must-have
  > Socrates: Counter-argument considered: "LLMs hallucinate; a rules-based lookup table is safer for a medical-adjacent domain." Resolution: LLM kept as the right approach — bike fitting reference ranges exist in literature and can be embedded in the prompt. Rules-based hardcoding requires domain expertise to maintain. Prompt engineering is the mitigation for hallucination risk.

- FR-008: User sees fitting recommendations in plain language (saddle height, saddle fore/aft, etc.) alongside relevant angle measurements with reference ranges for context (e.g., "Knee angle: 142° / ideal: 140–150°"). Priority: must-have
  > Socrates: Revised. Original FR showed raw angle measurements as primary output. Socratic outcome: raw numbers without context are meaningless to amateurs. Resolution: show angles with reference ranges alongside recommendations — angles give technical credibility, ranges give meaning, recommendations give action.

### Session history

- FR-009: User can view their past bike-fitting sessions. Priority: must-have
  > Socrates: Counter-argument considered: "history adds backend complexity; store only last session for MVP." Resolution: kept as full history — history is core to showing improvement over time. Side-by-side comparison (FR-010) depends on having at least two sessions accessible.

- FR-010: User can compare two sessions side by side. Priority: nice-to-have
  > Socrates: Kept as nice-to-have. History without comparison is a list of results; comparison gives history purpose. Only built if core flow ships with time to spare.

## Business Logic

Given measured body angles from a cycling video, the system assesses overall riding position holistically and recommends the smallest set of physical adjustments (e.g., "raise saddle 5mm") that will most improve the overall fit — with each session serving as one step in an iterative fitting cycle.

The system receives all body angles extracted from the uploaded video. It does not evaluate each angle independently; it evaluates the overall posture picture across all angles and identifies the fewest, highest-impact adjustments a cyclist can make to their bike setup. Individual angle deviations from reference ranges are inputs to the assessment, not outputs shown to the user.

The fitting process is explicitly iterative: each submission is one round in a cycle of adjustment and re-analysis. The user makes the recommended adjustments, films again, submits again, and receives updated recommendations. Session history exists to track this progression over time.

The reference frame for gravel bike geometry (what counts as "in range") is an open question — the specific angle ranges and adjustment thresholds must be established before recommendations can be validated against the ±10° and reference-range success criteria. See Open Questions.

## Non-Functional Requirements

- Video data leaves no trace in operator-accessible storage after the analysis request that consumed it completes. (Privacy: process and discard.)
- The same video submitted twice produces the same fitting recommendations.
- Analysis may take up to 5–10 minutes to complete; the user is not expected to wait on-screen. The product must show processing status while the user is on-site and surface the completed result when the user returns. If the user keeps the page open, they receive an in-page notification when results are ready.

## Non-Goals

- **No own pose estimation or keypoint detection.** The system integrates a third-party pose estimation service; building a proprietary model is out of scope. Rationale: explicitly listed as MVP out-of-scope; would add months of ML work.
- **No mobile app.** Web only in MVP. Mobile is a potential v2 if the product proves useful on desktop first.
- **Gravel bikes only — no road or MTB geometry.** The system must not silently produce recommendations for other bike types. Reference ranges are calibrated for gravel geometry only.
- **No real-time or live video analysis.** Analysis is async: upload a clip, wait for results. Live camera feed is out of scope.
- **MP4 only — no multi-format video support.** Only MP4 video files are accepted in MVP. Format conversion and multi-codec handling are out of scope.
- **No equipment or component recommendations.** The app recommends bike adjustments (saddle height, fore/aft position, etc.), not what parts or bikes to purchase.
- **No sharing, social, or team features.** Sessions are private to the user. No public profiles, no coach access, no shared sessions.
- **No medical or injury advice.** The app gives bike fitting guidance; it is not a physiotherapy tool and must not diagnose or treat injury.

## Open Questions

1. **What is the minimum video duration for reliable angle extraction?** The 10s cap from idea notes was challenged as arbitrary; a single crank rotation (1–2s at 60 rpm) may suffice. The actual limit should be validated against the chosen pose estimation tool's accuracy requirements. Owner: user. Block: yes (affects FR-003 and success criterion).

2. **Which gravel bike angle reference ranges are authoritative?** The ±10° success criterion and the reference-range recommendation criterion both require a known "correct" range for each relevant angle. This domain knowledge must be sourced (bike fitting literature, certified fitter consultation) before recommendations can be validated. Owner: user. Block: yes (PRD is hollow without this; affects Business Logic and success criteria).

3. **Which third-party pose estimation tool/API will be used?** The chosen service must be validated for accuracy on side-view cycling video before committing. Accuracy on cycling footage may differ from the standing/walking poses typical training data covers. Owner: user. Block: yes (affects FR-004/005 and the ±10° success criterion).

4. **Which body angles are surfaced alongside recommendations?** The system passes all detected keypoint angles to the AI; the AI selects which angles are relevant per recommendation. The UI then shows those selected angles with reference ranges. The set of angles shown will emerge from the LLM's output, not be pre-defined. No pre-selection needed. Block: no.

## Quality cross-check

All elements present. quality_check_status: accepted.

