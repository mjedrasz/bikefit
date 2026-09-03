---
project: "BikeFit"
status: authoritative
created: 2026-09-02
updated: 2026-09-02
supersedes: context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md
---

# Gravel Bike Fitting — Authoritative Reference Angles

**Authoritative.** Resolves PRD Open Question #2 / Roadmap OQ-2, 2026-09-02.
Supersedes `context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`,
kept for source detail.

This is the project's single citable home for the five gravel/recreational
reference bands. `ANGLE_REFS` in `src/lib/pose/angles.ts` carries these exact
numbers and is pinned to this doc by `src/lib/pose/angles.test.ts`; the
recommendations system prompt is generated from `ANGLE_REFS`
(`src/lib/recommendations-prompt.ts`), so a band number lives in exactly one
place in code and traces back here.

Measured angle → "in range / outside range" verdict is `angleVerdict`
(`src/lib/angle-verdict.ts`); recommendations against these bands are
`generateRecommendations` (`src/lib/services/llm.ts`).

## Canonical bands

Keyed to `ANGLE_REFS` keys. The band is the inclusive `[min, max]` range in
degrees.

| Key (`ANGLE_REFS`) | Angle | Band | Measured at | Convention |
|---|---|---|---|---|
| `KNEE_BDC` | Knee angle at BDC | 135–145° | Bottom of pedal stroke (6 o'clock) | included |
| `KNEE_TDC` | Knee angle at TDC | 68–74° | Top of pedal stroke (12 o'clock) | included |
| `HIP` | Hip angle at TDC | 55–70° | Top of pedal stroke (12 o'clock) | included |
| `TORSO` | Torso angle | 45–55° | Hands on hoods, cranks horizontal | from horizontal |
| `ELBOW` | Elbow angle | 150–165° | Riding on hoods | included |

"Included" = the angle at the joint vertex, `180°` = a straight limb (what
`jointAngle(a, b, c)` computes). "From horizontal" = the angle of the
hip→shoulder line above the horizontal, folded to `[0, 90]` (what
`computeTorsoAngle` computes).

## Reconciliation

The archived literature review (`bike-fitting-ref-angles.md`, 13 sources) and
its companion `angle-to-adjustment-guide.md` were reconciled toward the more
gravel/recreational-tuned of the two. Only three bands moved; the source
literature is unchanged.

- **Knee at BDC → 135–145°** (was 137–147°). Follows
  `angle-to-adjustment-guide.md` §1 — 135–145° included / 35–45° flexion,
  measured dynamically during pedalling, sitting at the comfort-favouring
  upper end of the validated 33–43° dynamic range. Performance-oriented
  riders target the lower half (135–140°).

- **Knee at TDC → 68–74°** (was 65–75°). Follows
  `angle-to-adjustment-guide.md` §2 — 68–74° included at maximum knee
  flexion; below 68° the saddle is still too low, above 74° the saddle may
  be too high or the cranks too long. This is a practitioner estimate (no
  primary-research consensus). Note this band **narrows** — a returning
  rider whose knee-TDC sits at 65–67° or 74–75° flips to "Outside range" on
  a fresh analysis.

- **Hip at TDC → 55–70°** (was 55–65°). Widened per
  `angle-to-adjustment-guide.md` §3 — "55–65° road; up to 70°
  gravel/recreational". Opening the hip angle "improves breathing capacity
  and reduces lower-back stress on long rides" (`bike-fitting-ref-angles.md`
  Hip Angle). The widening is asymmetric about the old midpoint, so a
  borderline-open hip can flip verdict on a fresh analysis.

- **Torso → 45–55°** — unchanged. Both docs agree (45° = active end of
  recreational, 55° = relaxed all-day comfort; more upright than road).

- **Elbow → 150–165°** (was 150–160°). The shoulder–elbow–wrist *included*
  angle. `bike-fitting-ref-angles.md:58` gives 20–30° flexion from straight
  = 150–160° included; practitioner references (BikeFittr printable angle
  chart; Indoor Cycling Association goniometer protocol; torger.se) put the
  included elbow angle on the hoods at 150–170°. The band is opened to
  150–165° to cover a relaxed, upright gravel arm. Widening only loosens the
  band (max 160 → 165), so no returning rider is newly flagged.

### The elbow is not a road-vs-gravel conflict

`angle-to-adjustment-guide.md` §5 targets "85–95° (included angle at the
elbow)" for gravel/hoods and its Convention note frames 150–160° vs 85–95°
as a road-vs-gravel split. That framing is a **measurement mismatch**, not a
genuine convention difference:

- 85–95° is within rounding of the *upper-arm-to-torso* "shoulder forward
  angle" that `bike-fitting-ref-angles.md:57` lists as a **separate** row at
  80–90° — a different measurement from the shoulder–elbow–wrist included
  angle the app computes (`jointAngle(wl[11], wl[13], wl[15])`).
- ~90° *included* at the elbow is the aggressive TT/aero position (arms bent
  near a right angle on extensions), not a relaxed gravel position.
- Every practitioner reference for the *included* elbow angle on the hoods
  lands at 150–170°.

This **supersedes the elbow assessment in
`context/changes/testing-angle-correctness/research.md`**, which read the
guide's 85–95° figure as the same measurement the code computes and
concluded `ANGLE_REFS.ELBOW` was contested. It is not — the code's elbow
band is resolved at 150–165°.

## Caveat

`bike-fitting-ref-angles.md` carries an `[Author to verify]` citation caveat
on one source; these bands are blessed as a sourced literature synthesis, not
a certified-fitter consult. Revisit if a fitter consultation happens or a
returning-user verdict-shift complaint traces to a band.

## Sources

Carried forward verbatim from
`context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`.

### Fitting tools and practitioner guides

1. **BikeFittr** — "Finding the Perfect Balance: Adjusting Bike Fit for Comfort and Performance" (Nov 2023)
   <https://www.bikefittr.com/blog/posts/basic-bike-fit-principles/bike-fit-comfort-vs-performance>

2. **BikeFittr** — "Bike Fit Terminology: The Complete Glossary for Cyclists" (Apr 2025)
   <https://www.bikefittr.com/blog/posts/basic-bike-fit-principles/bike-fit-terminology>

3. **BikeDynamics** — "Saddle Height" (fit02, updated May 2020)
   <https://bikedynamics.co.uk/fit02.htm>

4. **BikeDynamics** — "Fit Guidelines"
   <https://bikedynamics.co.uk/guidelines.htm>

5. **BikeFitAdviser** — "A (not so) Basic Bike Fit Part 3: Bike Fit Joint Angles" (Feb 2017)
   <https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles>

6. **BikeFitAdviser** — "Knee Extension and Saddle Height" (Apr 2018)
   <https://www.bikefitadviser.com/blog/knee-extension-and-saddle-height>

### Gravel-specific fit guides

7. **Graveleur.cc** — "Gravel Bike Fit: Maximising Comfort and Performance" (Apr 2024)
   <https://graveleur.cc/features/gravel-bike-fit-guide>

8. **bicyclenest.com** — "Gravel Bike Fit Differences From Road Bikes Explained" (Jan 2026)
   <https://bicyclenest.com/gravel-bike-fit-differences-from-road-bikes-explained/>

### Expert practitioners

9. **Colby Pearce** — "Fitting a Cyclocross Bike" (gravel/CX fit principles, Dec 2014)
   <https://www.colbypearce.com/fitting-a-cyclocross-bike/>

10. **Colby Pearce, Andy Pruitt, Todd Carver** — "Bike Fit Philosophy" — Fast Talk Laboratories podcast ep. (Oct 2021)
    <https://www.fasttalklabs.com/fast-talk/bike-fit-philosophy-with-dr-andy-pruitt-colby-pearce-and-todd-carver/>

### Peer-reviewed research

11. **Holmes J.C., Pruitt A.L., Whalen N.J.** — "Lower extremity overuse in bicycling." *Clin Sports Med.* 1994;13(1):187–205.
    Origin of the Holmes static knee flexion method (25–35° at BDC).

12. **Bini R.R. et al.** — "Comparison of static and dynamic methods based on knee kinematics to determine optimal saddle height in cycling." *Acta Bioeng. Biomech.* 2019. PubMed: 32022807
    <https://pubmed.ncbi.nlm.nih.gov/32022807/>
    Establishes that dynamic BDC angle is ~8° greater than static (Holmes), yielding a dynamic range of 33–43°.

13. **Holliday W. et al.** — "Anthropometrics, flexibility and training history as determinants for bicycle configuration." *PMC* (2022)
    <https://pmc.ncbi.nlm.nih.gov/articles/PMC9219349/>
    Validates 25–35° static KFA and 45–55° torso angle for recreational cyclists.

### Elbow reconciliation — additional practitioner references

These are the included-elbow-angle references used to widen `ELBOW` to
150–165° (2026-09-02); they are not part of the original 13-source review.

- **BikeFittr** — printable bike-fit angle chart (elbow *included* angle on the hoods 150–170°; 90–110° for tri / extensions).
- **Indoor Cycling Association** — goniometer measurement protocol ("15–25° bend" at the elbow = 155–165° included).
- **torger.se** — road/gravel fit notes (elbow included angle "150–170").
