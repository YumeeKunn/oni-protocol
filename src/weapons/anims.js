// ═══════════════ VIEWMODEL ANIMATION — layered procedural pose machine ═══════════════
// The gun is driven by additive layers: idle sway, walk bob, ADS blend, recoil
// springs, and keyframed one-shots (draw, reload, bolt cycle, melee, throw).
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';

const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class ViewAnim {
  constructor(vm, def) {
    this.vm = vm;
    this.def = def;
    this.ud = vm.userData;
    this.state = 'draw';
    this.t = 0;
    this.dur = def.draw || 0.5;
    this.next = null;
    this.sway = V();
    this.aim = 0;
    this.kick = 0;
    this.kickV = 0;
    this.boltT = 0;
    this.spare = null;
    this.posed = { p: V(), r: E() };
    this.restP = V(0.275, -0.205, -0.60);
    this.restR = E(0.02, 0.075, 0.02);
    this._tmp = new THREE.Vector3();
  }

  // ── one-shots ──
  play(name, dur) {
    this.state = name;
    this.t = 0;
    this.dur = dur;
    if (name === 'reload') this._magPhase = 0;
    if (name === 'throw') this._thrown = false;
  }
  get busy() { return this.state !== 'idle' && this.state !== 'walk' && this.state !== 'sprint'; }

  fireImpulse(strength = 1) {
    this.kickV += strength;
  }
  bolt() { this.boltT = 1; }

  update(dt, ctx, time) {
    const ud = this.ud;
    const vm = this.vm;
    const st = this.state;
    this.t += dt;
    const k = this.t / Math.max(0.0001, this.dur);
    const done = k >= 1;

    // ── layer: base pose ──
    const baseP = this.restP.clone();
    const baseR = this.restR.clone();

    // ── layer: idle breathing sway + mouse lag ──
    const sway = ctx.swaySpeed || 1;
    const lagTarget = V(clamp(-ctx.mouseDX * 0.00035, -0.05, 0.05), clamp(ctx.mouseDY * 0.0003, -0.04, 0.04), 0);
    this.sway.lerp(lagTarget, 1 - Math.exp(-9 * dt));
    baseP.x += Math.sin(time * 1.15) * 0.0045 * sway + this.sway.x;
    baseP.y += Math.cos(time * 1.4) * 0.0038 * sway + this.sway.y;
    baseR.z += Math.sin(time * 0.9) * 0.008;
    baseR.y += this.sway.x * 0.6;

    // ── layer: walk / sprint bob ──
    const spd = clamp(ctx.speed / 9.2, 0, 1.3);
    if (ctx.sprinting && ctx.speed > 4) {
      const t = ctx.bobT || time;
      baseP.x += Math.cos(t) * 0.028;
      baseP.y += Math.sin(t * 2) * 0.026 - 0.03;
      baseR.x += 0.34;
      baseR.y += 0.5;
      baseR.z += Math.sin(t) * 0.06 - 0.18;
      baseP.z += 0.06;
    } else if (spd > 0.08) {
      const t = ctx.bobT || time;
      baseP.x += Math.cos(t) * 0.016 * spd;
      baseP.y += Math.abs(Math.sin(t)) * 0.014 * spd - 0.004 * spd;
      baseR.z += Math.cos(t) * 0.028 * spd;
      baseR.x += Math.sin(t * 2) * 0.012 * spd;
    }
    // land dip
    baseP.y -= clamp(ctx.dip || 0, 0, 0.4) * 0.35;

    // ── layer: ADS ──
    const ads = clamp(ctx.adsT || 0, 0, 1);
    this.aim = ads;
    if (ads > 0.001) {
      const a = ud.aim;
      const sc = ud.vmScale || 1;
      const scopeHold = ctx.holdingBreath ? 1 : 0;
      const breathe = scopeHold ? 0.35 : 1;
      // eye→sight distance: close enough to feel like the gun came up, far enough
      // that the (FOV-zoomed) receiver doesn't swallow the screen
      const adsP = V(a.x * sc, a.y * sc, -(0.42 * (sc / 0.47) + a.z * sc));
      const adsR = E(0, 0, 0);
      // breathing wobble while aiming
      adsP.x += Math.sin(time * 1.5) * 0.0022 * breathe * (1 - scopeHold * 0.7);
      adsP.y += Math.cos(time * 1.7) * 0.0020 * breathe * (1 - scopeHold * 0.7);
      const fp = this._adsBlend ? this._adsBlend.p : adsP;
      const fr = this._adsBlend ? this._adsBlend.r : adsR;
      this._adsBlend = { p: fp.clone().lerp(adsP, 1 - Math.exp(-14 * dt)), r: E(lerp(fr.x, adsR.x, 1 - Math.exp(-14 * dt)), lerp(fr.y, adsR.y, 1 - Math.exp(-14 * dt)), lerp(fr.z, adsR.z, 1 - Math.exp(-14 * dt))) };
      const bl = this._adsBlend;
      baseP.lerp(bl.p, ads);
      baseR.x = lerp(baseR.x, bl.r.x, ads);
      baseR.y = lerp(baseR.y, bl.r.y, ads);
      baseR.z = lerp(baseR.z, bl.r.z, ads);
      // sprint pose is dropped the moment you aim
    } else if (ctx.sprinting) {
      // handled above
    }

    // hide the rear furniture (stock + sleeves) once the sights come up
    if (ud.rear && ud.rear.length) {
      const wantHidden = ads > 0.5;
      if (wantHidden !== ud.rearHidden) {
        ud.rearHidden = wantHidden;
        for (const m of ud.rear) m.visible = !wantHidden;
      }
    }

    // ── layer: recoil spring ──
    this.kickV *= Math.exp(-11 * dt);
    this.kick = damp(this.kick, 0, 12, dt) + this.kickV * dt;
    const kickAmt = this.kick * (1 - ads * 0.35);
    baseP.z += kickAmt * 0.055;
    baseP.y += kickAmt * 0.012;
    baseR.x -= kickAmt * 0.16;
    baseR.z += kickAmt * 0.05;

    // ── layer: bolt cycle (sniper) ──
    if (this.boltT > 0) {
      this.boltT = Math.max(0, this.boltT - dt * 1.1);
      const b = Math.sin(this.boltT * Math.PI);
      baseR.z += b * 0.34;
      baseR.x += b * 0.2;
      baseP.x -= b * 0.03;
      baseP.y -= b * 0.02;
      const boltMesh = ud.boltHandle;
      if (boltMesh) boltMesh.position.z = 0.05 + b * 0.06;
    }

    // ── layer: one-shot states ──
    let magDropY = 0, magDropR = 0, hideMag = false, extraP = V(), extraR = E();
    if (st === 'draw') {
      const e = 1 - Math.pow(1 - clamp(k, 0, 1), 3);
      extraP.y = -0.5 * (1 - e);
      extraP.z = 0.16 * (1 - e);
      extraR.x = -0.9 * (1 - e);
      extraR.z = 0.4 * (1 - e);
      if (done) this.state = 'idle';
    } else if (st === 'reload') {
      const D = this.dur;
      const p1 = clamp(k / 0.26, 0, 1);            // tilt in + mag out
      const p2 = clamp((k - 0.24) / 0.42, 0, 1);   // new mag up
      const p3 = clamp((k - 0.66) / 0.22, 0, 1);   // seat + charge
      const p4 = clamp((k - 0.86) / 0.14, 0, 1);   // settle
      const ease = x => 1 - Math.pow(1 - x, 2);
      extraP.x = -0.05 * ease(p1) + -0.02 * Math.sin(p2 * Math.PI);
      extraP.y = -0.06 * ease(p1) + 0.07 * Math.sin(p2 * Math.PI) - 0.02 * ease(p3);
      extraP.z = 0.03 * ease(p1) - 0.02 * ease(p3);
      extraR.x = 0.35 * ease(p1) - 0.2 * ease(p3) - 0.35 * ease(p4);
      extraR.y = -0.5 * ease(p1) + 0.5 * ease(p4);
      extraR.z = 0.45 * ease(p1) - 0.45 * ease(p4) + 0.12 * Math.sin(p2 * Math.PI);
      if (this.def.cls === 'pistol') { extraP.y -= 0.03 * ease(p1); }
      // mag object choreography
      if (p1 > 0.35 && k < 0.5) { magDropY = -(k - 0.1) * 0.55; magDropR = (k - 0.1) * 2.4; }
      if (k >= 0.5 && k < 0.72) { hideMag = true; }
      if (k >= 0.72) { magDropY = -(0.72 - k + 0.72) * 0.1; hideMag = false; }
      if (k >= 0.62 && k < 0.72) extraP.y -= 0.02;
      if (done) this.state = 'idle';
    } else if (st === 'melee') {
      const s = k;
      const swing = Math.sin(clamp(s / 0.45, 0, 1) * Math.PI);
      const back = Math.sin(clamp((s - 0.4) / 0.6, 0, 1) * Math.PI);
      extraP.x = -0.3 * back + 0.22 * swing;
      extraP.y = 0.06 * swing - 0.08 * back;
      extraP.z = -0.36 * swing + 0.16 * back;
      extraR.y = 0.9 * back - 1.5 * swing;
      extraR.x = -0.3 * swing + 0.4 * back;
      extraR.z = -0.5 * swing;
      if (done) this.state = 'idle';
    } else if (st === 'throw') {
      const wind = clamp(k / 0.35, 0, 1);
      const rel = clamp((k - 0.35) / 0.25, 0, 1);
      extraP.y = -0.06 * Math.sin(wind * Math.PI) - 0.05 * Math.sin(rel * Math.PI);
      extraP.z = 0.14 * Math.sin(wind * Math.PI) - 0.3 * Math.sin(rel * Math.PI);
      extraR.x = -0.5 * Math.sin(wind * Math.PI) + 0.7 * Math.sin(rel * Math.PI);
      extraR.z = 0.4 * Math.sin(wind * Math.PI);
      if (rel > 0.1 && !this._thrown) { this._thrown = true; this.onThrow && this.onThrow(); }
      if (done) this.state = 'idle';
    } else if (st === 'inspect') {
      const s = Math.sin(clamp(k / 0.5, 0, 1) * Math.PI);
      extraP.z = -0.12 * s;
      extraP.x = 0.06 * s;
      extraR.y = -1.1 * s;
      extraR.z = 0.6 * s;
      extraR.x = 0.2 * s;
      if (done) this.state = 'idle';
    } else if (st === 'hit') {
      extraP.z = 0.08 * Math.sin(k * Math.PI);
      extraR.x = 0.3 * Math.sin(k * Math.PI);
      if (done) this.state = 'idle';
    }

    baseP.add(extraP);
    baseR.x += extraR.x; baseR.y += extraR.y; baseR.z += extraR.z;

    // ── apply ──
    vm.position.copy(baseP);
    vm.rotation.copy(baseR);

    // mag choreography
    const mag = ud.mag;
    if (mag) {
      if (hideMag) { mag.visible = false; }
      else {
        mag.visible = true;
        mag.position.y = (mag.userData.baseY ?? (mag.userData.baseY = mag.position.y)) + magDropY;
        if (st === 'reload') mag.rotation.z = (mag.userData.baseRZ ?? (mag.userData.baseRZ = mag.rotation.z)) + magDropR;
      }
    }

    // muzzle flash decay
    const fl = ud.flash;
    if (fl && fl.visible) {
      const u = fl.userData;
      u.fade = Math.max(0, (u.fade ?? 0) - dt * 12);
      const on = u.fade > 0;
      fl.visible = on;
      if (on) {
        const s = 0.7 + u.fade * 0.9;
        u.cone.scale.set(s, s, 0.6 + u.fade * 0.8);
        u.star.scale.setScalar(0.7 + u.fade * 1.1);
        u.star2.scale.setScalar(0.55 + u.fade * 0.9);
        u.star.rotation.z = u.fade * 3.4;
        u.light.intensity = u.fade * 22;
        u.smoke.material.opacity = Math.max(0, (u.smoke.material.opacity || 0) - dt * 1.4);
      } else {
        u.light.intensity = 0;
      }
    }
    return this.state;
  }

  triggerFlash(strength = 1) {
    const fl = this.ud.flash;
    if (!fl) return;
    fl.visible = true;
    fl.userData.fade = 1 * strength;
    fl.userData.smoke.material.opacity = 0.35 * strength;
    fl.userData.smoke.scale.setScalar(0.8 + Math.random() * 0.5);
  }
}
