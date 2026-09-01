---
change_id: results-display-ux-improvements
title: Round over-precise body angles in results display
status: implemented
created: 2026-09-01
updated: 2026-09-01
archived_at: null
---

## Notes

Roadmap slice: S-05 "UX improvements" (context/foundation/roadmap.md). Prerequisite: S-03 (fitting-results-display), status done.

Outcome: body angles shown alongside fitting recommendations are rounded to a readable precision instead of raw floating-point values, e.g. currently `120.36403496308388 degrees (reference: 137–147 degrees)`.

PRD ref: FR-008 (recommendations in plain language with angles and reference ranges for context).

Open question (non-blocking): whole-degree vs. one-decimal rounding — default to whole degrees, adjust from feedback.
