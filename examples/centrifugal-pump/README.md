# P-301 · Live centrifugal pump (break it, foul it, fix it)

The second worked example for the `process-sim` skill. It's a hot condensate return pump: a vented receiver at 82 °C feeds an end-suction centrifugal pump through a Y-strainer. The pump sends the condensate up to the deaerator through a level-control valve. Open the casing to watch the impeller spin and liquid flow through the eye, the vanes and the volute. The cutaway also shows the mechanical seal, both bearings with their balls, the coupling and the motor windings. Then break something and watch which number on the board moves first.

The fluid is hot on purpose. At 82 °C the condensate is close to boiling, so NPSH margin is the story: lose suction head and the pump cavitates.

## Run it

**Live:** https://ivanegetov-lab.github.io/process-sim/pump/ (runs in your browser, nothing to install)

Locally:

```bash
cd examples/centrifugal-pump
python3 -m http.server 8788        # then open http://localhost:8788/
node test-sim.mjs all              # the model's response to every fault, in numbers
node ../../scripts/check_tells.mjs sim.js tells.mjs
```

URL flags (same as the column): `?open` starts cut open, `?clean` hides the panels, `?speed=600` sets sim-seconds per real second, `?record` steps frames only via `APP.tick(dt)`, `&camslow=2` slows camera flights for recordings.

## Files

| File | What |
|------|------|
| `sim.js` | The pump model. Plain JS, no deps, Node + browser (`window.PumpSimLib`). Also curve helpers (`curveH`, `systemH`, `npshAat`, `npshRat`) for the chart. |
| `scene.js` | three.js skid: receiver, strainer, volute with spinning 6-vane impeller, seal, bearing frame, coupling, motor, piping; cutaway, particles, cavitation bubbles, seal drips, vortex. |
| `app.js` | UI, fault table (`FX`), tells, KPIs, pump-curve + NPSH chart, vibration spectrum, trends, alarms, info cards, camera. `window.APP` for scripted recording. |
| `index.html` | Layout and styles (shared with the column). |
| `tells.mjs` | First-tell rules, checked by `node ../../scripts/check_tells.mjs sim.js tells.mjs`. |
| `test-sim.mjs` | `node test-sim.mjs [all\|str\|wear\|brg\|mis\|seal\|lt\|valve\|surge]` prints the response to each fault. |

## The model

- **Pump against system:** `H = hm (H0 − c (Q·(1+0.4·wear))²)` against static head, suction/strainer/discharge friction and an equal-percentage valve. Flow is solved from the head balance each step with a short pipe-inertia lag. Pump and system curves cross at the operating point on the chart.
- **NPSH:** NPSHa comes from receiver height and level, minus suction and strainer losses, minus vapor pressure at the casing temperature. NPSHr rises with flow. Below 1.6 × NPSHr cavitation starts (noise, broadband vibration, pitting). Below NPSHr the head breaks down.
- **Vibration by component at both bearings:** 1×, 2×, vane pass (6×, up off-BEP), BPFO 3.07× with harmonics and sidebands, and broadband for cavitation and vortexing. The overall is the RMS sum and is graded against ISO 10816-3 zones (2.8 / 4.5 mm/s alarms).
- **Heat:** a casing energy balance, so a deadheaded pump heats up and flashes. Bearing temperatures lag their causes.
- **Power:** a radial-pump power curve, motor amps at 460 V. Seal leakage grows with face wear.
- **Interlocks:** LSLL-301 low-low level, TAHH-303 casing temperature, bearing seizure (motor overload).
- **Simplified:** single-phase liquid, a lumped cavitation model, no rotor dynamics, wear compressed from years into hours. Illustrative textbook values, **not a real plant and not for design or sizing.**

Design point: 90 m³/h at 39.5 m head, 78% efficiency (BEP 100 m³/h), LV-310 at 71%, NPSHa 7.9 m vs NPSHr 3.5 m, 13.1 kW, 19 A, overall vibration 1.3 / 1.1 mm/s.

## Faults and their first tell

`check_tells.mjs` result: every slow fault tells first.

| Fault | First tell | First P1/P2 alarm |
|------|------|------|
| Plug the suction strainer | PDI-305 ΔP up 8 kPa at 8.2 h, everything else normal | 23.3 h (receiver level high). Cavitation starts at ~13.6 h, the vibration advisory comes at 18.9 h |
| Wear the impeller | LV-310 creeps open 8 points (15 h), amps up for the same flow | 34.7 h (valve pinned, level high) |
| Start a bearing defect | BPFO peak in the spectrum at 11.6 h while the overall is still zone A/B | 27.4 h (vibration zone D), then heat, then seizure at 40 h |
| Misalign the coupling | 2× > 1× at the coupling-end bearing, instantly | never (zone C advisory, thrust bearing runs hot) |
| Wear the mechanical seal | Steady drip, 0.6 L/h at 8.8 h | 22.7 h (seal leak pot) |
| Drift the LT-301 level transmitter | PI-305 suction pressure falls while LI-301 reads steady (1.3 h) | 2.7 h (independent LSL-302), then vortexing and the LSLL trip |
| Fail the discharge valve shut | Flow zero, amps drop, pump still running | fast: deadhead, casing heats ~2 °C/min, receiver overflows |
| Surge the condensate return | LV-310 opens, level holds | never (a disturbance, not a failure) |

The `TELLS` text in `app.js` is written to be replaced in your own words, from pumps you have actually run.
