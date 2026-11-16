import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PumpSim } = require('./sim.js');
const t0 = Date.now();
let s = new PumpSim();
console.log('init ms', Date.now() - t0);
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const snap = (label) => {
  const p = s.pump, m = s.meas, v = s.vib;
  console.log(`\n== ${label}  t=${(s.t / 3600).toFixed(2)}h  ${p.running && !s.trip.on ? 'RUN' : 'STOP ' + s.trip.reason}`);
  console.log(`Q=${f1(m.Q)} Qin=${f1(m.Qin)} H=${f1(p.H)} LV=${f1(s.valves.LV310)}% L=${f1(m.L)}% (true ${f1(m.Ltrue)}) Ps=${f2((p.Ps - 101.3) / 100)}barg Pd=${f2((p.Pd - 101.3) / 100)}barg dPstr=${f1(p.dPstr)}kPa`);
  console.log(`NPSHa=${f2(p.npshA)} NPSHr=${f2(p.npshR)} ci=${f2(p.ci)} hcav=${f2(p.hcav)} vortex=${f2(s.tank.vortex)} r=${f2(p.rImp)}`);
  console.log(`P=${f1(p.P)}kW eta=${(p.eta * 100).toFixed(0)}% amps=${f1(p.amps)} Tc=${f1(p.Tc)} T1=${f1(s.bear.T1)} T2=${f1(s.bear.T2)} leak=${f2(p.leak)}L/h`);
  console.log(`vib 301=${f2(v.o1)} [1x ${f2(v.b1.x1)} 2x ${f2(v.b1.x2)} vp ${f2(v.b1.vp)} bp ${f2(v.b1.bp)} bb ${f2(v.b1.bb)}]  302=${f2(v.o2)} [1x ${f2(v.b2.x1)} 2x ${f2(v.b2.x2)}]`);
  console.log(`$ energy ${s.money.energy.toFixed(0)} lost ${s.money.lost.toFixed(0)}`);
  console.log('alarms', s.getAlarms().map((a) => `P${a.pri} ${a.tag} ${a.text}`).join(' | '));
};
snap('steady state');
const scen = (name, fn, hours) => { s = new PumpSim(); fn(s); for (const hh of hours) { s.advance(hh * 3600 - s.t); snap(name + ' @' + hh + 'h'); } };
const cases = {
  str: () => scen('strainer plug', (s) => s.setFault('strainerPlug', true), [9, 15, 20, 24]),
  wear: () => scen('impeller wear', (s) => s.setFault('impellerWear', true), [10, 20, 30, 36]),
  brg: () => scen('bearing defect', (s) => s.setFault('bearingDefect', true), [12, 21, 28, 36, 40.5]),
  mis: () => scen('misalignment', (s) => s.setFault('misalignment', true), [0.05, 2]),
  seal: () => scen('seal wear', (s) => s.setFault('sealWear', true), [9, 20, 30]),
  lt: () => scen('LT drift', (s) => s.setFault('ltDrift', true), [1, 2, 3, 4]),
  valve: () => scen('valve fail', (s) => s.setFault('valveFail', true), [0.03, 0.1, 0.2, 0.3]),
  surge: () => scen('inflow surge', (s) => s.setFault('inflowSurge', true), [0.5, 2]),
};
const which = process.argv[2] || 'all';
if (which === 'all') for (const k in cases) cases[k](); else cases[which]();
