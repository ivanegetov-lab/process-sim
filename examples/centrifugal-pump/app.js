import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { Plant, LAYOUT, PY, CX } from './scene.js';

const { PumpSim, FAULTS } = window.PumpSimLib;
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const CAM_SLOW = Math.max(0.2, +(params.get('camslow') || 1));
const barg = (p) => (p - 101.3) / 100;

// ---------------- sim ----------------
let sim = new PumpSim();
let baseline = snap();
function snap() { return { V1: sim.meas.V1, V2: sim.meas.V2, kW: sim.pump.Pel, Ps: sim.pump.Ps, LV: sim.valves.LV310 }; }

// What a good engineer or maintenance manager sees first. Edit these in your own words.
const TELLS = {
  strainerPlug: '<b>Watch PDI-305.</b> Strainer ΔP climbs for hours while flow, pressure and vibration all look normal. Once the NPSH margin is gone, the pump cavitates and every number moves at once.',
  impellerWear: '<b>Watch LV-310 and the amps.</b> The valve creeps open to hold the same flow, and the motor draws more for it. When the valve pins, the receiver starts to fill.',
  bearingDefect: '<b>Watch the spectrum, not the overall.</b> A peak at the outer-race defect frequency (BPFO, 3.07×) shows up long before the overall number or the temperature moves. That gap is your P-F interval.',
  misalignment: '<b>The overall says "vibration high". The spectrum says why.</b> 2× running speed dominates at the coupling-end bearing, and that bearing runs hotter.',
  sealWear: '<b>Watch the drip.</b> A steady drip from the gland on rounds comes long before the leak-pot alarm. Seals rarely fail all at once.',
  ltDrift: '<b>The board says 50%. PI-305 disagrees.</b> Suction pressure keeps falling while the level reads steady. Both can\'t be right. When the pump starts to vortex, the pump gets blamed.',
  valveFail: '<b>Flow to zero, amps drop, the pump keeps running.</b> All the motor power now heats a few liters of water in the casing. Hot condensate flashes in minutes.',
  inflowSurge: '<b>The controls should absorb this one.</b> LV-310 opens, flow follows, level holds. A disturbance, not a failure. Note how little valve is left.',
};
const FAULT_TAGS = { strainerPlug: 'S-305', impellerWear: 'P-301', bearingDefect: 'Brg 301', misalignment: 'Coupling', sealWear: 'Seal', ltDrift: 'LT-301', valveFail: 'LV-310', inflowSurge: 'FI-300' };

// ---------------- three ----------------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: params.has('record') });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.fog = new THREE.Fog(0xdfe2e5, 30, 70);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.zoomToCursor = true;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.8; controls.maxDistance = 40;
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(8, 14, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -5, near: 1, far: 50 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; scene.add(sun);
const fill = new THREE.DirectionalLight(0xfff4e6, 0.55); fill.position.set(-8, 6, 8); scene.add(fill);

const plant = new Plant(scene, sim);

// ---------------- what each fault touches, where to point, what to measure, when it first shows ----------------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const m_ = (name, fn, unit, dec) => ({ name, fn, unit, dec });
const FX = {
  strainerPlug: { short: 'Strainer plugging', keys: ['strainer', 'pipe:suction'], anchor: () => plant.strainerPos.clone(), size: 0.7, focus: { kind: 'strainer' }, loops: [],
    metrics: [m_('PDI-305 strainer ΔP', (s) => s.pump.dPstr, ' kPa', 1), m_('PI-305 suction', (s) => barg(s.pump.Ps), ' barg', 2), m_('NPSH margin', (s) => s.pump.npshA - s.pump.npshR, ' m', 1), m_('VI-301 vibration', (s) => s.meas.V1, ' mm/s', 1)],
    tell: (s, b) => s.pump.dPstr > b[0] + 8, tellText: (s, b) => `Strainer ΔP is ${s.pump.dPstr.toFixed(0)} kPa (was ${b[0].toFixed(0)}). Flow, vibration and sound are all still normal. This is where you catch it.` },
  impellerWear: { short: 'Impeller wearing', keys: ['impeller', 'casing'], anchor: () => V3(CX, PY + 0.35, 0.3), size: 0.6, focus: { kind: 'pump' }, loops: ['LIC301'],
    metrics: [m_('LV-310 valve', (s) => s.valves.LV310, '%', 0), m_('Pump head', (s) => s.pump.H, ' m', 1), m_('Motor amps', (s) => s.pump.amps, ' A', 1), m_('Flow', (s) => s.meas.Q, ' m³/h', 0)],
    tell: (s, b) => s.valves.LV310 > b[0] + 8, tellText: (s, b) => `LV-310 is ${s.valves.LV310.toFixed(0)}% open (was ${b[0].toFixed(0)}%) for the same flow. Amps up ${(s.pump.amps - b[2]).toFixed(1)} A. The pump is losing head.` },
  bearingDefect: { short: 'Bearing defect', keys: ['bearing1'], anchor: () => V3(LAYOUT.B1X, PY + 0.2, 0.18), size: 0.45, focus: { kind: 'bearing', i: 1 }, loops: [],
    metrics: [m_('BPFO peak (spectrum)', (s) => s.vib.b1.bp, ' mm/s', 2), m_('VI-301 overall', (s) => s.meas.V1, ' mm/s', 1), m_('TI-301 bearing', (s) => s.meas.T1, ' °C', 0)],
    tell: (s) => s.vib.b1.bp > 0.5, tellText: (s) => `A BPFO peak is up in the spectrum (${s.vib.b1.bp.toFixed(2)} mm/s). Overall vibration is still ${s.meas.V1.toFixed(1)} mm/s, zone A/B. Plan the bearing change now.`, spec: 1 },
  misalignment: { short: 'Misaligned coupling', keys: ['coupling', 'motor'], anchor: () => V3(LAYOUT.CPLX, PY + 0.2, 0.2), size: 0.5, focus: { kind: 'coupling' }, loops: [],
    metrics: [m_('VI-302 2× peak', (s) => s.vib.b2.x2, ' mm/s', 2), m_('VI-302 overall', (s) => s.meas.V2, ' mm/s', 1), m_('TI-302 bearing', (s) => s.meas.T2, ' °C', 0), m_('Motor power', (s) => s.pump.Pel, ' kW', 1)],
    tell: (s) => s.vib.b2.x2 > s.vib.b2.x1, tellText: (s) => `2× running speed (${s.vib.b2.x2.toFixed(1)} mm/s) is bigger than 1× (${s.vib.b2.x1.toFixed(1)}) at the coupling-end bearing. That is the misalignment signature.`, spec: 2 },
  sealWear: { short: 'Seal wearing', keys: ['seal'], anchor: () => V3(LAYOUT.SEALX + 0.1, PY - 0.05, 0.16), size: 0.4, focus: { kind: 'seal' }, loops: [],
    metrics: [m_('Seal leakage', (s) => s.pump.leak, ' L/h', 2), m_('Condensate lost', (s) => s.money.lostM3 * 1000, ' L', 0)],
    tell: (s) => s.pump.leak > 0.6, tellText: (s) => `Steady drip from the gland: ${s.pump.leak.toFixed(1)} L/h. No alarm until 6 L/h. Rounds catch this, not the DCS.` },
  ltDrift: { short: 'LT-301 drifting', keys: ['lt', 'tank'], anchor: () => plant.ltPos.clone(), size: 0.7, focus: { kind: 'tank' }, loops: ['LIC301'],
    metrics: [m_('LI-301 reads', (s) => s.meas.L, '%', 0), m_('Level actually', (s) => s.meas.Ltrue, '%', 0), m_('PI-305 suction', (s) => barg(s.pump.Ps), ' barg', 2)],
    tell: (s, b) => s.pump.Ps < b[3] - 5, tellText: (s) => `LI-301 reads ${s.meas.L.toFixed(0)}%. The receiver is really at ${s.meas.Ltrue.toFixed(0)}%. PI-305 has been falling the whole time.`, extraBase: (s) => s.pump.Ps },
  valveFail: { short: 'LV-310 failed shut', keys: ['valve:LV-310', 'pipe:discharge', 'casing'], anchor: () => plant.valves['LV-310'].g.position.clone().add(V3(0, 0.75, 0)), size: 0.6, focus: { kind: 'valve', tag: 'LV-310' }, loops: ['LIC301'],
    metrics: [m_('Flow', (s) => s.meas.Q, ' m³/h', 0), m_('Motor amps', (s) => s.pump.amps, ' A', 1), m_('TI-303 casing', (s) => s.pump.Tc, ' °C', 0), m_('Receiver level', (s) => s.meas.L, '%', 0)],
    tell: (s) => s.pump.running && s.meas.Q < 5, tellText: (s, b) => `Flow is zero and amps fell from ${b[1].toFixed(0)} to ${s.pump.amps.toFixed(0)} A, with the pump still running. It's deadheaded.` },
  inflowSurge: { short: 'Return surge', keys: ['pipe:inflow'], anchor: () => plant.inletPos.clone().add(V3(-1.2, 0.8, 0)), size: 0.7, focus: { kind: 'tank' }, loops: ['LIC301'],
    metrics: [m_('Return flow', (s) => s.tank.Qin, ' m³/h', 0), m_('LV-310 valve', (s) => s.valves.LV310, '%', 0), m_('Receiver level', (s) => s.meas.L, '%', 0)],
    tell: (s, b) => s.valves.LV310 > b[1] + 6, tellText: (s, b) => `LV-310 went from ${b[1].toFixed(0)}% to ${s.valves.LV310.toFixed(0)}%. Level holds. The controls are absorbing it.` },
};
const FS = {}, fixedAt = {};
let followFaults = true;

const VIEWS = {
  home: { pos: [3.0, 6.6, 15.8], target: [-2.2, 3.0, 0] },
  open: { pos: [-2.55, 2.15, 3.55], target: [-0.55, 0.9, 0] },
};
function setView(v, instant) { tweenCam(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target), instant ? 0 : 1.4); }
let camTween = null;
function tweenCam(pos, target, dur) {
  if (!dur) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
  camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, t: 0, dur: dur * CAM_SLOW };
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  document.body.classList.toggle('portrait', h > w * 1.05);
  let cx = w / 2, cy = h / 2;
  if (!document.body.classList.contains('clean')) {
    const L = $('#left').getBoundingClientRect(), R = $('#right').getBoundingClientRect(), B = $('#bottom').getBoundingClientRect();
    if (R.left - L.right > 200) { cx = (L.right + R.left) / 2; cy = B.top / 2; }
  }
  camera.setViewOffset(w, h, -(cx - w / 2), -(cy - h / 2), w, h);
  camera.updateProjectionMatrix();
  drawChart(); drawTrend();
}
window.addEventListener('resize', resize);

// ---------------- UI: components ----------------
const groupVis = {};
document.querySelectorAll('.chip[data-g]').forEach((b) => { const g = b.dataset.g; groupVis[g] = true; b.onclick = () => { groupVis[g] = !groupVis[g]; applyVis(); }; });
function applyVis() {
  for (const k in plant.groups) if (groupVis[k] !== undefined) plant.groups[k].visible = groupVis[k] !== false;
  plant.groups.valves.visible = groupVis.piping !== false;
  plant.groups.flow.visible = groupVis.flow !== false;
  document.querySelectorAll('.chip[data-g]').forEach((b) => b.classList.toggle('off', !groupVis[b.dataset.g]));
  $('#labels').style.display = groupVis.labels ? '' : 'none';
}
let openAnim = null, isOpen = false;
function animateOpen(to) { openAnim = { from: plant.openT, to, t: 0, dur: 2.2 * CAM_SLOW }; isOpen = to > 0.5; $('#openBtn').textContent = isOpen ? 'Close the pump' : 'Open up the pump'; }
$('#openBtn').onclick = () => { if (!isOpen) { animateOpen(1); setView(VIEWS.open); } else { animateOpen(0); setView(VIEWS.home); } };
$('#showAll').onclick = () => { for (const k in groupVis) groupVis[k] = true; applyVis(); animateOpen(0); setView(VIEWS.home); select(null); };
$('#resetView').onclick = () => { setView(isOpen ? VIEWS.open : VIEWS.home); select(null); };

let colorMode = 'pressure';
const LEGENDS = {
  pressure: ['linear-gradient(90deg,#ffffff 0 8%,hsl(223,75%,50%) 8%,hsl(140,75%,50%),hsl(60,75%,50%),hsl(0,75%,50%))', ['vapor', '-0.4', '4.4 barg']],
  temperature: ['linear-gradient(90deg,hsl(223,75%,50%),hsl(140,75%,50%),hsl(60,75%,50%),hsl(0,75%,50%))', ['60 °C', '', '115 °C']],
  vibration: ['linear-gradient(90deg,#2e9d62 0 25%,#a4c23a 25% 50%,#f2a33a 50% 75%,#d93333 75%)', ['zone A', 'B · C', 'D (ISO 10816-3)']],
};
function setLegend() { const [g, l] = LEGENDS[colorMode]; $('#legend').style.background = g; $('#legendL').innerHTML = l.map((x) => `<span>${x}</span>`).join(''); }
document.querySelectorAll('#colorMode button').forEach((b) => b.onclick = () => { colorMode = b.dataset.m; document.querySelectorAll('#colorMode button').forEach((x) => x.classList.toggle('on', x === b)); setLegend(); });
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
    el.appendChild(d);
  }
}
function toggleFault(k) {
  const on = !sim.faults[k].active;
  sim.setFault(k, on);
  const fx = FX[k];
  if (on) {
    const base = fx.metrics.map((m) => m.fn(sim)); if (fx.extraBase) base[3] = fx.extraBase(sim);
    FS[k] = { t0: sim.t, base, told: false };
    toast('fault', `Broke it: ${FAULTS[k].label.toLowerCase()}`, FAULTS[k].what);
    if (followFaults) {
      const f = fx.focus;
      if (['pump', 'bearing', 'seal', 'coupling', 'strainer'].includes(f.kind) && !isOpen) animateOpen(1);
      select(f, true);
      if (fx.spec) setChartTab('spec' + fx.spec);
    }
  } else {
    delete FS[k]; fixedAt[k] = curNow;
    toast('fix', `Fixed: ${FAULTS[k].fix}`, 'Watch the pump recover.');
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
function toast(kind, title, body) {
  const el = document.createElement('div'); el.className = 'toast ' + kind;
  el.innerHTML = `<div class="tt"><span class="tm">${clockStr(sim.t, true)}</span>${title}</div>${body ? `<div class="tb">${body}</div>` : ''}`;
  const box = $('#toasts'); box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  const life = kind === 'tell' ? 11000 : 7000;
  el.dataset.out = curNow + life; el.dataset.end = curNow + life + 600;
}
function expireToasts() { document.querySelectorAll('#toasts .toast').forEach((el) => { if (curNow > +el.dataset.end) el.remove(); else if (curNow > +el.dataset.out) el.classList.add('out'); }); }

// ---------------- UI: loops + motor ----------------
function buildLoops() {
  const el = $('#loops'); el.innerHTML = '';
  const c = sim.ctl.LIC301;
  const d = document.createElement('div'); d.className = 'fp'; d.id = 'l-LIC301';
  d.innerHTML = `<div class="tg">${c.tag}<small>${c.name}</small></div>
    <div><div class="pv"></div><div class="op"><i></i></div><div class="opl"></div></div>
    <div class="sp"><button data-d="-1">−</button><span></span><button data-d="1">+</button><button class="md"></button></div>`;
  d.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
    const c = sim.ctl.LIC301, dir = +b.dataset.d;
    if (c.mode === 'AUTO') c.sp = Math.max(10, Math.min(90, c.sp + dir * 5)); else c.op = Math.max(0, Math.min(100, c.op + dir * 5));
    updateLoops();
  });
  d.querySelector('.md').onclick = () => { const c = sim.ctl.LIC301; c.mode = c.mode === 'AUTO' ? 'MAN' : 'AUTO'; if (c.mode === 'AUTO') c.sp = Math.round(c.pv); updateLoops(); };
  el.appendChild(d);
  const m = document.createElement('div'); m.className = 'fp'; m.id = 'l-HS301';
  m.innerHTML = `<div class="tg">HS-301<small>P-301 motor</small></div><div><div class="pv"></div><div class="opl"></div></div><div class="sp"><button class="st"></button></div>`;
  m.querySelector('.st').onclick = () => {
    if (sim.trip.on) { if (!sim.resetTrip()) toast('alarm', 'Can\'t restart yet', sim.trip.tag === 'M-301' ? 'Replace the bearing first.' : 'Clear the cause first: level above 20%, casing below 95 °C.'); }
    else if (sim.pump.running) { sim.pump.running = false; sim.log('P-301 stopped by operator', 'op'); }
    else { sim.pump.running = true; sim.log('P-301 started by operator', 'op'); }
    updateLoops();
  };
  el.appendChild(m);
}
function updateLoops() {
  const c = sim.ctl.LIC301, d = $('#l-LIC301');
  d.querySelector('.pv').innerHTML = `${c.pv.toFixed(0)} <small>${c.unit}</small>`;
  const op = d.querySelector('.op'); op.querySelector('i').style.width = c.op.toFixed(1) + '%'; op.classList.toggle('sat', c.op > 92 || c.op < 3);
  d.querySelector('.opl').textContent = `OP ${c.op.toFixed(0)}% · LV-310 ${sim.valves.LV310.toFixed(0)}%`;
  d.querySelector('.sp span').textContent = c.mode === 'AUTO' ? `SP ${c.sp.toFixed(0)}` : `OP ${c.op.toFixed(0)}`;
  const md = d.querySelector('.md'); md.textContent = c.mode; md.classList.toggle('man', c.mode !== 'AUTO');
  d.classList.toggle('hot', Object.keys(FS).some((k) => FX[k].loops.includes('LIC301')));
  const m = $('#l-HS301'), run = sim.pump.running && !sim.trip.on;
  m.querySelector('.pv').innerHTML = run ? `RUN <small>${sim.pump.amps.toFixed(1)} A</small>` : `<span style="color:var(--red)">${sim.trip.on ? 'TRIPPED' : 'STOPPED'}</span>`;
  m.querySelector('.opl').textContent = run ? `${sim.pump.Pel.toFixed(1)} kW · ${sim.d.rpm} rpm` : (sim.trip.reason || 'stopped');
  m.querySelector('.st').textContent = sim.trip.on ? 'Reset' : run ? 'Stop' : 'Start';
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
$('#restart').onclick = () => { sim = new PumpSim(); plant.sim = sim; baseline = snap(); for (const k in FS) delete FS[k]; buildLoops(); updateFaults(); select(null); };

// ---------------- charts ----------------
let trendTab = 'flow', chartTab = 'curve';
document.querySelectorAll('#trendTabs button').forEach((b) => b.onclick = () => { trendTab = b.dataset.t; document.querySelectorAll('#trendTabs button').forEach((x) => x.classList.toggle('on', x === b)); drawTrend(); });
function setChartTab(t) { chartTab = t; document.querySelectorAll('#chartTabs button').forEach((x) => x.classList.toggle('on', x.dataset.p === t)); drawChart(); }
document.querySelectorAll('#chartTabs button').forEach((b) => b.onclick = () => setChartTab(b.dataset.p));

function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio);
  if (!cv.dataset.h) cv.dataset.h = cv.getAttribute('height');
  const h = +cv.dataset.h;
  if (cv._w !== r.width || cv._dpr !== dpr) { cv.style.height = h + 'px'; cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.round(h * dpr); cv._w = r.width; cv._dpr = dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h };
}
const MONO = (wt, px) => `${wt} ${px}px ui-monospace, Menlo, monospace`;

// trends: [key, label, color, fn, [lo, hi], rightAxis]; refs: [value, seriesIndex]
const TRENDS = {
  flow: { series: [['Q', 'Pump flow FI-310', '#1f8a8a', (p) => p.Q, [0, 140]], ['L', 'LI-301 reads %', '#e8573a', (p) => p.L, [0, 100], true], ['Ltrue', 'Level actual %', '#6b5bd6', (p) => p.Ltrue, [0, 100], true], ['Qin', 'Return FI-300', '#9aa2aa', (p) => p.Qin, [0, 140]]], refs: [[80, 1], [20, 1]] },
  press: { series: [['Ps', 'Suction PI-305 barg', '#2a64d6', (p) => barg(p.Ps), [-0.6, 0.6]], ['dPstr', 'Strainer PDI-305 kPa', '#d98a16', (p) => p.dPstr, [0, 80], true], ['Pd', 'Discharge PI-310 barg', '#d93333', (p) => barg(p.Pd), [0, 6], true]], refs: [[25, 1]] },
  npsh: { series: [['npshA', 'NPSH available m', '#1f8a8a', (p) => p.npshA, [0, 12]], ['npshR', 'NPSH required m', '#d93333', (p) => p.npshR, [0, 12]], ['npshI', '1.6 × NPSHr (cavitation starts)', '#f2a33a', (p) => p.npshR * 1.6, [0, 12]]], refs: [] },
  vib: { series: [['V1', 'VI-301 radial brg mm/s', '#d93333', (p) => p.V1, [0, 10]], ['V2', 'VI-302 thrust brg mm/s', '#6b5bd6', (p) => p.V2, [0, 10]]], refs: [[2.8, 0], [4.5, 0]] },
  temp: { series: [['T1', 'TI-301 radial brg °C', '#d93333', (p) => p.T1, [30, 100]], ['T2', 'TI-302 thrust brg °C', '#6b5bd6', (p) => p.T2, [30, 100]], ['Tc', 'TI-303 casing °C', '#d98a16', (p) => p.Tc, [60, 120], true]], refs: [[85, 0]] },
  power: { series: [['LV', 'LV-310 %', '#1f8a8a', (p) => p.LV, [0, 100]], ['kW', 'Motor kW', '#e8573a', (p) => p.kW, [0, 20], true], ['amps', 'Amps', '#9b7bd4', (p) => p.amps, [0, 32], true, 1]], refs: [[92, 0]] },
};
function drawTrend() {
  const cv = $('#trend'); const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  const H = sim.history; if (H.length < 2) return;
  const cfg = TRENDS[trendTab];
  const span = Math.max(6 * 3600, Math.min(48 * 3600, H[H.length - 1].t));
  const t1 = H[H.length - 1].t, t0 = Math.max(0, t1 - span);
  const padL = 34, padR = 34, padT = 14, padB = 14;
  const X = (t) => padL + (t - t0) / (t1 - t0 || 1) * (w - padL - padR);
  g.font = MONO(500, 9); g.strokeStyle = '#eceef0'; g.lineWidth = 1; g.fillStyle = '#9aa2aa';
  const stepH = span > 24 * 3600 ? 6 : span > 8 * 3600 ? 2 : 1;
  for (let hh = Math.ceil(t0 / 3600 / stepH) * stepH; hh * 3600 <= t1; hh += stepH) { const x = X(hh * 3600); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); g.fillText(clockStr(hh * 3600, true), x - 12, h - 3); }
  const EC = { fault: '#e8573a', fix: '#2e9d62', tell: '#d99a16', trip: '#d93333' }, EG = { fault: '⚠', fix: '✓', tell: '●', trip: '⛔' };
  for (const e of sim.events) {
    if (!EC[e.kind] || e.t < t0) continue; const x = X(e.t);
    g.strokeStyle = EC[e.kind]; g.globalAlpha = 0.75; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 1; g.fillStyle = EC[e.kind]; g.font = MONO(700, 10); g.fillText(EG[e.kind], x - 4, padT + 9); g.font = MONO(500, 9);
  }
  const Yf = (range) => (v) => padT + (1 - (Math.max(range[0], Math.min(range[1], v)) - range[0]) / (range[1] - range[0])) * (h - padT - padB);
  for (const [v, si] of cfg.refs) { const y = Yf(cfg.series[si][4])(v); g.strokeStyle = 'rgba(217,51,51,0.5)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke(); g.setLineDash([]); }
  let legendX = padL, leftDone = false, rightDone = false;
  cfg.series.forEach(([key, name, color, fn, range, right, hidden]) => {
    const Y = Yf(range);
    if ((!right && !leftDone) || (right && !rightDone)) {
      g.fillStyle = color; g.textAlign = right ? 'left' : 'right';
      g.fillText(range[1], right ? w - padR + 3 : padL - 3, padT + 3); g.fillText(range[0], right ? w - padR + 3 : padL - 3, h - padB);
      g.textAlign = 'left'; if (right) rightDone = true; else leftDone = true;
    }
    g.strokeStyle = color; g.lineWidth = key === 'Ltrue' || key === 'npshI' ? 2.0 : 1.8; if (key === 'Ltrue' || key === 'npshI' || key === 'Qin') g.setLineDash([5, 3]);
    g.beginPath(); let first = true;
    for (const p of H) { if (p.t < t0) continue; const x = X(p.t), y = Y(fn(p)); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    g.stroke(); g.setLineDash([]);
    g.fillStyle = color; g.fillRect(legendX, 2, 8, 3); g.fillStyle = '#4a535b'; g.fillText(name, legendX + 11, 8);
    legendX += g.measureText(name).width + 22;
  });
}

// pump curve + NPSH, or vibration spectrum
function drawChart() {
  const cv = $('#prof'); const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  if (chartTab === 'curve') drawCurve(g, w, h); else drawSpectrum(g, w, h, chartTab === 'spec1' ? 1 : 2);
}
function drawCurve(g, w, h) {
  const padL = 30, padR = 10, Qmax = 150;
  const top = { y0: 14, y1: Math.round(h * 0.6) }, bot = { y0: Math.round(h * 0.6) + 22, y1: h - 18 };
  const X = (q) => padL + q / Qmax * (w - padL - padR);
  const YH = (v) => top.y1 - Math.max(0, Math.min(55, v)) / 55 * (top.y1 - top.y0);
  const YN = (v) => bot.y1 - Math.max(0, Math.min(12, v)) / 12 * (bot.y1 - bot.y0);
  g.font = MONO(500, 9);
  // grid
  g.strokeStyle = '#eef0f2'; g.fillStyle = '#9aa2aa';
  for (let q = 0; q <= Qmax; q += 25) { const x = X(q); g.beginPath(); g.moveTo(x, top.y0); g.lineTo(x, top.y1); g.moveTo(x, bot.y0); g.lineTo(x, bot.y1); g.stroke(); g.fillText(q, x - 6, h - 6); }
  for (const v of [0, 20, 40]) { g.fillText(v, 4, YH(v) + 3); g.beginPath(); g.moveTo(padL, YH(v)); g.lineTo(w - padR, YH(v)); g.stroke(); }
  for (const v of [0, 6, 12]) { g.fillText(v, 8, YN(v) + 3); }
  g.fillText('m³/h', w - padR - 26, h - 6 - 10);
  // preferred operating region 70-120% BEP
  g.fillStyle = 'rgba(46,157,98,0.07)'; g.fillRect(X(70), top.y0, X(120) - X(70), top.y1 - top.y0);
  g.fillStyle = '#2e9d62'; g.fillText('POR', X(70) + 3, top.y0 + 9);
  const path = (fn, Y, from, to) => { g.beginPath(); for (let q = from; q <= to; q += 1.5) { const x = X(q), y = Y(fn(q)); q === from ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
  // clean pump curve, current pump curve, system curve (current valve) and valve wide open
  g.lineWidth = 1.2; g.strokeStyle = '#b9c0c6'; g.setLineDash([3, 3]); path((q) => sim.curveH(q, true), YH, 0, Qmax);
  g.strokeStyle = '#9aa2aa'; path((q) => sim.systemH(q, 100), YH, 0, Qmax); g.setLineDash([]);
  g.lineWidth = 2.2; g.strokeStyle = '#2a64d6'; path((q) => sim.curveH(q), YH, 0, Qmax);
  g.lineWidth = 1.6; g.strokeStyle = '#7c858d'; path((q) => sim.systemH(q), YH, 0, Qmax);
  // BEP
  g.fillStyle = '#2e9d62'; g.beginPath(); g.arc(X(100), YH(sim.curveH(100, true)), 3, 0, 7); g.fill(); g.fillText('BEP', X(100) + 5, YH(sim.curveH(100, true)) - 4);
  const run = sim.pump.running && !sim.trip.on;
  const Q = sim.pump.Q, H = sim.pump.H;
  if (run) { g.fillStyle = '#e8573a'; g.beginPath(); g.arc(X(Q), YH(H), 5, 0, 7); g.fill(); g.font = MONO(700, 10); g.fillText(`${Q.toFixed(0)} m³/h @ ${H.toFixed(1)} m`, Math.min(w - 125, X(Q) + 8), YH(H) - 7); g.font = MONO(500, 9); }
  g.fillStyle = '#2a64d6'; g.fillText('pump', X(130), YH(sim.curveH(130)) - 5);
  g.fillStyle = '#7c858d'; g.fillText('system', X(18), YH(sim.systemH(18)) - 5);
  g.fillStyle = '#4a535b'; g.font = MONO(700, 9); g.fillText('HEAD m', 2, 9); g.font = MONO(500, 9);
  // NPSH panel
  g.fillStyle = '#4a535b'; g.font = MONO(700, 9); g.fillText('NPSH m', 2, bot.y0 - 6); g.font = MONO(500, 9);
  // shade the cavitation zone between NPSHr and 1.6 NPSHr
  g.fillStyle = 'rgba(242,163,58,0.14)'; g.beginPath();
  for (let q = 0; q <= Qmax; q += 1.5) { const x = X(q), y = YN(sim.npshRat(q) * 1.6); q ? g.lineTo(x, y) : g.moveTo(x, y); }
  for (let q = Qmax; q >= 0; q -= 1.5) g.lineTo(X(q), YN(sim.npshRat(q)));
  g.closePath(); g.fill();
  g.lineWidth = 2; g.strokeStyle = '#d93333'; path((q) => sim.npshRat(q), YN, 0, Qmax);
  g.lineWidth = 1; g.strokeStyle = '#f2a33a'; g.setLineDash([3, 3]); path((q) => sim.npshRat(q) * 1.6, YN, 0, Qmax); g.setLineDash([]);
  g.lineWidth = 2; g.strokeStyle = '#1f8a8a'; path((q) => sim.npshAat(q), YN, 0, Qmax);
  g.fillStyle = '#1f8a8a'; g.fillText('available', X(4), YN(sim.npshAat(4)) - 4);
  g.fillStyle = '#d93333'; g.fillText('required', X(28), YN(sim.npshRat(28)) + 11);
  if (run) {
    const a = sim.pump.npshA, r = sim.pump.npshR, x = X(Q);
    g.strokeStyle = a < r ? '#d93333' : a < 1.6 * r ? '#d98a16' : '#2e9d62'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, YN(a)); g.lineTo(x, YN(r)); g.stroke();
    g.fillStyle = '#e8573a'; g.beginPath(); g.arc(x, YN(a), 3.5, 0, 7); g.fill();
    g.font = MONO(700, 10); g.fillStyle = g.strokeStyle;
    const txt = a < r ? `margin ${(a - r).toFixed(1)} m · CAVITATING` : a < 1.6 * r ? `margin ${(a - r).toFixed(1)} m · cavitation starting` : `margin ${(a - r).toFixed(1)} m`;
    g.fillText(txt, Math.min(w - g.measureText(txt).width - 4, x + 8), YN((a + r) / 2) + 3); g.font = MONO(500, 9);
  }
}
// deterministic pseudo-noise
const nz = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
function drawSpectrum(g, w, h, which) {
  const v = which === 1 ? sim.vib.b1 : sim.vib.b2, ov = which === 1 ? sim.vib.o1 : sim.vib.o2;
  const padL = 30, padR = 10, padT = 30, padB = 22, OM = 12;
  const peaks = [[1, v.x1, '1×'], [2, v.x2, '2×'], [3, 0.12 * v.x1], [6, v.vp, 'vane pass'], [3.07, v.bp, 'BPFO'], [6.14, 0.5 * v.bp], [9.21, 0.28 * v.bp], [2.07, 0.22 * v.bp], [4.07, 0.22 * v.bp]];
  const maxP = Math.max(2, ...peaks.map((p) => p[1]), v.bb * 0.6) * 1.18;
  const X = (o) => padL + o / OM * (w - padL - padR), Y = (a) => h - padB - Math.min(1, a / maxP) * (h - padT - padB);
  g.font = MONO(500, 9); g.strokeStyle = '#eef0f2'; g.fillStyle = '#9aa2aa';
  for (let o = 0; o <= OM; o += 1) { const x = X(o); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); if (o % 2 === 0) g.fillText(o + '×', x - 6, h - 10); }
  g.fillText(`${(OM * sim.d.rpm / 60).toFixed(0)} Hz`, w - padR - 40, h - 1);
  for (const a of [0, Math.round(maxP / 2 * 10) / 10]) { g.fillText(a, 4, Y(a) + 3); }
  const t = sim.t;
  g.beginPath(); g.moveTo(X(0), Y(0));
  const N = 480;
  for (let i = 0; i <= N; i++) {
    const o = i / N * OM;
    let a = 0.035 + 0.03 * nz(i, Math.floor(t / 20));
    for (const [c, amp] of peaks) a += amp * Math.exp(-((o - c) * (o - c)) / (2 * 0.035 * 0.035));
    if (v.bb > 0.02) a += v.bb * 0.32 * Math.exp(-((o - 8.5) * (o - 8.5)) / 8) * (0.55 + 0.9 * nz(i, 7 + Math.floor(t / 15)));
    g.lineTo(X(o), Y(a));
  }
  g.lineTo(X(OM), Y(0)); g.closePath();
  g.fillStyle = 'rgba(42,100,214,0.16)'; g.fill(); g.strokeStyle = '#2a64d6'; g.lineWidth = 1.3; g.stroke();
  for (const [c, amp, name] of peaks) {
    if (!name || amp < 0.15) continue;
    const hot = (name === 'BPFO' && amp > 0.4) || (name === '2×' && v.x2 > v.x1);
    g.fillStyle = hot ? '#e8573a' : '#4a535b'; g.font = MONO(hot ? 700 : 600, 9.5);
    g.fillText(name, X(c) - g.measureText(name).width / 2, Y(amp) - 5);
  }
  if (v.bb > 0.5) { g.fillStyle = '#e8573a'; g.font = MONO(700, 9.5); g.fillText('broadband: cavitation', X(6.6), Y(v.bb * 0.5) - 8); }
  const zone = ov < 1.4 ? 'A' : ov < 2.8 ? 'B' : ov < 4.5 ? 'C' : 'D';
  g.font = MONO(700, 10); g.fillStyle = zone === 'D' ? '#d93333' : zone === 'C' ? '#c47d10' : '#2e9d62';
  const lbl = `VI-30${which} overall ${ov.toFixed(2)} mm/s · zone ${zone}`;
  g.fillText(lbl, padL, 11);
  g.fillStyle = '#7c858d'; g.font = MONO(500, 9); g.fillText(which === 1 ? 'radial bearing · impeller end' : 'thrust bearing · coupling end', padL, 23);
}

// ---------------- KPIs, alarms, money, clock ----------------
function clockStr(t, short) {
  const tt = 6 * 3600 + t, day = Math.floor(tt / 86400) + 1, s = tt % 86400;
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
let lastAlarmKey = '', prevAlarms = new Set();
function updatePanels() {
  const p = sim.pump, m = sim.meas, run = p.running && !sim.trip.on;
  kpi('#kQ', m.Q.toFixed(1) + ' m³/h', `in ${sim.tank.Qin.toFixed(0)} · LV-310 ${sim.valves.LV310.toFixed(0)}%`, !run || m.Q < 20 ? 'bad' : sim.valves.LV310 > 92 ? 'warn' : '');
  const mg = p.npshA - p.npshR;
  kpi('#kN', run ? (mg >= 0 ? '+' : '') + mg.toFixed(1) + ' m' : '—', `NPSHa ${p.npshA.toFixed(1)} · NPSHr ${p.npshR.toFixed(1)} m`, !run ? '' : mg < 0 ? 'bad' : p.npshA < 1.6 * p.npshR ? 'warn' : '');
  const vmax = Math.max(m.V1, m.V2);
  kpi('#kV', vmax.toFixed(1) + ' mm/s', `zone ${vmax < 1.4 ? 'A' : vmax < 2.8 ? 'B' : vmax < 4.5 ? 'C' : 'D'} · ${m.V1.toFixed(1)} / ${m.V2.toFixed(1)}`, vmax > 4.5 ? 'bad' : vmax > 2.8 ? 'warn' : '');
  kpi('#kP', p.Pel.toFixed(1) + ' kW', `${p.amps.toFixed(1)} A · eff ${(p.eta * 100).toFixed(0)}%`, sim.trip.on ? 'bad' : '');
  $('#clock').innerHTML = clockStr(sim.t);
  const mo = sim.money;
  $('#money').innerHTML = `energy <b>${fmt$(mo.energy)}</b> · condensate lost <b class="${mo.lost > 0.5 ? 'red' : ''}">${fmt$(mo.lost)}</b><br/>power now ${fmt$(p.Pel * sim.d.energyCost * 24)}/day`;
  for (const k in FS) {
    const st = FS[k], fx = FX[k];
    if (!st.told && fx.tell(sim, st.base)) { st.told = true; st.tellT = sim.t; toast('tell', `First tell · ${fx.short}`, fx.tellText(sim, st.base)); sim.log(`First tell: ${fx.short}`, 'tell'); }
  }
  const al = sim.getAlarms();
  document.body.classList.toggle('p1', al.some((a) => a.pri === 1));
  const key = al.map((a) => a.text).join('|');
  if (key !== lastAlarmKey) {
    lastAlarmKey = key;
    const el = $('#alarms'); el.innerHTML = '';
    if (!al.length) el.innerHTML = '<div class="ok-pill">All normal · pump in its operating region</div>';
    al.slice(0, 4).forEach((a) => {
      const div = document.createElement('div'); div.className = 'al p' + a.pri;
      div.innerHTML = `<span class="t">${a.tag}</span><span>${a.text}</span>`;
      if (sim.trip.on && a.tag === sim.trip.tag) { const b = document.createElement('button'); b.textContent = 'Reset & restart'; b.onclick = () => { if (!sim.resetTrip()) b.textContent = 'cause not cleared'; }; div.appendChild(b); }
      if (!prevAlarms.has(a.tag + a.text.split(' ')[0])) div.classList.add('new');
      el.appendChild(div);
    });
    const now = new Set(al.map((a) => a.tag + a.text.split(' ')[0]));
    for (const a of al) if (!prevAlarms.has(a.tag + a.text.split(' ')[0]) && a.pri <= 2 && sim.t > 60) toast('alarm', `${a.tag} · ${a.text}`);
    prevAlarms = now;
    if (al.length > 4) { const div = document.createElement('div'); div.className = 'al p3'; div.textContent = `+${al.length - 4} more`; el.appendChild(div); }
  }
  $('#log').innerHTML = sim.events.slice(0, 12).map((e) => `<div><span>${clockStr(e.t, true)}</span> <span class="${e.kind}-k">${e.text}</span></div>`).join('') || '<div>Quiet shift so far.</div>';
  updateLoops(); updateFaults();
}

// ---------------- labels ----------------
const labelEls = new Map();
function updateLabels() {
  if (!groupVis.labels) return;
  const w = window.innerWidth, h = window.innerHeight, v = new THREE.Vector3();
  const camDist = camera.position.distanceTo(controls.target);
  for (const L of plant.labels) {
    let el = labelEls.get(L.id);
    if (!el) { el = document.createElement('div'); el.className = 'lbl ' + L.cls; $('#labels').appendChild(el); labelEls.set(L.id, el); }
    const far = (L.cls !== 'equip' && camDist > 13) || (L.near && camDist > 7);
    v.copy(L.pos).project(camera);
    if (far || v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px'; el.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
    const txt = L.text(sim); if (el._t !== txt) { el.textContent = txt; el._t = txt; }
    el.classList.toggle('alarm', !!(L.alarm && L.alarm(sim)));
  }
}

// ---------------- fault callouts ----------------
const calloutEls = new Map();
function updateCallouts() {
  const w = window.innerWidth, h = window.innerHeight, v = new THREE.Vector3(), live = new Set();
  for (const k in FX) {
    if (!sim.faults[k].active) continue;
    live.add(k);
    let el = calloutEls.get(k);
    if (!el) { el = document.createElement('div'); el.className = 'callout'; $('#callouts').appendChild(el); calloutEls.set(k, el); el.onclick = () => select(FX[k].focus, true); }
    v.copy(FX[k].anchor()).project(camera);
    if (v.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px'; el.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
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
  const mm = new THREE.Vector2(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(mm, camera);
  const hits = ray.intersectObjects(plant.pickables.filter((o) => isShown(o)), false);
  const hit = hits.find((hh) => !isClipped(hh));
  if (!hit) { select(null); return; }
  select(hit.object.userData.pick, true);
});
function isShown(o) { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; }
function isClipped(hh) { const planes = hh.object.material && hh.object.material.clippingPlanes; if (!planes || !planes.length) return false; return planes.every((pl) => pl.distanceToPoint(hh.point) < 0); }
function select(info, focus) {
  selected = info; const card = $('#info');
  if (!info) { card.style.display = 'none'; return; }
  card.style.display = 'block'; if (focus) focusOn(info); renderInfo();
  if (info.kind === 'bearing') setChartTab('spec' + info.i);
  else if (info.kind === 'pump' || info.kind === 'strainer') setChartTab('curve');
}
function focusOn(info) {
  let target, off;
  const T = LAYOUT.TANK;
  if (info.kind === 'tank' || info.kind === 'lt') { target = V3(T.x + 0.3, T.y0 + 1.1, 0); off = V3(4.6, 2.6, 8.4); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'strainer') { target = V3(LAYOUT.STRX + 0.05, PY - 0.05, 0); off = V3(0.9, 0.75, 2.1); }
  else if (info.kind === 'pump') { target = V3(CX, PY, 0); off = V3(-1.15, 0.65, 1.55); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'bearing') { target = V3((LAYOUT.B1X + LAYOUT.B2X) / 2, PY, 0); off = V3(0.25, 0.55, 1.75); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'seal') { target = V3(LAYOUT.SEALX + 0.02, PY - 0.08, 0); off = V3(0.35, 0.45, 1.3); if (!isOpen) animateOpen(1); }
  else if (info.kind === 'coupling') { target = V3(LAYOUT.CPLX + 0.1, PY, 0); off = V3(0.6, 0.6, 1.9); }
  else if (info.kind === 'motor') { target = V3(LAYOUT.MOTX, PY, 0); off = V3(0.9, 0.8, 2.3); }
  else if (info.kind === 'valve') { const vg = plant.valves[info.tag].g; target = vg.position.clone().add(V3(0, 0.15, 0)); off = V3(1.3, 0.8, 2.3); }
  if (target) tweenCam(target.clone().add(off), target, 1.3);
}
function rows(r) { return '<table>' + r.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + '</table>'; }
function renderInfo() {
  if (!selected) return;
  const s = sim, p = s.pump, m = s.meas, card = $('#info'), k = selected.kind, run = p.running && !s.trip.on;
  let html = '<button class="x" onclick="this.parentNode.style.display=\'none\'">×</button>';
  if (k === 'tank' || k === 'lt') {
    html += `<div class="eyebrow">Vented receiver · 2.0 m × 3.0 m · ${s.d.Tliq} °C</div><h1>T-301 condensate receiver</h1>` + rows([
      ['LI-301 reads', m.L.toFixed(0) + '%'], ['Level actually', m.Ltrue.toFixed(0) + '% · ' + s.tank.L.toFixed(2) + ' m'], ['Return in (FI-300)', s.tank.Qin.toFixed(0) + ' m³/h'], ['Pumped out', m.Q.toFixed(0) + ' m³/h'],
      ['Submergence over outlet', (s.tank.L).toFixed(2) + ' m'], ['Vortexing', s.tank.vortex > 0.02 ? (s.tank.vortex * 100).toFixed(0) + '%' : 'no'], ['Overflow', s.tank.overflow > 0.1 ? s.tank.overflow.toFixed(0) + ' m³/h to drain' : 'none']]);
    html += `<p>The receiver sits 2 m above the pump on purpose. That height is most of the NPSH this hot condensate has. ${k === 'lt' ? 'LT-301 is a radar on the top head. LSL-302 is an independent float switch near the bottom that doesn\'t trust LT-301.' : 'Lose level and you lose suction head, then you start pulling a vortex into the pump.'}</p>`;
  } else if (k === 'strainer') {
    html += `<div class="eyebrow">6" Y-strainer · 3 mm perforated basket</div><h1>S-305 suction strainer</h1>` + rows([
      ['PDI-305 ΔP', p.dPstr.toFixed(1) + ' kPa'], ['Basket plugged', (s.faults.strainerPlug.s * 100).toFixed(0) + '%'], ['PI-305 suction', barg(p.Ps).toFixed(2) + ' barg'], ['NPSH available', p.npshA.toFixed(2) + ' m'], ['NPSH required', p.npshR.toFixed(2) + ' m']]);
    html += `<p>Every kPa lost across this basket comes straight off the pump's NPSH margin. With liquid this close to boiling, there isn't much margin to give away.</p>`;
  } else if (k === 'pump') {
    html += `<div class="eyebrow">End-suction · 6-vane closed impeller · ${s.d.rpm} rpm</div><h1>P-301 condensate pump</h1>` + rows([
      ['Flow', m.Q.toFixed(1) + ' m³/h (' + (m.Q * 4.403).toFixed(0) + ' gpm)'], ['Head', p.H.toFixed(1) + ' m'], ['Suction / discharge', `${barg(p.Ps).toFixed(2)} / ${barg(p.Pd).toFixed(2)} barg`], ['% of BEP flow', (p.rImp * 100).toFixed(0) + '%'],
      ['Pump efficiency', (p.eta * 100).toFixed(0) + '%'], ['NPSHa / NPSHr', `${p.npshA.toFixed(1)} / ${p.npshR.toFixed(1)} m`], ['Cavitation', p.ci > 1 ? 'HEAD BREAKING DOWN' : p.ci > 0.05 ? 'starting (noise, pitting)' : 'none'],
      ['Impeller wear', (s.faults.impellerWear.s * 100).toFixed(0) + '%'], ['Casing temp TI-303', p.Tc.toFixed(1) + ' °C']]);
    html += `<p>${p.ci > 1 ? 'The pressure at the impeller eye has dropped to the vapor pressure. Vapor bubbles form at the vane inlets and collapse as pressure rises across the vane. That collapse pits the metal and shakes the pump.' : p.ci > 0.05 ? 'Below about 1.6 × NPSHr, small bubbles already form and collapse at the vane inlets. The curve still looks fine. The impeller does not.' : 'Liquid enters the eye, gets flung outward by the vanes, and the volute turns that speed into pressure.'}</p>`;
  } else if (k === 'bearing') {
    const i = selected.i, v = i === 1 ? s.vib.b1 : s.vib.b2, o = i === 1 ? s.vib.o1 : s.vib.o2, T = i === 1 ? m.T1 : m.T2;
    html += `<div class="eyebrow">${i === 1 ? '6309 ball bearing · impeller end' : '7309 duplex angular contact · coupling end'}</div><h1>${i === 1 ? 'Radial bearing · VI/TI-301' : 'Thrust bearing · VI/TI-302'}</h1>` + rows([
      ['Overall vibration', o.toFixed(2) + ' mm/s RMS'], ['1× running speed', v.x1.toFixed(2)], ['2× running speed', v.x2.toFixed(2)], ['Vane pass 6×', v.vp.toFixed(2)], ['BPFO 3.07×', v.bp.toFixed(2)], ['Broadband', v.bb.toFixed(2)], ['Temperature', T.toFixed(0) + ' °C']]);
    html += `<p>${i === 1 && s.faults.bearingDefect.active ? 'A spall on the outer race. Each ball hits it 3.07 times per shaft turn. That frequency shows up in the spectrum long before the overall number moves. Temperature and noise come last.' : 'Each fault leaves its own fingerprint: unbalance at 1×, misalignment at 2×, bearing defects at non-integer multiples, cavitation as broadband hash.'}</p>`;
  } else if (k === 'seal') {
    html += `<div class="eyebrow">Single cartridge seal · carbon vs SiC</div><h1>Mechanical seal</h1>` + rows([['Leakage', p.leak.toFixed(2) + ' L/h'], ['Face wear', (s.faults.sealWear.s * 100).toFixed(0) + '%'], ['Condensate lost', (s.money.lostM3 * 1000).toFixed(0) + ' L']]);
    html += `<p>The carbon face spins with the shaft against the stationary silicon carbide seat. A healthy seal leaks as vapor you can't see. Drips mean the faces aren't flat anymore.</p>`;
  } else if (k === 'coupling') {
    html += `<div class="eyebrow">Disc-pack spacer coupling</div><h1>Coupling · pump to M-301</h1>` + rows([['Alignment', s.faults.misalignment.active ? '0.5 mm offset + angle' : 'within 0.05 mm'], ['2× at VI-302', s.vib.b2.x2.toFixed(2) + ' mm/s'], ['TI-302 thrust bearing', m.T2.toFixed(0) + ' °C']]);
    html += `<p>Misalignment bends the disc packs back and forth twice every turn. That shows up as a 2× peak, mostly axial, and as heat in the bearing closest to the coupling.</p>`;
  } else if (k === 'motor') {
    html += `<div class="eyebrow">15 kW TEFC · 460 V · ${s.d.rpm} rpm</div><h1>M-301 motor</h1>` + rows([['Power', p.Pel.toFixed(1) + ' kW'], ['Current', p.amps.toFixed(1) + ' A (FLA 27 A)'], ['Shaft power to pump', p.P.toFixed(1) + ' kW'], ['State', run ? 'running' : s.trip.on ? 'TRIPPED' : 'stopped']]);
  } else if (k === 'valve') {
    const c = s.ctl.LIC301;
    html += `<div class="eyebrow">Equal-percentage globe valve · fail closed</div><h1>LV-310 discharge valve</h1>` + rows([['Position', s.valves.LV310.toFixed(0) + '% open'], ['Controller', `${c.tag} ${c.mode}`], ['Level PV / SP', `${c.pv.toFixed(0)} / ${c.sp.toFixed(0)} %`], ['Flow', m.Q.toFixed(1) + ' m³/h']]);
    if (s.faults.valveFail.active) html += '<p><b>Air lost.</b> LIC-301 asks for more flow; the valve is shut and can\'t answer. The pump is deadheaded.</p>';
    else html += '<p>The valve burns the head the pump makes and the system doesn\'t need. The more open it runs, the less margin is left.</p>';
  }
  card.innerHTML = html;
}

// ---------------- loop ----------------
const RECORD = params.has('record');
let last = performance.now(), acc = 0, uiAcc = 0, chartAcc = 0, curNow = 0, vnow = 0;
function frame(now) {
  curNow = now;
  const dt = Math.min(0.06, (now - last) / 1000); last = now;
  if (speed > 0) {
    acc += dt * speed; let steps = Math.floor(acc / 0.5);
    if (steps > 9000) { steps = 9000; acc = 0; }
    if (steps > 0) { sim.advance(steps * 0.5); acc -= steps * 0.5; }
  }
  if (openAnim) { openAnim.t += dt / openAnim.dur; const k = Math.min(1, openAnim.t); plant.setOpen(openAnim.from + (openAnim.to - openAnim.from) * k); if (k >= 1) openAnim = null; }
  if (camTween) {
    camTween.t += dt / camTween.dur; const k = Math.min(1, camTween.t); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(camTween.p0, camTween.p1, e); controls.target.lerpVectors(camTween.t0, camTween.t1, e);
    if (k >= 1) camTween = null;
  }
  plant.update(sim, dt, colorMode, selected);
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
  plant.setHighlights(hl); plant.updateBeacons(bc, camera, dt);
  controls.update(); renderer.render(scene, camera);
  updateLabels(); updateCallouts(); expireToasts();
  uiAcc += dt; chartAcc += dt;
  if (uiAcc > 0.15) { uiAcc = 0; updatePanels(); renderInfo(); }
  if (chartAcc > 0.25) { chartAcc = 0; drawTrend(); drawChart(); }
  if (!RECORD) requestAnimationFrame(frame);
}

if (params.has('clean')) document.body.classList.add('clean');
applyVis(); resize(); setView(VIEWS.home, true); updatePanels();
if (params.has('open')) { plant.setOpen(1); isOpen = true; $('#openBtn').textContent = 'Close the pump'; setView(VIEWS.open, true); }
if (!RECORD) requestAnimationFrame(frame);

window.APP = { THREE, get sim() { return sim; }, plant, camera, controls, setView, tweenCam, animateOpen, select, VIEWS, toggleFault, FX, FS, resize, setChartTab,
  tick: (dt) => { vnow += dt * 1000; last = vnow - dt * 1000; frame(vnow); },
  get isOpen() { return isOpen; }, setSpeed: (s) => { speed = s; buildSpeeds(); }, setColor: (m) => document.querySelector(`#colorMode [data-m="${m}"]`).click(), setTrend: (t) => document.querySelector(`#trendTabs [data-t="${t}"]`).click() };
