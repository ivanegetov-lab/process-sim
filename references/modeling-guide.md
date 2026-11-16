# Modeling guide

Aim for a model that behaves right, is fast enough to run 3,600x real time in a browser, and is simple enough to explain. Not a design simulator.

## Structure

- **States** are inventories: liquid holdup (kmol or m³), component holdup (M·x), gas/vapor inventory (as pressure), stored heat (as temperature) where it matters.
- **Flows are algebraic** from the current states: weirs, valves, pumps, heat transfer. Compute all flows first, then integrate all states with the same step.
- **Explicit Euler with a fixed step** (0.5 s in the example) is fine if every time constant is at least about 5 steps. Check: τ ≈ holdup / (d outflow / d holdup). If something is too fast, make it algebraic (solve it each step) instead of shrinking the step.
- **Settle on start.** Initialize with a rough profile, run 8 to 12 simulated hours with controllers in auto, then set setpoints to the settled values and clear history and costs.
- **Measurements are separate from truth.** `meas.T5 = true T5 + drift`. Instrument faults change the measurement, not the process, and the controller acts on the measurement.

## Building blocks

**Tank / tray / sump holdup**
`dM/dt = Σin − Σout`. Outflow by weir `L = Kw·max(0, M − Mw)^1.5`, by valve `F = Fmax·(v/100)·g(level)`, or by pump with a suction cutoff at low level (that's cavitation and loss of suction for free).

**Composition**
`d(M·x)/dt = Σ F_in·x_in − Σ F_out·x`. Then `x = (M·x)/M`. Clamp 0..1.

**Vapor-liquid equilibrium**
Antoine for vapor pressure, Raoult for ideal mixtures, bubble-point temperature by Newton at each stage's own pressure. Murphree efficiency: `y = y_in + E·(y* − y_in)`. For non-ideal mixtures add an activity model only if the audience will notice.

**Pressure from gas inventory**
`dP/dt = (gas in − gas out) / C`, where `C ≈ V / (R·T)` in kmol per kPa. Condensers, compressors and vents set "gas out". This makes pressure self-regulating the way real columns and headers are.

**Heat exchangers**
`Q = UA·ΔT` (LMTD if the approach is tight). Fouling is a multiplier on UA that ramps down. For a steam-heated exchanger with a control valve, solve steam-side pressure each step so valve flow equals exchanger duty (bisection, about 30 iterations). That is what makes a fouling exchanger show up as a valve creeping open before it shows up as lost duty.

**Cooling water / utilities**
Flow fraction from the valve, saturating effect on duty (`g = v/(v + 0.3)`). A utility loss sets availability to 0.

**Control valves**
Linear: `F = Fmax·v/100` (add `√ΔP` if pressure varies a lot). Fail position matters: an instrument-air fault drives the valve to its fail position no matter what the controller asks.

**PI controllers (velocity form)**
`op += Kc·((e − e_prev) + (dt/Ti)·e)`, clamped 0..100 (the clamp is the anti-windup). Reverse action where needed (level-to-outflow, pressure-to-cooling). Tune by running the Node test until it's steady and doesn't ring.

**Hydraulics for trays/packing**
Jet flood % from vapor velocity vs a Fair-type limit `u_f = Csb·√((ρL − ρV)/ρV)`. Efficiency drops above ~85% flood (entrainment) and below ~35% (weeping). Pressure drop = dry + liquid head, rising sharply in flood. Liquid stacking when a stage is full: restrict the inflow from above.

**Interlocks and reliefs**
Latch trips (`trip.steam = true` until reset). Reliefs vent proportional to overpressure.

**Costs (optional)**
Integrate utility cost and off-spec downgrade per hour. People remember dollars.

## Other units, quick recipes

- **Shell-and-tube exchanger train**: outlet temperatures from effectiveness-NTU, fouling on either side, bypass valve, tube leak as cross-contamination.
- **Boiler / steam drum**: drum level with swell/shrink on load change, feedwater valve, three-element control, tube fouling, low-level trip.
- **Centrifugal compressor**: flow-head curve, surge line, anti-surge recycle valve, suction strainer plugging (falling suction pressure), seal gas loss.
- **CSTR reactor**: Arrhenius rate, jacket cooling with fouling, runaway when heat generation outruns removal, agitator failure.
- **Pump system**: pump curve against system curve, minimum flow recycle, cavitation at low suction head (capacity loss plus vibration), worn impeller as a head multiplier.
- **Tank farm / transfer**: levels, transfer pumps, overfill with a high-high trip, a level transmitter that freezes.

## Test before you draw

Write a Node harness (see the example's `test-sim.mjs`) that prints the steady state and every fault at a few time points. Check the design point against the user's numbers, the direction of every move, and that nothing goes NaN.
