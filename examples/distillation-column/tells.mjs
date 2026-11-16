// First-tell rules for C-101 (mirror of the `tell` rules in app.js FX). Checked by scripts/check_tells.mjs.
export const faults = {
  reboilerFouling: { base: (s) => ({ TV: s.valves.TV105 }), tell: (s, b) => s.valves.TV105 > b.TV + 10 },
  condenserFouling: { base: (s) => ({ PV: s.valves.PV110 }), tell: (s, b) => s.valves.PV110 > b.PV + 20 },
  trayFouling: { base: (s) => ({ dP: s.dP }), tell: (s, b) => s.dP > b.dP + 1.2 },
  tcDrift: { tell: (s) => s.meas.T5true - s.meas.T5 > 0.7 },
  damagedTray: { base: (s) => ({ xD: s.drum.x * 100 }), tell: (s, b) => s.drum.x * 100 < b.xD - 0.3 },
  bottomsPump: { tell: (s) => s.valves.LV130 > 95 },
  steamDrop: { tell: (s) => s.valves.TV105 > 85, fast: true },
  cwLoss: { base: (s) => ({ P: s.top.P }), tell: (s, b) => s.top.P > b.P + 25, fast: true },
  refluxValveFail: { tell: (s) => s.flows.LR < 5, fast: true },
};
