# Interview: what to ask before you model anything

Ask in plain language, a few questions at a time. Read anything they hand you first (P&ID, PFD, equipment list, SOPs, operating data, a DCS screenshot) and only ask about the gaps.

## 1. Purpose and audience

- What unit or equipment do you want to model?
- Who is it for? (new staff engineers, operators, maintenance techs, reliability engineers, a manager)
- What should someone understand after 10 minutes with it? (e.g. "why the reboiler valve creeping open matters", "what a stuck reflux valve does", "how fouling shows up before quality")

## 2. The equipment

- List the equipment and how it's connected: vessels, columns, exchangers, pumps, compressors, control valves, utilities (steam, cooling water, instrument air, power).
- Sizes that matter: diameters, heights, tray or packing count, exchanger duty or area, pump capacity, vessel volumes. Rough is fine.
- What's inside that people never see: trays, tube bundles, impellers, catalyst beds, demisters. These are the cutaway moments.

## 3. Normal operation

- Typical rates, pressures, temperatures, levels, compositions.
- Typical valve positions on the main loops (a valve that normally runs at 60% and creeps to 100% is a story).
- Product specs or operating limits that define "bad".
- Costs if they have them: steam or fuel price, value of off-spec product. Optional, but money makes the point land.

**Never invent their numbers.** If something is missing, use a textbook value, say so out loud, and flag it in the README as illustrative.

## 4. Control

- Each loop: what it measures, what it moves, setpoint, rough tuning if known.
- Fail position of each control valve (fail open / fail closed). This decides what an instrument-air loss does.
- Interlocks and reliefs: high-high trips, PSV set pressures.

## 5. What breaks

- What has actually gone wrong on this unit? Fouling, plugging, a valve that stuck, a transmitter or thermocouple that drifted, a pump that cavitated, a utility outage, an upstream upset.
- For each: how did you find out, and what would you have seen earlier if you had known where to look? That second answer is the first tell.
- Which of these does the audience most need to recognize?

Real history beats a generic list. Never make up an incident for them. If they have none to share, use the standard failure modes for that equipment and say they're generic.
