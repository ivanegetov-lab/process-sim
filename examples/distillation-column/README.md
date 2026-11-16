# C-101 · Live distillation column (break it, foul it, fix it)

A browser-based 3D distillation column that actually runs. It's a benzene/toluene splitter with 20 valve trays, a kettle reboiler, a water-cooled condenser, a reflux drum, two pumps and six PI loops. Open the cladding, watch vapor bubble through the trays, then break something and watch how the column tells you before quality does.

## Run it

```bash
python3 -m http.server 8787   # in this folder
# open http://localhost:8787/
```

It needs a local server because it loads ES modules. No build step and no npm. three.js is vendored in `vendor/`.

URL flags: `?open` starts with the column cut open, `?clean` hides all panels, `?speed=600` sets the starting sim speed (sim-seconds per real second), `?record` freezes the loop so a script can step frames with `APP.tick(dt)`.

## Files

| File | What |
|------|------|
| `sim.js` | The process model. Plain JS, no deps, works in Node and the browser (`window.ColumnSimLib`). |
| `scene.js` | three.js plant geometry, the cutaway, and per-frame visuals driven by sim state. |
| `app.js` | UI, control-room faceplates, faults, trends, alarms, click-to-inspect, camera. `window.APP` is exposed for scripted recording. |
| `index.html` | Layout and styles. |
| `tells.mjs` | First-tell rules, checked with `node ../../scripts/check_tells.mjs sim.js tells.mjs`. |
| `test-sim.mjs` | `node test-sim.mjs [all\|reb\|cond\|tray\|tc\|dmg\|refl\|cw\|steam\|feed\|pump\|rate\|low]` prints the column response to each scenario. |

## The model (what's real, what's simplified)

- **Real:** tray-by-tray dynamic material balances; Francis-weir liquid hydraulics (holdup lags, liquid stacking); Murphree efficiency; Antoine + Raoult VLE with bubble-point temperature at each tray's own pressure; tray ΔP (dry + liquid head); Fair-style jet flood %, entrainment and weeping; top pressure from the vapor inventory vs condenser duty; a steam-side reboiler solved as a control valve in series with the exchanger (so fouling makes the valve creep); PI loops in velocity form; a PAHH steam trip and a PSV.
- **Simplified:** constant molar overflow (no tray energy balances), ideal VLE, saturated-liquid feed, one lumped vapor capacitance. It's a training model, not a design tool. The UI footer says so.

Design point: 100 kmol/h feed at 50% benzene, reflux 100 kmol/h, 1.37 MW boil-up, 105 kPa top, ΔP 14.7 kPa, about 77% flood. Products are 97.7% benzene overhead and 2.7% benzene in the bottoms. Specs are ≥97.0% and ≤3.5%.

## Faults and their first tell

| Fault | What you see first |
|------|------|
| Reboiler fouling (gradual) | TV-105 creeps from 59% to 100% over about 15 h while quality looks fine; then the bottoms goes off-spec |
| Condenser fouling (gradual) | PV-110 opens to 97% with pressure flat; then pressure runs away and TIC-105 holds the wrong composition |
| Bottom-tray deck fouling (gradual) | Column ΔP climbs; trays 1-2 flood around 36 h |
| TI-105 thermocouple drift (gradual) | No alarm. The controller holds a fake setpoint, the column runs hot, distillate goes off-spec |
| Tray 14 dislodged | A small, permanent quality loss; ΔP drops slightly |
| Reflux valve fails shut | Distillate off-spec in minutes |
| CW pump trip | Pressure spike, PAHH-110 trips the steam, the column dumps |
| Steam header drop | Like reboiler fouling, but in minutes |
| Feed composition swing | The controls absorb it (a disturbance, not a failure) |
| Bottoms pump cavitation | Sump overfills, liquid backs up trays 1-8, ΔP jumps |

The "first tell" text in `app.js` (`TELLS`, `FX`) is written to be edited in your own words.

## What happens when you break something

- **The camera flies to it** (toggle "fly to it"). It opens the cutaway for internal faults and pops the info card.
- **The equipment pulses coral** (shell, tubes, pipes, valve). A radar-ping beacon and a live callout ("⚠ Reboiler fouling · TV-105 steam valve 66% ▲") sit on the spot. When the first tell fires, the callout turns amber. When you fix it, the equipment flashes green.
- **The fault card shows "Since you broke it":** elapsed sim time and before → now for the 3-4 numbers that matter, with ▲▼.
- **Toasts** appear for the break, each new alarm, the fix, and the **first tell** (the moment a good maintenance manager would catch it, before any alarm). The tell is checked to fire hours before the first quality alarm for every slow fault.
- **Trend markers:** ⚠ break, ● first tell, ✓ fix, ⛔ trip.
- **Elsewhere on screen:** the tray profile shades the gap from the clean column and labels the biggest move. KPI cards flash when their state changes and show deltas from the start. Loops hit by the fault light up. Tag labels show ▲▼ on 30-minute moves. Valve actuators turn amber above 85% and red when pinned. A red screen-edge pulse marks a P1 alarm.

## Moving liquid

- The froth on each tray carries a foam texture that flows across the deck toward the outlet weir, at a speed set by that tray's liquid rate.
- The froth bobs, harder when the tray is flooding.
- A liquid sheet spills over each weir and falls down the downcomer.
- The sump surface swirls with boil-up.
- Vapor bubbles rise through the froth.
- Flooding slows the cross-flow and carries droplets upward. Weeping drips liquid through the deck.
