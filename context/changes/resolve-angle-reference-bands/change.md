---
change_id: resolve-angle-reference-bands
title: Resolve the authoritative gravel angle reference bands (PRD OQ#2 / Roadmap OQ-2)
status: implementing
created: 2026-09-02
updated: 2026-09-03
archived_at: null
---

## Decision (2026-09-02)

**Resolved.** The authoritative gravel/recreational reference bands for all
five body angles, sourced from `context/foundation/reference-angles.md` (a
promotion of the archived 13-source literature review, three bands reconciled
toward the gravel-adjustment guide's recreational tuning):

| Key (`ANGLE_REFS`) | Angle | Band | Measured at | Convention |
|---|---|---|---|---|
| `KNEE_BDC` | Knee angle at BDC | 135–145° | Bottom of pedal stroke (6 o'clock) | included |
| `KNEE_TDC` | Knee angle at TDC | 68–74° | Top of pedal stroke (12 o'clock) | included |
| `HIP` | Hip angle at TDC | 55–70° | Top of pedal stroke (12 o'clock) | included |
| `TORSO` | Torso angle | 45–55° | Hands on hoods, cranks horizontal | from horizontal |
| `ELBOW` | Elbow angle | 150–165° | Riding on hoods | included |

**Rationale.** Knee-at-BDC (135–145°) and knee-at-TDC (68–74°) follow the
archived `angle-to-adjustment-guide.md` §1–§2 recreational tuning; hip widened
to 55–70° per guide §3 (gravel/recreational — opening the hip improves
breathing capacity and reduces lower-back stress); torso unchanged (both
source docs agree 45–55°). Elbow widened 150–160° → 150–165° to match the
practitioner included-angle range for a relaxed hoods position (BikeFittr
angle chart, ICA goniometer protocol, torger.se all put the included elbow
angle on the hoods at 150–170°). The adjustment guide's 85–95° "elbow" figure
is a measurement mismatch, not a road-vs-gravel convention split — it is the
upper-arm-to-torso "shoulder forward angle" (`bike-fitting-ref-angles.md:57`,
listed separately at 80–90°), not the shoulder–elbow–wrist included angle the
app computes; ~90° included is the aggressive TT/aero position. The
triplicated band copy (code constant, prompt table, prompt per-angle
thresholds) is collapsed to a single source — `ANGLE_REFS` drives a generated
recommendations prompt (`src/lib/recommendations-prompt.ts`).

## Notes

This is the durable home for the **reference-band dimension of Risk #1**:
*which* numeric range each of the five body angles is judged against.

**Status: implemented (2026-09-03).** The owner decision has been made and
recorded in `## Decision` above — see `plan-brief.md` / `plan.md` in this
folder. The plan blessed
`context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`
as the authoritative source (promoted to
`context/foundation/reference-angles.md`), reconciled the three shifted
bands toward the gravel-adjustment guide, widened the elbow to the
practitioner included-angle range, collapsed the triplicated prompt copy into
a generator sourced from `ANGLE_REFS`, and closed OQ-2 everywhere.

### Why this exists

`context/changes/testing-angle-correctness/` (test-plan §3 Phase 1) defends
only the **geometry / convention** dimension of Risk #1 — that the code
measures the angle the fitting literature *means* (correct vertex,
included-vs-flexion convention, torso from horizontal), verified against an
oracle taken from the archived reference-angle notes. It deliberately does
**not** assert against the shipped `ANGLE_REFS` values, and `angleVerdict`
is unit-tested with synthetic bands. Once §3 Phase 1 is marked `complete`,
"Risk #1 defended" must not be read as covering the bands themselves.

### The decision, as originally framed — resolved 2026-09-02 (see `## Decision` above)

The reference bands were triplicated across three copies:

- `src/lib/pose/angles.ts` `ANGLE_REFS.ELBOW` was `150–160°`.
- `context/archive/2026-05-28-ai-analysis-pipeline/angle-to-adjustment-guide.md:126–128`
  gives `85–95°` for gravel/hoods and its **Convention note** frames the
  `150–160°` vs `85–95°` gap as a road-vs-gravel split. **That framing is a
  measurement mismatch, not a convention difference:** `85–95°` is within
  rounding of the upper-arm-to-torso "shoulder forward angle"
  (`bike-fitting-ref-angles.md:57` lists it separately at 80–90°), not the
  shoulder–elbow–wrist *included* angle the app computes. ~90° included is
  the aggressive TT/aero position; every practitioner reference for the
  included elbow angle on the hoods lands at 150–170°. See
  `context/foundation/reference-angles.md` § "The elbow is not a
  road-vs-gravel conflict".
- The same ranges were re-stated as prose in the recommendations system
  prompt (`src/lib/services/llm.ts`) — now generated from `ANGLE_REFS` via
  `src/lib/recommendations-prompt.ts`.

The owner decision needed: the **authoritative gravel road-position
reference bands for all five angles** (knee at BDC, knee at TDC, hip, torso,
elbow), sourced from bike-fitting literature or a certified-fitter consult,
per Roadmap OQ-2. Owner: user. Block: yes. **→ Made 2026-09-02 — see
`## Decision` above; source of record is
`context/foundation/reference-angles.md`.**

### Links

- `context/changes/testing-angle-correctness/plan.md` — the Phase 1 plan
  that scoped this out (see "What We're NOT Doing").
- `context/foundation/test-plan.md` §7 — negative-space entry for the
  reference-band dimension.
- `context/foundation/prd.md` Open Question #2.
- `context/foundation/roadmap.md` Open Roadmap Question 2.
