import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ColumnSim } = require('./sim.js');
const t0 = Date.now();
const s = new ColumnSim();
console.log('init ms', Date.now() - t0);
const snap = (label) => {
  const tr = s.trays;
  console.log(`\n== ${label}  t=${(s.t/3600).toFixed(1)}h`);
  console.log(`xD=${(s.drum.x*100).toFixed(2)}% xB=${(s.reb.x*100).toFixed(2)}% Ptop=${s.top.P.toFixed(1)} dP=${s.dP.toFixed(1)} Q=${s.reb.Q.toFixed(0)} Psh=${s.reb.Psh.toFixed(0)}`);
  console.log(`F=${s.flows.F.toFixed(1)} LR=${s.flows.LR.toFixed(1)} D=${s.flows.D.toFixed(1)} B=${s.flows.B.toFixed(1)} VB=${s.flows.VB.toFixed(1)}`);
  console.log('valves', Object.entries(s.valves).map(([k,v])=>k+'='+v.toFixed(1)).join(' '));
  console.log(`T5=${s.meas.T5.toFixed(2)} (true ${s.meas.T5true.toFixed(2)}) sp=${s.ctl.TIC105.sp} drumL=${s.meas.drumL.toFixed(0)} sumpL=${s.meas.sumpL.toFixed(0)} Tb=${s.reb.T.toFixed(1)} Ttop=${tr[19].T.toFixed(1)}`);
  console.log('T  ', tr.map(t=>t.T.toFixed(0)).join(' '));
  console.log('x  ', tr.map(t=>(t.x*100).toFixed(0)).join(' '));
  console.log('fl ', tr.map(t=>(t.flood*100).toFixed(0)).join(' '));
  console.log('M  ', tr.map(t=>t.M.toFixed(2)).join(' '));
  console.log('$ steam', s.money.steam.toFixed(0), 'offspec', s.money.offspec.toFixed(0));
  console.log('alarms', s.getAlarms().map(a=>a.text).join(' | '));
};
snap('steady state');
const fresh = () => new ColumnSim();
const scen = (name, fn, hours) => { const x = fresh(); Object.assign(s, x); fn(s); for (const h of hours) { s.advance(h*3600 - s.t); snap(name+' @'+h+'h'); } };
const which = process.argv[2] || 'all';
const cases = {
  reb: () => scen('reboiler fouling', s=>s.setFault('reboilerFouling', true), [8, 20, 30]),
  cond: () => scen('condenser fouling', s=>s.setFault('condenserFouling', true), [12, 24]),
  tray: () => scen('tray fouling', s=>s.setFault('trayFouling', true), [18, 36]),
  tc: () => scen('tc drift', s=>s.setFault('tcDrift', true), [4, 10]),
  dmg: () => scen('damaged tray', s=>s.setFault('damagedTray', true), [2]),
  refl: () => scen('reflux fail', s=>s.setFault('refluxValveFail', true), [0.25, 1]),
  cw: () => scen('cw loss', s=>s.setFault('cwLoss', true), [0.02, 0.05, 0.2]),
  steam: () => scen('steam drop', s=>s.setFault('steamDrop', true), [2]),
  feed: () => scen('feed swing', s=>s.setFault('feedSwing', true), [3]),
  pump: () => scen('bottoms pump', s=>s.setFault('bottomsPump', true), [2.5, 4]),
  rate: () => scen('feed 125', s=>{s.ctl.FIC101.sp=125; s.ctl.FIC140.sp=125;}, [3]),
  low: () => scen('feed 50', s=>{s.ctl.FIC101.sp=50; s.ctl.FIC140.sp=50;}, [3]),
};
if (which === 'all') for (const k in cases) cases[k](); else if (cases[which]) cases[which]();
