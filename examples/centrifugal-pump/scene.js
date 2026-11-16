// 3D model of the P-301 condensate pump skid. Pure geometry + per-frame updates from the simulator state.
import * as THREE from 'three';

// ---------------- layout (meters) ----------------
export const PY = 0.85;        // shaft centerline
export const CX = -1.30;       // impeller center plane
const R_IMP = 0.16, R_EYE = 0.06;
const TANK = { x: -5.0, z: 0, r: 1.0, y0: PY + 2.0, H: 3.0 };
export const LAYOUT = { PY, CX, TANK, B1X: -0.80, B2X: -0.25, SEALX: -1.08, CPLX: 0.09, STRX: -3.0, MOTX: 0.85 };

// ---------------- palette ----------------
const C = {
  equip: 0xd8ccb0, pumpBlue: 0x3f6f9a, motor: 0x4f6a80, steel: 0x8d939a, struct: 0x6f7780, rail: 0xf0c419,
  concrete: 0xd7d8d6, pipe: 0xd2c6aa, hot: 0xc9b896, bronze: 0xc0874a, race: 0xb9c0c6, ball: 0xe4e8ec,
  carbon: 0x26292c, sic: 0xa9b0b6, copper: 0xb8743a, lam: 0x55595e, guard: 0xf2a33a, actuator: 0x3b4650, accent: 0xe8573a,
};
function mat(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.15 }, o)); }
function cyl(r, h, color, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r2 != null ? o.r2 : r, r, h, o.seg || 40, 1, !!o.open), o.material || mat(color, o.m));
  m.castShadow = true; m.receiveShadow = true; return m;
}
// cylinder along x
function xcyl(r, x0, x1, color, o = {}) { const m = cyl(r, x1 - x0, color, o); m.rotation.z = Math.PI / 2; m.position.set((x0 + x1) / 2, o.y != null ? o.y : PY, o.z || 0); return m; }
function box(w, h, d, color, o = {}) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material || mat(color, o.m)); m.castShadow = true; m.receiveShadow = true; return m; }
function rod(a, b, r, material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), material);
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
  m.position.copy(a).addScaledVector(dir, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); m.scale.y = len;
  m.castShadow = true; return m;
}
// ring (washer) around the x axis: inner/outer radius, width along x
function ringX(rIn, rOut, w, material) {
  const pts = [new THREE.Vector2(rIn, -w / 2), new THREE.Vector2(rOut, -w / 2), new THREE.Vector2(rOut, w / 2), new THREE.Vector2(rIn, w / 2), new THREE.Vector2(rIn, -w / 2)];
  const g = new THREE.LatheGeometry(pts, 48); g.rotateZ(-Math.PI / 2);
  const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m;
}

function makeDashTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.72, 'rgba(255,255,255,0)'); grd.addColorStop(0.86, 'rgba(255,255,255,1)'); grd.addColorStop(0.9, 'rgba(255,255,255,1)'); grd.addColorStop(0.93, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; return t;
}
function makeStreakTexture(vertical) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = 'rgb(222,228,229)'; g.fillRect(0, 0, 256, 256);
  let seed = vertical ? 7 : 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.lineCap = 'round';
  for (let k = 0; k < 75; k++) {
    const a = rnd() * 256, b = rnd() * 256, len = 25 + rnd() * 90, w = 1.5 + rnd() * 4.5;
    g.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.55})`; g.lineWidth = w;
    for (const o of [-256, 0, 256]) { g.beginPath(); if (vertical) { g.moveTo(a, b + o); g.lineTo(a, b + o + len); } else { g.moveTo(a + o, b); g.lineTo(a + o + len, b); } g.stroke(); }
  }
  for (let k = 0; k < 110; k++) { const x = rnd() * 256, y = rnd() * 256, r = 1.5 + rnd() * 4; g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
// rotor bar texture so rotation reads on screen
function makeStripeTexture(a, b, n) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 16; const g = c.getContext('2d');
  for (let k = 0; k < n; k++) { g.fillStyle = k % 2 ? a : b; g.fillRect(k * 256 / n, 0, 256 / n, 16); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DASH = typeof document !== 'undefined' ? makeDashTexture() : null;
const STREAK_H = typeof document !== 'undefined' ? makeStreakTexture(false) : null;
const STREAK_V = typeof document !== 'undefined' ? makeStreakTexture(true) : null;

// ▲ / ▼ when a historian tag moved more than `th` in the last 30 sim-minutes
function trend(s, key, th) {
  const H = s.history; if (!H || H.length < 6) return '';
  const a = H[Math.max(0, H.length - 31)][key], b = H[H.length - 1][key];
  return b - a > th ? ' ▲' : a - b > th ? ' ▼' : '';
}
const barg = (p) => (p - 101.3) / 100;
const zoneHex = (v) => (v < 1.4 ? 0x2e9d62 : v < 2.8 ? 0xa4c23a : v < 4.5 ? 0xf2a33a : 0xd93333);

// horizontal liquid level in a cylinder whose axis is x: circle of radius r filled to height h (from bottom)
function levelShape(r, h) {
  h = Math.max(0.005, Math.min(2 * r - 0.005, h));
  const s = new THREE.Shape(); const yl = -r + h; const a = Math.asin(yl / r);
  s.moveTo(-Math.sqrt(r * r - yl * yl), yl); s.absarc(0, 0, r, Math.PI - a, 2 * Math.PI + a, false); s.lineTo(-Math.sqrt(r * r - yl * yl), yl);
  return s;
}

// ---------------- the skid ----------------
export class Plant {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim;
    this.root = new THREE.Group(); scene.add(this.root);
    this.groups = {};
    for (const k of ['tank', 'casing', 'frame', 'motor', 'guard', 'internals', 'flow', 'piping', 'valves', 'structure'])
      this.groups[k] = new THREE.Group(), this.groups[k].name = k, this.root.add(this.groups[k]);
    this.pickables = []; this.pipes = []; this.valves = {}; this.labels = []; this.targets = {};
    this.openT = 0; this._clock = 0; this.rot = 0; this.omega = 0;
    // clipping: pump wedge (z>0 and y>Y), suction cover (y>Y), tank wedge (z>0, x>TANK.x, y>Y)
    this.clipPump = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 40)];
    this.clipCover = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 40)];
    this.clipTank = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), TANK.x), new THREE.Plane(new THREE.Vector3(0, -1, 0), 40)];
    this.cut = (planes, o = {}) => Object.assign({ clippingPlanes: planes, clipIntersection: true, clipShadows: true, side: THREE.DoubleSide }, o);

    this.buildGround();
    this.buildTank();
    this.buildStrainer();
    this.buildCasing();
    this.buildRotor();
    this.buildFrame();
    this.buildCoupling();
    this.buildMotor();
    this.buildPiping();
    this.buildParticles();
    this.setOpen(0);
  }

  pick(mesh, info) { mesh.userData.pick = info; this.pickables.push(mesh); return mesh; }
  reg(key, ...meshes) { (this.targets[key] = this.targets[key] || []).push(...meshes); }
  regGroup(key, obj) { obj.traverse((o) => { if (o.isMesh && o.material && !o.material.transparent && o.material.emissive) this.reg(key, o); }); }
  pickGroup(obj, info) { obj.traverse((o) => { if (o.isMesh) this.pick(o, info); }); }

  // ---------- ground, plinth, baseplate ----------
  buildGround() {
    const g = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat(0xe6e7e4, { roughness: 0.95, metalness: 0 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; this.root.add(g);
    const grid = new THREE.GridHelper(40, 40, 0xcfd1ce, 0xdcdedb); grid.position.y = 0.002; this.root.add(grid);
    const pad = box(14, 0.12, 6, C.concrete, { m: { roughness: 0.9, metalness: 0 } }); pad.position.set(-2.0, 0.06, 0.2); pad.castShadow = false; this.root.add(pad);
    const plinth = box(3.9, 0.3, 1.25, 0xcfd0cd, { m: { roughness: 0.9, metalness: 0 } }); plinth.position.set(-0.05, 0.15 + 0.12, 0); this.root.add(plinth);
    const st = this.groups.structure;
    const bp = box(3.5, 0.1, 0.8, C.struct, { m: { roughness: 0.5, metalness: 0.4 } }); bp.position.set(-0.05, 0.47, 0); st.add(bp);
    // drip rim around the baseplate
    for (const [w, d, x, z] of [[3.5, 0.03, -0.05, 0.385], [3.5, 0.03, -0.05, -0.385], [0.03, 0.8, -1.785, 0], [0.03, 0.8, 1.685, 0]]) { const r = box(w, 0.06, d, C.struct); r.position.set(x, 0.55, z); st.add(r); }
    this.baseY = 0.52;
    // seal-leak puddle on the baseplate under the gland
    this.puddleMat = new THREE.MeshStandardMaterial({ color: 0x5aa7b8, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, depthWrite: false });
    this.puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.puddleMat);
    this.puddle.rotation.x = -Math.PI / 2; this.puddle.position.set(-0.98, this.baseY + 0.004, 0.05); this.puddle.scale.setScalar(0.001); this.puddle.renderOrder = 2;
    st.add(this.puddle);
  }

  // ---------- T-301 condensate receiver ----------
  buildTank() {
    const g = this.groups.tank, T = TANK;
    const shellMat = mat(C.equip, this.cut(this.clipTank, { roughness: 0.55 }));
    const shell = cyl(T.r, T.H, 0, { material: shellMat, open: true, seg: 64 }); shell.position.set(T.x, T.y0 + T.H / 2, T.z);
    g.add(this.pick(shell, { kind: 'tank' }));
    const headGeo = new THREE.SphereGeometry(T.r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const top = new THREE.Mesh(headGeo, shellMat); top.scale.y = 0.25; top.position.set(T.x, T.y0 + T.H, T.z); top.castShadow = true;
    const bot = new THREE.Mesh(headGeo, shellMat); bot.scale.y = -0.25; bot.position.set(T.x, T.y0, T.z);
    g.add(this.pick(top, { kind: 'tank' }), this.pick(bot, { kind: 'tank' }));
    this.reg('tank', shell, top);
    // legs + bracing
    const steel = mat(C.struct, { roughness: 0.55, metalness: 0.35 });
    const legs = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, x = T.x + Math.cos(a) * 0.86, z = T.z + Math.sin(a) * 0.86;
      g.add(rod(new THREE.Vector3(x, 0.12, z), new THREE.Vector3(x, T.y0 + 0.25, z), 0.06, steel)); legs.push([x, z]);
      const fp = box(0.3, 0.04, 0.3, C.steel); fp.position.set(x, 0.14, z); g.add(fp);
    }
    for (let k = 0; k < 4; k++) { const [ax, az] = legs[k], [bx, bz] = legs[(k + 1) % 4]; g.add(rod(new THREE.Vector3(ax, 0.4, az), new THREE.Vector3(bx, T.y0 - 0.3, bz), 0.025, steel)); }
    // liquid
    this.tankLiqMat = new THREE.MeshStandardMaterial({ color: 0x2f8f9d, transparent: true, opacity: 0.7, roughness: 0.15, depthWrite: false });
    this.tankLiq = new THREE.Mesh(new THREE.CylinderGeometry(T.r - 0.02, T.r - 0.02, 1, 48), this.tankLiqMat); this.tankLiq.renderOrder = 2;
    g.add(this.pick(this.tankLiq, { kind: 'tank' }));
    const lb = new THREE.Mesh(new THREE.SphereGeometry(T.r - 0.02, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.tankLiqMat);
    lb.scale.y = 0.25; lb.position.set(T.x, T.y0, T.z); lb.renderOrder = 2; g.add(lb); this.tankLiqBot = lb;
    const smap = STREAK_H.clone(); smap.needsUpdate = true; smap.repeat.set(2.4, 2.4); smap.center.set(0.5, 0.5); this.smap = smap;
    this.tankTopMat = new THREE.MeshStandardMaterial({ color: 0x2f8f9d, map: smap, transparent: true, opacity: 0.9, roughness: 0.2, depthWrite: false });
    this.tankTop = new THREE.Mesh(new THREE.CircleGeometry(T.r - 0.025, 48), this.tankTopMat); this.tankTop.rotation.x = -Math.PI / 2; this.tankTop.renderOrder = 3; g.add(this.tankTop);
    // vortex funnel over the outlet
    const vmap = STREAK_V.clone(); vmap.needsUpdate = true; vmap.repeat.set(3, 1); this.vmap = vmap;
    this.vortexMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: vmap, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.vortex = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 32, 1, true), this.vortexMat); this.vortex.renderOrder = 4; this.vortex.rotation.x = Math.PI; g.add(this.vortex);
    // condensate falling in from the inlet nozzle
    const imap = STREAK_V.clone(); imap.needsUpdate = true; imap.repeat.set(1, 1.2); this.imap = imap;
    this.inMat = new THREE.MeshBasicMaterial({ color: 0x8fd0d8, map: imap, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    this.inStream = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1, 16, 1, true), this.inMat); this.inStream.renderOrder = 4; g.add(this.inStream);
    // LT-301 radar on the top head, LSL-302 float chamber on the side, level glass
    const lt = new THREE.Group();
    const stub = cyl(0.06, 0.25, C.equip); stub.position.y = 0.12; lt.add(stub);
    const head = box(0.2, 0.18, 0.16, 0x2f6fb0, { m: { metalness: 0.3, roughness: 0.5 } }); head.position.y = 0.34; lt.add(head);
    const cone = cyl(0.03, 0.06, 0x5f6870, { r2: 0.07 }); cone.position.y = 0.07; lt.add(cone);
    lt.position.set(T.x + 0.45, T.y0 + T.H + 0.18, T.z - 0.35); g.add(lt);
    this.pickGroup(lt, { kind: 'lt' }); this.regGroup('lt', lt); this.ltPos = lt.position.clone().add(new THREE.Vector3(0, 0.35, 0));
    const lsl = xcyl(0.06, T.x - T.r - 0.38, T.x - T.r + 0.02, C.equip, { y: T.y0 + 0.45, z: T.z }); g.add(lsl);
    const lslH = box(0.12, 0.14, 0.12, 0xd93333); lslH.position.set(T.x - T.r - 0.42, T.y0 + 0.45, T.z); g.add(lslH);
    this.lslPos = new THREE.Vector3(T.x - T.r - 0.42, T.y0 + 0.62, T.z);
    // vent with gooseneck
    const vm = mat(C.pipe);
    g.add(rod(new THREE.Vector3(T.x - 0.2, T.y0 + T.H + 0.2, T.z + 0.2), new THREE.Vector3(T.x - 0.2, T.y0 + T.H + 1.0, T.z + 0.2), 0.05, vm));
    const gn = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 10, 20, Math.PI), vm); gn.position.set(T.x - 0.32, T.y0 + T.H + 1.0, T.z + 0.2); g.add(gn);
    this.labels.push({ id: 't301', pos: new THREE.Vector3(T.x, T.y0 + T.H + 1.25, T.z), cls: 'equip', text: (s) => `T-301 condensate receiver · ${s.d.Tliq} °C` });
  }

  // ---------- S-305 Y-strainer ----------
  buildStrainer() {
    const g = this.groups.casing, x = LAYOUT.STRX;
    const bodyMat = mat(C.steel, this.cut(this.clipPump, { metalness: 0.5, roughness: 0.4 }));
    const body = xcyl(0.115, x - 0.3, x + 0.3, 0, { material: bodyMat }); g.add(this.pick(body, { kind: 'strainer' }));
    const a = new THREE.Vector3(x - 0.08, PY, 0), b = new THREE.Vector3(x + 0.28, PY - 0.36, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 1, 32, 1, true), bodyMat);
    leg.position.copy(a).lerp(b, 0.5); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); leg.scale.y = a.distanceTo(b); leg.castShadow = true;
    g.add(this.pick(leg, { kind: 'strainer' }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 24), mat(C.steel, { metalness: 0.5 })); cap.position.copy(b); cap.quaternion.copy(leg.quaternion); g.add(this.pick(cap, { kind: 'strainer' }));
    for (const s of [-1, 1]) { const f = ringX(0.08, 0.15, 0.04, mat(C.steel, { metalness: 0.5 })); f.position.set(x + s * 0.3, PY, 0); g.add(f); }
    // screen basket (perforated texture that clogs)
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const cg = cv.getContext('2d');
    cg.fillStyle = '#dfe3e6'; cg.fillRect(0, 0, 64, 64); cg.fillStyle = '#3a4046';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { cg.beginPath(); cg.arc(4 + i * 8, 4 + j * 8, 2.4, 0, 6.28); cg.fill(); }
    const st = new THREE.CanvasTexture(cv); st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(6, 4); st.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = mat(0xffffff, { map: st, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
    const scr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 24, 1, true), this.screenMat);
    scr.position.copy(leg.position); scr.quaternion.copy(leg.quaternion); scr.scale.y = a.distanceTo(b) * 0.95; g.add(this.pick(scr, { kind: 'strainer' }));
    // debris clumps that grow with fouling
    this.debris = [];
    const dm = mat(0x5b3b22, { roughness: 0.95, metalness: 0 });
    for (let k = 0; k < 14; k++) {
      const u = 0.15 + 0.8 * (k / 14), p = a.clone().lerp(b, u), ang = k * 2.4;
      const d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), dm);
      d.position.set(p.x + Math.cos(ang) * 0.05, p.y + Math.sin(ang) * 0.03, Math.sin(ang * 1.7) * 0.05); d.userData.u = u; g.add(d); this.debris.push(d);
    }
    this.reg('strainer', body, cap);
    this.strainerPos = new THREE.Vector3(x, PY + 0.05, 0.1);
    // PDI-305 across the strainer
    const tm = mat(0x9aa2aa, { metalness: 0.6 });
    for (const dx of [-0.42, 0.42]) g.add(rod(new THREE.Vector3(x + dx, PY + 0.08, 0), new THREE.Vector3(x + dx, PY + 0.42, 0), 0.012, tm));
    g.add(rod(new THREE.Vector3(x - 0.42, PY + 0.42, 0), new THREE.Vector3(x + 0.42, PY + 0.42, 0), 0.012, tm));
    const pdi = box(0.18, 0.16, 0.12, 0x2f6fb0, { m: { metalness: 0.3, roughness: 0.5 } }); pdi.position.set(x, PY + 0.5, 0); g.add(this.pick(pdi, { kind: 'strainer' }));
    this.reg('strainer', pdi);
  }

  // ---------- volute casing, suction cover, back cover, seal chamber ----------
  buildCasing() {
    const g = this.groups.casing;
    const casMat = mat(C.pumpBlue, this.cut(this.clipPump, { roughness: 0.5, metalness: 0.25 }));
    this.casMat = casMat;
    const W = 0.22, x0 = CX - W / 2;
    // volute: spiral outer wall, cavity grows from 0.19 at the cutwater to 0.27 at the throat
    const spiral = (r0, r1, t) => { const sh = []; const N = 72; for (let k = 0; k <= N; k++) { const th = k / N * Math.PI * 2; const r = r0 + (r1 - r0) * (k / N); sh.push([Math.cos(th + Math.PI / 2) * r, Math.sin(th + Math.PI / 2) * r]); } return sh; };
    const outerPts = spiral(0.22, 0.30), innerPts = spiral(0.185, 0.265);
    const shp = new THREE.Shape(outerPts.map(([u, v]) => new THREE.Vector2(u, v)));
    shp.holes.push(new THREE.Path(innerPts.slice().reverse().map(([u, v]) => new THREE.Vector2(u, v))));
    const vg = new THREE.ExtrudeGeometry(shp, { depth: W, bevelEnabled: false, curveSegments: 72 });
    vg.rotateY(Math.PI / 2); // local z -> world x, local x -> world -z
    const volute = new THREE.Mesh(vg, casMat); volute.position.set(x0, PY, 0); volute.castShadow = true; volute.receiveShadow = true;
    g.add(this.pick(volute, { kind: 'pump' }));
    // back cover (motor side of the impeller)
    const back = ringX(0.05, 0.30, 0.04, casMat); back.position.set(CX + W / 2 + 0.02, PY, 0); g.add(this.pick(back, { kind: 'pump' }));
    // suction cover with the eye opening + nozzle; removed entirely when opened
    const covMat = mat(C.pumpBlue, this.cut(this.clipCover, { roughness: 0.5, metalness: 0.25 }));
    this.covMat = covMat;
    const cover = ringX(R_EYE + 0.03, 0.30, 0.04, covMat); cover.position.set(x0 - 0.02, PY, 0); g.add(this.pick(cover, { kind: 'pump' }));
    const nozzle = xcyl(0.1, x0 - 0.26, x0 - 0.02, 0, { material: covMat, open: true }); g.add(this.pick(nozzle, { kind: 'pump' }));
    const nfl = ringX(0.085, 0.16, 0.04, mat(C.pumpBlue, { roughness: 0.5 })); nfl.position.set(x0 - 0.27, PY, 0); g.add(nfl);
    // discharge nozzle on top
    const dn = cyl(0.08, 0.26, 0, { material: casMat, open: true }); dn.position.set(CX, PY + 0.4, 0); g.add(this.pick(dn, { kind: 'pump' }));
    const dfl = cyl(0.15, 0.04, C.pumpBlue); dfl.position.set(CX, PY + 0.53, 0); g.add(dfl);
    // casing foot
    const ft = box(0.2, PY - 0.3 - this.baseY + 0.02, 0.5, C.pumpBlue); ft.position.set(CX, (this.baseY + PY - 0.28) / 2, 0); g.add(ft);
    // seal chamber + gland
    const sc = xcyl(0.12, CX + W / 2 + 0.04, LAYOUT.SEALX + 0.08, 0, { material: casMat, open: true }); g.add(this.pick(sc, { kind: 'seal' }));
    const glandMat = mat(0x9aa2aa, this.cut(this.clipPump, { metalness: 0.55, roughness: 0.4 }));
    const gland = ringX(0.04, 0.14, 0.04, glandMat); gland.position.set(LAYOUT.SEALX + 0.1, PY, 0); g.add(this.pick(gland, { kind: 'seal' }));
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; const bt = xcyl(0.012, LAYOUT.SEALX + 0.06, LAYOUT.SEALX + 0.15, 0x6b7078, { y: PY + Math.sin(a) * 0.11, z: Math.cos(a) * 0.11 }); g.add(bt); }
    this.glandPos = new THREE.Vector3(LAYOUT.SEALX + 0.1, PY - 0.13, 0.04);
    // seal stationary seat (SiC) and spring
    const seat = ringX(0.036, 0.068, 0.018, mat(C.sic, { metalness: 0.2, roughness: 0.3 })); seat.position.set(LAYOUT.SEALX + 0.035, PY, 0); g.add(this.pick(seat, { kind: 'seal' }));
    this.reg('seal', sc, gland, seat);
    this.reg('casing', volute, back, cover, dn);
    // casing drain plug + TI-303 on the casing
    const ti = box(0.1, 0.1, 0.08, 0x2f6fb0, { m: { metalness: 0.3 } }); ti.position.set(CX + 0.05, PY + 0.2, -0.27); g.add(ti);
  }

  // ---------- rotating assembly: impeller, shaft, seal face, rotor, coupling hubs ----------
  buildRotor() {
    const rg = new THREE.Group(); rg.position.set(0, PY, 0); this.groups.internals.add(rg); this.rotGroup = rg;
    // impeller
    const imp = new THREE.Group(); imp.position.x = CX; rg.add(imp); this.impeller = imp;
    this.impMat = mat(C.bronze, { roughness: 0.35, metalness: 0.7 });
    const backShroud = ringX(0.03, R_IMP, 0.012, this.impMat); backShroud.position.x = 0.035; imp.add(backShroud);
    const hub = xcyl(0.045, -0.04, 0.04, 0, { material: this.impMat, y: 0 }); imp.add(hub);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.impMat); nose.rotation.z = Math.PI / 2; nose.position.x = -0.04; imp.add(nose);
    // 6 backward-curved vanes
    for (let k = 0; k < 6; k++) {
      const sh = new THREE.Shape(); const N = 14, th0 = k * Math.PI / 3, wrap = 1.25, t = 0.011;
      const P = (r, off) => { const th = th0 - wrap * Math.log(r / R_EYE) / Math.log(R_IMP / R_EYE) + off / r; return [Math.cos(th) * r, Math.sin(th) * r]; };
      const side1 = [], side2 = [];
      for (let i = 0; i <= N; i++) { const r = R_EYE * 0.75 + (R_IMP - R_EYE * 0.75) * i / N; side1.push(P(r, t / 2)); side2.push(P(r, -t / 2)); }
      sh.moveTo(...side1[0]); for (const p of side1) sh.lineTo(...p); for (const p of side2.reverse()) sh.lineTo(...p);
      const vg = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false }); vg.rotateY(Math.PI / 2); vg.translate(-0.03, 0, 0);
      const v = new THREE.Mesh(vg, this.impMat); v.castShadow = true; imp.add(v);
    }
    // front shroud (suction side): translucent so the vanes read, removed when opened
    this.frontShroudMat = mat(C.bronze, this.cut(this.clipCover, { roughness: 0.35, metalness: 0.7, transparent: true, opacity: 0.55, depthWrite: false }));
    const fs = ringX(R_EYE, R_IMP, 0.01, this.frontShroudMat); fs.position.x = -0.035; imp.add(fs);
    // wear ring (stationary, front)
    imp.traverse((o) => { if (o.isMesh) this.pick(o, { kind: 'pump' }); });
    this.reg('impeller', backShroud, hub);
    // shaft (one piece through the coupling, reads as pump shaft + motor shaft)
    const shaftMat = mat(0xb9c0c6, { metalness: 0.8, roughness: 0.25 });
    const shaft = xcyl(0.028, CX + 0.04, 1.48, 0, { material: shaftMat, y: 0 }); rg.add(shaft);
    const stripe = box(0.9, 0.006, 0.012, 0x1d2328); stripe.position.set(-0.5, 0.029, 0); rg.add(stripe);
    const key = box(0.08, 0.012, 0.014, 0x8a9096); key.position.set(-0.05, 0.03, 0); rg.add(key);
    // sleeve + rotating seal face (carbon) + spring
    const sleeve = xcyl(0.034, CX + 0.12, LAYOUT.SEALX + 0.12, 0, { material: mat(0xc9ced3, { metalness: 0.8, roughness: 0.2 }), y: 0 }); rg.add(sleeve);
    const face = ringX(0.036, 0.062, 0.02, mat(C.carbon, { roughness: 0.4 })); face.position.x = LAYOUT.SEALX + 0.015; rg.add(this.pick(face, { kind: 'seal' }));
    const pts = []; for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 12; pts.push(new THREE.Vector3(LAYOUT.SEALX - 0.07 + 0.075 * i / 120, Math.cos(a) * 0.05, Math.sin(a) * 0.05)); }
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.005, 6, false), mat(0x9aa2aa, { metalness: 0.8 })); rg.add(spring);
    this.reg('seal', face);
    // bearing inner races
    for (const [x, w] of [[LAYOUT.B1X, 0.03], [LAYOUT.B2X - 0.02, 0.026], [LAYOUT.B2X + 0.02, 0.026]]) { const ir = ringX(0.03, 0.044, w, mat(C.race, { metalness: 0.85, roughness: 0.2 })); ir.position.x = x; rg.add(ir); }
    // coupling hubs (rotate)
    const hubMat = mat(0x8d939a, { metalness: 0.7, roughness: 0.3 });
    const h1 = xcyl(0.07, -0.14, -0.06, 0, { material: hubMat, y: 0 }); const h2 = xcyl(0.07, 0.24, 0.32, 0, { material: hubMat, y: 0 });
    const spacer = xcyl(0.045, -0.05, 0.23, 0, { material: hubMat, y: 0 });
    const d1 = xcyl(0.085, -0.065, -0.05, 0, { material: mat(0x3b4650), y: 0 }), d2 = xcyl(0.085, 0.225, 0.24, 0, { material: mat(0x3b4650), y: 0 });
    const cpl = new THREE.Group(); cpl.add(h1, spacer, d1, d2); rg.add(cpl);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; const bt = xcyl(0.008, -0.075, -0.04, 0x1d2328, { y: Math.sin(a) * 0.065, z: Math.cos(a) * 0.065 }); cpl.add(bt); }
    this.motorHub = h2; rg.add(h2);
    this.pickGroup(cpl, { kind: 'coupling' }); this.pick(h2, { kind: 'coupling' });
    this.reg('coupling', h1, h2, spacer);
    // motor rotor with bars so rotation reads
    const rmap = makeStripeTexture('#5b4632', '#8c6d4c', 24); rmap.repeat.set(1, 1);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.66, 40), mat(0xffffff, { map: rmap, metalness: 0.5, roughness: 0.4 }));
    rotor.rotation.z = Math.PI / 2; rotor.position.x = LAYOUT.MOTX; rotor.castShadow = true; this.rotor = rotor;
    this.motorRot = new THREE.Group(); this.motorRot.add(rotor); rg.add(this.motorRot);
    this.pick(rotor, { kind: 'motor' });
  }

  // ---------- bearing frame: housing, two bearings, oil ----------
  buildFrame() {
    const g = this.groups.frame;
    const fMat = mat(C.pumpBlue, this.cut(this.clipPump, { roughness: 0.5, metalness: 0.25 })); this.frameMat = fMat;
    const housing = xcyl(0.15, LAYOUT.B1X - 0.08, LAYOUT.B2X + 0.1, 0, { material: fMat, open: true }); g.add(this.pick(housing, { kind: 'bearing', i: 1 }));
    for (const x of [LAYOUT.B1X - 0.09, LAYOUT.B2X + 0.11]) { const e = ringX(0.033, 0.155, 0.03, fMat); e.position.set(x, PY, 0); g.add(e); }
    // lantern/adapter between seal chamber and frame (window to see the gland)
    for (const z of [-1, 1]) for (const y of [-1, 1]) { const rib = box(0.18, 0.03, 0.03, C.pumpBlue, { material: fMat }); rib.position.set(LAYOUT.SEALX + 0.22, PY + y * 0.11, z * 0.11); g.add(rib); }
    const foot = box(0.32, PY - 0.15 - this.baseY, 0.42, C.pumpBlue); foot.position.set((LAYOUT.B1X + LAYOUT.B2X) / 2, (this.baseY + PY - 0.15) / 2, 0); g.add(foot);
    this.regGroup('frame', g);
    // bearings: outer races (stationary), balls + cage (orbit at cage speed)
    this.bearings = [];
    const raceMat = () => mat(C.race, { metalness: 0.85, roughness: 0.22 });
    const mk = (x, w, idx) => {
      const or = ringX(0.07, 0.085, w, raceMat()); or.position.set(x, PY, 0); g.add(this.pick(or, { kind: 'bearing', i: idx }));
      const cage = new THREE.Group(); cage.position.set(x, PY, 0); g.add(cage);
      const nb = 10, bm = mat(C.ball, { metalness: 0.9, roughness: 0.12 });
      for (let k = 0; k < nb; k++) { const a = k * Math.PI * 2 / nb; const b = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 14, 10), bm); b.position.set(0, Math.cos(a) * 0.057, Math.sin(a) * 0.057); b.castShadow = true; cage.add(b); this.pick(b, { kind: 'bearing', i: idx }); }
      const cg = ringX(0.05, 0.064, w * 0.35, mat(0xb8862e, { metalness: 0.6, roughness: 0.35 })); cage.add(cg);
      return { or, cage, x };
    };
    this.bearings.push({ rows: [mk(LAYOUT.B1X, 0.03, 1)], idx: 1 });
    this.bearings.push({ rows: [mk(LAYOUT.B2X - 0.02, 0.026, 2), mk(LAYOUT.B2X + 0.02, 0.026, 2)], idx: 2 });
    this.reg('bearing1', this.bearings[0].rows[0].or); this.reg('bearing2', ...this.bearings[1].rows.map((r) => r.or));
    // spall on the radial bearing outer race (load zone, bottom)
    this.spallMat = mat(0x3a1e12, { roughness: 0.9, emissive: 0x000000 });
    this.spall = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.03), this.spallMat); this.spall.position.set(LAYOUT.B1X, PY - 0.0705, 0.0); this.spall.scale.setScalar(0.001); g.add(this.spall);
    // oil bath
    this.oilMat = new THREE.MeshStandardMaterial({ color: 0xc9902a, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false, clippingPlanes: this.clipPump, clipIntersection: true });
    const oil = new THREE.Mesh(new THREE.ExtrudeGeometry(levelShape(0.145, 0.07), { depth: LAYOUT.B2X - LAYOUT.B1X + 0.16, bevelEnabled: false, curveSegments: 24 }), this.oilMat);
    oil.geometry.rotateY(Math.PI / 2); oil.position.set(LAYOUT.B1X - 0.07, PY, 0); oil.renderOrder = 2; g.add(oil);
    // constant-level oiler
    const oiler = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8c070, transparent: true, opacity: 0.6, roughness: 0.05 }));
    oiler.position.set((LAYOUT.B1X + LAYOUT.B2X) / 2, PY - 0.02, -0.21); g.add(oiler);
    g.add(rod(new THREE.Vector3((LAYOUT.B1X + LAYOUT.B2X) / 2, PY - 0.07, -0.15), new THREE.Vector3((LAYOUT.B1X + LAYOUT.B2X) / 2, PY - 0.07, -0.21), 0.012, mat(0x9aa2aa)));
    // vibration + temperature transmitters on top of each bearing
    for (const [x, idx] of [[LAYOUT.B1X, 1], [LAYOUT.B2X, 2]]) {
      const sens = cyl(0.025, 0.07, 0x2f6fb0, { m: { metalness: 0.4 } }); sens.position.set(x, PY + 0.185, 0); g.add(this.pick(sens, { kind: 'bearing', i: idx }));
      g.add(rod(new THREE.Vector3(x, PY + 0.22, 0), new THREE.Vector3(x, PY + 0.32, -0.12), 0.006, mat(0x1d2328)));
    }
    this.labels.push({ id: 'p301', pos: new THREE.Vector3(CX - 0.1, PY + 0.95, 0.2), cls: 'equip', text: (s) => `P-301 · ${s.pump.running && !s.trip.on ? s.pump.H.toFixed(0) + ' m head' : 'STOPPED'}` });
  }

  // ---------- coupling guard ----------
  buildCoupling() {
    const gm = mat(C.guard, this.cut(this.clipPump, { roughness: 0.55, metalness: 0.2 }));
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.54, 32, 1, true, 0, Math.PI), gm);
    guard.rotation.z = Math.PI / 2; guard.position.set(LAYOUT.CPLX, PY, 0); guard.castShadow = true;
    // guard: upper half shell
    guard.rotation.x = 0; this.groups.guard.add(guard);
    const lw = box(0.54, PY - 0.16 - this.baseY, 0.02, C.guard, { material: gm }); lw.position.set(LAYOUT.CPLX, (PY + this.baseY) / 2 - 0.08, 0.16); this.groups.guard.add(lw);
    const lw2 = lw.clone(); lw2.position.z = -0.16; this.groups.guard.add(lw2);
    this.pickGroup(this.groups.guard, { kind: 'coupling' });
  }

  // ---------- M-301 motor ----------
  buildMotor() {
    const g = new THREE.Group(); this.groups.motor.add(g); this.motorG = g;
    const mm = mat(C.motor, this.cut(this.clipPump, { roughness: 0.45, metalness: 0.35 })); this.motorMat = mm;
    const x0 = 0.42, x1 = 1.30;
    const body = xcyl(0.235, x0, x1, 0, { material: mm, open: true }); g.add(body);
    for (const x of [x0, x1]) { const e = ringX(0.03, 0.24, 0.05, mm); e.position.set(x, PY, 0); g.add(e); }
    for (let k = 0; k < 22; k++) {
      const a = k / 22 * Math.PI * 2; if (Math.abs(Math.sin(a) + 1) < 0.25) continue;
      const fin = box(x1 - x0 - 0.06, 0.05, 0.012, C.motor, { material: mm }); fin.position.set((x0 + x1) / 2, PY + Math.sin(a) * 0.255, Math.cos(a) * 0.255); fin.rotation.x = Math.PI / 2 - a; g.add(fin);
    }
    const fan = xcyl(0.24, x1, x1 + 0.2, 0, { material: mat(C.motor, { roughness: 0.5 }), open: true }); g.add(fan);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.235, 32), mat(0x2b3036, { roughness: 0.8 })); grille.rotation.y = Math.PI / 2; grille.position.set(x1 + 0.2, PY, 0); g.add(grille);
    for (let k = -3; k <= 3; k++) { const bar = box(0.012, 0.44 * Math.cos(Math.asin(k / 4)), 0.012, 0x8d939a); bar.position.set(x1 + 0.205, PY, k * 0.055); g.add(bar); }
    const tb = box(0.2, 0.14, 0.2, C.motor); tb.position.set(0.75, PY + 0.3, 0.05); g.add(tb);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16), mat(0x8d939a)); eye.position.set(0.88, PY + 0.29, 0); g.add(eye);
    for (const x of [x0 + 0.12, x1 - 0.12]) for (const z of [-0.17, 0.17]) { const f = box(0.1, PY - 0.2 - this.baseY, 0.08, C.motor); f.position.set(x, (this.baseY + PY - 0.2) / 2, z); g.add(f); }
    // stator laminations + end windings (visible in the cutaway)
    const stator = ringX(0.135, 0.215, 0.62, mat(C.lam, this.cut(this.clipPump, { roughness: 0.6, metalness: 0.5 }))); stator.position.set(LAYOUT.MOTX, PY, 0); g.add(stator);
    for (const x of [LAYOUT.MOTX - 0.36, LAYOUT.MOTX + 0.36]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 40), mat(C.copper, this.cut(this.clipPump, { metalness: 0.6, roughness: 0.35 }))); w.rotation.y = Math.PI / 2; w.position.set(x, PY, 0); g.add(w); }
    this.pickGroup(g, { kind: 'motor' }); this.regGroup('motor', g);
    this.labels.push({ id: 'm301', pos: new THREE.Vector3(0.85, PY + 0.62, 0.1), cls: 'equip', text: (s) => `M-301 · ${s.pump.Pel.toFixed(1)} kW` });
  }

  // ---------- valves ----------
  makeValve(pos, axis, tag) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), mat(C.steel, { metalness: 0.6, roughness: 0.4 })); g.add(body);
    for (const s of [-1, 1]) { const f = cyl(0.14, 0.04, C.steel); f.rotation.z = Math.PI / 2; f.position.x = s * 0.16; g.add(f); }
    const bonnet = cyl(0.05, 0.2, C.steel); bonnet.position.y = 0.16; g.add(bonnet);
    const yoke = box(0.025, 0.25, 0.13, C.steel); yoke.position.y = 0.37; g.add(yoke);
    const act = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.actuator, { roughness: 0.45, metalness: 0.3 })); act.position.y = 0.52; act.scale.y = 0.5; g.add(act);
    const actb = cyl(0.18, 0.04, C.actuator); actb.position.y = 0.52; g.add(actb);
    const ind = box(0.03, 0.06, 0.03, C.accent, { m: { emissive: C.accent, emissiveIntensity: 0.4 } }); ind.position.set(0.035, 0.37, 0.08); g.add(ind);
    g.position.copy(pos); if (axis === 'z') g.rotation.y = Math.PI / 2;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; this.pick(o, { kind: 'valve', tag }); } });
    this.groups.valves.add(g); this.regGroup('valve:' + tag, g);
    this.valves[tag] = { g, ind, act: [act.material, actb.material] };
    return g;
  }
  makeGate(pos, axis) {
    const g = new THREE.Group(), m = mat(C.steel, { metalness: 0.55, roughness: 0.4 });
    const body = cyl(0.12, 0.2, 0, { material: m }); body.rotation.z = Math.PI / 2; g.add(body);
    const bon = cyl(0.05, 0.4, 0, { material: m }); bon.position.y = 0.25; g.add(bon);
    const hw = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 24), mat(0xd93333)); hw.rotation.x = Math.PI / 2; hw.position.y = 0.48; g.add(hw);
    g.position.copy(pos); if (axis === 'z') g.rotation.y = Math.PI / 2; this.groups.valves.add(g); return g;
  }

  // ---------- piping ----------
  pipe(points, r, color, flowColor, key, opts = {}) {
    const path = new THREE.CurvePath(); const pts = points.map((p) => new THREE.Vector3(...p)); let len = 0;
    for (let k = 0; k < pts.length - 1; k++) { path.add(new THREE.LineCurve3(pts[k], pts[k + 1])); len += pts[k].distanceTo(pts[k + 1]); }
    const segs = Math.max(8, Math.round(len * 8));
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, segs, r, 16, false), mat(color, { roughness: 0.55, metalness: 0.2 }));
    m.castShadow = true; m.receiveShadow = true; this.groups.piping.add(m);
    for (let k = 1; k < pts.length - 1; k++) { const e = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 14, 10), m.material); e.position.copy(pts[k]); this.groups.piping.add(e); }
    if (flowColor != null) {
      const tex = DASH.clone(); tex.needsUpdate = true; tex.repeat.set(len / 0.35, 1);
      const fm = new THREE.MeshBasicMaterial({ color: flowColor, alphaMap: tex, transparent: true, opacity: 0.9, depthWrite: false });
      const flow = new THREE.Mesh(new THREE.TubeGeometry(path, segs, r * 1.08, 10, false), fm); flow.renderOrder = 3; this.groups.flow.add(flow);
      this.pipes.push({ key, tex, len, mesh: flow, mat: fm, dir: opts.dir || 1 });
    }
    if (opts.pick) this.pick(m, opts.pick);
    this.reg('pipe:' + key, m);
    return m;
  }

  buildPiping() {
    const T = TANK, P = C.hot;
    // condensate return into the top of the receiver
    this.pipe([[-10, T.y0 + T.H + 0.75, 0], [T.x - 0.45, T.y0 + T.H + 0.75, 0], [T.x - 0.45, T.y0 + T.H + 0.12, 0]], 0.09, P, 0x7fc4cf, 'inflow', { pick: { kind: 'tank' } });
    this.inletPos = new THREE.Vector3(T.x - 0.45, T.y0 + T.H, 0);
    // overflow: side nozzle near the top, down to a drain funnel
    this.pipe([[T.x - T.r - 0.02, T.y0 + T.H - 0.12, -0.5], [T.x - T.r - 0.35, T.y0 + T.H - 0.12, -0.5], [T.x - T.r - 0.35, 0.55, -0.5]], 0.07, P, 0x7fc4cf, 'overflow');
    const fun = cyl(0.12, 0.2, 0x8d939a, { r2: 0.2, open: true }); fun.position.set(T.x - T.r - 0.35, 0.42, -0.5); this.groups.piping.add(fun);
    // suction: tank bottom -> down -> HV-301 -> S-305 -> reducer -> pump suction
    const xs = CX - 0.11 - 0.29;
    this.pipe([[T.x, T.y0 - 0.2, 0], [T.x, PY, 0], [LAYOUT.STRX - 0.3, PY, 0]], 0.085, P, 0x5aa7b8, 'suction', { pick: { kind: 'strainer' } });
    this.pipe([[LAYOUT.STRX + 0.3, PY, 0], [xs - 0.25, PY, 0]], 0.085, P, 0x5aa7b8, 'suction2', { pick: { kind: 'strainer' } });
    const red = xcyl(0.085, xs - 0.25, xs, 0, { r2: 0.1, material: mat(P, { roughness: 0.55 }) }); red.rotation.z = -Math.PI / 2; this.groups.piping.add(red);
    this.reg('pipe:suction', red);
    this.makeGate(new THREE.Vector3(-4.1, PY, 0), 'x');
    // PI-305 suction gauge
    const pg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), mat(0xffffff, { roughness: 0.3 })); pg.rotation.x = Math.PI / 2; pg.position.set(xs - 0.12, PY + 0.3, 0.02); this.groups.piping.add(pg);
    this.groups.piping.add(rod(new THREE.Vector3(xs - 0.12, PY + 0.08, 0), new THREE.Vector3(xs - 0.12, PY + 0.24, 0), 0.012, mat(0x9aa2aa)));
    this.psPos = new THREE.Vector3(xs - 0.12, PY + 0.4, 0);
    // discharge: nozzle up -> check valve -> over to LV-310 -> FE-310 -> up and away to D-401
    const yD = PY + 1.0, zD = 0.95;
    this.pipe([[CX, PY + 0.55, 0], [CX, yD, 0], [CX, yD, zD], [2.4, yD, zD], [2.4, 3.6, zD], [5.5, 3.6, zD]], 0.065, P, 0x5aa7b8, 'discharge', { pick: { kind: 'valve', tag: 'LV-310' } });
    const ck = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12), mat(C.steel, { metalness: 0.6 })); ck.scale.set(1, 1.3, 1); ck.position.set(CX, PY + 0.72, 0); this.groups.piping.add(ck);
    const ckc = cyl(0.06, 0.05, C.steel); ckc.rotation.x = Math.PI / 2; ckc.position.set(CX, PY + 0.74, 0.1); this.groups.piping.add(ckc);
    this.makeValve(new THREE.Vector3(0.55, yD, zD), 'x', 'LV-310');
    for (const s of [-0.05, 0.05]) { const fl = ringX(0.06, 0.13, 0.03, mat(C.steel, { metalness: 0.5 })); fl.position.set(1.55 + s, yD, zD); this.groups.piping.add(fl); }
    const ft = box(0.14, 0.14, 0.1, 0x2f6fb0, { m: { metalness: 0.3 } }); ft.position.set(1.55, yD + 0.26, zD); this.groups.piping.add(ft);
    this.groups.piping.add(rod(new THREE.Vector3(1.5, yD + 0.05, zD), new THREE.Vector3(1.5, yD + 0.2, zD), 0.008, mat(0x9aa2aa)));
    const pd = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), mat(0xffffff, { roughness: 0.3 })); pd.rotation.x = Math.PI / 2; pd.position.set(CX + 0.16, yD - 0.25, 0.02); this.groups.piping.add(pd);
    this.groups.piping.add(rod(new THREE.Vector3(CX + 0.06, yD - 0.25, 0), new THREE.Vector3(CX + 0.14, yD - 0.25, 0), 0.012, mat(0x9aa2aa)));
    // seal drain line to LSH-330 pot
    this.pipe([[LAYOUT.SEALX + 0.1, PY - 0.14, 0.06], [LAYOUT.SEALX + 0.1, 0.62, 0.06], [LAYOUT.SEALX + 0.1, 0.62, 0.3]], 0.012, 0x9aa2aa, null, 'sealDrain');
    const pot = cyl(0.06, 0.2, C.steel, { m: { metalness: 0.5 } }); pot.position.set(LAYOUT.SEALX + 0.1, 0.62, 0.3); this.groups.piping.add(pot);
    this.potPos = new THREE.Vector3(LAYOUT.SEALX + 0.1, 0.8, 0.3);
    // arrow to D-401
    const arr = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 20), mat(C.accent, { emissive: C.accent, emissiveIntensity: 0.2 })); arr.rotation.z = -Math.PI / 2; arr.position.set(5.7, 3.6, zD); this.groups.piping.add(arr);

    // ---- tags ----
    const L = this.labels;
    L.push({ id: 'd401', pos: new THREE.Vector3(5.2, 4.0, zD), cls: 'equip', text: () => 'to D-401 deaerator · +12 m' });
    L.push({ id: 'fi300', pos: new THREE.Vector3(-7.6, T.y0 + T.H + 1.0, 0), cls: 'inst', text: (s) => `FI-300 return  ${s.tank.Qin.toFixed(0)} m³/h`, alarm: (s) => s.faults.inflowSurge.active });
    L.push({ id: 'li301', pos: this.ltPos.clone().add(new THREE.Vector3(0, 0.25, 0)), cls: 'inst', text: (s) => `LI-301  ${s.meas.L.toFixed(0)}%${trend(s, 'L', 2)}`, alarm: (s) => s.meas.L > 80 || s.meas.L < 20 });
    L.push({ id: 'lsl302', pos: this.lslPos, cls: 'inst', text: (s) => (s.meas.Ltrue < 15 ? 'LSL-302 LOW' : 'LSL-302'), alarm: (s) => s.meas.Ltrue < 15 });
    L.push({ id: 's305', pos: new THREE.Vector3(LAYOUT.STRX, PY + 0.85, 0), cls: 'equip', text: () => 'S-305 Y-strainer' });
    L.push({ id: 'pdi305', pos: new THREE.Vector3(LAYOUT.STRX, PY + 0.7, 0.1), cls: 'inst', text: (s) => `PDI-305  ΔP ${s.pump.dPstr.toFixed(1)} kPa${trend(s, 'dPstr', 0.6)}`, alarm: (s) => s.pump.dPstr > 25 });
    L.push({ id: 'pi305', pos: this.psPos, cls: 'inst', text: (s) => `PI-305  ${barg(s.pump.Ps).toFixed(2)} barg${trend(s, 'Ps', 1.5)}`, alarm: (s) => s.pump.Ps < 110 && s.pump.running });
    L.push({ id: 'pi310', pos: new THREE.Vector3(CX + 0.3, yD - 0.12, 0.05), cls: 'inst', text: (s) => `PI-310  ${barg(s.pump.Pd).toFixed(2)} barg${trend(s, 'Pd', 3)}` });
    L.push({ id: 'lv310', pos: new THREE.Vector3(0.55, yD + 0.75, zD), cls: 'valve', text: (s) => `LV-310  ${s.valves.LV310.toFixed(0)}%${trend(s, 'LV', 1.5)}`, alarm: (s) => s.valves.LV310 > 92 || s.faults.valveFail.active });
    L.push({ id: 'fi310', pos: new THREE.Vector3(1.55, yD + 0.48, zD), cls: 'inst', text: (s) => `FI-310  ${s.meas.Q.toFixed(1)} m³/h${trend(s, 'Q', 2)}`, alarm: (s) => s.pump.running && s.meas.Q < 20 });
    L.push({ id: 'vi301', pos: new THREE.Vector3(LAYOUT.B1X, PY + 0.42, -0.05), cls: 'inst', text: (s) => `VI-301 ${s.meas.V1.toFixed(1)} mm/s · TI ${s.meas.T1.toFixed(0)} °C${trend(s, 'V1', 0.15)}`, alarm: (s) => s.meas.V1 > 2.8 || s.meas.T1 > 85 });
    L.push({ id: 'vi302', pos: new THREE.Vector3(LAYOUT.B2X + 0.05, PY + 0.42, -0.05), cls: 'inst', text: (s) => `VI-302 ${s.meas.V2.toFixed(1)} mm/s · TI ${s.meas.T2.toFixed(0)} °C${trend(s, 'V2', 0.15)}`, alarm: (s) => s.meas.V2 > 2.8 || s.meas.T2 > 85 });
    L.push({ id: 'ti303', pos: new THREE.Vector3(CX + 0.05, PY + 0.32, -0.32), cls: 'inst', text: (s) => `TI-303 casing ${s.pump.Tc.toFixed(0)} °C${trend(s, 'Tc', 0.5)}`, alarm: (s) => s.pump.Tc > 98 });
    L.push({ id: 'ii301', pos: new THREE.Vector3(0.75, PY + 0.45, 0.2), cls: 'inst', text: (s) => `II-301  ${s.pump.amps.toFixed(1)} A${trend(s, 'amps', 0.4)}` });
    L.push({ id: 'lsh330', pos: this.potPos.clone().add(new THREE.Vector3(0, 0.1, 0.05)), cls: 'inst', text: (s) => `LSH-330 seal leak ${s.pump.leak.toFixed(s.pump.leak < 1 ? 2 : 1)} L/h${trend(s, 'leak', 0.15)}`, alarm: (s) => s.pump.leak > 6 });
  }

  // ---------- particles: liquid through the pump, cavitation, drips ----------
  buildParticles() {
    const sgeo = new THREE.SphereGeometry(1, 8, 6);
    const lmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.95, depthWrite: false });
    // liquid parcels: phase 0..1 through eye (axial) -> impeller channel (spiral out) -> volute (around) -> discharge nozzle
    this.liqN = 200;
    this.liq = new THREE.InstancedMesh(sgeo, lmat, this.liqN);
    this.liq.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.liqN * 3), 3);
    this.liq.frustumCulled = false; this.liq.renderOrder = 4; this.groups.flow.add(this.liq);
    this.liqData = Array.from({ length: this.liqN }, (_, k) => ({ ph: k / this.liqN, a0: Math.random() * Math.PI * 2, rr: Math.random(), xx: Math.random() }));
    // cavitation bubbles (ride with the impeller near the vane inlets, collapse as pressure rises)
    this.cavN = 120;
    const cmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false, emissive: 0xffffff, emissiveIntensity: 0.25 });
    this.cav = new THREE.InstancedMesh(sgeo, cmat, this.cavN); this.cav.frustumCulled = false; this.cav.renderOrder = 5;
    this.impeller.add(this.cav);
    this.cavData = Array.from({ length: this.cavN }, (_, k) => ({ vane: k % 6, ph: Math.random(), off: (Math.random() - 0.5) * 0.25, xx: (Math.random() - 0.5) * 0.045, sp: 0.6 + Math.random() * 0.8 }));
    // collapse flashes
    // seal drips
    this.dripN = 40;
    this.drip = new THREE.InstancedMesh(sgeo, new THREE.MeshStandardMaterial({ color: 0x8fd0d8, roughness: 0.05, transparent: true, opacity: 0.9, depthWrite: false }), this.dripN);
    this.drip.frustumCulled = false; this.drip.renderOrder = 4; this.groups.flow.add(this.drip);
    this.dripData = Array.from({ length: this.dripN }, (_, k) => ({ ph: k / this.dripN, dx: (Math.random() - 0.5) * 0.03, dz: (Math.random() - 0.5) * 0.03 }));
    // tank: bubbles in the vortex
  }

  // ---------- open / close ----------
  setOpen(t) {
    this.openT = t;
    const e = t * t * (3 - 2 * t);
    const Y = e > 0 ? 2.4 - e * 2.6 : 40;              // pump wedge sweeps from the top down
    this.clipPump[1].constant = Y;
    this.clipCover[0].constant = Y;
    this.clipTank[2].constant = e > 0 ? TANK.y0 + TANK.H + 0.6 - e * (TANK.H + 1.4) : 40;
    this._open = e > 0.02;
  }

  setHighlights(list) {
    for (const m of this._hiMats || []) { m.emissive.copy(m.userData.e0); m.emissiveIntensity = m.userData.ei0; }
    this._hiMats = [];
    for (const h of list) for (const ms of this.targets[h.key] || []) {
      const m = ms.material; if (!m || !m.emissive) continue;
      if (!m.userData.e0) { m.userData.e0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity; }
      m.emissive.set(h.color); m.emissiveIntensity = h.k; this._hiMats.push(m);
    }
  }

  updateBeacons(list, camera, dt) {
    if (!this._beacons) { this.beaconGroup = new THREE.Group(); this.root.add(this.beaconGroup); this._beacons = new Map(); this._ringGeo = new THREE.RingGeometry(0.93, 1.0, 64); this._bt = 0; }
    this._bt += dt; const seen = new Set();
    for (const b of list) {
      seen.add(b.id); let o = this._beacons.get(b.id);
      if (!o) {
        o = { g: new THREE.Group(), rings: [] };
        for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: b.color, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 20; o.g.add(m); o.rings.push(m); }
        o.dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: b.color, depthTest: false, transparent: true })); o.dot.renderOrder = 21; o.g.add(o.dot);
        this.beaconGroup.add(o.g); this._beacons.set(b.id, o);
      }
      o.g.position.copy(b.pos);
      o.rings.forEach((r, k) => { const ph = (this._bt * 0.55 + k / 3) % 1; r.quaternion.copy(camera.quaternion); const sc = b.size * (0.15 + ph * 0.75); r.scale.set(sc, sc, sc); r.material.opacity = (1 - ph) * 0.7; r.material.color.set(b.color); });
      o.dot.material.color.set(b.color); o.dot.material.opacity = 0.6 + 0.4 * Math.sin(this._bt * 6);
    }
    for (const [id, o] of this._beacons) if (!seen.has(id)) { this.beaconGroup.remove(o.g); this._beacons.delete(id); }
  }

  // ---------- per-frame ----------
  update(sim, dtReal, colorMode, selected) {
    this._clock += dtReal;
    const p = sim.pump, tk = sim.tank, d = sim.d, rgk = sim.rg;
    const running = p.running && !sim.trip.on;
    const col = new THREE.Color();
    const pvap = p.Ps - p.npshA * rgk; // vapor pressure at casing temperature
    // local liquid color by mode
    const pcol = (pk) => { if (pk < pvap + 4) return col.set(0xffffff); const k = Math.max(0, Math.min(1, (barg(pk) + 0.4) / 4.8)); return col.setHSL(0.62 - 0.62 * k, 0.75, 0.5); };
    const tcol = (T) => { const k = Math.max(0, Math.min(1, (T - 60) / 55)); return col.setHSL(0.62 - 0.62 * k, 0.75, 0.5); };
    const liquidColor = (pk, T) => (colorMode === 'temperature' ? tcol(T) : colorMode === 'pressure' ? pcol(pk) : col.set(0x3aa0a8));

    // ---- shaft speed (spins down on trip) ----
    const target = running ? 2 * Math.PI * 1.25 : 0;
    this.omega += (target - this.omega) * Math.min(1, dtReal * (running ? 1.5 : 0.6));
    this.rot += this.omega * dtReal;
    this.rotGroup.rotation.x = this.rot;
    for (const b of this.bearings) for (const r of b.rows) r.cage.rotation.x = this.rot * 0.4;
    const spin = this.omega / (2 * Math.PI * 1.25);

    // ---- misalignment: motor offset + a visible tilt (exaggerated) ----
    const mis = sim.faults.misalignment.active ? 1 : 0;
    this._mis = (this._mis || 0) + (mis - (this._mis || 0)) * Math.min(1, dtReal * 2);
    this.motorG.position.y = 0.018 * this._mis; this.motorG.rotation.y = 0.022 * this._mis;
    this.motorRot.position.y = 0.018 * this._mis; this.motorRot.rotation.y = 0.022 * this._mis;
    this.motorHub.position.y = 0.018 * this._mis;

    // ---- vibration shake (deterministic, exaggerated) ----
    const v1 = sim.vib.o1, v2 = sim.vib.o2;
    const amp = Math.max(0, Math.max(v1, v2) - 1.6) * 0.0011 * spin;
    const sh = (f, ph) => Math.sin(this._clock * f + ph);
    const dy = amp * (sh(53, 0) * 0.6 + sh(97, 1.3) * 0.4), dz = amp * (sh(61, 2.1) * 0.6 + sh(113, 0.4) * 0.4);
    for (const k of ['casing', 'frame', 'internals', 'motor', 'guard']) { this.groups[k].position.y = dy; this.groups[k].position.z = dz; }
    this.groups.casing.position.y = dy * 0.5;

    // ---- color modes on the hardware ----
    const tint = (m, base, c, k) => { m.color.set(base).lerp(new THREE.Color(c), k); };
    if (colorMode === 'vibration') {
      tint(this.frameMat, C.pumpBlue, zoneHex(Math.max(v1, v2)), 0.75); tint(this.casMat, C.pumpBlue, zoneHex(v1), 0.6); tint(this.covMat, C.pumpBlue, zoneHex(v1), 0.6); tint(this.motorMat, C.motor, zoneHex(v2), 0.6);
    } else if (colorMode === 'temperature') {
      const th = (T, lo, hi) => new THREE.Color().setHSL(0.62 - 0.62 * Math.max(0, Math.min(1, (T - lo) / (hi - lo))), 0.7, 0.5);
      this.frameMat.color.copy(th(Math.max(sim.bear.T1, sim.bear.T2), 35, 95)); this.casMat.color.copy(th(p.Tc, 60, 115)); this.covMat.color.copy(this.casMat.color); this.motorMat.color.set(C.motor);
    } else { this.frameMat.color.set(C.pumpBlue); this.casMat.color.set(C.pumpBlue); this.covMat.color.set(C.pumpBlue); this.motorMat.color.set(C.motor); }
    // bearing races glow with heat; spall grows
    const sB = sim.faults.bearingDefect.s;
    const sp = Math.max(0, (sB - 0.15) / 0.85);
    this.spall.scale.set(1 + 2 * sp, 1, 0.3 + 1.6 * sp); this.spall.visible = sB > 0.12;
    const hot1 = Math.max(0, (sim.bear.T1 - 65) / 30), hot2 = Math.max(0, (sim.bear.T2 - 65) / 30);
    this.bearings[0].rows[0].or.material.color.set(C.race).lerp(new THREE.Color(0xd9622b), Math.min(0.8, hot1));
    for (const r of this.bearings[1].rows) r.or.material.color.set(C.race).lerp(new THREE.Color(0xd9622b), Math.min(0.8, hot2));
    // impeller wear: dull + eroded tint
    this.impMat.color.set(C.bronze).lerp(new THREE.Color(0x6b5a48), Math.min(0.7, sim.faults.impellerWear.s * 0.8));
    // strainer fouling
    const sS = sim.faults.strainerPlug.s;
    this.screenMat.color.set(0xffffff).lerp(new THREE.Color(0x4a3220), Math.min(0.9, sS * 1.1));
    for (const db of this.debris) { const k = Math.max(0, Math.min(1, (sS - (1 - db.userData.u) * 0.6) * 2.2)); db.scale.setScalar(Math.max(0.001, k * 1.3)); }

    // ---- tank ----
    const T = TANK, L = Math.max(0.0, tk.L);
    this.tankLiq.scale.y = Math.max(0.005, L); this.tankLiq.position.set(T.x, T.y0 + L / 2, T.z);
    this.tankTop.position.set(T.x, T.y0 + L + 0.003, T.z);
    this.tankTop.visible = L > 0.02; this.tankLiqBot.visible = L > 0.005 || true;
    const tc = liquidColor(d.Patm + rgk * L / 2, d.Tliq);
    this.tankLiqMat.color.copy(tc); this.tankTopMat.color.copy(tc);
    this.smap.rotation += dtReal * (0.12 + 0.6 * tk.vortex + 0.2 * p.Q / 90);
    const vx = tk.vortex;
    this.vortex.visible = vx > 0.02 && L > 0.03;
    this.vortexMat.opacity = Math.min(0.8, vx * 1.4);
    const vh = Math.max(0.05, L * (0.4 + 0.6 * vx)); this.vortex.scale.set(0.5 + vx, vh, 0.5 + vx); this.vortex.position.set(T.x, T.y0 + L - vh / 2, T.z);
    this.vortex.rotation.y += dtReal * 5;
    this.vmap.offset.x += dtReal * 1.5;
    const fallH = Math.max(0.1, T.H - L + 0.05);
    this.inStream.scale.y = fallH; this.inStream.position.set(this.inletPos.x, T.y0 + T.H - fallH / 2, T.z);
    this.inStream.visible = tk.Qin > 1; this.imap.offset.y += dtReal * (0.8 + tk.Qin / 60);
    this.inMat.color.copy(liquidColor(d.Patm, d.Tliq)).lerp(new THREE.Color(0xffffff), 0.35);

    // ---- liquid through the pump ----
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const qf = Math.min(1.6, p.Q / 90);
    const xs = CX - 0.11 - 0.29;
    for (let k = 0; k < this.liqN; k++) {
      const b = this.liqData[k];
      b.ph += dtReal * 0.32 * qf;
      if (b.ph > 1) b.ph -= 1;
      if (p.Q < 0.5) { m4.makeScale(0, 0, 0); this.liq.setMatrixAt(k, m4); continue; }
      const ph = b.ph; let pk, sz = 0.0075;
      if (ph < 0.22) {        // axial into the eye
        const u = ph / 0.22; const r = R_EYE * 0.85 * Math.sqrt(b.rr);
        v.set(xs + 0.05 + u * (CX - 0.03 - xs - 0.05), PY + Math.cos(b.a0) * r, Math.sin(b.a0) * r);
        pk = p.Ps - (p.Ps - (pvap + rgk * Math.max(0, p.npshA - p.npshR * 1.6))) * u;
      } else if (ph < 0.5) {  // out through the impeller channel, swirling with it
        const u = (ph - 0.22) / 0.28; const r = R_EYE + (R_IMP - R_EYE) * u;
        const a = b.a0 + this.rot + -1.25 * u;
        v.set(CX + (b.xx - 0.5) * 0.04, PY + Math.cos(a) * r, Math.sin(a) * r);
        const pe = pvap + rgk * Math.max(0, p.npshA - p.npshR * 1.6); pk = pe + (p.Pd * 0.8 - pe) * Math.pow(u, 0.7);
      } else if (ph < 0.86) { // around the volute toward the throat
        const u = (ph - 0.5) / 0.36; const r = 0.19 + 0.06 * u + 0.012 * (b.rr - 0.5);
        const a = 0.2 + (b.a0 % (Math.PI / 3)) + u * (Math.PI * 2 - 1.2);
        v.set(CX + (b.xx - 0.5) * 0.12, PY + Math.cos(a) * r, Math.sin(a) * r);
        pk = p.Pd * (0.82 + 0.18 * u);
      } else {                // up the discharge nozzle
        const u = (ph - 0.86) / 0.14; const r = 0.05 * Math.sqrt(b.rr);
        v.set(CX + Math.cos(b.a0) * r, PY + 0.27 + u * 0.3, Math.sin(b.a0) * r);
        pk = p.Pd;
      }
      s.setScalar(sz); m4.compose(v, q, s); this.liq.setMatrixAt(k, m4);
      this.liq.setColorAt(k, liquidColor(pk, p.Tc));
    }
    this.liq.instanceMatrix.needsUpdate = true; this.liq.instanceColor.needsUpdate = true;
    this.liq.visible = this._open;

    // ---- cavitation bubbles: born near the vane inlet, collapse as pressure rises ----
    const ci = Math.min(2, p.ci + (p.Tc > 103 && running ? (p.Tc - 103) / 4 : 0) + tk.vortex * 0.8);
    const nOn = Math.round(this.cavN * Math.min(1, ci / 1.6));
    for (let k = 0; k < this.cavN; k++) {
      const b = this.cavData[k];
      if (k >= nOn || !running) { m4.makeScale(0, 0, 0); this.cav.setMatrixAt(k, m4); continue; }
      b.ph += dtReal * b.sp * 0.9; if (b.ph > 1) b.ph -= 1;
      const reach = 0.25 + 0.5 * Math.min(1, ci / 2);            // deeper cavitation: bubbles survive further out
      const r = R_EYE * 0.9 + (R_IMP - R_EYE) * reach * b.ph;
      const th = b.vane * Math.PI / 3 - 1.25 * Math.log(r / R_EYE) / Math.log(R_IMP / R_EYE) + 0.18 + b.off * 0.5;
      v.set(b.xx, Math.sin(th) * r, -Math.cos(th) * r);
      const life = b.ph < 0.7 ? 0.6 + b.ph : Math.max(0, (1 - b.ph) / 0.3) * 1.3;
      s.setScalar(0.0085 * life * (0.8 + 0.4 * Math.min(1, ci))); m4.compose(v, q, s); this.cav.setMatrixAt(k, m4);
    }
    this.cav.instanceMatrix.needsUpdate = true;

    // ---- seal drips + puddle ----
    const leak = p.leak;
    const nd = Math.min(this.dripN, Math.round(leak * 3.2));
    const g0 = this.glandPos, fall = g0.y - this.baseY;
    for (let k = 0; k < this.dripN; k++) {
      const b = this.dripData[k];
      if (k >= nd) { m4.makeScale(0, 0, 0); this.drip.setMatrixAt(k, m4); continue; }
      b.ph += dtReal * (0.8 + Math.min(2, leak / 3)); if (b.ph > 1) b.ph -= 1;
      const yy = g0.y - fall * b.ph * b.ph;
      v.set(g0.x + b.dx, yy + this.groups.casing.position.y, g0.z + b.dz);
      const stream = leak > 4 ? 1.6 : 1;
      s.set(0.007, 0.007 * (1 + 1.4 * b.ph) * stream, 0.007); m4.compose(v, q, s); this.drip.setMatrixAt(k, m4);
    }
    this.drip.instanceMatrix.needsUpdate = true;
    const pTarget = leak > 0.1 ? Math.min(0.3, 0.045 * Math.sqrt(leak)) : 0;
    this._puddle = (this._puddle || 0) + (pTarget - (this._puddle || 0)) * Math.min(1, dtReal * 0.6);
    this.puddle.scale.setScalar(Math.max(0.001, this._puddle));

    // ---- pipe flow markers ----
    const rate = { suction: p.Q / 90, suction2: p.Q / 90, discharge: p.Q / 90, inflow: tk.Qin / 90, overflow: tk.overflow / 30 };
    for (const pp of this.pipes) {
      const r = rate[pp.key] != null ? rate[pp.key] : 0;
      pp.tex.offset.x -= dtReal * 0.9 * r * pp.dir; pp.mesh.visible = r > 0.02; pp.mat.opacity = Math.min(0.95, 0.5 + r * 0.4);
      if (colorMode === 'pressure') pp.mat.color.copy(pcol(pp.key === 'discharge' ? p.Pd * 0.7 : pp.key.startsWith('suction') ? p.Ps : d.Patm + 5));
      else if (colorMode === 'temperature') pp.mat.color.copy(tcol(d.Tliq));
      else pp.mat.color.set(0x5aa7b8);
    }

    // ---- valve stem + actuator color ----
    for (const tag in this.valves) {
      const vv = this.valves[tag], op = sim.valves.LV310;
      vv.ind.position.y = 0.3 + 0.15 * (op / 100);
      const sel = selected && selected.kind === 'valve' && selected.tag === tag;
      vv.ind.material.emissiveIntensity = sel ? 1.2 : 0.4;
      const ac = op > 95 || op < 2 ? 0xd93333 : op > 85 ? 0xe0a020 : C.actuator;
      for (const m of vv.act) m.color.lerp(new THREE.Color(ac), Math.min(1, dtReal * 4));
    }
  }
}
