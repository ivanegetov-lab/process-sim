// First-tell rules for P-301 (mirror of the `tell` rules in app.js FX). Checked by scripts/check_tells.mjs.
export const faults = {
  strainerPlug: { base: (s) => ({ dP: s.pump.dPstr }), tell: (s, b) => s.pump.dPstr > b.dP + 8 },
  impellerWear: { base: (s) => ({ LV: s.valves.LV310 }), tell: (s, b) => s.valves.LV310 > b.LV + 8 },
  bearingDefect: { tell: (s) => s.vib.b1.bp > 0.5 },
  misalignment: { tell: (s) => s.vib.b2.x2 > s.vib.b2.x1, fast: true },
  sealWear: { tell: (s) => s.pump.leak > 0.6 },
  ltDrift: { base: (s) => ({ Ps: s.pump.Ps }), tell: (s, b) => s.pump.Ps < b.Ps - 5 },
  valveFail: { tell: (s) => s.pump.running && s.meas.Q < 5, fast: true },
  inflowSurge: { base: (s) => ({ LV: s.valves.LV310 }), tell: (s, b) => s.valves.LV310 > b.LV + 6, fast: true },
};
