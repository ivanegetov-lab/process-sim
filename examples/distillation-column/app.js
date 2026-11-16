import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { Plant, COL, trayY } from './scene.js';

const { ColumnSim, FAULTS } = window.ColumnSimLib;
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

// ---------------- sim ----------------
let sim = new ColumnSim();
let baseline = snapshotProfile();
function snapshotProfile() { return { T: sim.trays.map((t) => t.T), x: sim.trays.map((t) => t.x), f: sim.trays.map((t) => t.flood), Tb: sim.reb.T, xb: sim.reb.x, xD: sim.drum.x, dP: sim.dP, Q: sim.reb.Q }; }

// What a good engineer or maintenance manager sees first. Edit these in your own words.
const TELLS = {
  reboilerFouling: '<b>Watch TV-105.</b> The steam valve creeps open for hours while every quality number looks fine. When it pins at 100%, the bottoms goes off-spec within the hour.',
  condenserFouling: '<b>Watch PV-110.</b> The CW valve opens wider while pressure holds. Once it pins, pressure climbs, and the tray 5 temperature stops meaning what TIC-105 thinks it means.',
  trayFouling: '<b>Watch column ΔP.</b> It climbs slowly on the bottom trays long before any flooding alarm or quality complaint.',
  tcDrift: '<b>Nothing alarms.</b> TIC-105 shows a perfect setpoint. Steam creeps up and the distillate goes off-spec. Only a lab sample or a second thermocouple catches it.',
  damagedTray: '<b>Quality slips and stays slipped.</b> ΔP drops a little. No alarm explains it. A gamma scan finds it, or the next turnaround.',
  refluxValveFail: '<b>Reflux to zero, top temperature jumps.</b> Distillate off-spec in minutes. Fail-safe position matters.',
  cwLoss: '<b>Pressure climbs fast.</b> PAHH-110 trips the steam. The column dumps. Restart CW, then reset the trip.',
  steamDrop: '<b>TV-105 goes to 100% and still can\'t hold tray 5.</b> Looks like a fouled reboiler, but it happened in minutes, not weeks.',
  feedSwing: '<b>The controls should absorb this one.</b> Distillate rate rises, quality holds. A disturbance, not a failure.',
  bottomsPump: '<b>LV-130 goes to 100% and the sump keeps rising.</b> Then liquid backs up the bottom trays and ΔP jumps.',
};
const FAULT_TAGS = { reboilerFouling: 'E-101', condenserFouling: 'E-102', trayFouling: 'Trays 1-8', tcDrift: 'TE-105', damagedTray: 'Tray 14', refluxValveFail: 'FV-140', cwLoss: 'P-201', steamDrop: 'LP steam', feedSwing: 'Feed', bottomsPump: 'P-102' };

// ---------------- three ----------------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: params.has('record') });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.fog = new THREE.Fog(0xdfe2e5, 45, 90);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 2; controls.maxDistance = 60;

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(14, 26, 12); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 22, bottom: -6, near: 1, far: 70 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xfff4e6, 0.5); fill.position.set(-12, 10, -6); scene.add(fill);

const plant = new Plant(scene, sim);

// ---------------- what each fault touches, where to point, what to measure, when it first shows ----------------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const vpos = (tag, up = 0.9) => plant.valves[tag].g.position.clone().add(V3(0, up, 0));
const m_ = (name, fn, unit, dec) => ({ name, fn, unit, dec });
const FX = {
  reboilerFouling: { short: 'Reboiler fouling', keys: ['reboiler'], anchor: () => V3(plant.reb.cx, plant.reb.cy + 0.2, 0.3), size: 1.7, focus: { kind: 'reboiler' }, loops: ['TIC105'],
    metrics: [m_('TV-105 steam valve', (s) => s.valves.TV105, '%', 0), m_('Tube-side pressure', (s) => s.reb.Psh / 100, ' bar', 1), m_('Reboiler UA', (s) => s.reb.UAf * 100, '%', 0), m_('Bottoms Bz', (s) => s.reb.x * 100, '%', 2)],
    tell: (s, b) => s.valves.TV105 > b[0] + 10, tellText: (s, b) => `TV-105 is ${s.valves.TV105.toFixed(0)}% open (was ${b[0].toFixed(0)}%). Quality is still on spec. This is where you catch it.` },
  condenserFouling: { short: 'Condenser fouling', keys: ['condenser', 'pipe:cwIn', 'pipe:cwOut'], anchor: () => V3(plant.cond.cx, plant.cond.cy + 0.2, 0), size: 1.6, focus: { kind: 'condenser' }, loops: ['PIC110'],
    metrics: [m_('PV-110 CW valve', (s) => s.valves.PV110, '%', 0), m_('Top pressure', (s) => s.top.P, ' kPa', 1), m_('Condenser UA', (s) => s.top.UAf * 100, '%', 0), m_('Bottoms Bz', (s) => s.reb.x * 100, '%', 2)],
    tell: (s, b) => s.valves.PV110 > b[0] + 20, tellText: (s, b) => `PV-110 is ${s.valves.PV110.toFixed(0)}% open (was ${b[0].toFixed(0)}%). Pressure still looks fine. The condenser is running out of margin.` },
  trayFouling: { short: 'Bottom trays fouling', keys: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 'tray:' + i), anchor: () => V3(0, trayY(3), 0), size: 1.5, focus: { kind: 'tray', i: 2 }, loops: [],
    metrics: [m_('Column ΔP', (s) => s.dP, ' kPa', 1), m_('Tray 1 flood', (s) => s.trays[0].flood * 100, '%', 0), m_('Tray 1 open area', (s) => s.trays[0].phi * 100, '%', 0), m_('Bottoms Bz', (s) => s.reb.x * 100, '%', 2)],
    tell: (s, b) => s.dP > b[0] + 1.2, tellText: (s, b) => `Column ΔP is up ${(s.dP - b[0]).toFixed(1)} kPa. No alarm yet. ΔP is your early warning for tray fouling.` },
  tcDrift: { short: 'TE-105 drifting', keys: ['thermowell'], anchor: () => plant.thermowellPos.clone(), size: 0.8, focus: { kind: 'tray', i: 4 }, loops: ['TIC105'],
    metrics: [m_('TI-105 reads', (s) => s.meas.T5, ' °C', 1), m_('Tray 5 actually', (s) => s.meas.T5true, ' °C', 1), m_('TV-105 steam valve', (s) => s.valves.TV105, '%', 0), m_('Distillate Bz', (s) => s.drum.x * 100, '%', 2)],
    tell: (s) => s.meas.T5true - s.meas.T5 > 0.7, tellText: (s) => `TI-105 reads ${s.meas.T5.toFixed(1)} °C. Tray 5 is really ${s.meas.T5true.toFixed(1)} °C. The board looks perfect. The lab won't.` },
  damagedTray: { short: 'Tray 14 dislodged', keys: ['tray:13'], anchor: () => V3(0, trayY(13), 0), size: 1.2, focus: { kind: 'tray', i: 13 }, loops: [],
    metrics: [m_('Distillate Bz', (s) => s.drum.x * 100, '%', 2), m_('Tray 14 efficiency', (s) => s.trays[13].E * 100, '%', 0), m_('Column ΔP', (s) => s.dP, ' kPa', 1)],
    tell: (s, b) => s.drum.x * 100 < b[0] - 0.3, tellText: (s, b) => `Distillate slipped from ${b[0].toFixed(2)}% to ${(s.drum.x * 100).toFixed(2)}% and isn't coming back. No alarm explains it.` },
  refluxValveFail: { short: 'FV-140 failed shut', keys: ['valve:FV-140', 'pipe:reflux'], anchor: () => vpos('FV-140'), size: 0.9, focus: { kind: 'valve', tag: 'FV-140' }, loops: ['FIC140'],
    metrics: [m_('Reflux flow', (s) => s.flows.LR, ' kmol/h', 0), m_('Top temperature', (s) => s.trays[19].T, ' °C', 1), m_('Distillate Bz', (s) => s.drum.x * 100, '%', 2)],
    tell: (s) => s.flows.LR < 5, tellText: (s, b) => `Reflux is zero. Top temperature is up ${(s.trays[19].T - b[1]).toFixed(1)} °C.` },
  cwLoss: { short: 'CW pump tripped', keys: ['condenser', 'pipe:cwIn', 'pipe:cwOut', 'valve:PV-110'], anchor: () => V3(plant.cond.cx, plant.cond.cy + 0.2, 0), size: 1.7, focus: { kind: 'condenser' }, loops: ['PIC110'],
    metrics: [m_('Top pressure', (s) => s.top.P, ' kPa', 1), m_('Condenser duty', (s) => s.top.Qc / 3.6, ' kW', 0), m_('Reboiler duty', (s) => s.reb.Q / 3.6, ' kW', 0)],
    tell: (s, b) => s.top.P > b[0] + 25, tellText: (s, b) => `Pressure is up ${(s.top.P - b[0]).toFixed(0)} kPa already. The trip is coming.` },
  steamDrop: { short: 'Steam header low', keys: ['pipe:steam', 'valve:TV-105'], anchor: () => vpos('TV-105'), size: 1.0, focus: { kind: 'valve', tag: 'TV-105' }, loops: ['TIC105'],
    metrics: [m_('Steam header', (s) => s.reb.Psup / 100, ' bar', 1), m_('TV-105 steam valve', (s) => s.valves.TV105, '%', 0), m_('Tray 5 temp', (s) => s.meas.T5, ' °C', 1), m_('Bottoms Bz', (s) => s.reb.x * 100, '%', 2)],
    tell: (s) => s.valves.TV105 > 85, tellText: () => 'TV-105 is wide open and still can\'t hold tray 5. Same symptom as a fouled reboiler, but in minutes.' },
  feedSwing: { short: 'Feed got lighter', keys: ['pipe:feed', 'valve:FV-101'], anchor: () => vpos('FV-101'), size: 1.0, focus: { kind: 'valve', tag: 'FV-101' }, loops: ['LIC120'],
    metrics: [m_('Feed Bz', (s) => s.feed.z * 100, '%', 0), m_('Distillate rate', (s) => s.flows.D, ' kmol/h', 0), m_('Distillate Bz', (s) => s.drum.x * 100, '%', 2)],
    tell: (s, b) => s.flows.D > b[1] + 5, tellText: (s, b) => `Distillate went from ${b[1].toFixed(0)} to ${s.flows.D.toFixed(0)} kmol/h. The controls are absorbing it.` },
  bottomsPump: { short: 'P-102 cavitating', keys: ['p102', 'pipe:bottoms', 'valve:LV-130'], anchor: () => V3(1.3, 1.1, 2.6), size: 1.0, focus: { kind: 'p102' }, loops: ['LIC130'],
    metrics: [m_('LV-130 valve', (s) => s.valves.LV130, '%', 0), m_('Sump level', (s) => s.meas.sumpL, '%', 0), m_('Bottoms flow', (s) => s.flows.B, ' kmol/h', 0), m_('Column ΔP', (s) => s.dP, ' kPa', 1)],
    tell: (s) => s.valves.LV130 > 95, tellText: () => 'LV-130 is wide open and the sump is still rising. The pump can\'t keep up.' },
};
const FS = {};          // live fault state: { t0, base: [metric values at break], told }
const fixedAt = {};     // fault -> real time it was fixed (for the green flash)
let followFaults = true;

const VIEWS = {
  home: { pos: [26, 17, 33], target: [-0.4, 8.8, 0] },
  open: { pos: [9.5, 12.8, 11.5], target: [-0.5, 10.6, 0] },
};
function setView(v, instant) { tweenCam(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target), instant ? 0 : 1.4); }
let camTween = null;
function tweenCam(pos, target, dur) {
  if (!dur) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
  camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, t: 0, dur };
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  document.body.classList.toggle('portrait', h > w * 1.05);
  // center the 3D view in the gap between the panels
  let cx = w / 2, cy = h / 2;
  if (!document.body.classList.contains('clean')) {
    const L = $('#left').getBoundingClientRect(), R = $('#right').getBoundingClientRect(), B = $('#bottom').getBoundingClientRect();
    const x0 = L.right, x1 = R.left, y1 = B.top;
    if (x1 - x0 > 200) { cx = (x0 + x1) / 2; cy = y1 / 2; }
  }
  camera.setViewOffset(w, h, -(cx - w / 2), -(cy - h / 2), w, h);
  camera.updateProjectionMatrix();
  drawProfile(true); drawTrend(true);
}
window.addEventListener('resize', resize);

// ---------------- UI: components ----------------
const groupVis = {};
document.querySelectorAll('.chip[data-g]').forEach((b) => {
  const g = b.dataset.g; groupVis[g] = true;
  b.onclick = () => { groupVis[g] = !groupVis[g]; applyVis(); };
});
function applyVis() {
  for (const k in plant.groups) plant.groups[k].visible = groupVis[k] !== false;
  if (groupVis.internals === false) plant.internals.visible = false; else plant.internals.visible = true;
  plant.groups.internals.visible = groupVis.internals !== false;
  const flow = groupVis.flow !== false;
  plant.bub.visible = flow; plant.drop.visible = flow; plant.rbub.visible = flow; plant.cwp.visible = flow;
  plant.groups.valves.visible = groupVis.piping !== false;
  document.querySelectorAll('.chip[data-g]').forEach((b) => b.classList.toggle('off', !groupVis[b.dataset.g]));
  $('#labels').style.display = groupVis.labels ? '' : 'none';
}
let openAnim = null;
let isOpen = false;
function animateOpen(to) {
  openAnim = { from: plant.openT, to, t: 0, dur: 2.2 };
  isOpen = to > 0.5;
  $('#openBtn').textContent = isOpen ? 'Close the column' : 'Open up the column';
}
$('#openBtn').onclick = () => {
  if (!isOpen) { animateOpen(1); setView(VIEWS.open); }
  else { animateOpen(0); setView(VIEWS.home); }
};
$('#showAll').onclick = () => { for (const k in groupVis) groupVis[k] = true; applyVis(); animateOpen(0); setView(VIEWS.home); select(null); };
$('#resetView').onclick = () => { setView(isOpen ? VIEWS.open : VIEWS.home); select(null); };

let colorMode = 'composition';
const LEGENDS = {
  composition: ['linear-gradient(90deg,hsl(191,78%,50%),hsl(130,78%,52%),hsl(32,78%,56%))', ['toluene-rich', 'benzene-rich']],
  composition_: 0,
  temperature: ['linear-gradient(90deg,hsl(223,75%,50%),hsl(140,75%,50%),hsl(60,75%,50%),hsl(0,75%,50%))', ['78 °C', '120 °C']],
  hydraulics: ['linear-gradient(90deg,#9fd3ff 0 12%,hsl(130,75%,48%) 12%,hsl(60,75%,48%),hsl(0,75%,48%))', ['weeping', 'flooding']],
};
function setLegend() { const [g, l] = LEGENDS[colorMode]; $('#legend').style.background = g; $('#legendL').innerHTML = `<span>${l[0]}</span><span>${l[1]}</span>`; }
document.querySelectorAll('#colorMode button').forEach((b) => b.onclick = () => {
  colorMode = b.dataset.m; document.querySelectorAll('#colorMode button').forEach((x) => x.classList.toggle('on', x === b)); setLegend();
});
setLegend();

// ---------------- UI: faults ----------------
function buildFaults() {
  const el = $('#faults'); el.innerHTML = '';
  for (const k in FAULTS) {
    const f = FAULTS[k];
    const d = document.createElement('div'); d.className = 'fault'; d.id = 'f-' + k;
    d.innerHTML = `<div class="top"><span class="nm">${f.label}</span><span class="tag">${FAULT_TAGS[k]}</span><button class="go">Break</button></div>
      <div class="bar"><i></i></div><div class="tell">${f.what}<br/><br/>${TELLS[k]}</div><div class="since"></div>`;
    d.querySelector('.go').onclick = () => toggleFault(k);
    d.querySelector('.go').title = f.what;
    el.appendChild(d);
  }
}
function toggleFault(k) {
  const on = !sim.faults[k].active;
  sim.setFault(k, on);
  const fx = FX[k];
  if (on) {
    FS[k] = { t0: sim.t, base: fx.metrics.map((m) => m.fn(sim)), told: false };
    toast('fault', `Broke it: ${FAULTS[k].label.toLowerCase()}`, FAULTS[k].what);
    if (followFaults) {
      const f = fx.focus;
      if ((f.kind === 'tray' || f.kind === 'reboiler' || f.kind === 'condenser') && !isOpen) animateOpen(1);
      select(f, true);
    }
  } else {
    delete FS[k]; fixedAt[k] = curNow;
    toast('fix', `Fixed: ${FAULTS[k].fix}`, 'Watch the column recover.');
  }
  updateFaults();
}
function fmtDur(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`; }
function updateFaults() {
  for (const k in FAULTS) {
    const d = $('#f-' + k), on = sim.faults[k].active;
    d.classList.toggle('on', on);
    d.querySelector('.go').textContent = on ? 'Fix' : 'Break';
    d.querySelector('.go').title = on ? FAULTS[k].fix : FAULTS[k].what;
    d.querySelector('.bar i').style.width = (sim.faults[k].s * 100).toFixed(0) + '%';
    const since = d.querySelector('.since');
    if (on && FS[k]) {
      const fx = FX[k], st = FS[k];
      since.innerHTML = `<div class="sh">Since you broke it · ${fmtDur(sim.t - st.t0)}${st.told ? ' · <span class="told">first tell seen</span>' : ''}</div>` + fx.metrics.map((m, j) => {
        const a = st.base[j], b = m.fn(sim), dd = b - a, th = Math.pow(10, -m.dec) * 0.5;
        const arr = dd > th ? '<i class="up">▲</i>' : dd < -th ? '<i class="dn">▼</i>' : '<i>·</i>';
        return `<div class="mrow"><span>${m.name}</span><b>${a.toFixed(m.dec)} → ${b.toFixed(m.dec)}${m.unit} ${arr}</b></div>`;
      }).join('');
    } else since.innerHTML = '';
  }
}
buildFaults();
{
  const h = [...document.querySelectorAll('#left h2')].find((x) => x.textContent.startsWith('Break it'));
  const lab = document.createElement('label'); lab.className = 'follow';
  lab.innerHTML = '<input type="checkbox" checked> fly to it';
  lab.querySelector('input').onchange = (e) => { followFaults = e.target.checked; };
  h.after(lab);
}
// toasts
function toast(kind, title, body) {
  const el = document.createElement('div'); el.className = 'toast ' + kind;
  el.innerHTML = `<div class="tt"><span class="tm">${clockStr(sim.t, true)}</span>${title}</div>${body ? `<div class="tb">${body}</div>` : ''}`;
  const box = $('#toasts'); box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  const life = kind === 'tell' ? 11000 : 7000;
  el.dataset.out = curNow + life; el.dataset.end = curNow + life + 600;   // app clock, so recordings are deterministic
}
function expireToasts() {
  document.querySelectorAll('#toasts .toast').forEach((el) => {
    if (curNow > +el.dataset.end) el.remove(); else if (curNow > +el.dataset.out) el.classList.add('out');
  });
}

// ---------------- UI: loops ----------------
const LOOPS = [
  { k: 'TIC105', step: 0.5, dec: 1, opName: 'steam TV-105' },
  { k: 'PIC110', step: 5, dec: 1, opName: 'CW PV-110' },
  { k: 'FIC101', step: 5, dec: 0, opName: 'FV-101' },
  { k: 'FIC140', step: 5, dec: 0, opName: 'FV-140' },
  { k: 'LIC120', step: 5, dec: 0, opName: 'distillate LV-120' },
  { k: 'LIC130', step: 5, dec: 0, opName: 'bottoms LV-130' },
];
function buildLoops() {
  const el = $('#loops'); el.innerHTML = '';
  for (const L of LOOPS) {
    const c = sim.ctl[L.k];
    const d = document.createElement('div'); d.className = 'fp'; d.id = 'l-' + L.k;
    d.innerHTML = `<div class="tg">${c.tag}<small>${c.name}</small></div>
      <div><div class="pv"></div><div class="op"><i></i></div><div class="opl"></div></div>
      <div class="sp"><button data-d="-1">−</button><span></span><button data-d="1">+</button><button class="md"></button></div>`;
    d.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
      const c = sim.ctl[L.k], dir = +b.dataset.d;
      if (c.mode === 'AUTO') c.sp = Math.round((c.sp + dir * L.step) * 100) / 100;
      else c.op = Math.max(0, Math.min(100, c.op + dir * 5));
      if (L.k === 'FIC101') sim.log(`Feed setpoint → ${c.sp} kmol/h`, 'op');
      updateLoops();
    });
    d.querySelector('.md').onclick = () => { const c = sim.ctl[L.k]; c.mode = c.mode === 'AUTO' ? 'MAN' : 'AUTO'; if (c.mode === 'AUTO') c.sp = Math.round(c.pv * 10) / 10; updateLoops(); };
    el.appendChild(d);
  }
}
function updateLoops() {
  for (const L of LOOPS) {
    const c = sim.ctl[L.k], d = $('#l-' + L.k);
    d.querySelector('.pv').innerHTML = `${c.pv.toFixed(L.dec)} <small>${c.unit}</small>`;
    const op = d.querySelector('.op');
    op.querySelector('i').style.width = c.op.toFixed(1) + '%';
    op.classList.toggle('sat', c.op > 92 || c.op < 3);
    d.querySelector('.opl').textContent = `OP ${c.op.toFixed(0)}% · ${L.opName}`;
    d.querySelector('.sp span').textContent = c.mode === 'AUTO' ? `SP ${c.sp.toFixed(L.dec)}` : `OP ${c.op.toFixed(0)}`;
    const md = d.querySelector('.md'); md.textContent = c.mode; md.classList.toggle('man', c.mode !== 'AUTO');
    d.classList.toggle('hot', Object.keys(FS).some((k) => FX[k].loops.includes(L.k)));
  }
}
buildLoops();

// ---------------- speeds ----------------
const SPEEDS = [[0, '❚❚'], [1, '1×'], [10, '10×'], [60, '1 min/s'], [600, '10 min/s'], [3600, '1 h/s']];
let speed = +(params.get('speed') || 60);
function buildSpeeds() {
  const el = $('#speeds'); el.innerHTML = '';
  for (const [s, l] of SPEEDS) { const b = document.createElement('button'); b.textContent = l; b.className = s === speed ? 'on' : ''; b.onclick = () => { speed = s; buildSpeeds(); }; el.appendChild(b); }
}
buildSpeeds();
$('#restart').onclick = () => {
  const keep = { colorMode };
  sim = new ColumnSim(); plant.sim = sim; baseline = snapshotProfile();
  for (const k in FS) delete FS[k];
  buildLoops(); updateFaults(); select(null);
};

// ---------------- trends ----------------
let trendTab = 'quality', profTab = 'T';
document.querySelectorAll('#trendTabs button').forEach((b) => b.onclick = () => { trendTab = b.dataset.t; document.querySelectorAll('#trendTabs button').forEach((x) => x.classList.toggle('on', x === b)); drawTrend(true); });
document.querySelectorAll('#profTabs button').forEach((b) => b.onclick = () => { profTab = b.dataset.p; document.querySelectorAll('#profTabs button').forEach((x) => x.classList.toggle('on', x === b)); drawProfile(true); });

function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio);
  if (!cv.dataset.h) cv.dataset.h = cv.getAttribute('height');
  const h = +cv.dataset.h;
  if (cv._w !== r.width || cv._dpr !== dpr) { cv.style.height = h + 'px'; cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.round(h * dpr); cv._w = r.width; cv._dpr = dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h };
}
const TRENDS = {
  quality: { series: [['xD', 'Distillate Bz %', '#d98a16', (p) => p.xD * 100, [90, 100]], ['xB', 'Bottoms Bz %', '#1f8a8a', (p) => p.xB * 100, [0, 10], true]], specs: [[97, 'L'], [3.5, 'R']] },
  valves: { series: [['steamV', 'Steam TV-105 %', '#e8573a', (p) => p.steamV, [0, 100]], ['cwV', 'CW PV-110 %', '#2a64d6', (p) => p.cwV, [0, 100]]], specs: [[92, 'L']] },
  hyd: { series: [['dP', 'Column ΔP kPa', '#6b5bd6', (p) => p.dP, [5, 30]], ['flood', 'Max flood %', '#d93333', (p) => p.flood * 100, [30, 130], true]], specs: [[22, 'L']] },
  press: { series: [['P', 'Top pressure kPa', '#1d2328', (p) => p.P, [80, 280]], ['T5', 'TI-105 reads °C', '#1f8a8a', (p) => p.T5, [100, 116], true], ['T5true', 'Tray 5 true °C', '#e8573a', (p) => p.T5true, [100, 116], true]], specs: [[175, 'L']] },
  flows: { series: [['F', 'Feed', '#9b7bd4', (p) => p.F, [0, 200]], ['D', 'Distillate', '#d98a16', (p) => p.D, [0, 200]], ['B', 'Bottoms', '#1f8a8a', (p) => p.B, [0, 200]], ['LR', 'Reflux', '#e8573a', (p) => p.LR, [0, 200]]], specs: [] },
};
function drawTrend() {
  const cv = $('#trend'); const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  const H = sim.history; if (H.length < 2) return;
  const cfg = TRENDS[trendTab];
  const span = Math.max(6 * 3600, Math.min(48 * 3600, H[H.length - 1].t));
  const t1 = H[H.length - 1].t, t0 = Math.max(0, t1 - span);
  const padL = 30, padR = 30, padT = 14, padB = 14;
  const X = (t) => padL + (t - t0) / (t1 - t0 || 1) * (w - padL - padR);
  g.font = '500 9px ui-monospace, Menlo, monospace';
  // grid + hours
  g.strokeStyle = '#eceef0'; g.lineWidth = 1; g.fillStyle = '#9aa2aa';
  const stepH = span > 24 * 3600 ? 6 : span > 8 * 3600 ? 2 : 1;
  for (let hh = Math.ceil(t0 / 3600 / stepH) * stepH; hh * 3600 <= t1; hh += stepH) {
    const x = X(hh * 3600); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke();
    g.fillText(clockStr(hh * 3600, true), x - 12, h - 3);
  }
  // event markers: fault, fix, first tell, trip
  const EC = { fault: '#e8573a', fix: '#2e9d62', tell: '#d99a16', trip: '#d93333' };
  const EG = { fault: '⚠', fix: '✓', tell: '●', trip: '⛔' };
  for (const e of sim.events) {
    if (!EC[e.kind] || e.t < t0) continue;
    const x = X(e.t);
    g.strokeStyle = EC[e.kind]; g.globalAlpha = 0.75; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 1; g.fillStyle = EC[e.kind]; g.font = '700 10px ui-monospace, Menlo, monospace'; g.fillText(EG[e.kind], x - 4, padT + 9);
    g.font = '500 9px ui-monospace, Menlo, monospace';
  }
  // series
  let legendX = padL;
  cfg.series.forEach(([key, name, color, fn, range, right], si) => {
    const [lo, hi] = range;
    const Y = (v) => padT + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (h - padT - padB);
    if (si < 2) { // axis labels
      g.fillStyle = color; g.textAlign = right ? 'left' : 'right';
      g.fillText(hi, right ? w - padR + 3 : padL - 3, padT + 3); g.fillText(lo, right ? w - padR + 3 : padL - 3, h - padB);
      g.textAlign = 'left';
    }
    if (si === 0) cfg.specs.forEach(([v, side]) => {
      const rr = side === 'R' && cfg.series[1] ? cfg.series[1][4] : range;
      const yy = padT + (1 - (v - rr[0]) / (rr[1] - rr[0])) * (h - padT - padB);
      g.strokeStyle = 'rgba(217,51,51,0.5)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - padR, yy); g.stroke(); g.setLineDash([]);
    });
    g.strokeStyle = color; g.lineWidth = key === 'T5true' ? 2.2 : 1.8; if (key === 'T5true') g.setLineDash([5, 3]);
    g.beginPath();
    let first = true;
    for (const p of H) { if (p.t < t0) continue; const x = X(p.t), y = Y(fn(p)); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    g.stroke(); g.setLineDash([]);
    g.fillStyle = color; g.fillRect(legendX, 2, 8, 3);
    g.fillStyle = '#4a535b'; g.fillText(name, legendX + 11, 8);
    legendX += g.measureText(name).width + 24;
  });
}
function drawProfile() {
  const cv = $('#prof'); const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  const N = sim.trays.length, padL = 28, padR = 10, padT = 8, padB = 20;
  const rows = N + 1;
  const Y = (i) => h - padB - (i + 0.5) / rows * (h - padT - padB); // i = -1 sump .. N-1
  let lo, hi, fn, base, unit;
  if (profTab === 'T') { lo = 78; hi = 128; fn = (t) => t.T; base = baseline.T; unit = '°C'; }
  else if (profTab === 'x') { lo = 0; hi = 100; fn = (t) => t.x * 100; base = baseline.x.map((v) => v * 100); unit = '% Bz'; }
  else { lo = 0; hi = 130; fn = (t) => (t.damaged ? 0 : t.flood * 100); base = baseline.f.map((v) => v * 100); unit = '% flood'; }
  const X = (v) => padL + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (w - padL - padR);
  g.font = '500 9px ui-monospace, Menlo, monospace';
  g.strokeStyle = '#eef0f2'; g.fillStyle = '#9aa2aa';
  for (let k = 0; k <= 5; k++) { const v = lo + (hi - lo) * k / 5; const x = X(v); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); g.fillText(v.toFixed(0), x - 6, h - 6); }
  g.fillText(unit, w - padR - 34, h - 6 - 10);
  for (const i of [0, 4, 8, 13, 19]) { g.fillText(String(i + 1), 4, Y(i) + 3); }
  g.fillText('sump', 0, Y(-1) + 3);
  if (profTab === 'f') { g.fillStyle = 'rgba(217,51,51,0.08)'; g.fillRect(X(85), padT, X(130) - X(85), h - padT - padB); g.fillStyle = 'rgba(42,100,214,0.06)'; g.fillRect(X(0), padT, X(36) - X(0), h - padT - padB); }
  // feed + control tray markers
  g.fillStyle = 'rgba(155,123,212,0.12)'; g.fillRect(padL, Y(8) - 5, w - padL - padR, 10);
  g.fillStyle = 'rgba(232,87,58,0.12)'; g.fillRect(padL, Y(4) - 5, w - padL - padR, 10);
  g.fillStyle = '#9b7bd4'; g.fillText('feed', w - padR - 22, Y(8) + 3);
  g.fillStyle = '#e8573a'; g.fillText('TIC', w - padR - 18, Y(4) + 3);
  // baseline
  g.strokeStyle = '#b9c0c6'; g.setLineDash([3, 3]); g.lineWidth = 1.2; g.beginPath();
  base.forEach((v, i) => { const x = X(v), y = Y(i); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
  // shade the change vs the clean column
  {
    let maxD = 0, maxI = -1;
    g.fillStyle = 'rgba(232,87,58,0.14)'; g.beginPath();
    base.forEach((v, i) => { const x = X(v), y = Y(i); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    for (let i = sim.trays.length - 1; i >= 0; i--) { const v = fn(sim.trays[i]); g.lineTo(X(v), Y(i)); const dd = v - base[i]; if (Math.abs(dd) > Math.abs(maxD)) { maxD = dd; maxI = i; } }
    g.closePath(); g.fill();
    const thr = profTab === 'T' ? 0.8 : profTab === 'x' ? 2 : 4;
    if (Math.abs(maxD) > thr) {
      const u = profTab === 'T' ? ' °C' : profTab === 'x' ? ' pts' : ' pts';
      const txt = `${maxD > 0 ? '+' : ''}${maxD.toFixed(1)}${u} at tray ${maxI + 1}`;
      g.font = '700 10px ui-monospace, Menlo, monospace'; g.fillStyle = '#c0392b';
      const xx = Math.min(w - padR - g.measureText(txt).width - 2, X(fn(sim.trays[maxI])) + 6);
      g.fillText(txt, xx, Y(maxI) - 6); g.font = '500 9px ui-monospace, Menlo, monospace';
    }
  }
  // current
  g.strokeStyle = '#e8573a'; g.lineWidth = 2; g.beginPath();
  const pts = sim.trays.map((t, i) => [X(fn(t)), Y(i)]);
  if (profTab !== 'f') pts.unshift([X(profTab === 'T' ? sim.reb.T : sim.reb.x * 100), Y(-1)]);
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  sim.trays.forEach((t, i) => {
    g.fillStyle = t.damaged ? '#555' : t.flooding ? '#d93333' : t.weeping ? '#5aa9f0' : '#e8573a';
    g.beginPath(); g.arc(X(fn(t)), Y(i), t.damaged || t.flooding || t.weeping ? 3.2 : 2.2, 0, Math.PI * 2); g.fill();
  });
  g.fillStyle = '#7c858d'; g.fillText('dashed = clean column at start', padL + 2, padT + 8);
}

// ---------------- KPIs, alarms, money, clock ----------------
function clockStr(t, short) {
  const start = 6 * 3600; const tt = start + t;
  const day = Math.floor(tt / 86400) + 1; const s = tt % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0'), mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  if (short) return `${hh}:${mm}`;
  const shift = s >= 6 * 3600 && s < 14 * 3600 ? 'A' : s >= 14 * 3600 && s < 22 * 3600 ? 'B' : 'C';
  return `Day ${day} ${hh}:${mm}<small>Shift ${shift}</small>`;
}
const fmt$ = (v) => '$' + Math.round(v).toLocaleString('en-US');
function kpi(id, val, sub, state) {
  const el = $(id); el.querySelector('.v').textContent = val; if (sub != null) el.querySelector('.s').textContent = sub;
  const prev = el.dataset.state || '';
  if (prev !== (state || '')) { el.dataset.state = state || ''; el.className = 'kpi' + (state ? ' ' + state : ''); void el.offsetWidth; el.classList.add('flash'); }
}
const dlt = (v, dec, unit = '') => (Math.abs(v) < Math.pow(10, -dec) * 0.5 ? '±0' : (v > 0 ? '▲ +' : '▼ ') + v.toFixed(dec)) + unit;
let lastAlarmKey = '';
let prevAlarms = new Set();
function updatePanels() {
  const d = sim.d;
  kpi('#kD', (sim.drum.x * 100).toFixed(2) + '%', `spec ≥ 97.0% · ${dlt((sim.drum.x - baseline.xD) * 100, 2)} vs start`, sim.drum.x < d.specD ? 'bad' : sim.drum.x < d.specD + 0.004 ? 'warn' : '');
  kpi('#kB', (sim.reb.x * 100).toFixed(2) + '%', `spec ≤ 3.5% · ${dlt((sim.reb.x - baseline.xb) * 100, 2)} vs start`, sim.reb.x > d.specB ? 'bad' : sim.reb.x > d.specB - 0.004 ? 'warn' : '');
  kpi('#kDP', sim.dP.toFixed(1) + ' kPa', `${dlt(sim.dP - baseline.dP, 1)} vs clean · max flood ${(Math.max(...sim.trays.map((t) => (t.damaged ? 0 : t.flood))) * 100).toFixed(0)}%`, sim.dP > 22 ? 'bad' : sim.dP > 17 ? 'warn' : '');
  kpi('#kQ', (sim.reb.Q / 3.6).toFixed(0) + ' kW', `steam valve ${sim.valves.TV105.toFixed(0)}% · UA ${(sim.reb.UAf * 100).toFixed(0)}%`, sim.trip.steam ? 'bad' : sim.valves.TV105 > 92 ? 'warn' : '');
  $('#clock').innerHTML = clockStr(sim.t);
  const m = sim.money;
  $('#money').innerHTML = `steam <b>${fmt$(m.steam)}</b> · off-spec <b class="${m.offspec > 0 ? 'red' : ''}">${fmt$(m.offspec)}</b><br/>steam now ${fmt$(sim.reb.Q * d.steamCost)}/h`;
  // first tells
  for (const k in FS) {
    const st = FS[k], fx = FX[k];
    if (!st.told && fx.tell(sim, st.base)) {
      st.told = true; st.tellT = sim.t;
      toast('tell', `First tell · ${fx.short}`, fx.tellText(sim, st.base));
      sim.log(`First tell: ${fx.short}`, 'tell');
    }
  }
  // alarms
  const al = sim.getAlarms();
  document.body.classList.toggle('p1', al.some((a) => a.pri === 1));
  const key = al.map((a) => a.text).join('|');
  if (key !== lastAlarmKey) {
    lastAlarmKey = key;
    const el = $('#alarms'); el.innerHTML = '';
    if (!al.length) { el.innerHTML = '<div class="ok-pill">All loops normal · products on spec</div>'; }
    al.slice(0, 4).forEach((a) => {
      const div = document.createElement('div'); div.className = 'al p' + a.pri;
      div.innerHTML = `<span class="t">${a.tag}</span><span>${a.text}</span>`;
      if (a.tag === 'PAHH-110') { const b = document.createElement('button'); b.textContent = 'Reset trip'; b.onclick = () => { if (!sim.resetTrip()) b.textContent = 'P still high'; }; div.appendChild(b); }
      if (!prevAlarms.has(a.text.split(' ')[0] + a.tag)) { div.classList.add('new'); }
      el.appendChild(div);
    });
    const now = new Set(al.map((a) => a.text.split(' ')[0] + a.tag));
    for (const a of al) if (!prevAlarms.has(a.text.split(' ')[0] + a.tag) && a.pri <= 2 && sim.t > 60) toast('alarm', `${a.tag} · ${a.text}`);
    prevAlarms = now;
    if (al.length > 4) { const div = document.createElement('div'); div.className = 'al p3'; div.textContent = `+${al.length - 4} more`; el.appendChild(div); }
  }
  // log
  $('#log').innerHTML = sim.events.slice(0, 12).map((e) => `<div><span>${clockStr(e.t, true)}</span> <span class="${e.kind}-k">${e.text}</span></div>`).join('') || '<div>Quiet shift so far.</div>';
  updateLoops(); updateFaults();
}

// ---------------- labels ----------------
const labelEls = new Map();
function updateLabels() {
  if (!groupVis.labels) return;
  const w = window.innerWidth, h = window.innerHeight;
  const v = new THREE.Vector3();
  const camDist = camera.position.distanceTo(controls.target);
  for (const L of plant.labels) {
    let el = labelEls.get(L.id);
    if (!el) { el = document.createElement('div'); el.className = 'lbl ' + L.cls; $('#labels').appendChild(el); labelEls.set(L.id, el); }
    const hidden = (L.onlyOpen && plant.openT < 0.6) || (L.cls === 'tray' && camDist > 22) || (L.cls !== 'equip' && L.cls !== 'tray' && camDist > 34);
    v.copy(L.pos).project(camera);
    if (hidden || v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px';
    el.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
    const txt = L.text(sim);
    if (el._t !== txt) { el.textContent = txt; el._t = txt; }
    const alarm = L.alarm ? L.alarm(sim) : false;
    el.classList.toggle('alarm', !!alarm);
  }
}

// ---------------- fault callouts (HTML, anchored to the 3D fault location) ----------------
const calloutEls = new Map();
function updateCallouts() {
  const w = window.innerWidth, h = window.innerHeight, v = new THREE.Vector3();
  const live = new Set();
  for (const k in FX) {
    if (!sim.faults[k].active) continue;
    live.add(k);
    let el = calloutEls.get(k);
    if (!el) { el = document.createElement('div'); el.className = 'callout'; $('#callouts').appendChild(el); calloutEls.set(k, el); el.onclick = () => select(FX[k].focus, true); }
    v.copy(FX[k].anchor()).project(camera);
    if (v.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px';
    el.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
    const fx = FX[k], st = FS[k], m = fx.metrics[0];
    const val = m.fn(sim), base = st ? st.base[0] : val, dd = val - base;
    const arr = Math.abs(dd) < Math.pow(10, -m.dec) ? '' : dd > 0 ? ' ▲' : ' ▼';
    const html = `<b>⚠ ${fx.short}</b><span>${m.name} ${val.toFixed(m.dec)}${m.unit}${arr}</span>${st && st.told ? '<em>first tell ✓</em>' : ''}`;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.classList.toggle('told', !!(st && st.told));
  }
  for (const [k, el] of calloutEls) if (!live.has(k)) { el.remove(); calloutEls.delete(k); }
}

// ---------------- picking + info card ----------------
let selected = null;
const ray = new THREE.Raycaster();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const m = new THREE.Vector2(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(m, camera);
  const hits = ray.intersectObjects(plant.pickables.filter((o) => isShown(o)), false);
  // skip clipped-away surfaces of the cutaway
  const hit = hits.find((h) => !isClipped(h));
  if (!hit) { select(null); return; }
  select(hit.object.userData.pick, true);
});
function isShown(o) { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; }
function isClipped(h) {
  const planes = h.object.material && h.object.material.clippingPlanes;
  if (!planes || !planes.length) return false;
  return planes.every((pl) => pl.distanceToPoint(h.point) < 0);
}
function select(info, focus) {
  selected = info;
  const card = $('#info');
  if (!info) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  if (focus) focusOn(info);
  renderInfo();
}
function focusOn(info) {
  let target, off;
  const P = plant;
  if (info.kind === 'tray') { target = new THREE.Vector3(0, trayY(info.i) + 0.2, 0); off = new THREE.Vector3(3.2, 1.3, 3.2); if (!isOpen) { animateOpen(1); } }
  else if (info.kind === 'column' || info.kind === 'sump') { target = new THREE.Vector3(0, info.kind === 'sump' ? 4.6 : 10.5, 0); off = info.kind === 'sump' ? new THREE.Vector3(4, 1.5, 4) : new THREE.Vector3(7.5, 2, 7.5); }
  else if (info.kind === 'reboiler') { target = new THREE.Vector3(P.reb.cx, P.reb.cy, 0); off = new THREE.Vector3(3.2, 3.6, 8.0); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'condenser') { target = new THREE.Vector3(P.cond.cx, P.cond.cy, 0); off = new THREE.Vector3(7.0, 3.0, 4.0); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'drum') { target = new THREE.Vector3(P.drumG.cx, P.drumG.cy, 0); off = new THREE.Vector3(7.0, 2.6, 4.2); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'p101') { target = new THREE.Vector3(-3, 0.8, 3.2); off = new THREE.Vector3(2.5, 1.6, 3); }
  else if (info.kind === 'p102') { target = new THREE.Vector3(1.3, 0.8, 2.6); off = new THREE.Vector3(2.5, 1.6, 3); }
  else if (info.kind === 'valve') { const v = P.valves[info.tag].g; target = v.position.clone(); off = new THREE.Vector3(1.8, 1.0, 2.4); }
  if (target) tweenCam(target.clone().add(off), target, 1.2);
}
function rows(r) { return '<table>' + r.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + '</table>'; }
function renderInfo() {
  if (!selected) return;
  const s = sim, i = selected.i, card = $('#info');
  let html = '<button class="x" onclick="this.parentNode.style.display=\'none\'">×</button>';
  const k = selected.kind;
  if (k === 'tray') {
    const t = s.trays[i];
    const state = t.damaged ? 'DISLODGED' : t.liquidFull ? 'liquid-full (stacked)' : t.flooding ? 'FLOODING' : t.weeping ? 'weeping' : 'normal';
    html += `<div class="eyebrow">Valve tray · C-101</div><h1>Tray ${i + 1}${i === 8 ? ' · feed' : i === 4 ? ' · TIC-105' : ''}</h1>` + rows([
      ['Temperature', t.T.toFixed(1) + ' °C'], ['Pressure', t.P.toFixed(1) + ' kPa'], ['Liquid benzene', (t.x * 100).toFixed(1) + '%'], ['Vapor benzene', (t.y * 100).toFixed(1) + '%'],
      ['Jet flood', (t.flood * 100).toFixed(0) + '%'], ['Tray ΔP', (t.dp * 1000 / 9.81 / 0.812).toFixed(0) + ' mm liq'], ['Efficiency', (t.E * 100).toFixed(0) + '%'],
      ['Open area', (t.phi * 100).toFixed(0) + '%'], ['Liquid holdup', t.M.toFixed(2) + ' kmol'], ['Entrainment', (t.psi * 100).toFixed(1) + '%'], ['State', state]]);
    html += `<p>${t.damaged ? 'Panels lifted. Liquid dumps straight through and vapor bypasses. This tray does no separation.' : t.flooding ? 'Vapor is holding liquid up. Froth fills the tray spacing, liquid gets carried to the tray above, separation collapses and ΔP jumps.' : t.weeping ? 'Too little vapor to hold liquid on the deck. Liquid leaks through the valves and skips contact.' : 'Vapor bubbles up through the valves into the froth; liquid crosses the deck, over the weir and down the downcomer.'}</p>`;
  } else if (k === 'reboiler') {
    html += `<div class="eyebrow">Kettle reboiler · LP steam in tubes</div><h1>E-101 reboiler</h1>` + rows([
      ['Duty', (s.reb.Q / 3.6).toFixed(0) + ' kW'], ['Boil-up', s.flows.VB.toFixed(0) + ' kmol/h'], ['Steam valve TV-105', s.valves.TV105.toFixed(0) + '%'],
      ['Steam header', (s.reb.Psup / 100).toFixed(1) + ' bar(a)'], ['Tube-side pressure', (s.reb.Psh / 100).toFixed(1) + ' bar(a)'], ['Steam temperature', s.reb.Tsh.toFixed(0) + ' °C'],
      ['Bottoms temperature', s.reb.T.toFixed(1) + ' °C'], ['UA (vs clean)', (s.reb.UAf * 100).toFixed(0) + '%'], ['Sump level', s.meas.sumpL.toFixed(0) + '%']]);
    html += `<p>As the bundle fouls, the steam has to condense hotter to push the same heat through. Tube-side pressure climbs, the valve sees less ΔP, and TIC-105 opens it further. When the valve runs out, the column runs out.</p>`;
  } else if (k === 'condenser') {
    html += `<div class="eyebrow">Shell & tube · CW in tubes</div><h1>E-102 condenser</h1>` + rows([
      ['Duty', (s.top.Qc / 3.6).toFixed(0) + ' kW'], ['Vapor in', s.flows.Vtop.toFixed(0) + ' kmol/h'], ['Condensing', s.flows.Vcond.toFixed(0) + ' kmol/h'],
      ['CW valve PV-110', s.valves.PV110.toFixed(0) + '%'], ['Condensing temp', s.top.Tcond.toFixed(1) + ' °C'], ['UA (vs clean)', (s.top.UAf * 100).toFixed(0) + '%'], ['Top pressure', s.top.P.toFixed(1) + ' kPa']]);
    html += `<p>Pressure is the balance between vapor arriving and vapor condensed. Lose condensing and pressure rises until the hotter vapor forces enough heat through. Every tray temperature moves with it.</p>`;
  } else if (k === 'drum') {
    html += `<div class="eyebrow">Horizontal accumulator</div><h1>V-101 reflux drum</h1>` + rows([
      ['Level', s.meas.drumL.toFixed(0) + '%'], ['Benzene', (s.drum.x * 100).toFixed(2) + '%'], ['Reflux', s.flows.LR.toFixed(0) + ' kmol/h'], ['Distillate', s.flows.D.toFixed(0) + ' kmol/h'], ['Reflux ratio', (s.flows.LR / Math.max(0.1, s.flows.D)).toFixed(2)]]);
  } else if (k === 'sump' || k === 'column') {
    html += `<div class="eyebrow">20 valve trays · 1.3 m ID · 600 mm spacing</div><h1>C-101 column</h1>` + rows([
      ['Top pressure', s.top.P.toFixed(1) + ' kPa'], ['Column ΔP', s.dP.toFixed(1) + ' kPa'], ['Top temp', s.trays[19].T.toFixed(1) + ' °C'], ['Bottom temp', s.reb.T.toFixed(1) + ' °C'],
      ['Feed', `${s.flows.F.toFixed(0)} kmol/h @ ${(s.feed.z * 100).toFixed(0)}% Bz`], ['Boil-up', s.flows.VB.toFixed(0) + ' kmol/h'], ['Sump level', s.meas.sumpL.toFixed(0) + '%']]);
  } else if (k === 'p101' || k === 'p102') {
    const b = k === 'p102';
    html += `<div class="eyebrow">Centrifugal pump</div><h1>${b ? 'P-102 bottoms pump' : 'P-101 reflux pump'}</h1>` + rows(b
      ? [['Flow', s.flows.B.toFixed(0) + ' kmol/h'], ['LV-130', s.valves.LV130.toFixed(0) + '%'], ['Condition', s.faults.bottomsPump.active ? 'cavitating · 35% capacity' : 'normal'], ['Sump level', s.meas.sumpL.toFixed(0) + '%']]
      : [['Flow', (s.flows.LR + s.flows.D).toFixed(0) + ' kmol/h'], ['Suction (drum level)', s.meas.drumL.toFixed(0) + '%']]);
  } else if (k === 'valve') {
    const map = { 'FV-101': ['FIC101', 'Feed'], 'FV-140': ['FIC140', 'Reflux'], 'TV-105': ['TIC105', 'Steam to E-101'], 'PV-110': ['PIC110', 'Cooling water'], 'LV-120': ['LIC120', 'Distillate'], 'LV-130': ['LIC130', 'Bottoms'] };
    const [ck, nm] = map[selected.tag]; const c = s.ctl[ck];
    const vk = selected.tag.replace('-', '');
    html += `<div class="eyebrow">Control valve · ${nm}</div><h1>${selected.tag}</h1>` + rows([
      ['Position', s.valves[vk].toFixed(0) + '% open'], ['Controller', `${c.tag} ${c.mode}`], ['PV', c.pv.toFixed(1) + ' ' + c.unit], ['SP', c.sp.toFixed(1) + ' ' + c.unit], ['Controller OP', c.op.toFixed(0) + '%']]);
    if (selected.tag === 'FV-140' && s.faults.refluxValveFail.active) html += '<p><b>Air lost.</b> The controller is asking for more; the valve is shut and can\'t answer.</p>';
  }
  card.innerHTML = html;
}

// ---------------- loop ----------------
// ?record = deterministic frame stepping for video capture: nothing runs until APP.tick(dt) is called
const RECORD = params.has('record');
let last = performance.now(), acc = 0, uiAcc = 0, chartAcc = 0, curNow = 0, vnow = 0;
function frame(now) {
  curNow = now;
  const dt = Math.min(0.06, (now - last) / 1000); last = now;
  // sim time
  if (speed > 0) {
    acc += dt * speed;
    let steps = Math.floor(acc / 0.5);
    if (steps > 9000) { steps = 9000; acc = 0; }
    if (steps > 0) { sim.advance(steps * 0.5); acc -= steps * 0.5; }
  }
  // cutaway anim
  if (openAnim) { openAnim.t += dt / openAnim.dur; const k = Math.min(1, openAnim.t); plant.setOpen(openAnim.from + (openAnim.to - openAnim.from) * k); if (k >= 1) openAnim = null; }
  if (camTween) {
    camTween.t += dt / camTween.dur; const k = Math.min(1, camTween.t); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(camTween.p0, camTween.p1, e); controls.target.lerpVectors(camTween.t0, camTween.t1, e);
    if (k >= 1) camTween = null;
  }
  plant.update(sim, dt, colorMode, selected);
  // fault highlights + beacons
  const pulse = 0.5 + 0.5 * Math.sin(now / 1000 * 4.2);
  const hl = [], bc = [];
  for (const k in FX) {
    if (sim.faults[k].active) {
      for (const key of FX[k].keys) hl.push({ key, color: 0xff3b1f, k: 0.1 + 0.32 * pulse });
      bc.push({ id: k, pos: FX[k].anchor(), size: FX[k].size, color: FS[k] && FS[k].told ? 0xd99a16 : 0xe8573a });
    } else if (fixedAt[k] && now - fixedAt[k] < 3000) {
      const a = 1 - (now - fixedAt[k]) / 3000;
      for (const key of FX[k].keys) hl.push({ key, color: 0x2ecc71, k: 0.7 * a });
      bc.push({ id: k + '-fix', pos: FX[k].anchor(), size: FX[k].size * 0.8, color: 0x2e9d62 });
    }
  }
  plant.setHighlights(hl);
  plant.updateBeacons(bc, camera, dt);
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
  updateCallouts();
  expireToasts();
  uiAcc += dt; chartAcc += dt;
  if (uiAcc > 0.15) { uiAcc = 0; updatePanels(); renderInfo(); }
  if (chartAcc > 0.5) { chartAcc = 0; drawTrend(); drawProfile(); }
  if (!RECORD) requestAnimationFrame(frame);
}

if (params.has('clean')) document.body.classList.add('clean');
applyVis();
resize();
setView(VIEWS.home, true);
updatePanels();
if (params.has('open')) { plant.setOpen(1); isOpen = true; $('#openBtn').textContent = 'Close the column'; setView(VIEWS.open, true); }
if (!RECORD) requestAnimationFrame(frame);

// expose for scripted recording / debugging
window.APP = { THREE, get sim() { return sim; }, plant, camera, controls, setView, tweenCam, animateOpen, select, VIEWS, toggleFault, FX, FS, resize,
  tick: (dt) => { vnow += dt * 1000; last = vnow - dt * 1000; frame(vnow); },
  get isOpen() { return isOpen; }, setSpeed: (s) => { speed = s; buildSpeeds(); }, setColor: (m) => document.querySelector(`#colorMode [data-m="${m}"]`).click() };
