/*
 * Distillation column dynamic simulator — benzene / toluene splitter C-101.
 *
 * Tray-by-tray dynamic model:
 *  - liquid holdup per tray with Francis-weir hydraulics (L = Kw (M - Mw)^1.5)
 *  - component balance per tray, Murphree vapor efficiency
 *  - ideal VLE (Raoult + Antoine), bubble-point temperature at each tray pressure
 *  - tray pressure drop (dry + liquid head), jet-flood %, weeping, entrainment
 *  - column top pressure from vapor inventory vs condenser duty (self-regulating)
 *  - steam-side reboiler: control valve in series with a fouling-sensitive exchanger
 *  - PI control loops: FIC feed, FIC reflux, TIC tray 5 -> steam, PIC top -> CW,
 *    LIC drum -> distillate, LIC sump -> bottoms
 *  - faults that break the column the way real columns break
 *
 * Units: kmol, kmol/h, kPa(abs), degC, MJ, MJ/h. Internal integrator step in seconds.
 * Tray index 0 = tray 1 (bottom). Works in the browser (window.ColumnSim) and Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------- physical properties ----------
  const COMP = {
    light: { name: 'Benzene', short: 'Bz', A: 6.90565, B: 1211.033, C: 220.79, MW: 78.11, lam: 30.72 },
    heavy: { name: 'Toluene', short: 'Tol', A: 6.95464, B: 1344.8, C: 219.482, MW: 92.14, lam: 33.18 },
  };
  const MMHG = 0.133322; // kPa per mmHg
  const psat = (c, T) => Math.pow(10, c.A - c.B / (c.C + T)) * MMHG;
  const dpsat = (c, T) => psat(c, T) * Math.LN10 * c.B / ((c.C + T) * (c.C + T));
  // water, for the steam side of the reboiler (valid ~100-370 C)
  const W = { A: 8.14019, B: 1810.94, C: 244.485 };
  const psatW = (T) => Math.pow(10, W.A - W.B / (W.C + T)) * MMHG;
  const tsatW = (P) => W.B / (W.A - Math.log10(P / MMHG)) - W.C;

  function bubbleT(x, P, Tguess) {
    let T = Tguess || 95;
    for (let k = 0; k < 30; k++) {
      const f = x * psat(COMP.light, T) + (1 - x) * psat(COMP.heavy, T) - P;
      const d = x * dpsat(COMP.light, T) + (1 - x) * dpsat(COMP.heavy, T);
      const step = f / d;
      T -= Math.max(-20, Math.min(20, step));
      if (Math.abs(step) < 1e-5) break;
    }
    return T;
  }
  const yEq = (x, T, P) => Math.min(1, x * psat(COMP.light, T) / P);
  const lam = (x) => x * COMP.light.lam + (1 - x) * COMP.heavy.lam;
  const mw = (x) => x * COMP.light.MW + (1 - x) * COMP.heavy.MW;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- design basis ----------
  const DESIGN = {
    nTrays: 20,
    feedTray: 9,            // 1-based, counted from the bottom
    controlTray: 5,         // TIC-105 sensitive tray
    diameter: 1.3,          // m
    traySpacing: 0.6,       // m
    eff: 0.68,              // Murphree vapor efficiency, clean tray
    Mw: 0.55,               // kmol held below weir crest
    Kw: 1200,               // weir coefficient, kmol/h per kmol^1.5
    rhoL: 812,              // kg/m3
    Csb: 0.08,              // m/s capacity factor (Fair), 600 mm spacing
    MBmax: 16,              // sump capacity, kmol
    MDmax: 10,              // reflux drum capacity, kmol
    vapCap: 0.0085,         // kmol per kPa of vapor inventory (column + overhead)
    Psteam: 1100,           // kPa abs, LP steam header
    Kv: 360,                // steam valve, MJ/h per sqrt(kPa) at 100%
    UAr: 120,               // reboiler clean UA, MJ/h/K
    UAc: 160,               // condenser clean UA, MJ/h/K
    Tcw: 30,                // cooling water supply, C
    Fmax: 160, LRmax: 220, Dmax: 130, Bmax: 130,
    Prelief: 260,           // PSV-101 set pressure, kPa abs
    Ptrip: 175,             // PAHH-110: trips steam
    specD: 0.97,            // distillate benzene >= 97.0 mol%
    specB: 0.035,           // bottoms benzene <= 3.5 mol%
    steamCost: 0.0125,      // $/MJ
    offspecD: 14,           // $/kmol downgrade when distillate off-spec
    offspecB: 9,            // $/kmol downgrade when bottoms off-spec
  };

  // ---------- faults ----------
  // ramp: severity units per process hour while active (gradual faults). instant faults jump to 1.
  const FAULTS = {
    reboilerFouling: { label: 'Foul the reboiler', fix: 'Clean E-101 bundle', ramp: 1 / 30, kind: 'foul',
      what: 'Polymer and coke build on the tube side of E-101. Heat transfer drops a little every hour.' },
    condenserFouling: { label: 'Foul the condenser', fix: 'Clean E-102 (CW side)', ramp: 1 / 24, kind: 'foul',
      what: 'Scale and silt on the cooling-water side of E-102. Less condensing at the same CW flow.' },
    trayFouling: { label: 'Foul the bottom trays', fix: 'Turnaround: clean trays 1-8', ramp: 1 / 36, kind: 'foul',
      what: 'Deposits plug the valve/sieve holes on trays 1-8. Less open area, more pressure drop, floods sooner.' },
    tcDrift: { label: 'Drift the TI-105 thermocouple', fix: 'Replace TE-105', ramp: 1 / 10, kind: 'foul',
      what: 'The tray 5 thermocouple reads low and keeps drifting. The controller believes it and adds steam.' },
    damagedTray: { label: 'Dislodge tray 14', fix: 'Turnaround: reinstall tray 14', kind: 'break',
      what: 'Tray 14 panels lift off after a pressure surge. Liquid dumps, vapor bypasses. That tray stops separating.' },
    refluxValveFail: { label: 'Fail the reflux valve shut', fix: 'Restore air to FV-140', kind: 'break',
      what: 'Instrument air lost to FV-140. Valve fails closed. No reflux.' },
    cwLoss: { label: 'Trip the CW pump', fix: 'Restart P-201 CW pump', kind: 'break',
      what: 'Cooling water pump P-201 trips. E-102 stops condensing.' },
    steamDrop: { label: 'Drop the steam header', fix: 'Restore steam header', kind: 'break',
      what: 'LP steam header sags from 11 to 6.5 bar(a). Less driving force across E-101.' },
    feedSwing: { label: 'Swing the feed', fix: 'Feed back to normal', kind: 'break',
      what: 'Upstream unit sends a lighter feed: 50 -> 64 mol% benzene.' },
    bottomsPump: { label: 'Cavitate the bottoms pump', fix: 'Repair P-102 (impeller/seal)', kind: 'break',
      what: 'P-102 cavitates and loses 65% of its capacity. The sump starts to fill.' },
  };

  // ---------- PI controller ----------
  function PI(o) {
    return Object.assign({ mode: 'AUTO', sp: 0, pv: 0, op: 50, kc: 1, ti: 0.1, reverse: false, lo: 0, hi: 100, err0: null }, o);
  }
  function runPI(c, pv, hours) {
    c.pv = pv;
    if (c.mode !== 'AUTO') { c.err0 = null; return c.op; }
    const e = (c.reverse ? -1 : 1) * (c.sp - pv);
    if (c.err0 === null) c.err0 = e;
    // velocity form with clamping = natural anti-windup
    const dop = c.kc * ((e - c.err0) + (hours / c.ti) * e);
    c.op = clamp(c.op + dop, c.lo, c.hi);
    c.err0 = e;
    return c.op;
  }

  // ---------- the simulator ----------
  class ColumnSim {
    constructor(opts) {
      this.d = Object.assign({}, DESIGN, opts || {});
      this.reset();
    }

    reset() {
      const d = this.d, N = d.nTrays;
      this.t = 0; // process seconds since start
      this.feed = { F: 100, z: 0.5, zNormal: 0.5 };
      this.trays = [];
      for (let i = 0; i < N; i++) {
        const x = 0.05 + 0.9 * i / (N - 1);
        this.trays.push({ i, M: 0.8, x, y: x, T: 95, P: 110, V: 150, L: 150, e: 0, flood: 0.7, floodRaw: 0.7, dp: 0.75,
          E: d.eff, phi: 1, psi: 0, weeping: false, flooding: false, ystar: x });
      }
      this.reb = { M: 8, x: 0.03, y: 0.07, T: 112, P: 120, Q: 5000, Psh: 600, Tsh: 158, UAf: 1, V: 150 };
      this.drum = { M: 5, x: 0.98, T: 81 };
      this.top = { P: 105, Vtop: 150, Vcond: 150, Qc: 4600, cwFlowFrac: 0.5, relief: 0 };
      this.flows = { F: 100, LR: 100, D: 50, B: 50 };
      this.ctl = {
        FIC101: PI({ tag: 'FIC-101', name: 'Feed flow', unit: 'kmol/h', sp: 100, op: 62.5, kc: 0.4, ti: 0.004 }),
        FIC140: PI({ tag: 'FIC-140', name: 'Reflux flow', unit: 'kmol/h', sp: 100, op: 45, kc: 0.3, ti: 0.004 }),
        TIC105: PI({ tag: 'TIC-105', name: 'Tray 5 temperature', unit: '°C', sp: 106.5, op: 60, kc: 3.0, ti: 0.12 }),
        PIC110: PI({ tag: 'PIC-110', name: 'Column top pressure', unit: 'kPa', sp: 105, op: 50, kc: 2.5, ti: 0.06, reverse: true }),
        LIC120: PI({ tag: 'LIC-120', name: 'Reflux drum level', unit: '%', sp: 50, op: 38, kc: 2.0, ti: 0.4, reverse: true }),
        LIC130: PI({ tag: 'LIC-130', name: 'Sump level', unit: '%', sp: 50, op: 38, kc: 2.0, ti: 0.4, reverse: true }),
      };
      this.valves = { FV101: 62.5, FV140: 45, TV105: 60, PV110: 50, LV120: 38, LV130: 38 };
      this.faults = {};
      for (const k in FAULTS) this.faults[k] = { active: false, s: 0 };
      this.trip = { steam: false, reason: '' };
      this.money = { steam: 0, offspec: 0, offspecHoursD: 0, offspecHoursB: 0 };
      this.history = [];
      this.events = [];
      this.alarms = [];
      this._histAcc = 0;
      // settle to steady state
      this.settle(10 * 3600, 2);
      this.t = 0;
      this.money = { steam: 0, offspec: 0, offspecHoursD: 0, offspecHoursB: 0 };
      this.history = [];
      this.events = [];
      this.ctl.TIC105.sp = Math.round(this.ctl.TIC105.pv * 10) / 10;
      this.settle(2 * 3600, 2);
      this.t = 0; this.history = []; this.money = { steam: 0, offspec: 0, offspecHoursD: 0, offspecHoursB: 0 };
      this.record(true);
    }

    settle(seconds, dt) {
      const n = Math.round(seconds / dt);
      for (let k = 0; k < n; k++) this.step(dt, true);
    }

    // advance by `seconds` of process time
    advance(seconds) {
      const dt = 0.5;
      const n = Math.max(1, Math.round(seconds / dt));
      for (let k = 0; k < n; k++) this.step(dt, false);
    }

    setFault(key, on) {
      const f = this.faults[key];
      if (!f) return;
      if (on) {
        f.active = true;
        if (!FAULTS[key].ramp) f.s = 1;
        if (key === 'refluxValveFail') this._stuckLR = 0;
        this.log(`${FAULTS[key].label.replace(/^\w/, (c) => c.toUpperCase())}`, 'fault');
      } else {
        f.active = false; f.s = 0;
        if (key === 'damagedTray') { const tr = this.trays[13]; tr.M = Math.max(tr.M, this.d.Mw); }
        this.log(FAULTS[key].fix + ' — done', 'fix');
      }
    }

    resetTrip() {
      if (this.top.P < 140) { this.trip.steam = false; this.trip.reason = ''; this.log('Steam trip reset by operator', 'op'); return true; }
      return false;
    }

    log(text, kind) { this.events.unshift({ t: this.t, text, kind: kind || 'info' }); if (this.events.length > 60) this.events.pop(); }

    step(dt, quiet) {
      const d = this.d, N = d.nTrays, tr = this.trays, h = dt / 3600;
      const F = this.faults;

      // --- fault ramps ---
      for (const k in F) {
        const f = F[k];
        if (f.active && FAULTS[k].ramp && f.s < 1) f.s = Math.min(1, f.s + FAULTS[k].ramp * h);
      }
      const sRF = F.reboilerFouling.s, sCF = F.condenserFouling.s, sTF = F.trayFouling.s;

      // --- feed ---
      this.feed.z = F.feedSwing.active ? 0.64 : this.feed.zNormal;
      const Ffeed = this.valves.FV101 / 100 * d.Fmax;

      // --- tray deck fouling / damage parameters ---
      for (let i = 0; i < N; i++) {
        const t = tr[i];
        t.phi = i < 8 ? 1 - 0.5 * sTF * (1 - i / 10) : 1;
        t.damaged = F.damagedTray.active && i === 13;
      }

      // --- pressures (top-down) ---
      const Ptop = this.top.P;
      let P = Ptop;
      for (let i = N - 1; i >= 0; i--) { P += tr[i].dp; tr[i].P = P - tr[i].dp / 2; }
      this.reb.P = P;
      this.dP = P - Ptop;

      // --- temperatures ---
      for (let i = 0; i < N; i++) tr[i].T = bubbleT(tr[i].x, tr[i].P, tr[i].T);
      this.reb.T = bubbleT(this.reb.x, this.reb.P, this.reb.T);
      this.drum.T = bubbleT(this.drum.x, Ptop, this.drum.T) - 3; // slightly subcooled

      // --- reboiler, steam side: valve in series with exchanger ---
      const Psup = F.steamDrop.active ? 650 : d.Psteam;
      const UA = d.UAr * (1 - 0.62 * sRF);
      const v = this.valves.TV105 / 100;
      let Q = 0, Psh = psatW(this.reb.T + 0.5), Tsh = this.reb.T;
      if (!this.trip.steam && v > 0.001) {
        let lo = psatW(this.reb.T + 0.2), hi = Psup;
        if (hi <= lo) { Q = 0; }
        else {
          for (let k = 0; k < 40; k++) {
            const mid = 0.5 * (lo + hi);
            const qv = d.Kv * v * Math.sqrt(Psup - mid);
            const qx = UA * (tsatW(mid) - this.reb.T);
            if (qv > qx) lo = mid; else hi = mid;
          }
          Psh = 0.5 * (lo + hi); Tsh = tsatW(Psh);
          Q = Math.max(0, UA * (Tsh - this.reb.T));
        }
      }
      this.reb.Q = Q; this.reb.Psh = Psh; this.reb.Tsh = Tsh; this.reb.UAf = UA / d.UAr; this.reb.Psup = Psup;
      const VB = this.reb.M > 0.3 ? Q / lam(this.reb.x) : 0;
      this.reb.V = VB;
      this.reb.y = yEq(this.reb.x, this.reb.T, this.reb.P);

      // --- vapor up the column, hydraulics, efficiency (bottom-up) ---
      const An = 0.88 * Math.PI * d.diameter * d.diameter / 4;
      let yin = this.reb.y;
      for (let i = 0; i < N; i++) {
        const t = tr[i];
        t.V = VB; // saturated-liquid feed: constant vapor rate (CMO)
        const MWv = mw(yin);
        const rhoV = t.P * MWv / (8.314 * (t.T + 273.15));
        const u = t.V * MWv / rhoV / 3600 / An;
        const uf = d.Csb * Math.sqrt((d.rhoL - rhoV) / rhoV);
        t.floodRaw = u / uf;
        t.flood = t.floodRaw / (0.55 + 0.45 * t.phi);
        // efficiency
        let E = d.eff;
        const fl = t.flood;
        if (fl > 0.85) E *= clamp(1 - 3.0 * (fl - 0.85), 0.1, 1);
        t.weeping = fl < 0.36;
        if (t.weeping) E *= clamp(0.25 + 0.75 * (fl - 0.1) / 0.26, 0.25, 1);
        t.liquidFull = t.M > 1.5;
        if (t.liquidFull) E *= clamp(1 - (t.M - 1.5), 0.15, 1);
        if (t.damaged) E = 0.04;
        t.E = E;
        t.flooding = fl > 0.95 || t.liquidFull;
        t.ystar = yEq(t.x, t.T, t.P);
        t.y = clamp(yin + E * (t.ystar - yin), 0, 1);
        yin = t.y;
        // entrainment fraction
        t.psi = fl < 0.8 ? 0.004 : clamp(0.004 + 2.2 * (fl - 0.8) * (fl - 0.8), 0, 0.6);
        // pressure drop: dry + liquid head
        const dry = t.damaged ? 0.05 : 0.30 * Math.pow(t.floodRaw / 0.76, 2) / (t.phi * t.phi);
        const head = 0.45 * t.M / 0.8;
        const floodJam = fl > 0.95 ? 3.5 * (fl - 0.95) : 0;
        t.dp = dry + head + floodJam;
      }

      // --- liquid flows (weir), entrainment ---
      for (let i = 0; i < N; i++) {
        const t = tr[i];
        const Mw = t.damaged ? 0.12 : d.Mw * (1 + 0.6 * Math.max(0, t.flood - 0.9));
        const Kw = t.damaged ? d.Kw * 3 : d.Kw;
        t.L = Kw * Math.pow(Math.max(0, t.M - Mw), 1.5);
        t.e = t.psi / (1 - t.psi) * t.L;
      }
      // sump overfilled: liquid backs up over the reboiler return and stacks on tray 1
      const sumpFrac = this.reb.M / d.MBmax;
      this.reb.backup = sumpFrac > 1.0;
      if (sumpFrac > 1.0) tr[0].L *= clamp((1.12 - sumpFrac) / 0.12, 0, 1);
      // a tray full to the next deck can't take more liquid: the downcomer above backs up (stacking)
      for (let i = 0; i < N - 1; i++) if (tr[i].M > 1.9) tr[i + 1].L *= clamp((2.3 - tr[i].M) / 0.4, 0, 1);

      // --- condenser + column pressure ---
      const cwAvail = F.cwLoss.active ? 0 : 1;
      const cwv = this.valves.PV110 / 100 * cwAvail;
      this.top.cwFlowFrac = cwv;
      const g = cwv / (cwv + 0.3);
      const UAc = d.UAc * (1 - 0.55 * sCF);
      const Tcond = bubbleT(tr[N - 1].y, Ptop, tr[N - 1].T);
      this.top.Tcond = Tcond;
      const Qc = Math.max(0, UAc * g * (Tcond - d.Tcw));
      this.top.Qc = Qc; this.top.UAf = UAc / d.UAc;
      const Vtop = tr[N - 1].V;
      const Vcond = Qc / lam(tr[N - 1].y);
      this.top.Vtop = Vtop; this.top.Vcond = Vcond;
      let relief = 0;
      if (Ptop > d.Prelief) relief = 60 * (Ptop - d.Prelief);
      this.top.relief = relief;
      const condensed = Math.min(Vcond, Vtop + this.top.P * d.vapCap / h); // can't condense vapor that isn't there
      const dPdt = (Vtop - condensed - relief) / d.vapCap; // kPa/h
      this.top.P = clamp(Ptop + dPdt * h, 20, 600);

      // --- flows from valves ---
      const drum = this.drum, reb = this.reb;
      const pumpOK = drum.M > 0.25;
      if (F.refluxValveFail.active) this.valves.FV140 = 0;
      const LR = pumpOK ? this.valves.FV140 / 100 * d.LRmax * clamp((drum.M - 0.25) / 0.5, 0, 1) : 0;
      const D = pumpOK ? this.valves.LV120 / 100 * d.Dmax * clamp((drum.M - 0.25) / 0.5, 0, 1) : 0;
      const Bcap = F.bottomsPump.active ? 0.35 : 1;
      const B = reb.M > 0.3 ? this.valves.LV130 / 100 * d.Bmax * Bcap * clamp((reb.M - 0.3) / 0.5, 0, 1) : 0;
      this.flows = { F: Ffeed, LR, D, B, VB, Vtop, Vcond: condensed };

      // --- material balances ---
      const f = d.feedTray - 1;
      const dM = new Float64Array(N), dMx = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const t = tr[i];
        const Lin = i === N - 1 ? LR : tr[i + 1].L;
        const xin = i === N - 1 ? drum.x : tr[i + 1].x;
        const Vin = i === 0 ? VB : tr[i - 1].V;
        const yv = i === 0 ? reb.y : tr[i - 1].y;
        const ein = i === 0 ? 0 : tr[i - 1].e;
        const xe = i === 0 ? 0 : tr[i - 1].x;
        let m = Lin + ein - t.L - t.e + (Vin - t.V);
        let mx = Lin * xin + ein * xe - (t.L + t.e) * t.x + Vin * yv - t.V * t.y;
        if (i === f) { m += Ffeed; mx += Ffeed * this.feed.z; }
        dM[i] = m; dMx[i] = mx;
      }
      // reboiler sump
      const dMB = tr[0].L - VB - B;
      const dMBx = tr[0].L * tr[0].x - VB * reb.y - B * reb.x;
      // reflux drum: condensate (vapor y_N) + entrained liquid off the top tray
      const eTop = tr[N - 1].e;
      const dMD = condensed + eTop - LR - D;
      const dMDx = condensed * tr[N - 1].y + eTop * tr[N - 1].x - (LR + D) * drum.x;

      for (let i = 0; i < N; i++) {
        const t = tr[i];
        const Mx = t.M * t.x + dMx[i] * h;
        t.M = Math.max(0.02, t.M + dM[i] * h);
        t.x = clamp(Mx / t.M, 0, 1);
      }
      {
        const Mx = reb.M * reb.x + dMBx * h;
        reb.M = clamp(reb.M + dMB * h, 0.01, d.MBmax * 1.12);
        reb.x = clamp(Mx / reb.M, 0, 1);
        const Mdx = drum.M * drum.x + dMDx * h;
        drum.M = clamp(drum.M + dMD * h, 0.01, d.MDmax * 1.3);
        drum.x = clamp(Mdx / drum.M, 0, 1);
      }

      // --- measurements ---
      const ct = d.controlTray - 1;
      const drift = -7 * F.tcDrift.s; // reads low
      this.meas = {
        F: Ffeed, LR, D, B,
        T5true: tr[ct].T,
        T5: tr[ct].T + drift,
        P: this.top.P,
        drumL: 100 * drum.M / d.MDmax,
        sumpL: 100 * reb.M / d.MBmax,
      };

      // --- control ---
      const c = this.ctl, vv = this.valves, m = this.meas;
      vv.FV101 = runPI(c.FIC101, m.F, h);
      const lr = runPI(c.FIC140, m.LR, h);
      if (!F.refluxValveFail.active) vv.FV140 = lr; else { c.FIC140.op = Math.min(100, c.FIC140.op); }
      vv.TV105 = this.trip.steam ? 0 : runPI(c.TIC105, m.T5, h);
      vv.PV110 = runPI(c.PIC110, m.P, h);
      vv.LV120 = runPI(c.LIC120, m.drumL, h);
      vv.LV130 = runPI(c.LIC130, m.sumpL, h);

      // --- safety ---
      if (!this.trip.steam && this.top.P > d.Ptrip) {
        this.trip.steam = true; this.trip.reason = 'PAHH-110 high-high pressure: steam to E-101 tripped';
        if (!quiet) this.log(this.trip.reason, 'trip');
      }

      // --- economics ---
      if (!quiet) {
        this.money.steam += Q * d.steamCost * h;
        const offD = drum.x < d.specD, offB = reb.x > d.specB;
        if (offD) { this.money.offspec += D * d.offspecD * h; this.money.offspecHoursD += h; }
        if (offB) { this.money.offspec += B * d.offspecB * h; this.money.offspecHoursB += h; }
      }

      this.t += dt;
      if (!quiet) {
        this._histAcc += dt;
        if (this._histAcc >= 60) { this._histAcc = 0; this.record(); }
      }
    }

    record() {
      const tr = this.trays, d = this.d;
      const maxFlood = Math.max(...tr.map((t) => (t.damaged ? 0 : t.flood)));
      this.history.push({
        t: this.t,
        xD: this.drum.x, xB: this.reb.x, P: this.top.P, dP: this.dP, T5: this.meas ? this.meas.T5 : 0,
        T5true: this.meas ? this.meas.T5true : 0, steamV: this.valves.TV105, cwV: this.valves.PV110,
        Q: this.reb.Q, F: this.flows.F, LR: this.flows.LR, D: this.flows.D, B: this.flows.B,
        flood: maxFlood, sumpL: this.meas ? this.meas.sumpL : 50, drumL: this.meas ? this.meas.drumL : 50,
      });
      if (this.history.length > 72 * 60) this.history.shift();
    }

    // current alarm list (computed, ISA-style priorities)
    getAlarms() {
      const a = [], d = this.d, m = this.meas || {}, tr = this.trays;
      const push = (tag, text, pri) => a.push({ tag, text, pri });
      if (this.trip.steam) push('PAHH-110', 'Steam tripped on high-high pressure', 1);
      if (this.top.relief > 0) push('PSV-101', 'Relief valve lifting to flare', 1);
      if (this.top.P > 150) push('PAH-110', `Top pressure high ${this.top.P.toFixed(0)} kPa`, 2);
      if (this.drum.x < d.specD) push('AI-150', `Distillate off-spec ${(this.drum.x * 100).toFixed(1)}% Bz`, 2);
      if (this.reb.x > d.specB) push('AI-160', `Bottoms off-spec ${(this.reb.x * 100).toFixed(1)}% Bz`, 2);
      if (this.dP > 22) push('PDAH-112', `Column ΔP high ${this.dP.toFixed(1)} kPa`, 2);
      const fl = tr.filter((t) => t.flooding && !t.damaged);
      if (fl.length) push('—', `Flooding on tray${fl.length > 1 ? 's' : ''} ${fl.map((t) => t.i + 1).slice(0, 6).join(', ')}`, 2);
      const wp = tr.filter((t) => t.weeping && !t.damaged);
      if (wp.length > 3) push('—', `Weeping on ${wp.length} trays: vapor too low`, 3);
      if (this.valves.TV105 > 92) push('TV-105', `Steam valve ${this.valves.TV105.toFixed(0)}%: running out of reboiler`, 3);
      if (this.valves.PV110 > 92) push('PV-110', `CW valve ${this.valves.PV110.toFixed(0)}%: running out of condenser`, 3);
      if (this.reb.backup) push('LAHH-130', 'Sump overfull: liquid backing up onto tray 1', 1);
      else if (m.sumpL > 80) push('LAH-130', `Sump level high ${m.sumpL.toFixed(0)}%`, 2);
      if (m.sumpL < 15) push('LAL-130', `Sump level low ${m.sumpL.toFixed(0)}%`, 2);
      if (m.drumL > 80) push('LAH-120', `Drum level high ${m.drumL.toFixed(0)}%`, 2);
      if (m.drumL < 15) push('LAL-120', `Drum level low ${m.drumL.toFixed(0)}%`, 2);
      if (Math.abs(this.ctl.TIC105.pv - this.ctl.TIC105.sp) > 1.5 && this.ctl.TIC105.mode === 'AUTO')
        push('TIC-105', `Tray 5 temp off setpoint ${this.ctl.TIC105.pv.toFixed(1)} °C`, 3);
      return a.sort((p, q) => p.pri - q.pri);
    }
  }

  const api = { ColumnSim, FAULTS, DESIGN, COMP, bubbleT, psat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColumnSimLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
