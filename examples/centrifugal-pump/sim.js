/*
 * Centrifugal pump dynamic simulator — P-301 condensate return pump.
 *
 * Unit: T-301 vented condensate receiver (82 °C) -> 6" suction line with Y-strainer S-305 ->
 * end-suction centrifugal pump P-301 (3560 rpm, 6-vane closed impeller) driven by M-301 (15 kW TEFC)
 * -> check valve -> LV-310 level control valve -> 4" line up to the D-401 deaerator (+12 m, 0.4 barg).
 * LIC-301 holds the receiver level by throttling LV-310. Condensate return from the plant is the inflow.
 *
 * Model:
 *  - pump curve H = hm (H0 - c (Q·(1+0.4·wear))²) against the system curve (static + K·Q² + valve)
 *  - equal-percentage control valve, flow solved each step from the head balance, short pipe-inertia lag
 *  - suction pressure from tank level, suction-line and strainer losses; NPSHa vs NPSHr(Q)
 *  - cavitation: incipient below 1.6 × NPSHr (noise and vibration), head breakdown below NPSHr
 *  - vortexing / loss of suction at low submergence
 *  - casing energy balance (deadhead heating -> flashing), bearing temperatures with lag
 *  - vibration by component (1×, 2×, vane pass, BPFO + harmonics, broadband) at DE and NDE bearings
 *  - shaft power from a radial-pump power curve, motor amps, mechanical seal leakage
 *  - interlocks: LSLL-301 low-low level, TAHH-303 casing temperature, bearing seizure
 *
 * Units: m³/h, m (head), kPa(abs), °C, kW, mm/s RMS. Integrator step 0.5 s.
 * Works in the browser (window.PumpSimLib) and in Node (module.exports).
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const G = 9.81;
  const MMHG = 0.133322;
  // water vapor pressure (Antoine), kPa
  const psatW = (T) => (T < 100 ? Math.pow(10, 8.07131 - 1730.63 / (233.426 + T)) : Math.pow(10, 8.14019 - 1810.94 / (244.485 + T))) * MMHG;
  const rhoW = (T) => 1000 - 0.0045 * (T - 4) * (T - 4);

  // ---------- design basis (illustrative textbook values, not a real plant) ----------
  const DESIGN = {
    Tliq: 82,             // °C condensate in the receiver
    Patm: 101.3,          // kPa
    Pda: 140.5,           // kPa abs, D-401 deaerator (0.4 barg)
    Zd: 12.0,             // m, deaerator inlet above pump centerline
    tankD: 2.0, tankH: 3.0, tankElev: 2.0,   // m: receiver diameter, height, bottom above pump CL
    Qin: 90,              // m³/h condensate return, normal
    Qsurge: 115,          // m³/h when the plant comes off a batch
    H0: 46, c: 0.0008,    // pump curve: shutoff head m, curvature m/(m³/h)²
    Qbep: 100, Hbep: 38, etaBep: 0.78, Pbep: 12.9,   // BEP flow, head, efficiency, shaft kW
    NPSHr0: 1.5, NPSHr1: 2.5,                        // NPSHr = a + b (Q/Qbep)²  (3% head-drop basis)
    Ks: 0.5 / 8100, Kstr: 0.3 / 8100, Kdis: 9 / 10000, // m per (m³/h)²
    Kv: 55, R: 30,        // valve: m³/h per sqrt(m) at 100%, equal-percentage rangeability
    rpm: 3560, vanes: 6, bpfo: 3.07, bpfi: 4.93,
    motorKW: 15, volts: 460, pf: 0.86, motorEff: 0.93,
    Ccas: 145,            // kJ/K casing + trapped liquid
    Tamb: 30,
    energyCost: 0.10,     // $/kWh
    condCost: 6,          // $/m³ lost condensate (water + treatment chemicals + heat)
    levelSP: 50,
  };

  // ---------- faults ----------
  const FAULTS = {
    strainerPlug: { label: 'Plug the suction strainer', fix: 'Clean Y-strainer S-305', ramp: 1 / 24, kind: 'foul',
      what: 'Scale, rust and gasket bits collect in the Y-strainer basket. A little more pressure drop on the suction side every hour.' },
    impellerWear: { label: 'Wear the impeller', fix: 'Rebuild P-301: impeller and wear rings', ramp: 1 / 36, kind: 'foul',
      what: 'Wear-ring clearance opens up. More liquid slips from discharge back to the eye. Less head, more power for the same flow. Years of wear squeezed into hours.' },
    bearingDefect: { label: 'Start a bearing defect', fix: 'Replace the radial bearing', ramp: 1 / 40, kind: 'foul',
      what: 'A spall starts on the outer race of the radial bearing (impeller end). Every ball that rolls over it sends a small impact.' },
    misalignment: { label: 'Misalign the coupling', fix: 'Laser-align motor to pump', kind: 'break',
      what: 'After the last coupling job the motor went back 0.5 mm high and slightly angled. The shaft gets pushed twice every turn.' },
    sealWear: { label: 'Wear the mechanical seal', fix: 'Replace the mechanical seal', ramp: 1 / 30, kind: 'foul',
      what: 'The seal faces wear and lose flatness. Leakage starts as vapor, then drips, then a stream.' },
    ltDrift: { label: 'Drift the LT-301 level transmitter', fix: 'Recalibrate LT-301', ramp: 1 / 4, kind: 'foul',
      what: 'The receiver level transmitter reads high and keeps drifting. LIC-301 believes it and drains the tank.' },
    valveFail: { label: 'Fail the discharge valve shut', fix: 'Restore air to LV-310', kind: 'break',
      what: 'Instrument air lost to LV-310. It fails closed. The pump keeps running against a closed valve.' },
    inflowSurge: { label: 'Surge the condensate return', fix: 'Return back to normal', kind: 'break',
      what: 'The plant comes off a batch and sends more condensate: 90 to 115 m³/h.' },
  };

  // ---------- PI controller (velocity form) ----------
  function PI(o) { return Object.assign({ mode: 'AUTO', sp: 0, pv: 0, op: 50, kc: 1, ti: 0.1, reverse: false, lo: 0, hi: 100, err0: null }, o); }
  function runPI(c, pv, hours) {
    c.pv = pv;
    if (c.mode !== 'AUTO') { c.err0 = null; return c.op; }
    const e = (c.reverse ? -1 : 1) * (c.sp - pv);
    if (c.err0 === null) c.err0 = e;
    c.op = clamp(c.op + c.kc * ((e - c.err0) + (hours / c.ti) * e), c.lo, c.hi);
    c.err0 = e;
    return c.op;
  }

  class PumpSim {
    constructor(opts) { this.d = Object.assign({}, DESIGN, opts || {}); this.reset(); }

    reset() {
      const d = this.d;
      this.t = 0;
      this.rho = rhoW(d.Tliq);
      this.rg = this.rho * G / 1000;              // kPa per m
      this.area = Math.PI * d.tankD * d.tankD / 4;
      this.tank = { L: d.tankH * 0.5, Qin: d.Qin, overflow: 0, vortex: 0 };
      this.pump = { running: true, Q: 90, H: 39.5, hcav: 1, ci: 0, Ps: 127, Pd: 500, npshA: 8, npshR: 3.5, Tc: d.Tliq + 0.1,
        P: 12, eta: 0.77, amps: 19, rImp: 0.9, leak: 0.05, sealDrain: 0 };
      this.bear = { T1: 55, T2: 55 };
      this.vib = this.calcVib(0.9, 0, 0, 0, 0, true);
      this.flows = { Qin: d.Qin, Q: 90 };
      this.ctl = {
        LIC301: PI({ tag: 'LIC-301', name: 'Receiver level', unit: '%', sp: d.levelSP, op: 73, kc: 2.0, ti: 0.12, reverse: true }),
      };
      this.valves = { LV310: 73 };
      this.faults = {};
      for (const k in FAULTS) this.faults[k] = { active: false, s: 0 };
      this.trip = { on: false, reason: '', tag: '' };
      this.money = { energy: 0, lost: 0, lostM3: 0 };
      this.history = []; this.events = []; this._histAcc = 0;
      this.settle(3 * 3600, 0.5);
      this.t = 0; this.history = []; this.events = []; this.money = { energy: 0, lost: 0, lostM3: 0 };
      this.record();
    }

    settle(seconds, dt) { const n = Math.round(seconds / dt); for (let k = 0; k < n; k++) this.step(dt, true); }
    advance(seconds) { const dt = 0.5, n = Math.max(1, Math.round(seconds / dt)); for (let k = 0; k < n; k++) this.step(dt, false); }

    setFault(key, on) {
      const f = this.faults[key]; if (!f) return;
      if (on) {
        f.active = true; if (!FAULTS[key].ramp) f.s = 1;
        this.log(FAULTS[key].label.replace(/^\w/, (c) => c.toUpperCase()), 'fault');
      } else {
        f.active = false; f.s = 0;
        this.log(FAULTS[key].fix + ' — done', 'fix');
        if (key === 'bearingDefect' && this.trip.on && this.trip.tag === 'M-301') this.resetTrip(true);
      }
    }

    resetTrip(quietOk) {
      const d = this.d, Ltrue = 100 * this.tank.L / d.tankH;
      if (!this.trip.on) return true;
      if (this.trip.tag === 'M-301' && this.faults.bearingDefect.s >= 0.99) return false;
      if (Ltrue < 20 || this.pump.Tc > 95) return false;
      this.trip.on = false; this.trip.reason = ''; this.trip.tag = '';
      this.pump.running = true;
      this.log('P-301 restarted by operator', 'op');
      return true;
    }

    log(text, kind) { this.events.unshift({ t: this.t, text, kind: kind || 'info' }); if (this.events.length > 60) this.events.pop(); }

    // vibration components (mm/s RMS) at the two pump bearings:
    // b1 = VI-301 radial bearing (impeller end), b2 = VI-302 thrust bearing (coupling end)
    calcVib(r, mis, sB, ci, ve, running) {
      if (!running) {
        const z = { x1: 0.03, x2: 0.01, vp: 0.01, bp: 0, bb: 0.05 };
        return { b1: Object.assign({}, z), b2: Object.assign({}, z), o1: 0.06, o2: 0.06 };
      }
      const off = (1 - r) * (1 - r);
      const vp = 0.45 + 1.8 * off;
      const bp = 9 * Math.pow(clamp((sB - 0.15) / 0.85, 0, 1), 1.6);
      const bb = 2.4 * Math.pow(Math.min(ci, 2), 1.3) + 3 * ve;
      const b1 = { x1: 1.2 + 0.4 * mis, x2: 0.2 + 0.9 * mis, vp, bp, bb };
      const b2 = { x1: 1.0 + 0.8 * mis, x2: 0.25 + 2.4 * mis, vp: 0.6 * vp, bp: 0.25 * bp, bb: 0.55 * bb };
      const ov = (v) => Math.sqrt(v.x1 * v.x1 + v.x2 * v.x2 + v.vp * v.vp + v.bp * v.bp + v.bb * v.bb + 0.09);
      return { b1, b2, o1: ov(b1), o2: ov(b2) };
    }

    step(dt, quiet) {
      const d = this.d, F = this.faults, h = dt / 3600, p = this.pump, tk = this.tank, rg = this.rg;
      for (const k in F) { const f = F[k]; if (f.active && FAULTS[k].ramp && f.s < 1) f.s = Math.min(1, f.s + FAULTS[k].ramp * h); }
      const sS = F.strainerPlug.s, w = F.impellerWear.s, sB = F.bearingDefect.s, mis = F.misalignment.active ? 1 : 0, sSeal = F.sealWear.s, sLT = F.ltDrift.s;

      // ---- inflow ----
      tk.Qin = F.inflowSurge.active ? d.Qsurge : d.Qin;

      // ---- valve ----
      if (F.valveFail.active) this.valves.LV310 = 0;
      const v = this.valves.LV310 / 100;
      const f = v < 0.02 ? (v / 0.02) * Math.pow(d.R, -0.98) : Math.pow(d.R, v - 1);

      // ---- suction side ----
      const Lm = tk.L;
      const strMult = 1 + 24 * sS * sS;
      const Kstr = d.Kstr * strMult;
      // submergence: vortex / loss of suction below ~0.45 m
      tk.vortex = clamp((0.45 - Lm) / 0.4, 0, 1);
      const ve = tk.vortex;
      const lossSuct = Lm < 0.04;

      // ---- pump curve x system curve ----
      const running = p.running && !this.trip.on;
      const hw = 1 - 0.36 * w, qf = 1 + 0.4 * w;
      const hv = lossSuct ? 0.05 : 1 - 0.55 * ve;
      const hm = running ? hw * p.hcav * hv : 0;
      const A = hm * d.H0, B = hm * d.c * qf * qf;
      const S = (d.Patm - d.Pda) / rg + (d.tankElev + Lm) - d.Zd;
      const Kval = f > 1e-6 ? 1 / ((d.Kv * f) * (d.Kv * f)) : Infinity;
      let Qt = 0;
      if (running && isFinite(Kval) && A + S > 0) Qt = Math.sqrt((A + S) / (B + d.Ks + Kstr + d.Kdis + Kval));
      p.Q += (Qt - p.Q) * Math.min(1, dt / 1.5);
      if (p.Q < 1e-3) p.Q = 0;
      const Q = p.Q;
      const H = running ? Math.max(0, A - B * Q * Q) : 0;
      p.H = H;
      p.Ps = d.Patm + rg * (d.tankElev + Lm) - rg * (d.Ks + Kstr) * Q * Q;
      p.Pd = p.Ps + rg * H;
      p.dPstr = rg * Kstr * Q * Q;
      p.rImp = Q * qf / d.Qbep;
      p.npshR = d.NPSHr0 + d.NPSHr1 * p.rImp * p.rImp;
      p.npshA = (p.Ps - psatW(p.Tc)) / rg;
      // cavitation intensity: 0 = none, 1 = at NPSHr (3% head drop), >1 = breakdown
      const ci = running ? clamp((1.6 * p.npshR - p.npshA) / (0.6 * p.npshR), 0, 2.2) : 0;
      p.ci = ci;
      const hcT = p.npshA >= p.npshR ? 1 - 0.03 * Math.min(1, ci) : clamp(0.97 - 0.22 * (p.npshR - p.npshA), 0.15, 0.97);
      p.hcav += (hcT - p.hcav) * Math.min(1, dt / 3);

      // ---- power, efficiency, amps ----
      const misLoad = 1 + 0.04 * mis;
      const bearLoss = sB > 0.7 ? 0.8 * Math.pow((sB - 0.7) / 0.3, 2) : 0;
      p.P = running ? (d.Pbep * (0.42 + 0.58 * Q * (1 + 0.15 * w) / d.Qbep) * misLoad + bearLoss) * Math.max(0.35, hv) : 0;
      const Phyd = this.rho * G * (Q / 3600) * H / 1000;
      p.eta = p.P > 0.1 ? clamp(Phyd / p.P, 0, 0.95) : 0;
      p.Pel = running ? p.P / d.motorEff : 0;
      p.amps = p.Pel * 1000 / (Math.sqrt(3) * d.volts * d.pf);

      // ---- casing energy balance (deadhead heating) ----
      const mdot = this.rho * Q / 3600;
      const heat = running ? Math.max(0, p.P - Phyd) : 0;
      p.Tc += (heat - mdot * 4.19 * (p.Tc - d.Tliq) - 0.05 * (p.Tc - d.Tliq)) / d.Ccas * dt;
      if (!running && Q < 0.5) p.Tc += (d.Tliq - p.Tc) * Math.min(1, dt / 1800) * 0.3;

      // ---- seal leakage (L/h) ----
      const deadheadFlash = p.Tc > 100 ? 1 : 0;
      p.leak = running || p.Tc > 90 ? 0.05 + 12 * Math.pow(sSeal, 2.5) + 0.8 * deadheadFlash + 1.2 * mis * 0 : 0.03 + 6 * Math.pow(sSeal, 2.5);
      p.sealDrain = p.leak;

      // ---- vibration ----
      this.vib = this.calcVib(p.rImp, mis, sB, ci, ve + (lossSuct ? 0.5 : 0) + (p.Tc > 103 && running ? clamp((p.Tc - 103) / 6, 0, 1) : 0), running);

      // ---- bearing temperatures (lagged) ----
      const load = 6 * Math.abs(1 - p.rImp) + (running ? 0 : -24);
      const T1t = d.Tamb + 24 + load + 4 * mis + (ci > 1 ? 3 * (ci - 1) : 0) + (sB > 0.65 ? 35 * Math.pow((sB - 0.65) / 0.35, 2) : 0);
      const T2t = d.Tamb + 24 + load + 16 * mis;
      const tau = 900;
      this.bear.T1 += (T1t - this.bear.T1) * Math.min(1, dt / tau);
      this.bear.T2 += (T2t - this.bear.T2) * Math.min(1, dt / tau);

      // ---- tank level ----
      tk.overflow = tk.L > 2.9 ? 300 * (tk.L - 2.9) : 0;
      const dV = (tk.Qin - Q - tk.overflow) * h;
      tk.L = clamp(tk.L + dV / this.area, 0, d.tankH);

      // ---- measurements ----
      const Ltrue = 100 * tk.L / d.tankH;
      const flick = ci > 1 && running ? (ci - 1) * 6 * (Math.sin(this.t * 2.3) * 0.6 + Math.sin(this.t * 5.1) * 0.4) : 0;
      this.meas = {
        L: clamp(Ltrue + 52 * sLT, 0, 100), Ltrue,
        Q: Math.max(0, Q + flick), Qin: tk.Qin,
        Ps: p.Ps, Pd: p.Pd, dPstr: p.dPstr,
        T1: this.bear.T1, T2: this.bear.T2, Tc: p.Tc,
        V1: this.vib.o1, V2: this.vib.o2, amps: p.amps,
      };

      // ---- control ----
      const lv = runPI(this.ctl.LIC301, this.meas.L, h);
      if (!F.valveFail.active) this.valves.LV310 = lv;

      // ---- interlocks ----
      if (!this.trip.on) {
        let why = null, tag = '';
        if (Ltrue < 6 && running) { why = 'LSLL-301 low-low level: P-301 stopped'; tag = 'LSLL-301'; }
        else if (p.Tc > 110 && running) { why = 'TAHH-303 casing temperature: P-301 stopped'; tag = 'TAHH-303'; }
        else if (sB >= 0.995 && running) { why = 'Radial bearing seized: M-301 tripped on overload'; tag = 'M-301'; }
        if (why) { this.trip.on = true; this.trip.reason = why; this.trip.tag = tag; p.running = false; if (!quiet) this.log(why, 'trip'); }
      }

      // ---- economics ----
      if (!quiet) {
        this.money.energy += p.Pel * d.energyCost * h;
        const lostM3 = (tk.overflow + p.leak / 1000) * h;
        this.money.lostM3 += lostM3; this.money.lost += lostM3 * d.condCost;
      }

      this.t += dt;
      if (!quiet) { this._histAcc += dt; if (this._histAcc >= 60) { this._histAcc = 0; this.record(); } }
    }

    // ---- curve helpers for the pump-curve chart (same equations as step) ----
    valveF(op) { const v = op / 100, R = this.d.R; return v < 0.02 ? (v / 0.02) * Math.pow(R, -0.98) : Math.pow(R, v - 1); }
    curveH(Q, clean) {
      const d = this.d, w = clean ? 0 : this.faults.impellerWear.s, hw = 1 - 0.36 * w, qf = 1 + 0.4 * w;
      const hm = clean ? 1 : hw * this.pump.hcav * (1 - 0.55 * this.tank.vortex);
      return Math.max(0, hm * (d.H0 - d.c * (Q * qf) * (Q * qf)));
    }
    systemH(Q, op) {
      const d = this.d, f = this.valveF(op == null ? this.valves.LV310 : op);
      const Kstr = d.Kstr * (1 + 24 * this.faults.strainerPlug.s * this.faults.strainerPlug.s);
      const Kval = f > 1e-6 ? 1 / ((d.Kv * f) * (d.Kv * f)) : 1e3;
      const S = (d.Patm - d.Pda) / this.rg + (d.tankElev + this.tank.L) - d.Zd;
      return -S + (d.Ks + Kstr + d.Kdis + Kval) * Q * Q;
    }
    npshAat(Q) {
      const d = this.d, Kstr = d.Kstr * (1 + 24 * this.faults.strainerPlug.s * this.faults.strainerPlug.s);
      return (d.Patm + this.rg * (d.tankElev + this.tank.L) - this.rg * (d.Ks + Kstr) * Q * Q - psatW(this.pump.Tc)) / this.rg;
    }
    npshRat(Q) { const d = this.d, qf = 1 + 0.4 * this.faults.impellerWear.s, r = Q * qf / d.Qbep; return d.NPSHr0 + d.NPSHr1 * r * r; }

    record() {
      const p = this.pump, m = this.meas || {};
      this.history.push({
        t: this.t, Ps: p.Ps, Pd: p.Pd, dPstr: p.dPstr, Qin: this.tank.Qin, Q: m.Q != null ? m.Q : p.Q, L: m.L != null ? m.L : 50, Ltrue: 100 * this.tank.L / this.d.tankH,
        V1: this.vib.o1, V2: this.vib.o2, T1: this.bear.T1, T2: this.bear.T2, Tc: p.Tc, kW: p.Pel, amps: p.amps, LV: this.valves.LV310,
        npshA: p.npshA, npshR: p.npshR, leak: p.leak, H: p.H,
      });
      if (this.history.length > 72 * 60) this.history.shift();
    }

    getAlarms() {
      const a = [], m = this.meas || {}, p = this.pump, d = this.d;
      const push = (tag, text, pri) => a.push({ tag, text, pri });
      if (this.trip.on) push(this.trip.tag, this.trip.reason, 1);
      if (this.tank.overflow > 0.5) push('LAHH-301', 'T-301 overflowing to drain: condensate lost', 1);
      if (m.L > 80) push('LAH-301', `Receiver level high ${m.L.toFixed(0)}%`, 2);
      if (m.L < 20) push('LAL-301', `Receiver level low ${m.L.toFixed(0)}%`, 2);
      if (m.Ltrue < 15 && !this.trip.on) push('LSL-302', 'Independent low-level switch: receiver low', 2);
      if (m.V1 > 4.5 || m.V2 > 4.5) push('VAHH-30' + (m.V1 > m.V2 ? '1' : '2'), `Vibration ${Math.max(m.V1, m.V2).toFixed(1)} mm/s: ISO zone D`, 2);
      else if (m.V1 > 2.8 || m.V2 > 2.8) push('VAH-30' + (m.V1 > m.V2 ? '1' : '2'), `Vibration ${Math.max(m.V1, m.V2).toFixed(1)} mm/s: ISO zone C`, 3);
      if (m.T1 > 85) push('TAH-301', `Radial bearing hot ${m.T1.toFixed(0)} °C`, 2);
      if (m.T2 > 85) push('TAH-302', `Thrust bearing hot ${m.T2.toFixed(0)} °C`, 2);
      if (m.Tc > 98 && !this.trip.on) push('TAH-303', `Casing temperature ${m.Tc.toFixed(0)} °C: no flow through the pump`, 2);
      if (p.running && !this.trip.on && m.Q < 20) push('FAL-310', `Low flow ${m.Q.toFixed(0)} m³/h with pump running`, 2);
      if (p.leak > 6) push('LSH-330', `Seal leak pot high: ${p.leak.toFixed(1)} L/h`, 2);
      if (m.dPstr > 25) push('PDAH-305', `Strainer ΔP high ${m.dPstr.toFixed(0)} kPa`, 3);
      if (this.valves.LV310 > 92 && p.running) push('LV-310', `Valve ${this.valves.LV310.toFixed(0)}%: running out of pump`, 3);
      if (m.Ps < 110 && p.running) push('PAL-305', `Suction pressure low ${((m.Ps - d.Patm) / 100).toFixed(2)} barg`, 3);
      return a.sort((x, y) => x.pri - y.pri);
    }
  }

  const api = { PumpSim, Sim: PumpSim, FAULTS, DESIGN, psatW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PumpSimLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
