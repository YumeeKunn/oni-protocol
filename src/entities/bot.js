// ═══════════════ BOT — operator model, ragdoll collapse, combat AI ═══════════════
import * as THREE from 'three';
import { boxGeo, projectUV } from '../core/geo.js';
import { clamp, damp, lerp, rand, chance, pick, angleDelta, rotTowards } from '../core/utils.js';
import { moveBody, rayHit } from './physics.js';
import { MOVE, COMBAT, DIFFICULTIES } from '../core/config.js';
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

    // hips pivot carries the upper body
    const hips = new THREE.Group();
    hips.position.y = 0.94;
    root.add(hips);
    this.hips = hips;

    const torso = new THREE.Group();
    hips.add(torso);
    this.torso = torso;
    box(torso, 0.42, 0.5, 0.24, body, 0, 0.28, 0);                     // chest
    box(torso, 0.4, 0.16, 0.22, body, 0, 0.02, 0);                     // waist
    const plate = box(torso, 0.38, 0.36, 0.1, vest, 0, 0.3, 0.14);     // front plate carrier
    plate.scale.z = 1;
    box(torso, 0.34, 0.3, 0.08, vest, 0, 0.3, -0.14);                  // back plate
    for (const sx of [-1, 1]) box(torso, 0.09, 0.1, 0.09, m.strap, sx * 0.12, 0.12, 0.16);   // pouches
    box(torso, 0.2, 0.09, 0.06, m.strap, 0, 0.16, -0.16);              // radio
    if (team === 'bravo' && !ghillie) {
      box(torso, 0.26, 0.12, 0.06, m.strap, 0, 0.02, 0.13);            // chest rig
    }

    // head + helmet
    const head = new THREE.Group();
    head.position.y = 0.62;
    torso.add(head);
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

    // legs
    const mkLeg = (side) => {
      const up = new THREE.Group();
      up.position.set(side * 0.11, 0, 0);
      hips.add(up);
      box(up, 0.15, 0.46, 0.16, body, 0, -0.24, 0);
      const low = new THREE.Group();
      low.position.y = -0.46;
      up.add(low);
      box(low, 0.14, 0.44, 0.14, body, 0, -0.22, 0);
      box(low, 0.16, 0.12, 0.26, m.boot, 0, -0.44, 0.04);              // combat boot
      return { up, low };
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
    this.aimPitch = 0;
    this.deadT = -1;
    this.root.rotation.y = 0;
  }

  /** pose the body from movement + aim state */
  pose(dt, ctx) {
    const { speed = 0, aiming = false, crouch = false, pitch = 0, time = 0, alive = true } = ctx;
    const moving = speed > 0.4;
    if (!alive) return;
    this.walkPhase += dt * (3.4 + speed * 1.15);
    const s = clamp(speed / 6.5, 0, 1.4);
    const swing = Math.sin(this.walkPhase) * s;
    const swing2 = Math.sin(this.walkPhase * 2) * s;
    if (crouch) {
      this.hips.position.y = lerp(this.hips.position.y, 0.66, 1 - Math.exp(-9 * dt));
      this.legR.up.rotation.x = lerp(this.legR.up.rotation.x, 0.95, 1 - Math.exp(-9 * dt));
      this.legL.up.rotation.x = lerp(this.legL.up.rotation.x, 0.95, 1 - Math.exp(-9 * dt));
      this.legR.low.rotation.x = lerp(this.legR.low.rotation.x, -1.5, 1 - Math.exp(-9 * dt));
      this.legL.low.rotation.x = lerp(this.legL.low.rotation.x, -1.5, 1 - Math.exp(-9 * dt));
    } else {
      this.hips.position.y = lerp(this.hips.position.y, 0.94, 1 - Math.exp(-9 * dt));
      this.legR.up.rotation.x = swing * 0.62;
      this.legL.up.rotation.x = -swing * 0.62;
      this.legR.low.rotation.x = Math.max(0, -swing) * 0.75;
      this.legL.low.rotation.x = Math.max(0, swing) * 0.75;
    }
    // torso lean + bob
    this.torso.rotation.x = lerp(this.torso.rotation.x, clamp(speed * 0.014, 0, 0.16) + (aiming ? -0.06 : 0), 1 - Math.exp(-8 * dt));
    this.torso.position.y = swing2 * 0.02;
    this.torso.rotation.y = lerp(this.torso.rotation.y, -swing * 0.06, 1 - Math.exp(-8 * dt));
    // arms hold the weapon
    const hold = aiming ? 1 : 0.55;
    const recoil = this.gunRecoil || 0;
    this.gunRecoil = Math.max(0, recoil - dt * 6);
    this.armR.up.rotation.x = lerp(this.armR.up.rotation.x, -0.95 * hold + pitch * 0.6 - recoil * 0.3, 1 - Math.exp(-12 * dt));
    this.armR.up.rotation.z = lerp(this.armR.up.rotation.z, -0.24 * hold, 1 - Math.exp(-12 * dt));
    this.armR.low.rotation.x = lerp(this.armR.low.rotation.x, -0.5 * hold - pitch * 0.35, 1 - Math.exp(-12 * dt));
    this.armL.up.rotation.x = lerp(this.armL.up.rotation.x, -1.15 * hold + pitch * 0.6 - recoil * 0.3, 1 - Math.exp(-12 * dt));
    this.armL.up.rotation.z = lerp(this.armL.up.rotation.z, 0.46 * hold, 1 - Math.exp(-12 * dt));
    this.armL.low.rotation.x = lerp(this.armL.low.rotation.x, -0.7 * hold - pitch * 0.3, 1 - Math.exp(-12 * dt));
    // head looks where the gun is pointing
    this.head.rotation.x = lerp(this.head.rotation.x, clamp(pitch, -0.7, 0.9) * 0.85, 1 - Math.exp(-11 * dt));
    // weapon follows the aim pitch a little
    this.gun.rotation.x = lerp(this.gun.rotation.x, clamp(pitch, -0.6, 0.8) * 0.5 - 0.03 - recoil * 0.25, 1 - Math.exp(-14 * dt));
    this.gun.position.z = 0.28 - recoil * 0.06;
  }

  /** ragdoll-style collapse — limbs go limp and the body folds to the ground */
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
    // limp limbs
    const limp = clamp(t / 0.55, 0, 1);
    const j = (k) => Math.sin(t * (5 + k) + this.deadSeed * k) * (1 - limp) * 0.5;
    this.legR.up.rotation.x = lerp(this.legR.up.rotation.x, 0.45 + j(1) * 0.6, 1 - Math.exp(-5 * dt));
    this.legL.up.rotation.x = lerp(this.legL.up.rotation.x, -0.2 + j(2) * 0.7, 1 - Math.exp(-5 * dt));
    this.legR.low.rotation.x = lerp(this.legR.low.rotation.x, -0.9 + j(3) * 0.5, 1 - Math.exp(-5 * dt));
    this.legL.low.rotation.x = lerp(this.legL.low.rotation.x, -0.5 + j(4) * 0.5, 1 - Math.exp(-5 * dt));
    this.armR.up.rotation.x = lerp(this.armR.up.rotation.x, -0.4 + j(5) * 0.9, 1 - Math.exp(-4 * dt));
    this.armL.up.rotation.x = lerp(this.armL.up.rotation.x, -0.2 + j(6) * 0.9, 1 - Math.exp(-4 * dt));
    this.armR.up.rotation.z = lerp(this.armR.up.rotation.z, 0.7 + j(7) * 0.4, 1 - Math.exp(-4 * dt));
    this.armL.up.rotation.z = lerp(this.armL.up.rotation.z, -0.9 + j(8) * 0.4, 1 - Math.exp(-4 * dt));
    this.torso.rotation.x = lerp(this.torso.rotation.x, 0.25, 1 - Math.exp(-4 * dt));
    this.torso.rotation.z = lerp(this.torso.rotation.z, 0.3 * this.deadAxis, 1 - Math.exp(-3 * dt));
    this.head.rotation.x = lerp(this.head.rotation.x, 0.6, 1 - Math.exp(-4 * dt));
    this.gun.visible = t < 0.35;
    if (!this.gun.visible && !this.gunDropped) {
      this.gunDropped = true;
      this.dropCallback && this.dropCallback();
    }
    // fall over: rotate the root around the feet, then settle
    const fall = clamp(t / 0.75, 0, 1);
    const ease = fall * fall * (3 - 2 * fall);
    this.root.rotation.x = ease * (Math.PI / 2) * 0.92 * this.deadDir;
    this.root.rotation.z = ease * 0.35 * this.deadAxis;
    this.root.position.y = groundY + Math.sin(clamp(t / 0.9, 0, 1) * Math.PI) * 0.06;
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
    this.model.deadT = -1;
    this.model.gun.visible = true;
    this.model.gunDropped = false;
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
      // flinch the aim
      this.recoilAim += amount * 0.0022;
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

    // ── state machine ──
    if (hasTarget) {
      const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      const ideal = this.weapon.cls === 'shotgun' ? 4.5 : (this.weapon.cls === 'smg' ? 8 : (isSniper ? 26 : 13));
      this.state = dist > ideal * 1.25 ? 'advance' : (dist < ideal * 0.6 ? 'back' : 'hold');
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
    if (standoff) {
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
    if (this.onGround) {
      frictionXZ(this.vel, dt, w.friction, w.stopSpeed);
      accelerateXZ(this.vel, wishX, wishZ, (this.crouching ? w.crouch : w.walk) * d.speed * 0.92, w.accel, dt);
    } else {
      accelerateXZ(this.vel, wishX, wishZ, Math.min(w.walk, w.airWishCap), w.airAccel, dt);
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
      } else if (this.reactT <= 0 && off < 0.13 && this.dropCooldown <= 0) {
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
      pitch: this.pitch, time,
    });
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
    if (hit.type === 'world') {
      this.bWorld = (this.bWorld || 0) + 1;
      this.game.fx.impact(hit.point, hit.normal, hit.tag, this.distToListener);
      sfx.impact('concrete', this.distToListener);
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
