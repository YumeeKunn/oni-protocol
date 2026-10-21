// ═══════════════ BOT — operator model, ragdoll collapse, combat AI ═══════════════
import * as THREE from 'three';
import { boxGeo, projectUV } from '../core/geo.js';
import { clamp, damp, lerp, rand, chance, pick, angleDelta, rotTowards } from '../core/utils.js';
import { moveBody, rayHit } from './physics.js';
import { MOVE, COMBAT, DIFFICULTIES, BOT_RANGE } from '../core/config.js';
import { sfx } from '../core/audio.js';
import { WEAPONS } from '../weapons/defs.js';
import { hitscan, spreadDir } from '../weapons/weapons.js';

const BOT_KITS = ['m4a1', 'mp5', 'm1014', 'l96a1'];

// ── shared third-person operator materials ──
const CACHE = {};
function opMats(kit) {
  if (CACHE.kit === kit) return CACHE;
  CACHE.kit = kit;
  CACHE.alphaCamo = new THREE.MeshStandardMaterial({ map: kit.camoAlpha.map, normalMap: kit.camoAlpha.bumpNormal, roughness: 0.95 });
  CACHE.bravoCamo = new THREE.MeshStandardMaterial({ map: kit.camoBravo.map, normalMap: kit.camoBravo.bumpNormal, roughness: 0.95 });
  CACHE.ghillie = new THREE.MeshStandardMaterial({ map: kit.ghillie.map, normalMap: kit.ghillie.bumpNormal, roughness: 1 });
  CACHE.vest = new THREE.MeshStandardMaterial({ map: kit.tyre.map, normalMap: kit.tyre.bumpNormal, color: 0x5a5648, roughness: 0.85 });
  CACHE.vestBravo = new THREE.MeshStandardMaterial({ map: kit.tyre.map, normalMap: kit.tyre.bumpNormal, color: 0x2e3226, roughness: 0.9 });
  CACHE.skin = new THREE.MeshStandardMaterial({ color: 0x9a6b48, roughness: 0.78 });
  CACHE.boot = new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 0.9 });
  CACHE.helmet = new THREE.MeshStandardMaterial({ map: kit.metal.map, normalMap: kit.metal.bumpNormal, color: 0x5b5c4a, roughness: 0.72 });
  CACHE.bandana = new THREE.MeshStandardMaterial({ color: 0xa8322c, roughness: 0.88 });
  CACHE.steel = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.6 });
  CACHE.strap = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.9 });
  return CACHE;
}

function box(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d, 0.5), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** third-person rifle/smg/shotgun/sniper prop */
export function buildBotGun(kit, type = 'rifle') {
  const m = opMats(kit);
  const g = new THREE.Group();
  const L = type === 'sniper' ? 1.15 : (type === 'shotgun' ? 0.95 : (type === 'smg' ? 0.72 : 0.88));
  box(g, 0.055, 0.075, 0.3 * L, m.steel, 0, 0, -0.05 * L);
  box(g, 0.05, 0.06, 0.2 * L, m.steel, 0, -0.01, 0.09 * L);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34 * L, 8), m.steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.005, -0.3 * L);
  barrel.castShadow = true;
  g.add(barrel);
  box(g, 0.045, 0.11, 0.06, m.steel, 0, -0.08, 0.02, 0.25, 0, 0);                 // magazine
  box(g, 0.04, 0.07, 0.05, m.steel, 0, -0.06, 0.09, 0.15, 0, 0);                  // grip
  box(g, 0.045, 0.07, 0.16 * L, m.steel, 0, -0.01, 0.2 * L);                      // stock
  box(g, 0.02, 0.026, 0.02, m.steel, 0, 0.055, -0.18 * L);                        // front sight
  box(g, 0.026, 0.02, 0.02, m.steel, 0, 0.05, 0.04 * L);                          // rear sight
  if (type === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 10), m.steel);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.07, -0.05);
    scope.castShadow = true;
    g.add(scope);
  }
  if (type === 'shotgun') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 8), m.steel);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.03, -0.28);
    g.add(tube);
  }
  g.traverse(n => { if (n.isMesh) n.castShadow = true; });
  return g;
}

/** full operator: legs, torso, plate carrier, arms, head, faction dressing */
export class OperatorModel {
  constructor(kit, team, opts = {}) {
    const m = opMats(kit);
    const ghillie = opts.ghillie || (team === 'bravo' && chance(0.28));
    const body = team === 'alpha' ? m.alphaCamo : (ghillie ? m.ghillie : m.bravoCamo);
    const vest = team === 'alpha' ? m.vest : m.vestBravo;
    const root = new THREE.Group();
    this.root = root;
    this.team = team;
    this.ghillie = ghillie;

    // ── rig: root → hips (pelvis) → spine → chest → neck → head ──
    // Two extra pivots over the old single hips pivot: the pelvis can roll and the
    // chest counter-rotate / lean independently, which is what separates a real
    // walk from a mannequin gliding forward.
    const hips = new THREE.Group();
    hips.position.y = 0.94;
    root.add(hips);
    this.hips = hips;

    box(hips, 0.34, 0.2, 0.24, body, 0, -0.09, 0);                     // pelvis
    box(hips, 0.37, 0.09, 0.26, m.strap, 0, 0.02, 0);                  // belt

    const spine = new THREE.Group();
    hips.add(spine);
    this.spine = spine;

    const torso = new THREE.Group();
    spine.add(torso);
    this.torso = torso;
    box(torso, 0.42, 0.5, 0.24, body, 0, 0.28, 0);                     // chest
    box(torso, 0.4, 0.16, 0.22, body, 0, 0.02, 0);                     // waist
    const plate = box(torso, 0.38, 0.36, 0.1, vest, 0, 0.3, 0.14);     // front plate carrier
    plate.scale.z = 1;
    box(torso, 0.34, 0.3, 0.08, vest, 0, 0.3, -0.14);                  // back plate
    box(torso, 0.12, 0.22, 0.14, m.strap, -0.09, 0.32, -0.2);          // assault pack
    for (const sx of [-1, 1]) {
      box(torso, 0.09, 0.1, 0.09, m.strap, sx * 0.12, 0.12, 0.16);     // pouches
      box(torso, 0.07, 0.08, 0.05, m.strap, sx * 0.19, 0.17, 0.15);    // mag pouches
      box(torso, 0.13, 0.1, 0.15, vest, sx * 0.2, 0.47, 0);            // shoulder pads
    }
    box(torso, 0.2, 0.09, 0.06, m.strap, 0, 0.16, -0.16);              // radio
    box(torso, 0.05, 0.52, 0.03, m.strap, 0.11, 0.28, 0.19, 0, 0, 0.34); // sling across the chest
    if (team === 'bravo' && !ghillie) {
      box(torso, 0.26, 0.12, 0.06, m.strap, 0, 0.02, 0.13);            // chest rig
    }

    // neck + head
    const neck = new THREE.Group();
    neck.position.y = 0.55;
    torso.add(neck);
    this.neck = neck;
    box(neck, 0.1, 0.1, 0.1, m.skin, 0, 0.02, 0);
    const head = new THREE.Group();
    head.position.y = 0.09;
    neck.add(head);
    this.head = head;
    box(head, 0.17, 0.2, 0.19, m.skin, 0, 0.02, 0);
    box(head, 0.1, 0.07, 0.05, m.skin, 0, -0.02, 0.1);                 // jaw / neck
    if (team === 'alpha') {
      box(head, 0.24, 0.16, 0.26, m.helmet, 0, 0.11, -0.01);           // ballistic helmet
      box(head, 0.22, 0.05, 0.03, m.helmet, 0, 0.03, 0.12);            // rim
      box(head, 0.07, 0.07, 0.07, m.steel, 0, 0.2, 0.02);              // NVG mount
      box(head, 0.05, 0.05, 0.05, m.steel, 0, 0.2, 0.09);
      box(head, 0.25, 0.06, 0.1, m.strap, 0, 0.02, -0.06);             // chinstrap
    } else {
      box(head, 0.24, 0.11, 0.25, m.bandana, 0, 0.12, -0.01);          // bandana marker
      box(head, 0.26, 0.04, 0.06, m.bandana, 0, 0.06, 0.1);
      if (ghillie) {
        for (let i = 0; i < 12; i++) {
          box(head, 0.06, 0.16, 0.04, m.ghillie, rand(-0.13, 0.13), 0.1 + rand(-0.05, 0.1), rand(-0.14, 0.1), rand(-0.4, 0.4), rand(0, 3), rand(-0.3, 0.3));
        }
      }
    }

    // arms: shoulder pivots
    const mkArm = (side) => {
      const up = new THREE.Group();
      up.position.set(side * 0.24, 0.5, 0);
      torso.add(up);
      box(up, 0.11, 0.28, 0.12, body, 0, -0.14, 0);
      const low = new THREE.Group();
      low.position.y = -0.28;
      up.add(low);
      box(low, 0.1, 0.26, 0.1, body, 0, -0.13, 0);
      box(low, 0.1, 0.06, 0.11, m.strap, 0, -0.24, 0);                 // wrist strap
      box(low, 0.1, 0.12, 0.11, m.boot, 0, -0.3, 0);                   // glove
      return { up, low };
    };
    this.armR = mkArm(1);
    this.armL = mkArm(-1);

    // legs: thigh → shin → ankle, so the boot can stay flat on the ground
    const mkLeg = (side) => {
      const up = new THREE.Group();
      up.position.set(side * 0.11, -0.02, 0);
      hips.add(up);
      box(up, 0.16, 0.46, 0.17, body, 0, -0.23, 0);
      box(up, 0.17, 0.15, 0.18, vest, 0, -0.42, 0.01);                 // knee pad
      const low = new THREE.Group();
      low.position.y = -0.46;
      up.add(low);
      box(low, 0.14, 0.42, 0.14, body, 0, -0.2, 0);
      const foot = new THREE.Group();
      foot.position.y = -0.42;
      low.add(foot);
      box(foot, 0.16, 0.11, 0.28, m.boot, 0, -0.045, 0.05);            // combat boot
      return { up, low, foot };
    };
    this.legR = mkLeg(1);
    this.legL = mkLeg(-1);

    // carried weapon (parented to the torso, hands posed onto it)
    this.gun = buildBotGun(kit, opts.gunType || 'rifle');
    this.gun.position.set(0.02, 0.42, 0.28);
    torso.add(this.gun);
    this.gunMuzzle = new THREE.Object3D();
    const gl = (opts.gunType === 'sniper' ? 0.62 : 0.5);
    this.gunMuzzle.position.set(0, 0.005, -gl);
    this.gun.add(this.gunMuzzle);

    root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });

    this.walkPhase = Math.random() * 6.28;
    this.breathSeed = Math.random() * 6.28;
    this.aimPitch = 0;
    this.deadT = -1;
    this.root.rotation.y = 0;
  }

  /**
   * Pose the body from movement + aim state.
   * ctx = { speed, aiming, crouch, pitch, time, sprint, strafe, knock, air, alive }
   */
  pose(dt, ctx) {
    const {
      speed = 0, aiming = false, crouch = false, pitch = 0, time = 0, alive = true,
      sprint = false, strafe = 0, knock = 0, air = false,
    } = ctx;
    if (!alive) return;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const s = clamp(speed / 6.4, 0, 1.15);
    const moving = speed > 0.35 && !air;

    // gait phase advances with distance covered, not with wall-clock time — that is
    // what keeps the boots planted instead of skating over the cobbles
    if (moving) this.walkPhase += dt * (1.2 + speed * 1.95);
    const p = this.walkPhase;
    const sw = Math.sin(p);

    // ── legs ──
    const amp = crouch ? 0.26 : clamp(0.1 + s * 0.52, 0.1, 0.6);
    const leg = (L, side) => {
      const lp = p + (side > 0 ? 0 : Math.PI);
      const ls = Math.sin(lp);
      const pass = Math.max(0, Math.cos(lp));            // 1 at the passing position
      let thigh, knee, ankle;
      if (air) {
        thigh = side > 0 ? -0.62 : 0.28;
        knee = side > 0 ? 1.05 : 0.4;
        ankle = -(thigh + knee) * 0.45;
      } else if (crouch) {
        thigh = -0.92 + ls * 0.14;
        knee = 1.45 + pass * 0.1;
        ankle = 0.34;
      } else {
        thigh = -ls * amp - 0.05;
        knee = 0.12 + pass * (0.5 + s * 0.75) * 0.95 + Math.max(0, -ls) * 0.1;
        ankle = -(thigh + knee) * 0.7;
      }
      L.up.rotation.x = lerp(L.up.rotation.x, thigh, k(14));
      L.low.rotation.x = lerp(L.low.rotation.x, knee, k(15));
      L.foot.rotation.x = lerp(L.foot.rotation.x, ankle, k(16));
    };
    leg(this.legR, 1);
    leg(this.legL, -1);

    // ── pelvis: drop, roll and counter-rotate ──
    const hipBase = crouch ? 0.68 : 0.94;
    const bob = crouch ? 0 : -Math.cos(p * 2) * 0.02 * s - 0.008 * s;
    this.hips.position.y = lerp(this.hips.position.y, hipBase + bob, k(12));
    this.hips.rotation.z = lerp(this.hips.rotation.z, sw * 0.05 * s + strafe * 0.045, k(10));
    this.hips.rotation.y = lerp(this.hips.rotation.y, -sw * 0.07 * s, k(10));

    // ── chest: dropped-shoulder stance, counter-rotation, hit flinch ──
    const lean = (aiming ? 0.05 : 0.1) + s * 0.1 + (crouch ? 0.16 : 0) + knock * 0.3;
    this.spine.rotation.x = lerp(this.spine.rotation.x, lean, k(9));
    this.spine.rotation.y = lerp(this.spine.rotation.y, sw * 0.1 * s - strafe * 0.1, k(9));
    this.spine.rotation.z = lerp(this.spine.rotation.z, -strafe * 0.06 + knock * 0.2, k(12));

    // ── head: tracks the aim, cranes forward, nods on the gait ──
    const headPitch = clamp(pitch, -0.7, 0.9);
    this.neck.rotation.x = lerp(this.neck.rotation.x, headPitch * 0.45 + 0.04, k(13));
    this.head.rotation.x = lerp(this.head.rotation.x, headPitch * 0.55 - sw * 0.02 * s, k(13));
    this.head.rotation.y = lerp(this.head.rotation.y, aiming ? 0 : -strafe * 0.16, k(9));

    // ── arms + weapon carry (low-ready → shouldered → slung at sprint) ──
    const rec = this.gunRecoil || 0;
    this.gunRecoil = Math.max(0, rec - dt * 6);
    const aimW = aiming ? 1 : 0;
    const sprintW = sprint && !aiming ? 1 : 0;
    const swing = sw * (0.16 + s * 0.2);
    const mix = (idle, aim, sprintV) => lerp(lerp(idle, aim, aimW), sprintV, sprintW);

    this.armR.up.rotation.x = lerp(this.armR.up.rotation.x, mix(-0.58 + swing * 0.3, -0.95 + headPitch * 0.6, -0.3) - rec * 0.35, k(13));
    this.armR.up.rotation.z = lerp(this.armR.up.rotation.z, mix(-0.42, -0.24, -0.55), k(13));
    this.armR.low.rotation.x = lerp(this.armR.low.rotation.x, mix(-0.85, -0.5 - headPitch * 0.35, -1.0) - rec * 0.2, k(13));
    this.armL.up.rotation.x = lerp(this.armL.up.rotation.x, mix(-0.88 + swing * 0.4, -1.15 + headPitch * 0.6, -0.45) - rec * 0.3, k(13));
    this.armL.up.rotation.z = lerp(this.armL.up.rotation.z, mix(0.6, 0.46, 0.24), k(13));
    this.armL.low.rotation.x = lerp(this.armL.low.rotation.x, mix(-1.12, -0.7 - headPitch * 0.3, -0.95), k(13));

    const gp = this.gun.position, gr = this.gun.rotation;
    gp.x = damp(gp.x, mix(0.06, 0.02, 0.12), 14, dt);
    gp.y = damp(gp.y, mix(0.3, 0.42, 0.16), 14, dt);
    gp.z = damp(gp.z, mix(0.3, 0.28, 0.24) - rec * 0.05, 14, dt);
    gr.x = damp(gr.x, mix(0.42, headPitch * 0.9 - 0.02, 0.85) - rec * 0.22, 15, dt);
    gr.y = damp(gr.y, mix(0, 0, 0.2), 12, dt);
    gr.z = damp(gr.z, mix(0.1, 0, 0.55) + rec * 0.05, 13, dt);

    // idle breathing (tiny, but it kills the "statue" read)
    const breath = Math.sin(time * 1.35 + (this.breathSeed || 0)) * 0.006;
    this.neck.position.y = 0.55 + breath;
    this.torso.scale.y = 1 + breath * 0.5;
  }

  /** reset the rig to a neutral standing pose (respawn) */
  resetPose() {
    this.deadT = -1;
    this.gunDropped = false;
    this.gunRecoil = 0;
    this.gun.visible = true;
    this.hips.position.y = 0.94;
    this.hips.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.torso.scale.set(1, 1, 1);
    this.head.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    for (const L of [this.legR, this.legL]) {
      L.up.rotation.set(0, 0, 0);
      L.low.rotation.set(0, 0, 0);
      L.foot.rotation.set(0, 0, 0);
    }
    for (const A of [this.armR, this.armL]) {
      A.up.rotation.set(0, 0, 0);
      A.low.rotation.set(0, 0, 0);
    }
    this.gun.position.set(0.02, 0.42, 0.28);
    this.gun.rotation.set(0, 0, 0);
  }

  /** collapse: knees give out, the body folds, then it rolls to the ground */
  die(dirFrom, t0) {
    this.deadT = 0;
    this.deadDir = dirFrom || 1;
    this.deadSeed = Math.random() * 6.28;
    this.deadAxis = chance(0.5) ? 1 : -1;
    this.limpT = 0;
    this.fallV = 0;
    this.fallW = rand(2.2, 3.6) * this.deadAxis;
  }

  updateDeath(dt, groundY) {
    if (this.deadT < 0) return;
    this.deadT += dt;
    const t = this.deadT;
    const k = (r) => 1 - Math.exp(-r * dt);
    const limp = clamp(t / 0.6, 0, 1);
    const j = (n) => Math.sin(t * (5 + n) + this.deadSeed * n) * (1 - limp) * 0.45;

    // −− the last frame of the fall: knees buckle before the torso drops −−
    this.legR.up.rotation.x = lerp(this.legR.up.rotation.x, -0.3 + j(1) * 0.5, k(6));
    this.legL.up.rotation.x = lerp(this.legL.up.rotation.x, -0.55 + j(2) * 0.5, k(6));
    this.legR.low.rotation.x = lerp(this.legR.low.rotation.x, 1.1 + j(3) * 0.4, k(6));
    this.legL.low.rotation.x = lerp(this.legL.low.rotation.x, 0.75 + j(4) * 0.4, k(6));
    this.legR.foot.rotation.x = lerp(this.legR.foot.rotation.x, -0.3, k(6));
    this.legL.foot.rotation.x = lerp(this.legL.foot.rotation.x, -0.2, k(6));
    this.hips.position.y = lerp(this.hips.position.y, 0.52, k(5));
    this.hips.rotation.z = lerp(this.hips.rotation.z, 0.16 * this.deadAxis, k(4));

    this.armR.up.rotation.x = lerp(this.armR.up.rotation.x, -0.5 + j(5) * 0.8, k(5));
    this.armL.up.rotation.x = lerp(this.armL.up.rotation.x, -0.25 + j(6) * 0.8, k(5));
    this.armR.up.rotation.z = lerp(this.armR.up.rotation.z, 0.7 + j(7) * 0.35, k(4));
    this.armL.up.rotation.z = lerp(this.armL.up.rotation.z, -0.9 + j(8) * 0.35, k(4));
    this.armR.low.rotation.x = lerp(this.armR.low.rotation.x, -0.5, k(5));
    this.armL.low.rotation.x = lerp(this.armL.low.rotation.x, -0.4, k(5));

    this.spine.rotation.x = lerp(this.spine.rotation.x, 0.42, k(4));
    this.spine.rotation.z = lerp(this.spine.rotation.z, 0.28 * this.deadAxis, k(3));
    this.neck.rotation.x = lerp(this.neck.rotation.x, 0.3, k(4));
    this.head.rotation.x = lerp(this.head.rotation.x, 0.35, k(4));

    this.gun.visible = t < 0.35;
    if (!this.gun.visible && !this.gunDropped) {
      this.gunDropped = true;
      this.dropCallback && this.dropCallback();
    }
    // fold, then rotate around the feet and settle with a small bounce
    const fall = clamp((t - 0.1) / 0.72, 0, 1);
    const ease = fall * fall * (3 - 2 * fall);
    this.root.rotation.x = ease * (Math.PI / 2) * 0.94 * this.deadDir;
    this.root.rotation.z = ease * 0.38 * this.deadAxis;
    this.root.position.y = groundY + Math.sin(clamp(t / 0.95, 0, 1) * Math.PI) * 0.05 + ease * 0.1;
  }
}

// ── name tag sprite (friendly triangles + name, like the reference HUD) ──
export function makeNameTag(name, css = '#4ade80') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 256, 64);
  // green triangle marker
  c.fillStyle = css;
  c.beginPath();
  c.moveTo(30, 34); c.lineTo(14, 56); c.lineTo(46, 56);
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(30, 22); c.lineTo(20, 36); c.lineTo(40, 36);
  c.closePath();
  c.fill();
  c.font = 'bold 30px "Rajdhani","Arial Narrow",Arial,sans-serif';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillText(name.toUpperCase(), 60, 40);
  c.fillStyle = css;
  c.fillText(name.toUpperCase(), 58, 38);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.95, 0.24, 1);
  sp.renderOrder = 30;
  return sp;
}

// ═══════════════ BOT AI ═══════════════
export class Bot {
  constructor(game, o) {
    this.game = game;
    this.world = game.world;
    this.grid = game.world.grid;
    this.team = o.team;
    this.name = o.name;
    this.difficulty = DIFFICULTIES[o.difficulty] || DIFFICULTIES.regular;
    this.isBot = true;
    this.radius = MOVE.radius * 1.05;
    this.height = 1.75;
    this.step = MOVE.stepHeight;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.hp = 100 * this.difficulty.hp;
    this.maxHp = this.hp;
    this.alive = true;
    this.onGround = true;
    this.crouching = false;
    this.speed = 0;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.headshots = 0;
    this.spawnProtect = COMBAT.spawnProtect;
    this.lastHit = -99;
    this.lastAttacker = null;
    this.wallN = new THREE.Vector3(1, 0, 0);
    this.wallT = 0;
    this.blockT = 0;
    this.dodgeT = 0;
    this.dodgeDir = 1;
    this.strafeT = 0;
    this.strafeDir = 1;

    this.classId = o.classId || pick(BOT_KITS.slice(0, 3));
    const def = WEAPONS[this.classId];
    this.weapon = def;
    // fighting distance: what the gun is for, stretched by how good this bot is
    this.idealRange = BOT_RANGE[def.cls] ?? 12;
    this.engageRange = this.idealRange * (1.15 + this.difficulty.engage * 0.25);
    this.pushT = 0;
    this.mag = def.mag;
    this.reloading = 0;
    this.fireT = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.reactT = 0;
    this.target = null;
    this.targetSeen = 0;
    this.lastSeenPos = new THREE.Vector3();
    this.aimError = new THREE.Vector3();
    this.recoilAim = 0;
    this.path = null;
    this.pathI = 0;
    this.repathT = 0;
    this.goal = new THREE.Vector3(o.spawn.x, 0, o.spawn.z);
    this.goalSetT = 0;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.strafeDir = chance(0.5) ? 1 : -1;
    this.strafeT = rand(0.4, 1.2);
    this.perceptT = Math.random() * 0.2;
    this.state = 'advance';
    this.distToListener = 999;
    this.nadeT = rand(6, 18);
    this.dropCooldown = 0;

    this.model = new OperatorModel(this.world.kit, this.team, {
      ghillie: o.ghillie,
      gunType: def.cls === 'sniper' ? 'sniper' : def.cls === 'shotgun' ? 'shotgun' : def.cls === 'smg' ? 'smg' : 'rifle',
    });
    game.scene.add(this.model.root);
    this.model.dropCallback = () => this.dropWeapon();
    this.tag = null;
    if (this.team === (game.player?.team || 'alpha')) {
      this.tag = makeNameTag(this.name, '#4ade80');
      this.tag.position.y = 2.1;
      game.scene.add(this.tag);
    }
    this.dropCooldown = 0;
    this.reset({ x: o.spawn.x, z: o.spawn.z, yaw: o.spawn.yaw ?? 0 });
  }

  dropWeapon() {
    const g = buildBotGun(this.world.kit, this.weapon.cls === 'sniper' ? 'sniper' : 'rifle');
    g.position.copy(this.model.root.position).add(new THREE.Vector3(rand(-0.3, 0.3), 0.6, rand(-0.3, 0.3)));
    g.rotation.set(Math.PI / 2 * rand(0.7, 1.3), rand(0, 6.28), rand(-0.4, 0.4));
    g.traverse(n => { if (n.isMesh) n.castShadow = true; });
    this.game.scene.add(g);
    this.droppedGun = g;
    setTimeout(() => {
      this.game.scene.remove(g);
      this.droppedGun = null;
    }, 22000);
  }

  reset(spawn) {
    this.pos.set(spawn.x, this.world.groundHeight(spawn.x, spawn.z), spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.aimYaw = this.yaw;
    this.aimPitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.mag = this.weapon.mag;
    this.reloading = 0;
    this.target = null;
    this.reactT = 0;
    this.state = 'advance';
    this.path = null;
    this.spawnProtect = COMBAT.spawnProtect;
    this.model.root.visible = true;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.set(0, this.yaw, 0);
    this.model.resetPose();
    if (this.droppedGun) { this.game.scene.remove(this.droppedGun); this.droppedGun = null; }
    this.goal.set(spawn.x, 0, spawn.z);
    this.goalSetT = 0;
    this.stuckT = 0;
  }

  get eyeY() { return this.pos.y + 1.6; }

  damage(amount, from, weaponName = 'M4A1', opts = {}) {
    if (!this.alive || this.spawnProtect > 0) return false;
    this.hp -= amount;
    this.lastHit = performance.now() / 1000;
    if (from && from !== this) {
      this.lastAttacker = from;
      // flinch the aim + body so incoming fire reads on the model
      this.recoilAim += amount * 0.0022;
      this.hitFlinch = Math.min(1, (this.hitFlinch || 0) + 0.45 + amount * 0.006);
      // getting shot pulls attention to the shooter even from outside the cone
      if (from.alive) {
        this.target = from;
        this.targetSeen = performance.now() / 1000;
        this.lastSeenPos.set(from.pos.x, from.pos.y + from.height * 0.6, from.pos.z);
        this.reactT = Math.min(this.reactT, 0.12);
      }
    }
    if (this.hp <= 0) {
      this.die(from, weaponName, opts);
      return true;
    }
    if (from && from.isBot === undefined) { /* player shot me */ }
    return true;
  }

  die(from, weaponName, opts = {}) {
    this.alive = false;
    this.hp = 0;
    this.deaths++;
    const dir = from ? Math.atan2(this.pos.x - from.pos.x, this.pos.z - from.pos.z) : 0;
    const local = Math.cos(dir) * 1;
    this.model.die(Math.cos(angleDelta(this.yaw, dir)) > 0 ? 1 : -1, performance.now() / 1000);
    if (this.tag) this.tag.visible = false;
    sfx.death(this.game.player.pos.distanceTo(this.pos));
    this.game.onBotDeath?.(this, from, weaponName, opts);
    this.game.squad?.onDeath?.(this, from, weaponName, opts);
  }

  // ── perception ──
  perceive(dt, time) {
    this.perceptT -= dt;
    if (this.perceptT > 0) return;
    this.perceptT = 0.14 + Math.random() * 0.1;
    const eye = new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z);
    let best = null, bestScore = -1;
    for (const e of this.game.entities) {
      if (e === this || !e.alive) continue;
      const hostile = this.game.isHostile(this, e);
      if (!hostile) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const maxSee = 48 * this.difficulty.accuracyRange;
      if (dist > maxSee) continue;
      const bearing = Math.atan2(-dx, -dz);
      const off = Math.abs(angleDelta(this.yaw, bearing));
      const fov = dist < 7 ? 1.35 : 0.95;   // ≈155° close, ≈109° normal cone
      if (off > fov) continue;
      const target = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.62, e.pos.z);
      if (!this.lineOfSight(eye, target)) continue;
      let score = 100 - dist;
      if (e === this.game.player) score += 14;
      if (off < 0.4) score += 10;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (this.target !== best && this.target !== null) this.reactT = this.difficulty.reaction;
      if (this.target !== best) this.reactT = this.difficulty.reaction * rand(0.8, 1.4);
      this.target = best;
      this.targetSeen = time;
      this.lastSeenPos.set(best.pos.x, best.pos.y, best.pos.z);
    } else if (this.target && time - this.targetSeen > 1.1) {
      this.target = null;
    }
  }

  lineOfSight(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.001) return true;
    dir.divideScalar(len);
    const hit = hitscanLOS(this.world.grid, from, dir, len - 0.3);
    return !hit;
  }

  // ── movement intent ──
  pickGoal() {
    const nav = this.game.nav;
    const enemies = this.game.entities.filter(e => e.alive && this.game.isHostile(this, e));
    let focus = this.target;
    if (!focus && enemies.length) {
      focus = enemies.reduce((a, b) => (
        Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z) < Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) ? b : a
      ));
    }
    let res = null;
    if (focus) res = nav.goalNear(this.pos.x, this.pos.z, focus.pos.x, focus.pos.z, 9);
    // fall back to a reachable wander goal so the bot never freezes on a bad pick
    for (let i = 0; i < 6 && !res; i++) {
      const p = nav.randomNear(this.pos.x, this.pos.z, 26) || nav.randomPoint();
      if (!nav.walkable(p.x, p.z)) continue;
      const path = nav.path(this.pos.x, this.pos.z, p.x, p.z);
      if (path) res = { goal: p, path };
    }
    if (res) {
      this.goal.set(res.goal.x, 0, res.goal.z);
      this.path = res.path;
      this.pathI = 0;
    } else {
      // nothing reachable: push straight at the nearest enemy so we never freeze
      const t = focus || { pos: { x: 0, z: 0 } };
      this.goal.set(t.pos.x, 0, t.pos.z);
      this.path = null;
    }
    this.goalSetT = 0;
    this.repathT = rand(0.9, 1.7);
  }

  update(dt, time) {
    if (!this.alive) {
      this.model.updateDeath(dt, this.world.groundHeight(this.pos.x, this.pos.z));
      return;
    }
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    const d = this.difficulty;
    this.perceive(dt, time);
    this.goalSetT += dt;
    this.repathT -= dt;
    this.dropCooldown = Math.max(0, this.dropCooldown - dt);
    if (this.droppedGun && this.dropCooldown > 0) { /* keep corpse gun */ }

    const isSniper = this.weapon.cls === 'sniper';
    const hasTarget = !!this.target;
    const ideal = this.idealRange;
    this.pushT = Math.max(0, this.pushT - dt);

    // ── state machine ──
    // Bots fight in your face: outside the engage range they keep pushing in,
    // inside it they strafe, and only when you are almost touching do they back off.
    if (hasTarget) {
      const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      const rush = dist > this.engageRange;
      this.state = rush ? 'advance' : (dist < ideal * 0.55 ? 'back' : 'hold');
      if (rush) this.pushT = 0.6;
    } else {
      this.state = this.goalSetT > 7 ? 'reposition' : 'advance';
    }
    if (this.state === 'reposition' || (!hasTarget && this.goalSetT > 5) || (this.path && this.pathI >= this.path.length)) {
      this.pickGoal();
      this.state = 'advance';
    }

    // ── pathing ──
    if (this.goalSetT > 0.2) {
      if ((!this.path || this.pathI >= this.path.length) && this.goalSetT > 0.35) {
        this.pickGoal();                                   // goal + path in one shot
      } else if (this.repathT <= 0) {
        const p = this.game.nav.path(this.pos.x, this.pos.z, this.goal.x, this.goal.z);
        if (p) { this.path = p; this.pathI = 0; }
        else this.pickGoal();
        this.repathT = rand(0.9, 1.7);
      }
    }

    // ── steering ──
    let wishX = 0, wishZ = 0;
    const standoff = hasTarget && this.state === 'hold';
    const retreating = hasTarget && this.state === 'back';
    if (retreating && this.target) {
      const dx = this.pos.x - this.target.pos.x, dz = this.pos.z - this.target.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      wishX = dx / dist; wishZ = dz / dist;
    } else if (standoff) {
      // strafe around the enemy, keep the distance — but break off if the strafe
      // grinds into a wall or another prop
      this.strafeT -= dt;
      if (this.strafeT <= 0 || this.blockT > 0.25) {
        this.strafeT = rand(0.6, 1.8);
        this.strafeDir *= -1;
        if (this.blockT > 0.25) this.blockT = 0;
      }
      if (this.stuckT > 0.55) { this.state = 'advance'; this.path = null; this.repathT = 0; }
      const a = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z) + Math.PI / 2;
      wishX = Math.sin(a) * this.strafeDir;
      wishZ = Math.cos(a) * this.strafeDir;
      if (Math.random() < 0.01) this.crouching = !this.crouching;
    } else if (hasTarget && this.pushT > 0) {
      // beeline: a clear line to the target is always faster than the waypoint path
      const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      wishX = dx / dist; wishZ = dz / dist;
    } else if (this.path && this.pathI < this.path.length) {
      const wp = this.path[this.pathI];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2) this.pathI++;
      else { wishX = dx / dist; wishZ = dz / dist; }
    } else if (hasTarget) {
      const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      wishX = dx / dist; wishZ = dz / dist;
    } else {
      // last resort: push straight at the goal so we never stand still
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (dist > 1.5) { wishX = dx / dist; wishZ = dz / dist; }
    }

    // ── wall handling: slide along the contact plane, then dodge when pinned ──
    if (this.wallT > 0 && (wishX || wishZ)) {
      const n = this.wallN;
      const dot = wishX * n.x + wishZ * n.z;
      if (dot < 0) { wishX -= n.x * dot; wishZ -= n.z * dot; }
      const len = Math.hypot(wishX, wishZ);
      if (len > 1e-4) { wishX /= len; wishZ /= len; }
    }
    this.dodgeT -= dt;
    if (this.blockT > 0.12 && this.dodgeT <= 0) { this.dodgeT = rand(0.3, 0.55); this.dodgeDir = chance(0.5) ? 1 : -1; }
    if (this.dodgeT > 0 && (wishX || wishZ)) {
      const a = this.dodgeDir * 1.2 * Math.min(1, this.dodgeT * 3.2);
      const cs = Math.cos(a), sn = Math.sin(a);
      const wx = wishX * cs - wishZ * sn, wz = wishX * sn + wishZ * cs;
      wishX = wx; wishZ = wz;
    }

    // ── aim ──
    let aimTargetYaw = this.yaw, aimTargetPitch = 0;
    if (hasTarget) {
      const tp = this.target.pos;
      const tHeight = this.target.height * (chance(0.25) ? 0.86 : 0.62);
      const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
      const dy = (tp.y + tHeight) - this.eyeY;
      aimTargetYaw = Math.atan2(-dx, -dz);
      aimTargetPitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.lastSeenPos.set(tp.x, tp.y + tHeight, tp.z);
    } else {
      aimTargetYaw = Math.atan2(-wishX, -wishZ);
      this.aimPitch = damp(this.aimPitch, 0, 4, dt);
    }
    const turnRate = 7.6 * (1 / Math.max(0.4, d.reaction * 3.2));
    this.aimYaw = rotTowards(this.aimYaw, aimTargetYaw, turnRate * dt);
    if (hasTarget) this.aimPitch = rotTowards(this.aimPitch, aimTargetPitch, turnRate * 0.8 * dt);
    this.yaw = this.aimYaw;
    this.pitch = this.aimPitch;

    // ── move ──
    const w = MOVE;
    const sprinting = this.state === 'advance' && !hasTarget ? true : (this.pushT > 0 && this.weapon.cls !== 'sniper');
    const moveSpeed = (this.crouching ? w.crouch : (sprinting ? w.sprint : w.walk)) * d.speed * (sprinting ? 0.94 : 0.92);
    if (this.onGround) {
      // same target-velocity model the player uses (MW-style ground response)
      botAccelerateGround(this.vel, wishX, wishZ, moveSpeed, dt);
    } else {
      botAccelerateAir(this.vel, wishX, wishZ, dt);
    }
    this.vel.y -= w.gravity * dt;
    const res = moveBody({ pos: this.pos, vel: this.vel, radius: this.radius, height: this.height, step: this.step }, dt, this.grid, this.world.groundHeight);
    this.onGround = res.grounded;

    // pinned against geometry while chasing a waypoint → drop it and repath
    if (res.hitWall) { this.wallT = 0.3; this.wallN.copy(res.wallNormal); } else this.wallT = Math.max(0, (this.wallT || 0) - dt);
    if (res.hitWall && this.speed < 0.8) this.blockT = (this.blockT || 0) + dt; else this.blockT = 0;
    if (this.blockT > 0.3) {
      this.blockT = 0;
      if (this.path && this.pathI < this.path.length - 1) this.pathI++;
      else this.path = null;
      this.repathT = 0;
    }

    // stuck handling
    const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
    this.dbg = {
      st: this.state, wish: [+wishX.toFixed(2), +wishZ.toFixed(2)], v: [+this.vel.x.toFixed(2), +this.vel.z.toFixed(2)],
      moved: +moved.toFixed(3), wall: !!res.hitWall, py: +this.pos.y.toFixed(2),
      wp: this.path && this.path[this.pathI] ? [+this.path[this.pathI].x.toFixed(1), +this.path[this.pathI].z.toFixed(1)] : null,
      pathN: this.path ? this.path.length : -1, pathI: this.pathI, goal: [+this.goal.x.toFixed(1), +this.goal.z.toFixed(1)],
    };
    if (moved < 0.03) this.stuckT += dt; else this.stuckT = 0;
    this.lastPos.copy(this.pos);
    if (this.stuckT > 0.9) {
      this.stuckT = 0;
      this.path = null;
      this.repathT = 0;
      this.strafeDir *= -1;
      this.vel.x += rand(-2.5, 2.5);
      this.vel.z += rand(-2.5, 2.5);
      if (this.onGround && chance(0.4)) this.vel.y = 5.6;
      this.pickGoal();
    }
    // hard unstick: if the bot is still wedged (a deck, a prop, a wall corner)
    // drop it back onto the nearest walkable cell of the nav grid
    this.wedgeT = (this.wedgeT || 0) + (moved < 0.05 ? dt : -dt * 2);
    if (this.wedgeT > 1.6) {
      this.wedgeT = 0;
      const p = this.game.nav.nearestWalkable(this.pos.x, this.pos.z, 9);
      if (p) {
        this.pos.set(p.x, this.game.nav.groundAt(p.x, p.z), p.z);
        this.vel.set(0, 0, 0);
        this.path = null;
        this.repathT = 0;
        this.reactT = this.difficulty.reaction;
        this.targetSeen = 0;          // forget where we saw them, re-acquire
      }
    } else if (this.wedgeT < 0) this.wedgeT = 0;
    const lim = this.world.bounds - 1.4;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ── combat ──
    this.fireT = Math.max(0, this.fireT - dt);
    this.recoilAim = Math.max(0, this.recoilAim - dt * 0.9);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.mag = this.weapon.mag;
    } else if (hasTarget) {
      this.reactT -= dt;
      const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      const off = Math.abs(angleDelta(this.yaw, Math.atan2(-(this.target.pos.x - this.pos.x), -(this.target.pos.z - this.pos.z))));
      if (this.mag <= 0) {
        this.reloading = this.weapon.reload * rand(0.95, 1.15);
        sfx.mech('mag');
      } else if (this.reactT <= 0 && off < 0.16 && this.dropCooldown <= 0 && dist <= this.engageRange) {
        if (this.fireT <= 0) this.shoot(dist);
      }
      // grenades when the enemy sits behind cover nearby
      this.nadeT -= dt;
      if (this.nadeT <= 0 && dist < 26 && dist > 9 && chance(0.4)) {
        this.nadeT = rand(14, 30);
        this.throwNade();
      }
    } else {
      this.reactT = this.difficulty.reaction;
    }

    // ── present ──
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.pose(dt, {
      speed: this.speed, aiming: hasTarget, crouch: this.crouching,
      pitch: this.pitch, time, sprint: sprinting, air: !this.onGround,
      strafe: hasTarget ? clamp((wishX * Math.cos(this.yaw) - wishZ * Math.sin(this.yaw)) * 2.2, -1, 1) : 0,
      knock: this.hitFlinch || 0,
    });
    this.hitFlinch = Math.max(0, (this.hitFlinch || 0) - dt * 3.2);
    if (this.tag) {
      const cam = this.game.player.camera;
      const dist = cam.position.distanceTo(this.model.root.position);
      this.tag.visible = this.alive && dist < 52;
      this.tag.position.set(this.pos.x, this.pos.y + 2.05, this.pos.z);
      const s = clamp(dist / 12, 0.85, 2.4);
      this.tag.scale.set(0.95 * s, 0.24 * s, 1);
      this.tag.material.opacity = clamp(1.25 - dist / 48, 0.05, 1);
    }
  }

  shoot(dist) {
    const d = this.difficulty;
    const w = this.weapon;
    const auto = w.auto;
    this.bShots = (this.bShots || 0) + 1;
    this.lastShotDist = dist;
    this.shotDists = this.shotDists || [];
    this.shotDists.push(Math.round(dist * 10) / 10);
    if (this.shotDists.length > 40) this.shotDists.shift();
    if (this.burstPause > 0) { this.burstPause -= 0.1; return; }
    if (this.burstLeft <= 0) {
      this.burstLeft = w.cls === 'sniper' ? 1 : (w.cls === 'shotgun' ? 1 : Math.round(rand(2, 4)));
    }
    this.mag--;
    this.burstLeft--;
    this.fireT = (60 / w.rpm) / d.fireRate;
    if (this.burstLeft <= 0) this.fireT += rand(0.45, 0.9) / d.fireRate;
    this.model.gunRecoil = 1;
    if (this.target && this.target.weaponRecoilHit) this.target.weaponRecoilHit();

    // muzzle flash + sound (bots are 3D-positioned)
    const muzzle = new THREE.Vector3();
    this.model.gunMuzzle.getWorldPosition(muzzle);
    this.distToListener = this.game.player.pos.distanceTo(this.pos);
    const pan = this.panToListener();
    sfx.gunshot(w.audio, { dist: this.distToListener, pan, indoors: false, first: false });

    // don't fire into cover: re-check line of sight on every shot
    const eye = new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z);
    const chest = new THREE.Vector3(this.target.pos.x, this.target.pos.y + this.target.height * 0.6, this.target.pos.z);
    if (!this.lineOfSight(eye, chest)) { this.reactT = 0.18; return; }

    // physics-based shot with difficulty spread
    const origin = muzzle.clone();
    const tp = this.target.pos;
    const chestY = tp.y + this.target.height * (0.55 + Math.random() * 0.12);
    const aim = new THREE.Vector3(tp.x - origin.x, chestY - origin.y, tp.z - origin.z).normalize();
    const movePenalty = this.speed > 2.2 ? 1.7 : 1;
    const spreadDeg = (0.20 + w.spread.base) * d.spread * movePenalty * (1 + dist / 16) + this.recoilAim * 5;
    const dir = spreadDir(aim, spreadDeg, new THREE.Vector3(0, 1, 0));
    const hit = hitscan(this.game, this, origin, dir, 200, { team: true, friendlyFire: false });
    // tracer ends at the impact point, never behind a wall
    const endPt = hit.point ? hit.point.clone() : origin.clone().addScaledVector(dir, 60);
    this.game.fx.tracer(muzzle, endPt, { width: 0.03, opacity: 0.5, color: 0xffd89a });
    // supersonic crack if the round passes close to the player's head
    this.whizPast(origin, dir);
    if (hit.type === 'world') {
      this.bWorld = (this.bWorld || 0) + 1;
      this.game.fx.impact(hit.point, hit.normal, hit.tag, this.distToListener);
      sfx.impact('concrete', this.distToListener, this.panToListener());
    } else if (hit.type === 'entity') {
      this.bHits = (this.bHits || 0) + 1;
      const ent = hit.entity;
      let dmg = (w.dmg * d.dmg) * rand(0.9, 1.1);
      if (w.falloff) {
        const [f0, f1, fmin] = w.falloff;
        const f = hit.dist <= f0 ? 1 : hit.dist >= f1 ? fmin : 1 + (fmin - 1) * ((hit.dist - f0) / (f1 - f0));
        dmg *= f;
      }
      if (hit.headshot) dmg *= w.headMult * (chance(0.6) ? 1 : 0.5);
      const killed = ent.damage(dmg, this, w.name, { headshot: hit.headshot, dist: hit.dist });
      this.game.fx.impact(hit.point, null, 'flesh');
      if (killed && ent === this.game.player) sfx.killConfirm();
    }
  }

  /** play a whiz-by when a shot passes within a couple of metres of the player */
  whizPast(origin, dir) {
    const p = this.game.player;
    if (!p || !p.alive) return;
    const head = new THREE.Vector3(p.pos.x, p.pos.y + p.height * 0.92, p.pos.z);
    const rel = new THREE.Vector3().subVectors(head, origin);
    const along = rel.dot(dir);
    if (along <= 0 || along > 90) return;
    const closest = new THREE.Vector3().copy(origin).addScaledVector(dir, along);
    const off = closest.distanceTo(head);
    if (off > 3.2) return;
    // pan by which side of the head the round passed
    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const side = rel.dot(right);
    sfx.whiz(clamp(side / 2.2, -1, 1), along);
  }

  panToListener() {
    const p = this.game.player;
    const cam = p.camera;
    const dx = this.pos.x - cam.position.x, dz = this.pos.z - cam.position.z;
    const yaw = Math.atan2(-dx, -dz);
    return clamp(Math.sin(angleDelta(yaw, p.yaw)) * 0.9, -1, 1);
  }

  throwNade() {
    const p = this.game.player;
    const dir = new THREE.Vector3(this.lastSeenPos.x - this.pos.x, 5.5, this.lastSeenPos.z - this.pos.z).normalize();
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z).addScaledVector(dir, 0.4);
    const v = dir.multiplyScalar(15);
    this.game.weapons.spawnProjectile(from, v, this);
    sfx.grenadePin();
  }
}

function hitscanLOS(grid, origin, dir, maxDist) {
  return rayHit(grid, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);
}

// local copies of the movement primitives (avoid a cycle with player.js)
/** drive the horizontal velocity toward (fx,fz) * target at MOVE.accel m/s² */
function botAccelerateGround(vel, fx, fz, target, dt) {
  const tx = fx * target, tz = fz * target;
  const dx = tx - vel.x, dz = tz - vel.z;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-6) return;
  const cur = Math.hypot(vel.x, vel.z);
  const rate = target < cur * 0.92 ? MOVE.decel : MOVE.accel;
  const step = rate * dt;
  if (dl <= step) { vel.x = tx; vel.z = tz; }
  else { const s = step / dl; vel.x += dx * s; vel.z += dz * s; }
}

/** air control — a quarter of ground authority, capped so it cannot add speed */
function botAccelerateAir(vel, fx, fz, dt) {
  if (!fx && !fz) return;
  const along = vel.x * fx + vel.z * fz;
  const add = MOVE.airSpeedCap - along;
  if (add <= 0) return;
  const accel = MOVE.accel * MOVE.airAccelScale * dt;
  const gain = accel < add ? accel : add;
  vel.x += fx * gain; vel.z += fz * gain;
}

function accelerateXZ(vel, wx, wz, wishSpeed, accel, dt) {
  const current = vel.x * wx + vel.z * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > add) accelSpeed = add;
  vel.x += wx * accelSpeed;
  vel.z += wz * accelSpeed;
}
function frictionXZ(vel, dt, fr, stop) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.02) { vel.x = 0; vel.z = 0; return; }
  const drop = Math.max(speed * fr * dt, stop * dt);
  const ns = Math.max(0, speed - drop) / speed;
  vel.x *= ns;
  vel.z *= ns;
}
