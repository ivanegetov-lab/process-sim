#!/usr/bin/env node
// Check that every fault's first tell fires before the first priority 1-2 alarm.
// usage: node check_tells.mjs <path/to/sim.js> <path/to/tells.mjs> [--hours 48]
//
// sim.js must export (CommonJS) an object with a simulator class: { ColumnSim } or { Sim } or the first class it finds.
// tells.mjs must export: { faults: { key: { base: (sim) => any, tell: (sim, base) => boolean, fast?: boolean } } }
import { createRequire } from 'module';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const [simPath, tellsPath, ...rest] = process.argv.slice(2);
if (!simPath || !tellsPath) { console.error('usage: node check_tells.mjs <sim.js> <tells.mjs> [--hours 48]'); process.exit(2); }
const hours = rest[0] === '--hours' ? +rest[1] : 48;
const require = createRequire(import.meta.url);
const lib = require(resolve(simPath));
const Sim = lib.Sim || lib.ColumnSim || Object.values(lib).find((v) => typeof v === 'function' && /^class /.test(String(v)));
const { faults } = await import(pathToFileURL(resolve(tellsPath)).href);

let bad = 0;
console.log('fault'.padEnd(22), 'first tell'.padStart(11), 'first alarm'.padStart(12), ' result');
for (const key of Object.keys(faults)) {
  const f = faults[key];
  const s = new Sim();
  const base = f.base ? f.base(s) : null;
  s.setFault(key, true);
  let tT = null, aT = null;
  for (let i = 0; i < hours * 60; i++) {
    s.advance(60);
    const t = s.t / 3600;
    if (tT === null && f.tell(s, base)) tT = t;
    if (aT === null && s.getAlarms().some((a) => a.pri <= 2)) aT = t;
    if (tT !== null && aT !== null) break;
  }
  const ok = tT !== null && (aT === null || tT <= aT || f.fast);
  if (!ok) bad++;
  const fmt = (v) => (v === null ? 'never' : v.toFixed(2) + ' h');
  console.log(key.padEnd(22), fmt(tT).padStart(11), fmt(aT).padStart(12), ok ? ' OK' : ' TELL LATE');
}
process.exit(bad ? 1 : 0);
