# Bike Fitting: Translating Angles into Concrete Adjustments

Reference angles: `bike-fitting-ref-angles.md`. This document answers: "given the measured angle, what do I actually turn or slide, and by how much?"

---

## Mental model

Every angle has one **primary lever** and one or more **secondary levers**. Adjust the primary first; re-measure all angles before touching a secondary. Adjustments interact — changing saddle height shifts hip angle; changing fore/aft shifts effective saddle height.

**Order of operations (always follow this sequence):**

1. Saddle height → fixes knee angle at BDC
2. Saddle fore/aft → fixes hip angle at TDC
3. Bar height (spacers / stem angle) → fixes torso angle
4. Stem length → fixes elbow/reach angle
5. Cleat position → fixes ankle angle and knee tracking

---

## 1. Knee angle at 6 o'clock (BDC)

**Target (gravel, recreational):** 135–145° included / 35–45° flexion from full extension, measured **dynamically during pedalling** [13, 16]

> Holmes (1994) [10] defines 25–35° using a static goniometer (crank at 6 o'clock, foot horizontal). Dynamic pedalling adds ~8° (Farrell et al., Peveler et al.) giving a validated dynamic BDC range of 33–43°. The 35–45° target here sits at the upper end of that dynamic range, favouring comfort over peak power output — appropriate for gravel/recreational riding. Performance-oriented cyclists should target the lower half (135–140° / 35–40°).

### Primary lever: saddle height

**Rule of thumb: 1 mm saddle height ≈ 1° knee angle change.**

Derived from the saddle-height prediction equation [16]: `SH = 7.41 + 0.82×inseam − 0.1×target_flexion°`, where the −0.1 coefficient yields 1 mm/° directly. The Ferrer-Roca (2012) equation [17] (`SH = 22.1 + 0.896×inseam − 0.15×KA`) implies ~1.5 mm/°; treat 1 mm/° as a conservative lower-bound approximation and round moves up when near a range boundary.

| Measured angle | Delta from target midpoint (140°) | Action |
|---|---|---|
| 130° (knee too bent) | −10° | Raise saddle ~10 mm |
| 133° | −7° | Raise saddle ~7 mm |
| 138° | −2° | Raise saddle ~2 mm |
| 142° | +2° | Lower saddle ~2 mm |
| 147° | +7° | Lower saddle ~7 mm |
| 152° (too straight) | +12° | Lower saddle ~12 mm |

**Practical rules:**
- Make adjustments in 3–5 mm increments; allow 2–3 rides between changes.
- Never move more than 10 mm in a single session.
- Mark current seatpost position before any adjustment.
- Crank length change of 5 mm requires the same saddle height correction (e.g., switching from 172.5 mm to 175 mm cranks → lower saddle ~5 mm).
- New shoes / pedal system / saddle model: re-check height immediately (stack differences are typically 3–8 mm).

### Secondary levers (smaller effect)

| Factor | Direction | Effect |
|---|---|---|
| Cleat moved rearward 3 mm | increases effective leg length | raises angle ~1–2° → may need saddle drop of ~1–2 mm |
| Thicker shoe sole +3 mm | same as rearward cleat | lower saddle ~2–3 mm |
| Ankle plantarflexes more (toe-down) | reduces measured knee angle at BDC | fix ankle pattern or cleat first |

---

## 2. Knee angle at 12 o'clock (TDC)

**Target (practitioner estimate — no primary research consensus):** 68–74° included at maximum knee flexion [3]. Below 68° = saddle too low; above 74° may indicate saddle too high or cranks too long.

Driven by the **same saddle height** as BDC. If BDC is in range but TDC is too acute (< 68°), the saddle is still too low — trust the TDC signal over BDC in ambiguous cases.

---

## 3. Hip angle at 12 o'clock (TDC)

**Target:** 55–65° road; up to 70° gravel/recreational (thigh-to-torso angle at TDC, larger = more open) [Burt 2014 via 13]. Professional cyclists average ~59° at their preferred position.

### Primary lever: saddle fore/aft (horizontal position)

| Measured hip angle | Action |
|---|---|
| < 55° (too closed, hip impingement risk) | Move saddle forward 5 mm; re-measure |
| 55–65° | Road target — in range |
| 65–70° | Gravel/recreational — acceptable; verify no power-loss symptoms |
| > 70° (too open, power loss at TDC) | Move saddle backward 5 mm; re-measure |

**Sensitivity:** a 10% backward shift of typical setback (~5–8 mm on most bikes) produces a measurable increase in peak hip flexion. Work in 3–5 mm increments.

**Adjustment method (KOPS baseline):**
With crank at 3 o'clock, a plumb line from the tibial tuberosity should intersect the pedal spindle ±5 mm. Use this as a starting point only — KOPS has no peer-reviewed evidence base [13]; hip angle measurement is the primary criterion.

### Secondary lever: saddle height

Raising the saddle slightly opens the hip angle at TDC (leg is more extended, pulling the thigh away from the torso). If hip angle is borderline, finalize saddle height first — it has a secondary upward effect on hip angle.

### Coupling note

Moving the saddle forward to open the hip angle also slightly raises the effective saddle height (the rider is now closer to the BB horizontally, effectively pedaling at a slightly higher position). After any fore/aft move > 5 mm, recheck knee angle at BDC.

---

## 4. Torso angle

**Target (gravel, recreational):** 45–55° from horizontal [Burt 2014 via 13]

### Primary lever A: bar height (spacers + stem angle)

Each 5 mm headset spacer adds ~1–2° of torso angle (more upright). This varies with torso length.

| Measured torso angle | Delta from midpoint (50°) | Action |
|---|---|---|
| 40° (too flat) | −10° | Add ~25 mm of spacers, or flip stem to positive rise |
| 44° | −6° | Add ~15 mm of spacers |
| 48° | −2° | Add ~5 mm spacer |
| 52° | +2° | Remove ~5 mm spacer |
| 56° | +6° | Remove ~15 mm of spacers or switch to negative-rise stem |
| 60° | +10° | Remove ~25 mm spacers or use −6° stem (on 100 mm stem, −6°/+6° flip = ~21 mm height change) |

**Stem flip calculation:** on a 100 mm stem, changing angle by θ degrees changes bar height by `100 × sin(θ°)` mm. A −6° to +6° flip (12° change) = 100 × sin(12°) ≈ 21 mm rise.

### Primary lever B: stem length (reach component)

A shorter stem raises the effective bar position slightly due to head tube angle geometry, and simultaneously reduces reach. Use stem length primarily for reach (elbow angle — see §5); use spacers/stem angle primarily for height (torso angle). They interact, so adjust one at a time.

### Gravel-specific note

Gravel targets 45–55° vs road endurance's 40–50°. If migrating from a road fit, expect to add 10–20 mm of spacers or use a shorter, more upright stem.

---

## 5. Elbow / arm angle

**Target (gravel, hoods):** 85–95° (included angle at the elbow; 180° = arm fully straight) [2]

> **Convention note:** sources targeting competitive road cyclists (Burt 2014 [13]) recommend 20–30° flexion from full extension (≈ 150–160° included) — reflecting a flatter, more aggressive position with nearly straight arms. The 85–95° included-angle target here is consistent with a gravel/recreational position where the upper body is more upright and bars are relatively high. Both conventions agree that arms must never be locked straight.

### Primary lever: stem length (reach)

Every 10 mm stem length change ≈ 10 mm reach change ≈ 5–10° arm angle change (exact value depends on arm length).

| Measured elbow angle | Action |
|---|---|
| < 75° (over-extended, arms nearly straight) | Shorten stem 10–20 mm |
| 75–85° | Shorten stem 10 mm; or raise bars 5–10 mm |
| 85–95° | In range |
| 95–105° | Lengthen stem 10 mm; or lower bars slightly |
| > 105° (too cramped) | Lengthen stem 10–20 mm |

**Quick check:** if elbows are locked straight → too long a reach; if forearms rest on thighs → too short.

### Secondary lever: bar height

Raising bars shortens effective reach slightly (due to head tube angle). 10 mm of spacers = ~3–4 mm less reach on a typical 72° head tube angle bike. Use this to fine-tune after stem length is set.

---

## 6. Ankle angle

**Target:**
- 3 o'clock (power phase): 85–95° (neutral, 0° = perpendicular to shin)
- 6 o'clock (BDC): 5–15° toe-down preferred, up to 20° acceptable (95–110° included) [Burt 2014 via 13]
- 12 o'clock (TDC): 20–30° toe-down

### Primary lever: cleat fore/aft position

Ball of foot (1st metatarsal head) should sit 0–5 mm behind the pedal spindle.

| Observation | Action |
|---|---|
| Excessive heel drop at BDC (heel lower than toe) | Move cleat rearward 3 mm (or lower saddle 3 mm) |
| Too much toe-down at BDC (> 20°) | Check saddle height first; if correct, move cleat forward 3 mm |
| Ankle nearly frozen / no movement | Cleat may be too far forward — move back 3 mm; or saddle too low |
| Calf fatigue (gravel/tri riders) | Move cleat 3–5 mm rearward to offload calf |

### Secondary lever: saddle height

- Saddle too high → excessive toe-down at BDC (ankle compensates to reach pedal).
- Saddle too low → heel drops (ankle dorsiflexes to fill the gap).
- Fix saddle height first; cleat fore/aft is fine-tuning.

### Lateral correction: cleat wedges

Not a degree-of-rotation adjustment — wedges correct **frontal-plane foot angle** (forefoot varus/valgus).

| Symptom | Action |
|---|---|
| Knee drifts inward (valgus) during power phase | 1–2° varus wedge under cleat (forefoot side down) |
| Knee drifts outward (varus) | 1–2° valgus wedge |
| Leg length discrepancy > 3 mm | Cleat shim (spacer) on shorter side, not a wedge |

Start with one wedge; reassess over 2–3 rides before adding a second.

---

## Quick-reference table

| Angle out of range | Primary adjustment | Increment | Notes |
|---|---|---|---|
| Knee BDC too closed (< 135°) | Raise saddle | 5 mm | 1 mm ≈ 1° |
| Knee BDC too open (> 145°) | Lower saddle | 5 mm | Check for hip rock first |
| Hip too closed (< 55°) | Move saddle forward | 5 mm | Recheck knee BDC after |
| Hip too open (> 70°) | Move saddle backward | 5 mm | Recheck knee BDC after |
| Torso too flat (< 45°) | Add spacers or flip stem up | 5–10 mm | Use stem flip for large changes |
| Torso too upright (> 55°) | Remove spacers or use negative stem | 5 mm | |
| Elbow over-extended (< 85°) | Shorten stem | 10 mm | One size at a time |
| Elbow too bent (> 95°) | Lengthen stem | 10 mm | |
| Ankle too toe-down at BDC (> 20°) | Lower saddle or move cleat forward | 3–5 mm | Saddle first |
| Ankle too heel-down at BDC (heel below neutral) | Raise saddle or move cleat rearward | 3–5 mm | Saddle first |
| Knee drifts medially/laterally | Cleat wedge 1–2° | 1 wedge at a time | |

---

## Coupling effects (always re-check after each change)

| Change made | What else to recheck |
|---|---|
| Saddle height ±5 mm | Hip angle at TDC |
| Saddle fore/aft ±5 mm | Knee angle at BDC (effective height change) |
| Cleat fore/aft ±3 mm | Saddle height (effective leg length change) |
| Bar height ±10 mm | Elbow angle (reach changes slightly) |
| Stem length ±10 mm | Torso angle (height changes slightly) |
| Crank length ±5 mm | Saddle height (raise if shorter cranks, lower if longer) |

---

## Sources

### Fitting tools and practitioner guides

1. **bikethomson.com** — "What Is the Correct Height of a Bike Seat?" (Oct 2025)
   <https://bikethomson.com/blog/what-is-the-correct-height-of-a-bike-seat/>
   1 mm saddle height ≈ 1° knee angle rule; fine-tuning increments (2–5 mm).

2. **BikeFittr** — "Finding the Perfect Balance: Adjusting Bike Fit for Comfort and Performance" (Nov 2023)
   <https://www.bikefittr.com/blog/posts/basic-bike-fit-principles/bike-fit-comfort-vs-performance>
   Bike-type angle tables; hip angle guidance.

3. **BikeFitAdviser** — "A (not so) Basic Bike Fit Part 3: Bike Fit Joint Angles" (Feb 2017)
   <https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles>
   Practical joint-angle ranges; hip-angle lever analysis.

4. **MyVeloFit** — "Bike Fit Adjustments: The Right Order for the Best Results" (Dec 2022)
   <https://www.myvelofit.com/fit-academy/bike-fitting-order-of-adjustments/>
   Order-of-operations rationale; fore/aft ↔ height coupling.

5. **Average Joe Cyclist** — "How to Find the Right Height and Setback for Your Bike Saddle" (Feb 2025)
   <https://averagejoecyclist.com/how-to-choose-right-bike-saddle/>
   KOPS baseline; saddle setback ranges by discipline.

6. **Pedal Chile** — "Is a Bike Fit Worth It?" (Jul 2020)
   <https://pedalchile.com/blog/bikefit>
   Saddle-height power-output data; fore/aft effect illustrations.

7. **Peloton Physio** — "Physio Bike Fit" (service overview)
   <https://www.pelotonphysio.com.au/physio-bike-fit>
   Cleat wedge and lateral-correction clinical practice.

8. **Steve Hogg** — "Seat Height — How Hard Can It Be?" (Feb 2011)
   <https://www.stevehoggbikefitting.com/bikefit/2011/02/seat-height-how-hard-can-it-be/>
   Velocity-of-extension cue; 3 mm increment protocol; never >10 mm in one session.

9. **Steve Hogg** — "Seat Set Back: For Road Bikes" (May 2011)
   <https://www.stevehoggbikefitting.com/bikefit/2011/05/seat-set-back-for-road-bikes/>
   Balance-point theory for fore/aft; torso-length interaction.

### Peer-reviewed research

10. **Holmes J.C., Pruitt A.L., Whalen N.J.** — "Lower extremity overuse in bicycling." *Clin Sports Med.* 1994;13(1):187–205.
    Original Holmes static-KFA method: 25–35° at BDC, measured with goniometer, crank at 6 o'clock, foot horizontal. Dynamic pedalling adds ~8°, giving a dynamic BDC range of 33–43°.

11. **Peveler W.W.** — "Effects of Saddle Height on Economy in Cycling." *J Strength Cond Res.* 2008;22:1355–1359. PubMed: 18545167
    <https://pubmed.ncbi.nlm.nih.gov/18545167/>
    25° KFA more economical than 35° or 109%-inseam method.

12. **Bini R.R. et al.** — "Effects of Bicycle Saddle Height on Knee Injury Risk and Cycling Performance." *Sports Med.* 2011;41:463–476. PubMed: 21615188
    <https://pubmed.ncbi.nlm.nih.gov/21615188/>
    5% saddle height change → 35% change in knee kinematics; supports small-increment adjustments.

13. **Holliday W. et al.** — "Anthropometrics, flexibility and training history as determinants for bicycle configuration." *PMC9219349* (2022)
    <https://pmc.ncbi.nlm.nih.gov/articles/PMC9219349/>
    Validates 25–35° static KFA; torso-angle 45–55° for recreational cyclists.

14. **García-López J. et al.** — "Changes in saddle setback and intensity affect comfort and lower limb kinematics in recreational cyclists." *PMC12238236* (2025)
    <https://pmc.ncbi.nlm.nih.gov/articles/PMC12238236/>
    10% rearward setback → greater joint extension; comfort decreases backward of preferred; new setback regression equation.

15. **Burt P. et al.** — "Intervention at the Foot-Shoe-Pedal Interface in Competitive Cyclists." *PMC4970853* (2016)
    <https://pmc.ncbi.nlm.nih.gov/articles/PMC4970853/>
    Cleat wedges and orthoses alter frontal-plane knee kinematics; basis for wedge-correction protocol.

16. **[Author(s) to verify]** — "Equations to prescribe bicycle saddle height based on desired joint kinematics and bicycle geometry." *Eur J Sport Sci.* 2022. <https://www.sponet.de/sponet/Record/4068511>
    Full equation (R²=0.97, n=40 adults): `SH = 7.41 + 0.82(inseam) − 0.1(min KFA) + 0.003(inseam)(seat tube angle°)`. Dropping the small seat tube angle term for typical 73° STA gives the simplified form `SH ≈ 7.41 + 0.82×inseam − 0.1×target_KFA` used in this document. **Note:** this formula was previously mis-attributed to Arnie Baker (2002); that book does not contain it.

17. **Ferrer-Roca V., Roig A., Galilea P., García-López J.** — "Influence of saddle height on lower limb kinematics in well-trained cyclists: Static vs. dynamic evaluation in bike fitting." *J Strength Cond Res.* 2012;26(11):3025–3029.
    Validated dynamic KFA range 30–40°; proposed equation `SH = 22.1 + 0.896×E − 0.15×KA` (−0.15 coefficient implies ~1.5 mm/° saddle-height sensitivity vs the 1 mm/° from source 16).
