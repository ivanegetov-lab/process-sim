// 3D plant model for C-101. Pure geometry + per-frame updates from the simulator state.
import * as THREE from 'three';

export const COL = {
  R: 0.65,          // shell inner radius
  Rins: 0.78,       // cladding radius
  tray0: 5.6,       // elevation of tray 1
  spacing: 0.6,
  n: 20,
  botTan: 3.6,      // bottom tangent line
  topTan: 18.0,
  dcX: 0.44,        // downcomer chord offset from center
};
export const trayY = (i) => COL.tray0 + i * COL.spacing;

// ---------------- palette ----------------
const C = {
  equip: 0xd8ccb0,      // painted equipment (beige)
  clad: 0xc9cdd2,       // aluminum cladding
  shellIn: 0x9aa0a6,
  steel: 0x8d939a,
  struct: 0x6f7780,
  rail: 0xf0c419,
  grating: 0x9a9fa6,
  concrete: 0xd7d8d6,
  pipe: 0xd2c6aa,
  steamPipe: 0xc4b8a0,
  cwPipe: 0x7fa8a3,
  tray: 0xb8763e,       // copper-ish internals (highlight like the reference)
  trayDeck: 0xa9b1b8,
  downcomer: 0x9b5f32,
  tube: 0xc98a4b,
  tubeCond: 0x8fb4c9,
  motor: 0x5a7184,
  actuator: 0x3b4650,
  accent: 0xe8573a,
};

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.62, metalness: 0.12 }, o));
}

// ---------------- helpers ----------------
function cyl(r, h, color, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, o.seg || 40, 1, !!o.open), o.material || mat(color, o.m));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function box(w, h, d, color, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material || mat(color, o.m));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function placeBetween(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.scale.y = len;
  return mesh;
}
function rod(a, b, r, material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), material);
  placeBetween(m, a, b);
  m.castShadow = true;
  return m;
}

// flow-marker texture (dashes) shared image
function makeDashTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 8);
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.72, 'rgba(255,255,255,0)'); grd.addColorStop(0.86, 'rgba(255,255,255,1)'); grd.addColorStop(0.9, 'rgba(255,255,255,1)'); grd.addColorStop(0.93, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}
const DASH = typeof document !== 'undefined' ? makeDashTexture() : null;

// moving-liquid textures: foam streaks + bubbles (horizontal for tray froth, vertical for falling liquid)
function makeStreakTexture(vertical) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(222,228,229)'; g.fillRect(0, 0, 256, 256);
  let seed = vertical ? 7 : 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.lineCap = 'round';
  for (let k = 0; k < 75; k++) {
    const a = rnd() * 256, b = rnd() * 256, len = 25 + rnd() * 90, w = 1.5 + rnd() * 4.5;
    g.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.55})`; g.lineWidth = w;
    for (const o of [-256, 0, 256]) {
      g.beginPath();
      if (vertical) { g.moveTo(a, b + o); g.lineTo(a, b + o + len); } else { g.moveTo(a + o, b); g.lineTo(a + o + len, b); }
      g.stroke();
    }
  }
  for (let k = 0; k < 110; k++) { const x = rnd() * 256, y = rnd() * 256, r = 1.5 + rnd() * 4; g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const STREAK_H = typeof document !== 'undefined' ? makeStreakTexture(false) : null;
const STREAK_V = typeof document !== 'undefined' ? makeStreakTexture(true) : null;

// ▲ / ▼ when a historian tag moved more than `th` in the last 30 sim-minutes
function trend(s, key, th) {
  const H = s.history; if (!H || H.length < 6) return '';
  const a = H[Math.max(0, H.length - 31)][key], b = H[H.length - 1][key];
  return b - a > th ? ' ▲' : a - b > th ? ' ▼' : '';
}

// circular segment shape (the part of a circle of radius r with x > c)
function segmentShape(r, c) {
  const s = new THREE.Shape();
  const th = Math.acos(Math.min(0.999, c / r));
  s.moveTo(c, -Math.sqrt(r * r - c * c));
  s.absarc(0, 0, r, -th, th, false);
  s.lineTo(c, -Math.sqrt(r * r - c * c));
  return s;
}
// circle minus segment x > c
function deckShape(r, c) {
  const s = new THREE.Shape();
  const th = Math.acos(Math.min(0.999, c / r));
  s.moveTo(c, Math.sqrt(r * r - c * c));
  s.absarc(0, 0, r, th, 2 * Math.PI - th, false);
  s.lineTo(c, Math.sqrt(r * r - c * c));
  return s;
}
// horizontal-cylinder liquid cross-section: circle of radius r filled to height h (from bottom)
function levelShape(r, h) {
  h = Math.max(0.005, Math.min(2 * r - 0.005, h));
  const s = new THREE.Shape();
  const yl = -r + h;
  const a = Math.asin(yl / r);
  s.moveTo(-Math.sqrt(r * r - yl * yl), yl);
  s.absarc(0, 0, r, Math.PI - a, 2 * Math.PI + a, false);
  s.lineTo(-Math.sqrt(r * r - yl * yl), yl);
  return s;
}

// ---------------- the plant ----------------
export class Plant {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.groups = {};
    for (const k of ['cladding', 'shell', 'platforms', 'internals', 'flow', 'reboiler', 'condenser', 'drum', 'pumps', 'piping', 'structure', 'valves'])
      this.groups[k] = new THREE.Group(), this.groups[k].name = k, this.root.add(this.groups[k]);
    this.pickables = [];
    this.pipes = [];
    this.valves = {};
    this.labels = [];      // {id, pos: Vector3, text()}
    this.clip = {};        // per-equipment clipping planes
    this.targets = {};     // highlight targets: key -> meshes
    this.openT = 0;        // 0 closed .. 1 fully open
    this._clock = 0;

    this.buildGround();
    this.buildColumn();
    this.buildInternals();
    this.buildPlatforms();
    this.buildReboiler();
    this.buildOverheadStructure();
    this.buildCondenser();
    this.buildDrum();
    this.buildPumps();
    this.buildPiping();
    this.buildParticles();
    this.regGroup('reboiler', this.groups.reboiler);
    this.regGroup('condenser', this.groups.condenser);
    this.regGroup('drum', this.groups.drum);
    this.regGroup('p101', this.p101);
    this.regGroup('p102', this.p102);
    this.setOpen(0);
  }

  pick(mesh, info) { mesh.userData.pick = info; this.pickables.push(mesh); return mesh; }
  reg(key, ...meshes) { (this.targets[key] = this.targets[key] || []).push(...meshes); }
  regGroup(key, obj) { obj.traverse((o) => { if (o.isMesh && o.material && !o.material.transparent && o.material.emissive) this.reg(key, o); }); }

  // ---------- ground ----------
  buildGround() {
    const g = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat(0xe6e7e4, { roughness: 0.95, metalness: 0 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
    this.root.add(g);
    const pad = box(16, 0.25, 9, C.concrete, { m: { roughness: 0.9, metalness: 0 } });
    pad.position.set(-0.6, 0.125, 0); pad.castShadow = false;
    this.root.add(pad);
    // curb lines
    const grid = new THREE.GridHelper(40, 40, 0xcfd1ce, 0xdcdedb);
    grid.position.y = 0.002; this.root.add(grid);
  }

  // ---------- column shell + cladding + skirt ----------
  buildColumn() {
    const { R, Rins, botTan, topTan } = COL;
    const H = topTan - botTan;
    const planes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 40)];
    this.clip.column = planes;
    const cutOpts = { clippingPlanes: planes, clipIntersection: true, clipShadows: true, side: THREE.DoubleSide };

    // shell (steel, visible when cladding is cut)
    const shellMat = mat(C.shellIn, Object.assign({ roughness: 0.45, metalness: 0.5 }, cutOpts));
    const shell = cyl(R + 0.012, H, 0, { material: shellMat, open: true, seg: 64 });
    shell.position.y = botTan + H / 2;
    this.groups.shell.add(this.pick(shell, { kind: 'column' }));
    // heads (2:1 ellipsoidal)
    const headGeo = new THREE.SphereGeometry(R + 0.012, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const topHead = new THREE.Mesh(headGeo, shellMat); topHead.scale.y = 0.5; topHead.position.y = topTan;
    const botHead = new THREE.Mesh(headGeo, shellMat); botHead.scale.y = -0.5; botHead.position.y = botTan;
    this.groups.shell.add(topHead, botHead);

    // cladding (aluminum jacket) with bands
    const cladMat = mat(C.clad, Object.assign({ roughness: 0.38, metalness: 0.55 }, cutOpts));
    this.cladMat = cladMat;
    const clad = cyl(Rins, H, 0, { material: cladMat, open: true, seg: 64 });
    clad.position.y = botTan + H / 2;
    this.groups.cladding.add(this.pick(clad, { kind: 'column' }));
    const cHead = new THREE.SphereGeometry(Rins, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const ct = new THREE.Mesh(cHead, cladMat); ct.scale.y = 0.55; ct.position.y = topTan; ct.castShadow = true;
    const cb = new THREE.Mesh(cHead, cladMat); cb.scale.y = -0.55; cb.position.y = botTan;
    this.groups.cladding.add(ct, cb);
    const bandMat = mat(0xaeb3b9, Object.assign({ roughness: 0.3, metalness: 0.7 }, cutOpts));
    for (let y = botTan + 0.6; y < topTan; y += 1.2) {
      const b = new THREE.Mesh(new THREE.TorusGeometry(Rins + 0.004, 0.012, 6, 64), bandMat);
      b.rotation.x = Math.PI / 2; b.position.y = y; this.groups.cladding.add(b);
    }
    // skirt
    const skirt = cyl(R + 0.02, botTan - 0.35, C.equip, { seg: 48, m: { side: THREE.DoubleSide } });
    skirt.position.y = (botTan - 0.35) / 2 + 0.25;
    this.groups.shell.add(skirt);
    const base = cyl(R + 0.25, 0.12, C.steel); base.position.y = 0.31; this.groups.shell.add(base);
    // skirt access opening (dark)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), mat(0x2b2f33));
    hole.position.set(0, 1.4, R + 0.03); this.groups.shell.add(hole);
    // manways (on cladding side facing +z-x, rotate)
    for (const y of [6.2, 11.9, 16.7]) {
      const mw = new THREE.Group();
      const neck = cyl(0.26, 0.28, C.equip); neck.rotation.z = Math.PI / 2; neck.position.x = 0.14;
      const flange = cyl(0.33, 0.06, C.equip); flange.rotation.z = Math.PI / 2; flange.position.x = 0.3;
      const davit = rod(new THREE.Vector3(0.3, 0.3, 0), new THREE.Vector3(0.3, 0.7, 0), 0.02, mat(C.steel));
      mw.add(neck, flange, davit);
      mw.position.set(0, y, 0);
      const ang = -Math.PI * 0.75; // facing back-left
      mw.rotation.y = ang; mw.translateX(Rins - 0.05);
      this.groups.cladding.add(mw);
    }
    // name plate
    this.labels.push({ id: 'c101', pos: new THREE.Vector3(0, topTan + 1.2, 0), cls: 'equip', text: () => 'C-101 · Bz/Tol splitter' });
  }

  // ---------- trays, downcomers, froth, sump ----------
  buildInternals() {
    const { R, dcX, n, spacing } = COL;
    const grp = new THREE.Group();
    grp.rotation.y = Math.PI / 4; // cross-flow runs across the view
    this.internals = grp;
    this.groups.internals.add(grp);
    const deckMat = mat(C.trayDeck, { roughness: 0.42, metalness: 0.55 });
    const dcMat = mat(C.downcomer, { roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    const ringMat = mat(0x8a5a33, { roughness: 0.5, metalness: 0.5 });
    const capGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10);
    const capMat = mat(0x5f6870, { roughness: 0.5, metalness: 0.6 });
    // valve-cap positions on the active area
    const caps = [];
    for (let x = -dcX + 0.1; x < dcX - 0.06; x += 0.085)
      for (let z = -R + 0.08; z < R - 0.08; z += 0.085)
        if (x * x + z * z < (R - 0.09) * (R - 0.09)) caps.push([x, z]);
    const capInst = new THREE.InstancedMesh(capGeo, capMat, caps.length * n);
    const m4 = new THREE.Matrix4();
    let ci = 0;
    this.trays = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1; // downcomer side alternates
      const y = trayY(i);
      const tg = new THREE.Group(); tg.position.y = y;
      tg.scale.x = side; // mirror alternate trays
      // deck
      const deckGeo = new THREE.ExtrudeGeometry(deckShape(R - 0.005, dcX), { depth: 0.018, bevelEnabled: false, curveSegments: 40 });
      const deck = new THREE.Mesh(deckGeo, deckMat.clone());
      deck.rotation.x = -Math.PI / 2; deck.castShadow = true; deck.receiveShadow = true;
      tg.add(this.pick(deck, { kind: 'tray', i }));
      // support ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.01, 0.012, 6, 48), ringMat);
      ring.rotation.x = Math.PI / 2; ring.position.y = -0.01; tg.add(ring);
      // outlet weir + downcomer plate
      const chord = 2 * Math.sqrt(R * R - dcX * dcX);
      const weir = new THREE.Mesh(new THREE.PlaneGeometry(chord, 0.06), dcMat);
      weir.rotation.y = Math.PI / 2; weir.position.set(dcX, 0.04, 0); tg.add(weir);
      const dc = new THREE.Mesh(new THREE.PlaneGeometry(chord, spacing - 0.05), dcMat);
      dc.rotation.y = Math.PI / 2; dc.position.set(dcX, -(spacing - 0.05) / 2 + 0.01, 0); tg.add(dc);
      // froth on the deck (scaled in y)
      const frothGeo = new THREE.ExtrudeGeometry(deckShape(R - 0.02, dcX - 0.01), { depth: 1, bevelEnabled: false, curveSegments: 40 });
      frothGeo.rotateX(-Math.PI / 2);
      const fmap = STREAK_H.clone(); fmap.needsUpdate = true; fmap.repeat.set(1.7, 1.7); fmap.offset.set(Math.random(), Math.random());
      const frothMat = new THREE.MeshStandardMaterial({ color: 0x3aa0a8, map: fmap, transparent: true, opacity: 0.55, roughness: 0.25, metalness: 0, depthWrite: false });
      const froth = new THREE.Mesh(frothGeo, frothMat);
      froth.position.y = 0.018; froth.scale.y = 0.12; froth.renderOrder = 2;
      tg.add(this.pick(froth, { kind: 'tray', i }));
      // liquid backed up in the downcomer (segment x > dcX), sits on the tray below
      const dclGeo = new THREE.ExtrudeGeometry(segmentShape(R - 0.02, dcX + 0.01), { depth: 1, bevelEnabled: false, curveSegments: 24 });
      dclGeo.rotateX(-Math.PI / 2);
      const dcl = new THREE.Mesh(dclGeo, frothMat.clone());
      dcl.position.y = -spacing + 0.02; dcl.scale.y = 0.2; dcl.renderOrder = 2;
      tg.add(dcl);
      // liquid spilling over the weir and falling down the downcomer
      const wmap = STREAK_V.clone(); wmap.needsUpdate = true; wmap.repeat.set(2.6, 1.3); wmap.offset.set(Math.random(), Math.random());
      const wmat = new THREE.MeshBasicMaterial({ color: 0x3aa0a8, map: wmap, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
      const fallH = spacing - 0.02;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(chord * 0.9, fallH), wmat);
      fall.rotation.y = Math.PI / 2; fall.position.set(dcX + 0.035, 0.07 - fallH / 2, 0); fall.renderOrder = 2;
      tg.add(fall);
      this.reg('tray:' + i, deck);
      // valve caps
      for (const [x, z] of caps) {
        m4.makeTranslation(x * side, y + 0.026, z);
        capInst.setMatrixAt(ci++, m4);
      }
      grp.add(tg);
      this.trays.push({ g: tg, deck, froth, dcl, side, frothMat, dclMat: dcl.material, tilt: 0, fmap, wmap, wmat, fall, frothH: 0.12 });
    }
    capInst.instanceMatrix.needsUpdate = true; capInst.castShadow = false;
    grp.add(capInst);
    this.capInst = capInst; this.capsPerTray = caps.length;

    // sump liquid (vertical cylinder in the bottom of the column)
    const sumpMat = new THREE.MeshStandardMaterial({ color: 0x2f8f9d, transparent: true, opacity: 0.7, roughness: 0.15, depthWrite: false });
    const sump = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 1, 48), sumpMat);
    sump.renderOrder = 2;
    this.sump = sump; this.groups.internals.add(this.pick(sump, { kind: 'sump' }));
    const sbot = new THREE.Mesh(new THREE.SphereGeometry(R - 0.02, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), sumpMat);
    sbot.scale.y = 0.5; sbot.position.y = COL.botTan; this.groups.internals.add(sbot);
    const smap = STREAK_H.clone(); smap.needsUpdate = true; smap.repeat.set(2.2, 2.2); smap.center.set(0.5, 0.5);
    this.sumpTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.025, 48), new THREE.MeshStandardMaterial({ color: 0x2f8f9d, map: smap, transparent: true, opacity: 0.9, roughness: 0.2, depthWrite: false }));
    this.sumpTop.rotation.x = -Math.PI / 2; this.sumpTop.renderOrder = 3; this.smap = smap;
    this.groups.internals.add(this.sumpTop);
    // feed distributor pipe
    const fd = rod(new THREE.Vector3(-0.5, trayY(8) + 0.32, 0.5), new THREE.Vector3(0.5, trayY(8) + 0.32, -0.5), 0.035, mat(C.steel, { metalness: 0.6 }));
    this.groups.internals.add(fd);
    // tray labels
    for (const i of [0, 4, 8, 13, 19]) {
      this.labels.push({ id: 'tray' + i, pos: new THREE.Vector3(-0.15, trayY(i) + 0.1, -0.15), cls: 'tray', onlyOpen: true, text: () => `Tray ${i + 1}` });
    }
  }

  // ---------- platforms, rails, ladder ----------
  buildPlatforms() {
    const g = this.groups.platforms;
    const planes = this.clip.column;
    const cut = { clippingPlanes: planes, clipIntersection: true, clipShadows: true };
    const gratMat = mat(C.grating, Object.assign({ roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }, cut));
    const railMat = mat(C.rail, Object.assign({ roughness: 0.5, metalness: 0.2 }, cut));
    const rIn = COL.Rins + 0.05, rOut = 2.0;
    for (const y of [7.1, 12.2, 16.4, 18.9]) {
      const top = y > 18;
      const sh = new THREE.Shape();
      const a0 = top ? 0 : -Math.PI * 0.15, a1 = top ? Math.PI * 2 : Math.PI * 1.35;
      const ro = top ? 1.2 : rOut;
      sh.absarc(0, 0, ro, a0, a1, false);
      sh.absarc(0, 0, rIn, a1, a0, true);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 48 });
      geo.rotateX(Math.PI / 2);
      const p = new THREE.Mesh(geo, gratMat); p.position.y = y; p.receiveShadow = true; p.castShadow = true;
      // rotate so the open gap faces the back
      p.rotation.y = Math.PI * 0.6;
      g.add(p);
      // handrails
      const arcLen = a1 - a0;
      for (const hy of [0.55, 1.05]) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(ro - 0.04, 0.025, 6, 64, arcLen), railMat);
        t.rotation.x = -Math.PI / 2; t.rotation.z = a0;
        const wrap = new THREE.Group(); wrap.add(t); wrap.position.y = y + hy; wrap.rotation.y = Math.PI * 0.6;
        g.add(wrap);
      }
      const posts = Math.round(arcLen / 0.35);
      for (let k = 0; k <= posts; k++) {
        const a = a0 + arcLen * k / posts + Math.PI * 0.6;
        const x = Math.cos(a) * (ro - 0.04), z = -Math.sin(a) * (ro - 0.04);
        g.add(rod(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 1.05, z), 0.022, railMat));
      }
      // toe board
      const tb = new THREE.Mesh(new THREE.CylinderGeometry(ro - 0.03, ro - 0.03, 0.12, 64, 1, true, a0 + Math.PI / 2 + Math.PI * 0.6, arcLen), railMat);
      tb.position.y = y + 0.06; g.add(tb);
      // brackets under platform
      for (let k = 0; k < 6; k++) {
        const a = a0 + (arcLen * (k + 0.5)) / 6 + Math.PI * 0.6;
        const p1 = new THREE.Vector3(Math.cos(a) * rIn, y - 0.7, -Math.sin(a) * rIn);
        const p2 = new THREE.Vector3(Math.cos(a) * (ro - 0.1), y - 0.03, -Math.sin(a) * (ro - 0.1));
        g.add(rod(p1, p2, 0.03, mat(C.struct, cut)));
      }
    }
    // caged ladder at the back-left
    const lad = new THREE.Group();
    const la = Math.PI * 1.05;
    const lr = COL.Rins + 0.35;
    const lx = Math.cos(la) * lr, lz = -Math.sin(la) * lr;
    const tang = new THREE.Vector3(Math.sin(la), 0, Math.cos(la)).multiplyScalar(0.22);
    const steel = mat(C.rail, { roughness: 0.5 });
    for (const s of [-1, 1]) lad.add(rod(new THREE.Vector3(lx + tang.x * s, 0.3, lz + tang.z * s), new THREE.Vector3(lx + tang.x * s, 19.9, lz + tang.z * s), 0.02, steel));
    for (let y = 0.6; y < 19.8; y += 0.3) lad.add(rod(new THREE.Vector3(lx - tang.x, y, lz - tang.z), new THREE.Vector3(lx + tang.x, y, lz + tang.z), 0.012, steel));
    const outward = new THREE.Vector3(Math.cos(la), 0, -Math.sin(la));
    for (let y = 2.4; y < 19.8; y += 0.9) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.012, 5, 24, Math.PI), steel);
      hoop.position.set(lx + outward.x * 0.05, y, lz + outward.z * 0.05);
      hoop.rotation.x = Math.PI / 2; hoop.rotation.z = -la - Math.PI / 2;
      lad.add(hoop);
    }
    g.add(lad);
  }

  // ---------- E-101 kettle reboiler ----------
  buildReboiler() {
    const g = this.groups.reboiler;
    const cx = 3.4, cy = 1.35, L = 3.4, r = 0.62;
    this.reb = { cx, cy, L, r };
    const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cy), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 40)];
    this.clip.reb = planes;
    const shellMat = mat(C.equip, { clippingPlanes: planes, clipIntersection: true, clipShadows: true, side: THREE.DoubleSide, roughness: 0.55 });
    const shell = cyl(r, L, 0, { material: shellMat, open: true, seg: 48 });
    shell.rotation.z = Math.PI / 2; shell.position.set(cx, cy, 0);
    g.add(this.pick(shell, { kind: 'reboiler' }));
    for (const s of [-1, 1]) {
      const hd = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
      hd.scale.y = 0.45; hd.rotation.z = -s * Math.PI / 2; hd.position.set(cx + s * L / 2, cy, 0);
      g.add(hd);
    }
    // channel head + flange on the steam end
    const ch = cyl(0.48, 0.5, C.equip); ch.rotation.z = Math.PI / 2; ch.position.set(cx + L / 2 + 0.45, cy - 0.12, 0); g.add(ch);
    const fl = cyl(0.56, 0.08, C.equip); fl.rotation.z = Math.PI / 2; fl.position.set(cx + L / 2 + 0.2, cy - 0.12, 0); g.add(fl);
    // saddles
    for (const s of [-1, 1]) {
      const sd = box(0.25, 0.75, 1.0, C.struct); sd.position.set(cx + s * L * 0.3, 0.55, 0); g.add(sd);
    }
    // tube bundle (lower part of the kettle)
    const tubeGeo = new THREE.CylinderGeometry(0.035, 0.035, L - 0.1, 8);
    const pos = [];
    for (let yy = -0.42; yy <= 0.02; yy += 0.11) for (let zz = -0.4; zz <= 0.4; zz += 0.11) if (yy * yy + zz * zz < 0.46 * 0.46) pos.push([yy, zz]);
    this.rebTubeMat = mat(C.tube, { roughness: 0.4, metalness: 0.6 });
    const tubes = new THREE.InstancedMesh(tubeGeo, this.rebTubeMat, pos.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    pos.forEach(([yy, zz], k) => { m4.compose(new THREE.Vector3(cx + 0.05, cy + yy, zz), q, new THREE.Vector3(1, 1, 1)); tubes.setMatrixAt(k, m4); });
    tubes.castShadow = true;
    g.add(this.pick(tubes, { kind: 'reboiler' }));
    this.rebTubes = tubes;
    // boiling liquid pool (segment, rebuilt when level changes)
    this.rebLiqMat = new THREE.MeshStandardMaterial({ color: 0x2f8f9d, transparent: true, opacity: 0.5, roughness: 0.1, depthWrite: false });
    this.rebLiq = null; this._rebLevel = -1;
    this.setHorizontalLevel('rebLiq', this.rebLiqMat, r - 0.03, L - 0.06, 0.8, new THREE.Vector3(cx, cy, 0), g);
    // nozzles
    const nz = cyl(0.13, 0.4, C.equip); nz.position.set(cx - 0.9, cy + r + 0.15, 0); g.add(nz);
    const nz2 = cyl(0.1, 0.35, C.equip); nz2.position.set(cx - 0.6, cy - r - 0.12, 0); g.add(nz2);
    this.labels.push({ id: 'e101', pos: new THREE.Vector3(cx + 0.4, cy + r + 0.55, 0.3), cls: 'equip', text: (s) => `E-101 reboiler · ${(s.reb.Q / 3.6).toFixed(0)} kW` });
  }

  setHorizontalLevel(key, material, r, L, frac, center, parent, alongZ) {
    const h = 2 * r * Math.max(0.02, Math.min(0.98, frac));
    const geo = new THREE.ExtrudeGeometry(levelShape(r, h), { depth: L, bevelEnabled: false, curveSegments: 32 });
    geo.translate(0, 0, -L / 2);
    if (!alongZ) geo.rotateY(Math.PI / 2);
    if (this[key]) { this[key].geometry.dispose(); this[key].geometry = geo; return; }
    const m = new THREE.Mesh(geo, material); m.position.copy(center); m.renderOrder = 2;
    parent.add(m); this[key] = m;
  }

  // ---------- overhead steel structure (holds E-102 and V-101) ----------
  buildOverheadStructure() {
    const g = this.groups.structure;
    const x0 = -5.6, x1 = -2.6, z0 = -2.3, z1 = 2.3;
    this.st = { x0, x1, z0, z1 };
    const steel = mat(C.struct, { roughness: 0.55, metalness: 0.35 });
    const rail = mat(C.rail, { roughness: 0.5 });
    const levels = [4.2, 8.0];
    for (const x of [x0, x1]) for (const z of [z0, z1]) {
      const col = box(0.22, 9.4, 0.22, 0, { material: steel }); col.position.set(x, 4.7, z); g.add(col);
    }
    for (const y of levels) {
      for (const z of [z0, z1]) { const b = box(x1 - x0, 0.25, 0.16, 0, { material: steel }); b.position.set((x0 + x1) / 2, y - 0.12, z); g.add(b); }
      for (const x of [x0, x1]) { const b = box(0.16, 0.25, z1 - z0, 0, { material: steel }); b.position.set(x, y - 0.12, 0); g.add(b); }
      const deck = box(x1 - x0 + 0.2, 0.05, z1 - z0 + 0.2, C.grating, { m: { roughness: 0.75, metalness: 0.4 } });
      deck.position.set((x0 + x1) / 2, y, 0); g.add(deck);
      // handrails around deck
      const pts = [[x0 - 0.1, z0 - 0.1], [x1 + 0.1, z0 - 0.1], [x1 + 0.1, z1 + 0.1], [x0 - 0.1, z1 + 0.1], [x0 - 0.1, z0 - 0.1]];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        for (const hy of [0.55, 1.05]) g.add(rod(new THREE.Vector3(ax, y + hy, az), new THREE.Vector3(bx, y + hy, bz), 0.025, rail));
        const segs = Math.round(Math.hypot(bx - ax, bz - az) / 0.9);
        for (let s = 0; s <= segs; s++) {
          const px = ax + (bx - ax) * s / segs, pz = az + (bz - az) * s / segs;
          g.add(rod(new THREE.Vector3(px, y, pz), new THREE.Vector3(px, y + 1.05, pz), 0.022, rail));
        }
      }
    }
    // diagonal bracing
    for (const z of [z0, z1]) {
      g.add(rod(new THREE.Vector3(x0, 0.3, z), new THREE.Vector3(x1, 4.0, z), 0.05, steel));
      g.add(rod(new THREE.Vector3(x1, 4.3, z), new THREE.Vector3(x0, 7.8, z), 0.05, steel));
    }
    // stair-ish ladder on the outside
    for (const s of [-0.22, 0.22]) g.add(rod(new THREE.Vector3(x0 - 0.35, 0.3, s - 1.2), new THREE.Vector3(x0 - 0.35, 9.0, s - 1.2), 0.02, rail));
    for (let y = 0.6; y < 9; y += 0.3) g.add(rod(new THREE.Vector3(x0 - 0.35, y, -1.42), new THREE.Vector3(x0 - 0.35, y, -0.98), 0.012, rail));
  }

  // ---------- E-102 condenser ----------
  buildCondenser() {
    const g = this.groups.condenser;
    const cx = -4.1, cy = 8.75, L = 3.6, r = 0.55;
    this.cond = { cx, cy, L, r };
    const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cy), new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx), new THREE.Plane(new THREE.Vector3(0, 0, -1), 40)];
    this.clip.cond = planes;
    const shellMat = mat(C.equip, { clippingPlanes: planes, clipIntersection: true, clipShadows: true, side: THREE.DoubleSide, roughness: 0.55 });
    const shell = cyl(r, L, 0, { material: shellMat, open: true, seg: 48 });
    shell.rotation.x = Math.PI / 2; shell.position.set(cx, cy, 0);
    g.add(this.pick(shell, { kind: 'condenser' }));
    for (const s of [-1, 1]) {
      const head = cyl(r + 0.05, 0.45, C.equip); head.rotation.x = Math.PI / 2; head.position.set(cx, cy, s * (L / 2 + 0.22)); g.add(head);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r + 0.05, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.equip));
      cap.scale.y = 0.35; cap.rotation.x = s * Math.PI / 2; cap.position.set(cx, cy, s * (L / 2 + 0.45)); g.add(cap);
      const sd = box(0.9, 0.3, 0.25, C.struct); sd.position.set(cx, cy - r - 0.05, s * L * 0.3); g.add(sd);
    }
    const tubeGeo = new THREE.CylinderGeometry(0.03, 0.03, L, 8);
    const pos = [];
    for (let xx = -0.44; xx <= 0.44; xx += 0.1) for (let yy = -0.44; yy <= 0.44; yy += 0.1) if (xx * xx + yy * yy < 0.44 * 0.44) pos.push([xx, yy]);
    this.condTubeMat = mat(C.tubeCond, { roughness: 0.35, metalness: 0.7 });
    const tubes = new THREE.InstancedMesh(tubeGeo, this.condTubeMat, pos.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    pos.forEach(([xx, yy], k) => { m4.compose(new THREE.Vector3(cx + xx, cy + yy, 0), q, new THREE.Vector3(1, 1, 1)); tubes.setMatrixAt(k, m4); });
    g.add(this.pick(tubes, { kind: 'condenser' }));
    this.condTubePos = pos;
    this.labels.push({ id: 'e102', pos: new THREE.Vector3(cx, cy + r + 0.5, 0), cls: 'equip', text: (s) => `E-102 condenser · ${(s.top.Qc / 3.6).toFixed(0)} kW` });
  }

  // ---------- V-101 reflux drum ----------
  buildDrum() {
    const g = this.groups.drum;
    const cx = -4.1, cy = 5.0, L = 3.0, r = 0.55;
    this.drumG = { cx, cy, L, r };
    const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cy + 0.1), new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx), new THREE.Plane(new THREE.Vector3(0, 0, -1), 40)];
    this.clip.drum = planes;
    const shellMat = mat(C.equip, { clippingPlanes: planes, clipIntersection: true, clipShadows: true, side: THREE.DoubleSide, roughness: 0.55 });
    const shell = cyl(r, L, 0, { material: shellMat, open: true, seg: 48 });
    shell.rotation.x = Math.PI / 2; shell.position.set(cx, cy, 0);
    g.add(this.pick(shell, { kind: 'drum' }));
    for (const s of [-1, 1]) {
      const hd = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
      hd.scale.y = 0.45; hd.rotation.x = s * Math.PI / 2; hd.position.set(cx, cy, s * L / 2); g.add(hd);
      const sd = box(0.9, 0.35, 0.22, C.struct); sd.position.set(cx, cy - r - 0.08, s * L * 0.3); g.add(sd);
    }
    // level gauge (sight glass) on the front
    const lg = box(0.05, 0.9, 0.05, 0x4a5560); lg.position.set(cx + r + 0.12, cy, 0.9); g.add(lg);
    this.drumLiqMat = new THREE.MeshStandardMaterial({ color: 0xf0a030, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false });
    this.drumLiq = null;
    this.setHorizontalLevel('drumLiq', this.drumLiqMat, r - 0.03, L - 0.05, 0.5, new THREE.Vector3(cx, cy, 0), g, true);
    this.labels.push({ id: 'v101', pos: new THREE.Vector3(cx + 0.2, cy + r + 0.35, 0.8), cls: 'equip', text: (s) => `V-101 reflux drum · ${s.meas.drumL.toFixed(0)}%` });
  }

  // ---------- pumps ----------
  makePump(x, z, rotY, tag) {
    const g = new THREE.Group();
    const base = box(1.5, 0.12, 0.6, C.struct); base.position.y = 0.31; g.add(base);
    const motor = cyl(0.2, 0.6, C.motor, { m: { roughness: 0.45, metalness: 0.4 } }); motor.rotation.z = Math.PI / 2; motor.position.set(-0.35, 0.6, 0); g.add(motor);
    for (let k = 0; k < 6; k++) { const fin = box(0.6, 0.02, 0.44, C.motor); fin.position.set(-0.35, 0.6, 0); fin.rotation.x = k * Math.PI / 6; g.add(fin); }
    const guard = box(0.28, 0.28, 0.3, C.rail); guard.position.set(0.1, 0.6, 0); g.add(guard);
    const volute = cyl(0.27, 0.2, C.equip); volute.rotation.z = Math.PI / 2; volute.position.set(0.42, 0.62, 0); g.add(volute);
    const suct = cyl(0.09, 0.3, C.equip); suct.rotation.z = Math.PI / 2; suct.position.set(0.65, 0.62, 0); g.add(suct);
    const dis = cyl(0.07, 0.35, C.equip); dis.position.set(0.42, 0.95, 0); g.add(dis);
    g.position.set(x, 0, z); g.rotation.y = rotY;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    return g;
  }
  buildPumps() {
    const g = this.groups.pumps;
    this.p101 = this.makePump(-3.0, 3.2, Math.PI / 2, 'P-101');
    this.p102 = this.makePump(1.3, 2.6, 0, 'P-102');
    g.add(this.p101, this.p102);
    this.p101.traverse((o) => o.isMesh && this.pick(o, { kind: 'p101' }));
    this.p102.traverse((o) => o.isMesh && this.pick(o, { kind: 'p102' }));
    this.labels.push({ id: 'p101', pos: new THREE.Vector3(-3.0, 1.5, 3.2), cls: 'equip', text: () => 'P-101 reflux pump' });
    this.labels.push({ id: 'p102', pos: new THREE.Vector3(1.3, 1.5, 2.6), cls: 'equip', text: (s) => `P-102 bottoms pump${s.faults.bottomsPump.active ? ' · cavitating' : ''}` });
  }

  // ---------- control valve ----------
  makeValve(pos, axis, tag) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), mat(C.steel, { metalness: 0.6, roughness: 0.4 })); g.add(body);
    for (const s of [-1, 1]) { const f = cyl(0.17, 0.05, C.steel); f.rotation.z = Math.PI / 2; f.position.x = s * 0.2; g.add(f); }
    const bonnet = cyl(0.06, 0.25, C.steel); bonnet.position.y = 0.2; g.add(bonnet);
    const yoke = box(0.03, 0.3, 0.16, C.steel); yoke.position.y = 0.45; g.add(yoke);
    const act = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.actuator, { roughness: 0.45, metalness: 0.3 }));
    act.position.y = 0.62; act.scale.y = 0.5; g.add(act);
    const actb = cyl(0.22, 0.05, C.actuator); actb.position.y = 0.62; g.add(actb);
    const ind = box(0.035, 0.07, 0.035, C.accent, { m: { emissive: C.accent, emissiveIntensity: 0.4 } }); ind.position.set(0.04, 0.45, 0.1); g.add(ind);
    g.position.copy(pos);
    if (axis === 'z') g.rotation.y = Math.PI / 2;
    if (axis === 'y') g.rotation.z = Math.PI / 2;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; this.pick(o, { kind: 'valve', tag }); } });
    this.groups.valves.add(g);
    this.regGroup('valve:' + tag, g);
    this.valves[tag] = { g, ind, act: [act.material, actb.material] };
    return g;
  }

  // ---------- piping ----------
  pipe(points, r, color, flowColor, key, opts = {}) {
    const path = new THREE.CurvePath();
    const pts = points.map((p) => new THREE.Vector3(...p));
    let len = 0;
    for (let k = 0; k < pts.length - 1; k++) { path.add(new THREE.LineCurve3(pts[k], pts[k + 1])); len += pts[k].distanceTo(pts[k + 1]); }
    const segs = Math.max(8, Math.round(len * 6));
    const geo = new THREE.TubeGeometry(path, segs, r, 14, false);
    const m = new THREE.Mesh(geo, mat(color, { roughness: 0.55, metalness: 0.2 }));
    m.castShadow = true; m.receiveShadow = true;
    this.groups.piping.add(m);
    const elbowMat = m.material;
    for (let k = 1; k < pts.length - 1; k++) { const e = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 14, 10), elbowMat); e.position.copy(pts[k]); this.groups.piping.add(e); }
    // flanges every few meters
    // flow markers
    let flow = null;
    if (flowColor != null) {
      const tex = DASH.clone(); tex.needsUpdate = true; tex.repeat.set(len / 0.45, 1);
      const fm = new THREE.MeshBasicMaterial({ color: flowColor, alphaMap: tex, transparent: true, opacity: 0.9, depthWrite: false });
      flow = new THREE.Mesh(new THREE.TubeGeometry(path, segs, r * 1.08, 10, false), fm);
      flow.renderOrder = 3;
      this.groups.flow.add(flow);
      this.pipes.push({ key, tex, len, mesh: flow, mat: fm, dir: opts.dir || 1 });
    }
    if (opts.pick) this.pick(m, opts.pick);
    this.reg('pipe:' + key, m);
    return m;
  }

  buildPiping() {
    const { R, Rins, topTan, botTan } = COL;
    const rb = this.reb, cd = this.cond, dr = this.drumG, st = this.st;
    const P = C.pipe;
    // overhead vapor line: top head -> over -> down to condenser top inlet
    const yTop = topTan + 0.45;
    this.pipe([[0, yTop - 0.1, 0], [0, yTop + 0.75, 0], [-1.0, yTop + 0.75, 0], [-1.0, 11.6, 0], [cd.cx, 11.6, 0], [cd.cx, cd.cy + cd.r, 0]], 0.2, P, 0xffffff, 'overhead');
    const neck = cyl(0.22, 0.6, C.equip); neck.position.set(0, yTop, 0); this.groups.piping.add(neck);
    // pipe support from column
    // condensate: condenser bottom -> drum top
    this.pipe([[cd.cx, cd.cy - cd.r, -0.9], [cd.cx, dr.cy + dr.r, -0.9]], 0.09, P, 0xf0a030, 'condensate');
    // drum vent / PSV line to flare header
    this.pipe([[cd.cx + 0.3, cd.cy + cd.r, 1.2], [cd.cx + 0.3, 10.6, 1.2], [cd.cx + 0.3, 10.6, 2.6], [cd.cx + 0.3, 2.6, 2.6]], 0.06, 0xbfb59e, null, 'flare');
    const psv = cyl(0.12, 0.35, C.accent); psv.position.set(cd.cx + 0.3, 10.2, 1.2); this.groups.piping.add(psv);
    this.labels.push({ id: 'psv', pos: new THREE.Vector3(cd.cx + 0.3, 10.7, 1.4), cls: 'inst', text: (s) => `PSV-101${s.top.relief > 0 ? ' LIFTING' : ''}`, alarm: (s) => s.top.relief > 0 });
    // drum outlet -> reflux pump suction
    const pmp = { x: -3.0, z: 3.2 };
    this.pipe([[dr.cx, dr.cy - dr.r, 1.0], [dr.cx, 0.62, 1.0], [dr.cx, 0.62, pmp.z - 0.65], [pmp.x, 0.62, pmp.z - 0.65]], 0.08, P, 0xf0a030, 'drumOut');
    // reflux: pump discharge -> FV-140 -> up the column -> top tray
    this.pipe([[pmp.x, 0.95, pmp.z - 0.42], [pmp.x, 1.5, pmp.z - 0.42], [-1.6, 1.5, pmp.z - 0.42], [-1.6, 1.5, 0.95], [-1.6, 17.55, 0.95], [-Rins * 0.6, 17.55, 0.6]], 0.07, P, 0xf0a030, 'reflux');
    this.makeValve(new THREE.Vector3(-2.2, 1.5, pmp.z - 0.42), 'x', 'FV-140');
    // distillate: tee off to product (LV-120)
    this.pipe([[-2.6, 1.5, pmp.z - 0.42], [-2.6, 1.5, 4.4], [-6.5, 1.5, 4.4]], 0.06, P, 0xf0a030, 'distillate');
    this.makeValve(new THREE.Vector3(-4.6, 1.5, 4.4), 'x', 'LV-120');
    // cooling water to/from condenser
    this.pipe([[-7.5, 0.5, -1.4], [cd.cx - 1.2, 0.5, -1.4], [cd.cx - 1.2, cd.cy - 0.3, -1.4], [cd.cx - 1.2, cd.cy - 0.3, -cd.L / 2 - 0.45], [cd.cx - 0.3, cd.cy - 0.3, -cd.L / 2 - 0.45]], 0.12, C.cwPipe, 0x4aa3df, 'cwIn');
    this.pipe([[cd.cx - 0.3, cd.cy + 0.3, -cd.L / 2 - 0.45], [cd.cx - 1.6, cd.cy + 0.3, -cd.L / 2 - 0.45], [cd.cx - 1.6, cd.cy + 0.3, -1.9], [cd.cx - 1.6, 0.8, -1.9], [-7.5, 0.8, -1.9]], 0.12, C.cwPipe, 0x6fb7e0, 'cwOut');
    this.makeValve(new THREE.Vector3(cd.cx - 1.6, 2.4, -1.9), 'y', 'PV-110');
    // feed: from the right side up to tray 9 nozzle, with FV-101 at grade
    const yF = trayY(8) + 0.32;
    this.pipe([[7.5, 0.6, 3.6], [1.75, 0.6, 3.6], [1.75, 0.6, -1.15], [1.75, yF, -1.15], [Rins * 0.8, yF, -Rins * 0.55]], 0.08, P, 0x9b7bd4, 'feed');
    this.makeValve(new THREE.Vector3(3.8, 0.6, 3.6), 'x', 'FV-101');
    // reboiler: column bottom -> kettle inlet; kettle vapor -> column
    this.pipe([[0.2, botTan - 0.3, 0.2], [0.2, 0.75, 0.2], [rb.cx - 0.6, 0.75, 0.2], [rb.cx - 0.6, rb.cy - rb.r - 0.1, 0.2]], 0.1, P, 0x2f8f9d, 'rebIn');
    this.pipe([[rb.cx - 0.9, rb.cy + rb.r + 0.3, 0], [rb.cx - 0.9, 4.75, 0], [R + 0.2, 4.75, 0]], 0.16, P, 0xffffff, 'rebVap');
    // bottoms product: column bottom -> P-102 -> LV-130 -> away
    this.pipe([[-0.2, botTan - 0.3, 0.2], [-0.2, 0.62, 0.2], [-0.2, 0.62, 2.6], [1.0, 0.62, 2.6]], 0.08, P, 0x2f8f9d, 'botSuct');
    this.pipe([[1.72, 0.95, 2.6], [1.72, 1.4, 2.6], [1.72, 1.4, 4.2], [7.5, 1.4, 4.2]], 0.07, P, 0x2f8f9d, 'bottoms');
    this.makeValve(new THREE.Vector3(3.6, 1.4, 4.2), 'x', 'LV-130');
    // steam: header -> TV-105 -> reboiler channel; condensate out
    this.pipe([[7.5, 2.9, -1.2], [rb.cx + rb.L / 2 + 0.55, 2.9, -1.2], [rb.cx + rb.L / 2 + 0.55, 2.9, -0.0], [rb.cx + rb.L / 2 + 0.55, rb.cy + 0.25, 0]], 0.1, C.steamPipe, 0xff8a5c, 'steam');
    this.makeValve(new THREE.Vector3(6.2, 2.9, -1.2), 'x', 'TV-105');
    this.pipe([[rb.cx + rb.L / 2 + 0.55, rb.cy - 0.45, 0], [rb.cx + rb.L / 2 + 0.55, 0.45, 0], [7.5, 0.45, 0]], 0.05, C.steamPipe, null, 'cond');
    // TE-105 thermowell into tray 5
    {
      const twY = trayY(4) + 0.14, a = Math.PI / 4;
      const inner = new THREE.Vector3(Math.cos(a) * 0.22, twY, Math.sin(a) * 0.22);
      const outer = new THREE.Vector3(Math.cos(a) * (Rins + 0.28), twY, Math.sin(a) * (Rins + 0.28));
      const tw = rod(inner, outer, 0.028, mat(0xb9c0c6, { metalness: 0.75, roughness: 0.3 }));
      const head = box(0.16, 0.18, 0.16, 0x2f6fb0, { m: { metalness: 0.3, roughness: 0.5 } }); head.position.copy(outer);
      const conduit = rod(outer, outer.clone().add(new THREE.Vector3(0, -1.2, 0)), 0.02, mat(0x5f6870));
      this.groups.piping.add(tw, head, conduit);
      this.pick(tw, { kind: 'tray', i: 4 }); this.pick(head, { kind: 'tray', i: 4 });
      this.reg('thermowell', tw, head);
      this.thermowellPos = outer.clone();
    }
    // instrument tags
    const L = this.labels;
    L.push({ id: 'pi110', pos: new THREE.Vector3(0.5, topTan + 1.4, 0.3), cls: 'inst', text: (s) => `PI-110  ${s.top.P.toFixed(1)} kPa${trend(s, 'P', 1)}`, alarm: (s) => s.top.P > 150 });
    L.push({ id: 'ti105', pos: this.thermowellPos.clone().add(new THREE.Vector3(0.1, 0.35, 0.1)), cls: 'inst', text: (s) => `TI-105  ${s.meas.T5.toFixed(1)} °C${trend(s, 'T5', 0.3)}`, alarm: (s) => Math.abs(s.ctl.TIC105.pv - s.ctl.TIC105.sp) > 1.5 });
    L.push({ id: 'pdi', pos: new THREE.Vector3(Rins + 0.2, 12.0, 0.4), cls: 'inst', text: (s) => `PDI-112  ΔP ${s.dP.toFixed(1)} kPa${trend(s, 'dP', 0.25)}`, alarm: (s) => s.dP > 22 });
    L.push({ id: 'li130', pos: new THREE.Vector3(Rins + 0.2, 4.3, 0.4), cls: 'inst', text: (s) => `LI-130  sump ${s.meas.sumpL.toFixed(0)}%${trend(s, 'sumpL', 3)}`, alarm: (s) => s.meas.sumpL > 80 || s.meas.sumpL < 15 });
    L.push({ id: 'tv105', pos: new THREE.Vector3(6.2, 3.8, -1.2), cls: 'valve', text: (s) => `TV-105 steam  ${s.valves.TV105.toFixed(0)}%${trend(s, 'steamV', 1.5)}`, alarm: (s) => s.valves.TV105 > 92 || s.trip.steam });
    L.push({ id: 'pv110', pos: new THREE.Vector3(cd.cx - 1.6, 3.3, -1.9), cls: 'valve', text: (s) => `PV-110 CW  ${s.valves.PV110.toFixed(0)}%${trend(s, 'cwV', 1.5)}`, alarm: (s) => s.valves.PV110 > 92 });
    L.push({ id: 'fv140', pos: new THREE.Vector3(-2.2, 2.4, pmp.z - 0.42), cls: 'valve', text: (s) => `FV-140 reflux  ${s.flows.LR.toFixed(0)} kmol/h${trend(s, 'LR', 2)}`, alarm: (s) => s.faults.refluxValveFail.active });
    L.push({ id: 'fv101', pos: new THREE.Vector3(3.8, 1.5, 3.6), cls: 'valve', text: (s) => `FV-101 feed  ${s.flows.F.toFixed(0)} kmol/h` });
    L.push({ id: 'lv130', pos: new THREE.Vector3(3.6, 2.3, 4.2), cls: 'valve', text: (s) => `LV-130 bottoms  ${s.flows.B.toFixed(0)} kmol/h${trend(s, 'B', 2)}`, alarm: (s) => s.valves.LV130 > 95 });
    L.push({ id: 'lv120', pos: new THREE.Vector3(-4.6, 2.4, 4.4), cls: 'valve', text: (s) => `LV-120 distillate  ${s.flows.D.toFixed(0)} kmol/h` });
    L.push({ id: 'ai150', pos: new THREE.Vector3(-6.3, 2.1, 4.4), cls: 'anal', text: (s) => `AI-150  ${(s.drum.x * 100).toFixed(2)}% Bz${trend(s, 'xD', 0.002)}`, alarm: (s) => s.drum.x < s.d.specD });
    L.push({ id: 'ai160', pos: new THREE.Vector3(7.0, 2.0, 4.2), cls: 'anal', text: (s) => `AI-160  ${(s.reb.x * 100).toFixed(2)}% Bz${trend(s, 'xB', 0.002)}`, alarm: (s) => s.reb.x > s.d.specB });
  }

  // ---------- particles: vapor bubbles, entrained droplets, weeping, downcomer liquid ----------
  buildParticles() {
    const n = COL.n;
    this.bubPer = 70;
    const total = this.bubPer * (n + 1);
    const bgeo = new THREE.SphereGeometry(1, 8, 6);
    const bmat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0, depthWrite: false });
    this.bub = new THREE.InstancedMesh(bgeo, bmat, total);
    this.bub.frustumCulled = false; this.bub.renderOrder = 4;
    this.bubData = [];
    for (let k = 0; k < total; k++) {
      const zone = Math.floor(k / this.bubPer);
      const slot = k % this.bubPer;
      let x, z;
      do { x = (Math.random() * 2 - 1) * (COL.dcX - 0.06); z = (Math.random() * 2 - 1) * (COL.R - 0.08); } while (x * x + z * z > (COL.R - 0.08) ** 2);
      this.bubData.push({ zone, slot, x, z, ph: Math.random(), sp: 0.7 + Math.random() * 0.6, sz: 0.012 + Math.random() * 0.016 });
    }
    this.internals.add(this.bub);
    // droplets: entrainment (up) and weeping (down) + downcomer flow
    const dgeo = new THREE.SphereGeometry(1, 6, 5);
    const dmat = new THREE.MeshStandardMaterial({ color: 0x3aa0a8, roughness: 0.2, transparent: true, opacity: 0.9, depthWrite: false });
    this.dropPer = 30;
    const dtotal = this.dropPer * n;
    this.drop = new THREE.InstancedMesh(dgeo, dmat, dtotal);
    this.drop.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(dtotal * 3), 3);
    this.drop.frustumCulled = false; this.drop.renderOrder = 4;
    this.dropData = [];
    for (let k = 0; k < dtotal; k++) this.dropData.push({ tray: Math.floor(k / this.dropPer), ph: Math.random(), x: (Math.random() * 2 - 1) * 0.35, z: (Math.random() * 2 - 1) * 0.45, sp: 0.6 + Math.random() * 0.8 });
    this.internals.add(this.drop);
    // reboiler boiling bubbles
    const rb = this.reb;
    this.rbub = new THREE.InstancedMesh(bgeo, bmat, 160);
    this.rbub.frustumCulled = false; this.rbub.renderOrder = 4;
    this.rbubData = Array.from({ length: 160 }, () => ({ x: rb.cx + (Math.random() - 0.5) * (rb.L - 0.4), z: (Math.random() - 0.5) * 0.8, ph: Math.random(), sp: 0.5 + Math.random() }));
    this.groups.reboiler.add(this.rbub);
    // condenser CW streaks inside tubes
    const cd = this.cond;
    this.cwp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.25), new THREE.MeshBasicMaterial({ color: 0x4aa3df, transparent: true, opacity: 0.85 }), this.condTubePos.length * 2);
    this.cwp.frustumCulled = false;
    this.cwpData = [];
    this.condTubePos.forEach(([xx, yy]) => { for (let j = 0; j < 2; j++) this.cwpData.push({ x: cd.cx + xx, y: cd.cy + yy, ph: Math.random() }); });
    this.groups.condenser.add(this.cwp);
  }

  // ---------- open / close the cutaway ----------
  setOpen(t) {
    this.openT = t;
    const e = t * t * (3 - 2 * t);
    // column: wedge peels from top to bottom (clipped where x>0, z>0, y>h)
    this.clip.column[2].constant = e > 0 ? 20.5 - e * 22 : 40;
    // horizontal vessels: wedge slides along their length
    this.clip.reb[2].constant = e > 0 ? (this.reb.cx + this.reb.L / 2 + 1) - e * (this.reb.L + 2) : 40;
    this.clip.cond[2].constant = e > 0 ? (this.cond.L / 2 + 1) - e * (this.cond.L + 2) : 40;
    this.clip.drum[2].constant = e > 0 ? (this.drumG.L / 2 + 1) - e * (this.drumG.L + 2) : 40;
    const vis = e > 0.02;
    this.internals.visible = true;
    this._open = vis;
  }

  // ---------- fault highlights: pulse the affected equipment ----------
  setHighlights(list) {
    for (const m of this._hiMats || []) { m.emissive.copy(m.userData.e0); m.emissiveIntensity = m.userData.ei0; }
    this._hiMats = [];
    for (const h of list) {
      for (const ms of this.targets[h.key] || []) {
        const m = ms.material; if (!m || !m.emissive) continue;
        if (!m.userData.e0) { m.userData.e0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity; }
        m.emissive.set(h.color); m.emissiveIntensity = h.k; this._hiMats.push(m);
      }
    }
  }

  // radar-ping beacons at fault locations, drawn on top of everything
  updateBeacons(list, camera, dt) {
    if (!this._beacons) { this.beaconGroup = new THREE.Group(); this.root.add(this.beaconGroup); this._beacons = new Map(); this._ringGeo = new THREE.RingGeometry(0.93, 1.0, 64); this._bt = 0; }
    this._bt += dt;
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let o = this._beacons.get(b.id);
      if (!o) {
        o = { g: new THREE.Group(), rings: [] };
        for (let k = 0; k < 3; k++) {
          const m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: b.color, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
          m.renderOrder = 20; o.g.add(m); o.rings.push(m);
        }
        o.dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: b.color, depthTest: false, transparent: true }));
        o.dot.renderOrder = 21; o.g.add(o.dot);
        this.beaconGroup.add(o.g); this._beacons.set(b.id, o);
      }
      o.g.position.copy(b.pos);
      o.rings.forEach((r, k) => {
        const ph = (this._bt * 0.55 + k / 3) % 1;
        r.quaternion.copy(camera.quaternion);
        const sc = b.size * (0.15 + ph * 0.75); r.scale.set(sc, sc, sc);
        r.material.opacity = (1 - ph) * 0.7; r.material.color.set(b.color);
      });
      o.dot.material.color.set(b.color); o.dot.material.opacity = 0.6 + 0.4 * Math.sin(this._bt * 6);
    }
    for (const [id, o] of this._beacons) if (!seen.has(id)) { this.beaconGroup.remove(o.g); this._beacons.delete(id); }
  }

  // ---------- per-frame update ----------
  update(sim, dtReal, colorMode, selected) {
    this._clock += dtReal;
    const n = COL.n, tr = sim.trays, d = sim.d;
    const col = new THREE.Color();
    const colorFor = (i, isSump, isDrum) => {
      const x = isSump ? sim.reb.x : isDrum ? sim.drum.x : tr[i].x;
      const T = isSump ? sim.reb.T : isDrum ? sim.drum.T : tr[i].T;
      if (colorMode === 'temperature') {
        const k = Math.max(0, Math.min(1, (T - 78) / 42));
        return col.setHSL(0.62 - 0.62 * k, 0.75, 0.5);
      }
      if (colorMode === 'hydraulics' && !isSump && !isDrum) {
        const t = tr[i];
        if (t.damaged) return col.set(0x555555);
        if (t.weeping) return col.set(0x9fd3ff);
        const f = t.flood;
        const k = Math.max(0, Math.min(1, (f - 0.55) / 0.5));
        return col.setHSL(0.36 - 0.36 * k, 0.75, 0.48);
      }
      // composition: toluene (teal) -> benzene (amber)
      return col.setHSL(0.53 - 0.44 * Math.pow(x, 0.85), 0.78, 0.5 + 0.06 * x);
    };

    // trays
    for (let i = 0; i < n; i++) {
      const t = tr[i], v = this.trays[i];
      const clear = Math.max(0.0, (t.M - 0.4) / 0.8) * 0.07;
      let froth = clear * 3.2 + 0.05;
      if (t.flood > 0.85) froth += (t.flood - 0.85) * 1.2;
      if (t.liquidFull) froth = Math.min(0.56, 0.12 + (t.M - 1.5) * 0.6);
      if (t.damaged) froth = 0.01;
      froth = Math.min(0.57, froth);
      if (sim.flows.VB < 5) froth = Math.min(froth, clear + 0.015); // no vapor: clear liquid, no froth
      v.frothH += (froth - v.frothH) * Math.min(1, dtReal * 3);
      const Lr = Math.max(0, t.L) / 150, alive = Math.min(1, sim.flows.VB / 60);
      const bob = 1 + (0.07 + (t.flooding ? 0.12 : 0)) * alive * Math.sin(this._clock * (4.5 + i * 0.13) + i * 1.7);
      v.froth.scale.y = Math.max(0.006, v.frothH * bob);
      // liquid crosses the deck toward the outlet weir; speed follows the tray's liquid rate
      v.fmap.offset.x -= dtReal * (0.06 + 0.42 * Math.min(1.6, Lr)) * (t.flooding ? 0.35 : 1);
      v.fmap.offset.y += dtReal * 0.03 * Math.sin(this._clock * 0.7 + i);
      v.wmap.offset.y += dtReal * (0.25 + 1.3 * Math.min(1.6, Lr));
      v.fall.visible = t.L > 2 && !t.damaged;
      const c = colorFor(i);
      v.wmat.color.copy(c); v.wmat.opacity = 0.35 + Math.min(0.4, Lr * 0.3);
      v.frothMat.color.copy(c);
      v.frothMat.opacity = 0.62 + Math.min(0.3, froth * 0.6);
      // downcomer backup
      const back = Math.min(0.57, 0.12 + 0.22 * (t.L / 150) + (t.flood > 0.9 ? (t.flood - 0.9) * 1.5 : 0) + (t.liquidFull ? 0.4 : 0));
      v.dcl.scale.y += (back - v.dcl.scale.y) * Math.min(1, dtReal * 3);
      v.dclMat.color.copy(c); v.dclMat.opacity = 0.5;
      // damaged tray: deck tilts and hangs
      const tilt = t.damaged ? 0.55 : 0;
      v.tilt += (tilt - v.tilt) * Math.min(1, dtReal * 2);
      v.deck.rotation.y = 0; v.deck.rotation.z = 0;
      v.deck.rotation.x = -Math.PI / 2 + v.tilt * 0.25;
      v.deck.position.y = -v.tilt * 0.12;
      v.froth.visible = !t.damaged || v.tilt < 0.3;
      // fouling tint on deck
      const foul = 1 - t.phi;
      v.deck.material.color.set(C.trayDeck).lerp(new THREE.Color(0x2a1f17), Math.min(1, foul * 1.8));
      const sel = selected && selected.kind === 'tray' && selected.i === i;
      v.deck.material.emissive.set(sel ? 0x2266ff : 0x000000); v.deck.material.emissiveIntensity = sel ? 0.55 : 0;
    }
    // sump
    const sumpH = Math.max(0.02, (sim.meas.sumpL / 100) * 1.75);
    this.sump.scale.y = sumpH;
    this.sump.position.y = COL.botTan + sumpH / 2;
    this.sump.material.color.copy(colorFor(0, true));
    this.sumpTop.position.y = COL.botTan + sumpH + 0.002;
    this.sumpTop.material.color.copy(colorFor(0, true));
    this.smap.rotation += dtReal * (0.15 + 0.5 * Math.min(1.5, sim.flows.VB / 150));

    // bubbles
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const V = sim.flows.VB;
    const vfrac = Math.max(0, Math.min(1.5, V / 150));
    const show = Math.round(this.bubPer * Math.min(1, vfrac * 0.85));
    for (let k = 0; k < this.bubData.length; k++) {
      const b = this.bubData[k];
      const zone = b.zone; // 0 = below tray 1 (from reboiler return); z = above tray z-1
      if (b.slot >= show || (zone > 0 && tr[zone - 1].damaged && b.slot > show * 0.15)) { m4.makeScale(0, 0, 0); this.bub.setMatrixAt(k, m4); continue; }
      const base = zone === 0 ? COL.botTan + 1.85 : trayY(zone - 1) + 0.02;
      const t = zone > 0 ? tr[zone - 1] : null;
      const frothTop = zone === 0 ? 0.6 : this.trays[zone - 1].froth.scale.y;
      const span = zone === 0 ? 0.55 : Math.max(0.1, Math.min(0.56, frothTop + 0.08));
      b.ph += dtReal * b.sp * (0.35 + 0.8 * vfrac) * (0.22 / span) * 0.9;
      if (b.ph > 1) { b.ph -= 1; }
      const side = zone > 0 ? this.trays[zone - 1].side : 1;
      const wob = Math.sin((b.ph * 6 + b.x * 10) * Math.PI) * 0.01;
      p.set(b.x * side + wob, base + b.ph * span, b.z);
      const big = t && (t.flooding) ? 1.8 : 1;
      const sz = b.sz * big * (b.ph > 0.85 ? (1 - b.ph) / 0.15 : 1);
      s.set(sz, sz, sz);
      m4.compose(p, q, s); this.bub.setMatrixAt(k, m4);
    }
    this.bub.instanceMatrix.needsUpdate = true;
    this.bub.visible = V > 1;

    // droplets: entrainment up, weeping down, downcomer flow
    const dc = new THREE.Color();
    for (let k = 0; k < this.dropData.length; k++) {
      const dd = this.dropData[k];
      const t = tr[dd.tray], v = this.trays[dd.tray];
      const slot = k % this.dropPer;
      const y0 = trayY(dd.tray);
      let mode = 'dc';
      if (t.psi > 0.03 && slot < Math.min(this.dropPer, 4 + t.psi * 60)) mode = 'up';
      else if (t.weeping && slot < 12) mode = 'weep';
      else if (t.damaged && slot < 25) mode = 'dump';
      dd.ph += dtReal * dd.sp * (mode === 'up' ? 0.9 : mode === 'dc' ? 0.7 * Math.min(1.5, t.L / 150 + 0.1) : 1.1);
      if (dd.ph > 1) dd.ph -= 1;
      let sz = 0.014;
      if (mode === 'up') { p.set(dd.x * v.side, y0 + v.froth.scale.y + dd.ph * (COL.spacing - v.froth.scale.y), dd.z); sz = 0.018; }
      else if (mode === 'weep' || mode === 'dump') { p.set(dd.x * v.side, y0 - dd.ph * (COL.spacing - 0.15), dd.z); sz = mode === 'dump' ? 0.022 : 0.014; }
      else {
        if (t.L < 2 || slot > 18) { m4.makeScale(0, 0, 0); this.drop.setMatrixAt(k, m4); continue; }
        // falling sheet in the downcomer
        const xx = (COL.dcX + 0.05 + Math.abs(dd.x) * 0.25) * v.side;
        p.set(xx, y0 - dd.ph * (COL.spacing - 0.08), dd.z * 0.9);
        sz = 0.011;
      }
      s.set(sz, sz * (mode === 'dc' || mode === 'weep' || mode === 'dump' ? 1.8 : 1), sz);
      m4.compose(p, q, s); this.drop.setMatrixAt(k, m4);
      dc.copy(colorFor(dd.tray)); this.drop.setColorAt(k, dc);
    }
    this.drop.instanceMatrix.needsUpdate = true; this.drop.instanceColor.needsUpdate = true;

    // reboiler: tubes foul, pool level, boiling
    const rf = sim.faults.reboilerFouling.s;
    this.rebTubeMat.color.set(C.tube).lerp(new THREE.Color(0x1d1712), Math.min(1, rf * 1.3));
    const rbLevel = 0.62;
    this.rebLiqMat.color.copy(colorFor(0, true));
    const rb = this.reb, boil = Math.min(1.3, sim.reb.Q / 5000);
    for (let k = 0; k < this.rbubData.length; k++) {
      const b = this.rbubData[k];
      b.ph += dtReal * b.sp * (0.4 + boil);
      if (b.ph > 1) b.ph -= 1;
      const on = k / this.rbubData.length < boil * 0.8;
      const sz = on ? 0.012 + 0.016 * b.ph : 0;
      p.set(b.x, rb.cy - 0.45 + b.ph * (rb.r * 2 * rbLevel - 0.1), b.z);
      s.set(sz, sz, sz); m4.compose(p, q, s); this.rbub.setMatrixAt(k, m4);
    }
    this.rbub.instanceMatrix.needsUpdate = true;

    // condenser: tube fouling + CW streaks
    const cf = sim.faults.condenserFouling.s;
    this.condTubeMat.color.set(C.tubeCond).lerp(new THREE.Color(0x5b5232), Math.min(1, cf * 1.3));
    const cw = sim.top.cwFlowFrac;
    const cd = this.cond;
    for (let k = 0; k < this.cwpData.length; k++) {
      const c = this.cwpData[k];
      c.ph += dtReal * cw * 0.9;
      if (c.ph > 1) c.ph -= 1;
      const sz = cw > 0.02 ? 1 : 0;
      p.set(c.x, c.y, -cd.L / 2 + c.ph * cd.L); s.set(sz, sz, sz);
      m4.compose(p, q, s); this.cwp.setMatrixAt(k, m4);
    }
    this.cwp.instanceMatrix.needsUpdate = true;

    // drum level
    const dl = Math.max(0.03, Math.min(0.97, sim.meas.drumL / 100 * 0.9 + 0.05));
    if (Math.abs(dl - (this._drumLevel || 0)) > 0.01) { this._drumLevel = dl; this.setHorizontalLevel('drumLiq', this.drumLiqMat, this.drumG.r - 0.03, this.drumG.L - 0.05, dl, new THREE.Vector3(this.drumG.cx, this.drumG.cy, 0), this.groups.drum, true); }
    this.drumLiqMat.color.copy(colorFor(0, false, true));

    // pipe flow markers
    const fl = sim.flows;
    const rate = { overhead: fl.Vtop / 150, condensate: fl.Vcond / 150, drumOut: (fl.LR + fl.D) / 150, reflux: fl.LR / 100, distillate: fl.D / 50,
      cwIn: sim.top.cwFlowFrac * 1.6, cwOut: sim.top.cwFlowFrac * 1.6, feed: fl.F / 100, rebIn: fl.VB / 150 + 0.2, rebVap: fl.VB / 150,
      botSuct: fl.B / 50, bottoms: fl.B / 50, steam: sim.reb.Q / 5000 };
    for (const pp of this.pipes) {
      const r = rate[pp.key] != null ? rate[pp.key] : 0;
      pp.tex.offset.x -= dtReal * 0.9 * r * pp.dir;
      pp.mesh.visible = r > 0.02;
      pp.mat.opacity = Math.min(0.95, 0.5 + r * 0.4);
    }

    // valve stem indicators + pump vibration
    const vpos = { 'FV-101': sim.valves.FV101, 'FV-140': sim.valves.FV140, 'TV-105': sim.valves.TV105, 'PV-110': sim.valves.PV110, 'LV-120': sim.valves.LV120, 'LV-130': sim.valves.LV130 };
    for (const tag in this.valves) {
      const v = this.valves[tag];
      v.ind.position.y = 0.36 + 0.18 * (vpos[tag] / 100);
      const sel = selected && selected.kind === 'valve' && selected.tag === tag;
      v.ind.material.emissiveIntensity = sel ? 1.2 : 0.4;
      const op = vpos[tag];
      const ac = op > 95 || op < 2 ? 0xd93333 : op > 85 ? 0xe0a020 : C.actuator;
      for (const m of v.act) m.color.lerp(new THREE.Color(ac), Math.min(1, dtReal * 4));
    }
    if (sim.faults.bottomsPump.active) {
      const j = 0.012;
      this.p102.position.x = 1.3 + (Math.random() - 0.5) * j; this.p102.position.z = 2.6 + (Math.random() - 0.5) * j;
    } else { this.p102.position.set(1.3, 0, 2.6); }
  }
}
