# Fault design: break it, foul it, fix it

A fault is only useful if someone can learn to see it coming. Design each one around its first tell.

## Kinds of faults (aim for a mix)

| Kind | Example | How it develops |
|---|---|---|
| Fouling / plugging | reboiler bundle, condenser CW side, tray decks, strainers | ramps over hours to days |
| Instrument that lies | thermocouple drift, frozen level transmitter, plugged impulse line | ramps or jumps; the process is fine until the controller acts on the lie |
| Mechanical failure | dislodged tray, worn impeller, cavitating pump, stuck valve | jumps |
| Valve fail position | instrument air lost to a fail-closed valve | jumps |
| Utility loss | cooling water pump trip, steam header sag, power dip | jumps, fast consequences, trips |
| Upstream disturbance | feed rate or composition swing | jumps, and the controls should absorb it |

Always include one disturbance the controls handle. People need to see the difference between "the process moved" and "something is broken".

## For each fault, write down

1. **Mechanism**: the one parameter that changes (UA × 0.4, measurement + drift, valve forced to 0, efficiency → 0.05). Keep it physical so the rest of the model produces the symptoms on its own.
2. **Ramp or jump**: ramp rate in severity per hour for gradual faults (the example uses 1/24 to 1/36 per hour for fouling, so it plays out over a simulated day or two at 1 h/s).
3. **Targets**: the equipment that should glow (shell, tubes, pipe, valve, instrument).
4. **The 3 to 4 numbers that tell the story**, shown as before → now in the fault card.
5. **First tell**: a rule on numbers that are already on the board, e.g. `steam valve > its value at break + 10 points`, `column ΔP up 1.2 kPa`, `true temperature − reading > 0.7 °C`. Write the tell text in plain words: what to watch and why it matters.
6. **The fix**: what maintenance actually does ("Clean E-101 bundle", "Replace TE-105"). The Fix button resets the parameter, and the model shows the recovery.

## The ordering rule

For every slow fault, the first tell must fire before the first priority 1-2 alarm. Otherwise the sim teaches people to wait for the alarm.

Prove it with the checker:

```bash
node scripts/check_tells.mjs path/to/sim.js path/to/tells.mjs
```

`tells.mjs` exports `{ faults: { key: { base: (s) => ({...}), tell: (s, b) => boolean } } }`. The checker breaks each fault on a fresh sim, steps one simulated minute at a time for up to 48 hours, and prints the time of the tell and of the first P1/P2 alarm. Fast faults (utility trips) may alarm within a minute; that's fine, and it's part of their lesson.

If a tell comes late, move the threshold or fix the model. Don't edit the text to hide it.

## Tell text style

- Start with what to watch: "Watch PV-110."
- Say what it does and what that means: "The CW valve opens wider while pressure holds. Once it pins, pressure climbs."
- No invented incidents, no blame on people. The system drifted; the reader learns where to look.
- Let the user rewrite these in their own words. It's their experience that makes them credible.
