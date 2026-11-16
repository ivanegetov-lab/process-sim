---
name: process-sim
description: Build a live, browser-based simulation of a process unit or piece of equipment (a 3D cutaway model running on a real dynamic model) with a control room and a break-it / foul-it / fix-it panel that shows how failures develop and what the first tell is before any alarm. Use when someone wants to model a process (distillation column, heat exchanger train, boiler, compressor, reactor, tank farm, pump system, cooling loop...), train staff engineers, operators or maintenance techs on failure modes, show "what happens when X breaks / fouls / drifts", or build an interactive training sim of their own unit.
argument-hint: "[unit to model, or a folder with an equipment list / P&ID / SOPs / operating data]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Process sim

You build one folder that runs in a browser: a 3D model of the user's unit you can open up, a control room with live numbers, and a panel of faults to break, foul and fix. Underneath is a real dynamic model: mass balances, hydraulics, heat transfer, control loops. When something breaks, the numbers move because the physics moves, not because a script says so.

The worked example is `examples/distillation-column/`: a 20-tray benzene/toluene column with a kettle reboiler, condenser, reflux drum, two pumps, six PI loops and ten faults. Read it before you build anything. It is also your scaffold: copy it and replace the model, the geometry and the fault table. A second example, `examples/centrifugal-pump/`, shows the same shape on rotating equipment: pump vs system curve, NPSH, cavitation, and a vibration spectrum by component (1×, 2×, vane pass, bearing defect frequencies). Start from whichever is closer to the user's unit.

**The rule that makes it worth using: every number is calculated, and every fault has a first tell.** The first tell is a number that is already on the board and moves before any alarm or quality complaint. That is what staff engineers and maintenance people are meant to learn: what failure looks like early.

## Step 1. Interview (do not skip)

Use `references/interview.md`. You need, at minimum:

- The unit and its purpose. Who will use the sim (new engineers, operators, maintenance techs, a manager who needs to see why a fix matters).
- Equipment list and streams: vessels, exchangers, pumps, compressors, valves, and how they connect. A P&ID, PFD, equipment list or SOPs are better than memory. Read whatever they give you.
- The normal operating point: rates, pressures, temperatures, levels, compositions, valve positions. **Use their numbers. Never invent plant data.** If they don't have a number, use a textbook value, say so out loud, and mark it in the README.
- Control loops: what each controller measures, what it moves, and fail positions of the valves.
- Product specs or limits that define "bad".
- The failures that matter to them. Ask what has actually gone wrong on this unit: fouling, a stuck valve, an instrument that lied, a pump, a utility loss. Real history beats a generic list. Never invent their incidents.

If they only give you a sentence ("model a heat exchanger"), build a sensible small unit from textbook values, label it as illustrative, and ask what to change.

## Step 2. Build the model (sim.js)

Follow `references/modeling-guide.md`. One plain-JS file, no dependencies, runs in Node and the browser. Keep the API the example uses, because the UI depends on it:

- `new Sim()` settles to steady state (run 8 to 12 simulated hours, then set the controller setpoints to the settled values).
- `advance(seconds)` with a fixed internal step (0.5 s works for most units).
- `setFault(key, on)`, `faults[key] = { active, s }` where `s` is severity 0..1 (gradual faults ramp).
- `getAlarms()` returns `[{ tag, text, pri }]`, priority 1 to 3.
- `history` (one sample per sim-minute), `events` (logbook), `meas` (what the instruments read, which can differ from the truth), `valves`, `ctl` (PI controllers), `money` (optional cost of utilities and off-spec).

Then test it in Node before you draw anything (`examples/distillation-column/test-sim.mjs` shows how): the design point must match their numbers, every fault must move the right numbers in the right direction, and nothing should go to NaN or run away unless that is the point.

## Step 3. Design the faults and their tells

Follow `references/fault-design.md`. For each fault write down: the physical mechanism (which parameter changes), whether it ramps or jumps, the equipment it touches, the 3 to 4 numbers that tell the story, and the first-tell rule.

Then prove the ordering: `node scripts/check_tells.mjs <sim.js> <tells.mjs>` runs every fault and reports when the tell fires and when the first priority 1-2 alarm fires. For every slow fault, the tell must come first. If it doesn't, the lesson is backwards. Fix the threshold or the model, not the text.

Include one disturbance the controls should absorb (the example uses a feed composition swing), so people see the difference between a disturbance and a failure.

## Step 4. Build the scene and UI

Follow `references/ui-guide.md`. Copy the example folder, keep `app.js` and `index.html` mostly as they are, and rewrite:

- `scene.js`: the geometry, built from the helpers already there (`cyl`, `box`, `rod`, `pipe`, `makeValve`, `makePump`, horizontal vessels with level, platforms, clipping-plane cutaways, highlight targets, beacons).
- The `FX` table in `app.js`: per fault, which targets glow, where the beacon sits, where the camera flies, which loops light up, the metrics for "since you broke it", and the tell rule and text.
- `TELLS`, `LOOPS`, the KPI cards, labels, and the info card for each clickable part.

Write the tell text plainly: "Watch TV-105. The steam valve creeps open for hours while quality looks fine." No invented war stories.

## Step 5. Check it

- Serve it (`python3 -m http.server` in the folder, it uses ES modules) and load it in a real or headless browser. The console must be clean.
- Screenshot the closed view, the open view, and each fault after it has developed. Look at them. Fix anything clipped, overlapping, unreadable or off-center.
- Re-run `check_tells.mjs` after any model change.

## Step 6. Hand it over

Tell the user how to run it, which numbers are theirs and which are textbook, what the model simplifies (say it plainly: "training model, not for design or sizing", which is also on screen), and which tell texts they should rewrite in their own words. If they want to publish it, GitHub Pages works as is: the folder is static.

## Recording a video

Load the page with `?record&clean`. Nothing runs until you call `APP.tick(dt)`, so a puppeteer script can step frames deterministically, drive the camera and faults (`APP.toggleFault`, `APP.animateOpen`, `APP.setSpeed`, `APP.setColor`), screenshot each frame and hand them to ffmpeg.
