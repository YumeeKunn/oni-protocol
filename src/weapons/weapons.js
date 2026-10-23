// ═══════════════ WEAPON SYSTEM — firing, ADS, reloads, grenades, melee ═══════════════
import * as THREE from 'three';
import { WEAPONS, GRENADE, loadoutFor } from './defs.js';
import { buildWeaponView } from './viewmodel.js';
import { ViewAnim } from './anims.js';
import { rayHit } from '../entities/physics.js';
import { clamp, rand, damp, lerp } from '../core/utils.js';
import { sfx } from '../core/audio.js';
import { COMBAT, RENDER } from '../core/config.js';

// ── ray vs vertical capsule (hitboxes) ──
function rayCapsule(ox, oy, oz, dx, dy, dz, p0, p1, r) {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
  const wx = ox - p0.x, wy = oy - p0.y, wz = oz - p0.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = dx * ux + dy * uy + dz * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const denom = a * c - b * b;
  let s, t;
  if (denom > 1e-7) {
    t = (b * e - c * d) / denom;              // param along the ray
    if (t < 0) t = 0;
    s = clamp((b * t + e) / c, 0, 1);         // clamp onto the body axis
    t = Math.max(0, (s * b - d) / a);
  } else {
    t = 0;
    s = clamp(e / c, 0, 1);
  }
  const rx = ox + dx * t - (p0.x + ux * s);
  const ry = oy + dy * t - (p0.y + uy * s);
  const rz = oz + dz * t - (p0.z + uz * s);
  const dist2 = rx * rx + ry * ry + rz * rz;
  if (dist2 > r * r) return null;
  // entry point: back up along the ray to the capsule surface
  const back = Math.sqrt(Math.max(0, r * r - dist2));
  return Math.max(0, t - back);
}

export function hitscan(game, shooter, origin, dir, maxDist, opts = {}) {
  const grid = game.world.grid;
  const hitW = rayHit(grid, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);
  let best = { dist: hitW ? hitW.dist : maxDist, type: hitW ? 'world' : null, normal: hitW ? hitW.normal : null, point: hitW ? hitW.point : null, tag: hitW ? hitW.tag : 'stone' };
  // entities
  for (const ent of game.entities) {
    if (ent === shooter || !ent.alive || ent.hp <= 0) continue;
    if (opts.team && shooter && ent.team === shooter.team && !opts.friendlyFire) continue;
    const p0 = new THREE.Vector3(ent.pos.x, ent.pos.y + ent.radius * 0.9, ent.pos.z);
    const p1 = new THREE.Vector3(ent.pos.x, ent.pos.y + ent.height - ent.radius * 0.9, ent.pos.z);
    const t = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p0, p1, ent.radius * 1.06);
    if (t == null || t >= best.dist) continue;
    const hy = origin.y + dir.y * t;
    const headCut = ent.pos.y + ent.height * 0.80;
    best = {
      dist: t, type: 'entity', entity: ent, normal: null,
      point: new THREE.Vector3(origin.x + dir.x * t, hy, origin.z + dir.z * t),
      tag: 'flesh', headshot: hy >= headCut, legshot: hy <= ent.pos.y + ent.height * 0.42,
    };
  }
  return best;
}

const SPREAD_DIR = new THREE.Vector3();

export function spreadDir(baseDir, spreadDeg, up = new THREE.Vector3(0, 1, 0)) {
  if (spreadDeg <= 0.0001) return baseDir.clone();
  const a = Math.random() * Math.PI * 2;
  const rad = Math.tan((spreadDeg * Math.PI) / 180) * Math.sqrt(Math.random());
  const side = new THREE.Vector3().crossVectors(baseDir, up);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const upv = new THREE.Vector3().crossVectors(side, baseDir).normalize();
  return baseDir.clone().addScaledVector(side, Math.cos(a) * rad).addScaledVector(upv, Math.sin(a) * rad).normalize();
}

const VIEW_SCALE = 0.47;

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.player = game.player;
    this.world = game.world;
    this.fx = game.fx;
    this.kit = game.world.kit;
    this.viewRoot = game.viewmodelRoot;   // parented to the camera
    this.loadout = loadoutFor('assault');
    this.views = new Map();
    this.anims = new Map();
    this.ammoStore = new Map();          // id → { mag, reserve }
    this.grenades = GRENADE.count;
    this.currentId = null;
    this.slot = 1;
    this.state = 'idle';
    this.reloadT = 0;
    this.reloadDur = 0;
    this.fireT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.spreadAcc = 0;
    this.ads = false;
    this.adsT = 0;
    this.scoped = false;
    this.zoomT = 0;
    this.semiLatch = false;
    this.grenadeCook = 0;
    this.cooking = false;
    this.projectiles = [];
    this.meleeSwing = 0;
    this.pendingMelee = false;
    this.inspectT = 0;
    this.burstQueue = 0;
  }

  setLoadout(classId) {
    this.loadout = loadoutFor(classId);
    for (const id of [this.loadout.primary, this.loadout.secondary, this.loadout.melee]) {
      if (!this.views.has(id)) this.makeView(id);
    }
    this.grenades = this.loadout.grenades;
    this.resetAmmo();
    this.equip(this.loadout.primary, true);
  }

  resetAmmo() {
    this.ammoStore.clear();
    for (const id of [this.loadout.primary, this.loadout.secondary, this.loadout.melee]) {
      const d = WEAPONS[id];
      this.ammoStore.set(id, { mag: d.mag === Infinity ? Infinity : d.mag, reserve: d.reserve === Infinity ? Infinity : d.reserve });
    }
  }

  makeView(id) {
    const def = WEAPONS[id];
    const vm = buildWeaponView(this.kit, id);
    vm.visible = false;
    // the models are built at 1:1 metres but the camera runs a wide world FOV
    // (78°), so the viewmodel is scaled down and pushed out for correct framing
    vm.scale.setScalar(VIEW_SCALE);
    vm.userData.vmScale = VIEW_SCALE;
    this.viewRoot.add(vm);
    const anim = new ViewAnim(vm, def);
    this.views.set(id, vm);
    this.anims.set(id, anim);
    return vm;
  }

  get def() { return WEAPONS[this.currentId]; }
  get ammo() { return this.ammoStore.get(this.currentId); }
  get view() { return this.views.get(this.currentId); }
  get anim() { return this.anims.get(this.currentId); }

  equip(id, silent = false) {
    if (!WEAPONS[id] || id === this.currentId) return;
    const prev = this.view;
    if (prev) prev.visible = false;
    this.currentId = id;
    const d = WEAPONS[id];
    this.slot = d.slot;
    const vm = this.view;
    vm.visible = true;
    this.anim.play('draw', d.draw);
    this.state = 'idle';
    this.reloadT = 0;
    this.fireT = 0.12;
    this.spreadAcc = 0;
    this.ads = false;
    this.adsT = 0;
    this.scoped = false;
    if (!silent) sfx.mech('bolt');
    this.game.onWeaponChange?.(d);
  }

  cycleSlot(dir) {
    const order = [this.loadout.primary, this.loadout.secondary, this.loadout.melee];
    const i = order.indexOf(this.currentId);
    const n = (i + dir + order.length) % order.length;
    this.equip(order[n]);
  }

  reload(force = false) {
    const d = this.def, a = this.ammo;
    if (!d || d.cls === 'melee' || this.state === 'reload') return;
    if (a.mag >= d.mag || a.reserve <= 0) return;
    const tactical = a.mag > 0 && !force;
    this.state = 'reload';
    this.reloadDur = tactical ? d.reloadTac : d.reload;
    this.reloadT = 0;
    this.ads = false;
    this.scoped = false;
    this.anim.play('reload', this.reloadDur);
    sfx.mech('mag');
    this.game.onReloadStart?.(d, this.reloadDur);
    this.pendingTactical = tactical;
  }

  finishReload() {
    const d = this.def, a = this.ammo;
    const need = d.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    this.state = 'idle';
    sfx.mech(d.cls === 'shotgun' ? 'pump' : (d.cls === 'sniper' ? 'bolt' : 'slide'));
    this.game.onReloadEnd?.(d);
    this.pendingTactical = false;
  }

  spreadNow(moving, airborne) {
    const d = this.def, sp = d.spread;
    let deg = sp.base;
    if (this.player.crouching) deg *= 0.62;
    if (moving) deg += sp.move * clamp(this.player.speed / 9.2, 0, 1.4);
    if (airborne) deg += sp.air;
    deg += this.spreadAcc;
    if (this.adsT > 0.001) deg = lerp(deg, d.adsSpread * (1 + this.spreadAcc * 0.5), this.adsT);
    return deg;
  }

  // ═══════════════ firing ═══════════════
  tryFire(dt, time, input) {
    const d = this.def;
    if (!d) return;
    if (this.state === 'reload') return;
    const wantFire = input.fire;
    const canRepeat = d.auto || d.cls === 'melee';
    if (!wantFire) { this.semiLatch = false; }
    if (this.fireT > 0) return;
    if (!canRepeat && this.semiLatch) return;
    if (!wantFire) return;
    if (this.anim.busy && this.anim.state !== 'fire' && d.cls !== 'melee') return;

    if (d.cls === 'melee') {
      this.semiLatch = !d.auto;
      this.meleeAttack();
      return;
    }
    const a = this.ammo;
    if (a.mag <= 0) {
      this.semiLatch = !d.auto;
      sfx.dryFire();
      this.game.onDryFire?.(d);
      if (a.reserve > 0) this.reload(true);
      return;
    }
    this.semiLatch = !d.auto;
    a.mag--;
    this.fireT = 60 / d.rpm;
    this.shotsFired++;
    this.spreadAcc = Math.min(d.spread.max, this.spreadAcc + d.spread.perShot);
    this.fireShot(d, time);
    if (d.bolt) {
      this.state = 'bolt';
      this.boltT = d.bolt;
      this.anim.bolt();
      sfx.mech('bolt');
    }
  }

  fireShot(d, time) {
    const cam = this.player.camera;
    const origin = new THREE.Vector3();
    cam.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const moving = this.player.speed > 1.2;
    const airborne = !this.player.onGround;
    const spread = this.spreadNow(moving, airborne);

    const echoPos = origin.clone().addScaledVector(dir, 0.5);
    sfx.gunshot(d.audio, { dist: 0, first: true });
    this.fx.muzzle(echoPos, dir, this.adsT > 0.5 ? 0.7 : 1);
    this.anim.triggerFlash(d.cls === 'shotgun' || d.cls === 'sniper' ? 1.35 : 1);
    this.anim.fireImpulse(d.recoil.kick * 26);
    this.player.addShake(d.recoil.kick * 0.55);

    // recoil to the view
    const vKick = d.recoil.v * rand(0.82, 1.18);
    const hKick = d.recoil.h * rand(-1, 1);
    const adsMul = lerp(1, 0.72, this.adsT);
    this.player.addKick(vKick * 0.055 * adsMul, hKick * 0.05 * adsMul);

    // eject a casing
    const eject = this.view?.userData.eject;
    if (eject) {
      const p = new THREE.Vector3();
      eject.getWorldPosition(p);
      this.fx.casing(p, dir, 1, d.cls === 'shotgun');
      sfx.shellDrop();
    }

    const damageEvents = [];
    for (let i = 0; i < d.pellets; i++) {
      const sd = spreadDir(dir.clone(), spread);
      const hit = hitscan(this.game, this.player, origin, sd, 240, { team: true });
      if (!hit.type) continue;
      if (hit.type === 'world') {
        this.fx.impact(hit.point, hit.normal, hit.tag, hit.dist);
        const pan = this.panFor(hit.point);
        sfx.impact(hit.tag === 'metal' ? 'metal' : (hit.tag === 'wood' ? 'wood' : 'concrete'), hit.dist, pan);
        if (Math.random() < 0.16) sfx.ricochet(hit.dist, pan);
        if (i === 0) {
          this.fx.tracer(origin.clone().addScaledVector(dir, 0.75), hit.point, { width: 0.018 * d.tracer, color: 0xffe0a0 });
        }
      } else {
        const ent = hit.entity;
        const falloff = this.falloff(d, hit.dist);
        let dmg = d.dmg * falloff;
        if (hit.headshot) dmg *= d.headMult;
        else if (hit.legshot) dmg *= d.legMult;
        if (d.cls === 'shotgun') dmg *= clamp(1.25 - hit.dist / 22, 0.35, 1.25);
        const killed = ent.damage(dmg, this.player, d.name, { headshot: hit.headshot, dist: hit.dist });
        this.shotsHit += this.game.isPlayerTeam(ent) ? 0 : 1;
        this.fx.impact(hit.point, new THREE.Vector3(0, 0, 0), 'flesh', hit.dist);
        if (killed) this.fx.bloodKill(hit.point, dir, hit.dist);
        else if (hit.headshot && Math.random() < 0.4) this.fx.bloodKill(hit.point, dir, hit.dist);
        if (i === 0 || d.pellets === 1) {
          this.fx.tracer(origin.clone().addScaledVector(dir, 0.75), hit.point, { width: 0.02 * d.tracer, color: 0xffd0c0 });
        }
        damageEvents.push({ ent, dmg, headshot: hit.headshot, killed });
      }
    }
    if (damageEvents.length) {
      const head = damageEvents.some(e => e.headshot);
      const killed = damageEvents.some(e => e.killed);
      this.game.onPlayerHit?.(damageEvents, head, killed);
      sfx.hitmarker(head);
      if (killed) sfx.killConfirm();
    }
    if (d.pellets === 1 && !damageEvents.length) {
      // no-hit tracer for feedback (already drawn on world hit)
    }
    this.game.onShoot?.(d);
  }

  /** stereo position of a world point relative to where the player is looking */
  panFor(p) {
    if (!p) return 0;
    const cam = this.player.camera;
    const dx = p.x - cam.position.x, dz = p.z - cam.position.z;
    const yaw = Math.atan2(-dx, -dz);
    return clamp(Math.sin(yaw - this.player.yaw), -1, 1);
  }

  falloff(d, dist) {
    const [s, e, min] = d.falloff;
    if (dist <= s) return 1;
    if (dist >= e) return min;
    const t = (dist - s) / (e - s);
    return lerp(1, min, t);
  }

  meleeAttack() {
    this.fireT = 60 / this.def.rpm;
    this.anim.play('melee', 0.42);
    sfx.katanaSwing();
    this.pendingMelee = { at: 0.16, hit: false };
    this.fireT = 0.42;
  }

  doMeleeHit() {
    const d = this.def;
    const cam = this.player.camera;
    const origin = new THREE.Vector3();
    cam.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const hit = hitscan(this.game, this.player, origin, dir, d.range, { team: true });
    if (hit.type === 'entity') {
      const from = this.player.pos;
      const to = hit.entity.pos;
      const facing = Math.cos(hit.entity.yaw - Math.atan2(from.x - to.x, from.z - to.z));
      const back = facing > 0.35;
      const dmg = back ? d.backStab : d.dmg;
      const killed = hit.entity.damage(dmg, this.player, 'KNIFE', { headshot: false, melee: true, dist: hit.dist });
      sfx.katanaHit();
      this.fx.impact(hit.point, null, 'flesh');
      this.game.onPlayerHit?.([{ ent: hit.entity, dmg, killed }], false, killed);
      if (killed) sfx.killConfirm();
    } else if (hit.type === 'world') {
      this.fx.impact(hit.point, hit.normal, hit.tag, hit.dist);
      sfx.katanaHit();
    }
  }

  // ═══════════════ grenades ═══════════════
  throwGrenade() {
    if (this.grenades <= 0 || this.cooking) return;
    this.cooking = true;
    this.grenadeCook = 0;
    this.anim.play('throw', 0.62);
    this.anim.onThrow = () => {
      if (this.grenades <= 0) return;
      this.grenades--;
      const cam = this.player.camera;
      const origin = new THREE.Vector3();
      cam.getWorldPosition(origin);
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const start = origin.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, -0.05, 0));
      const v = dir.clone().multiplyScalar(GRENADE.throwSpeed);
      v.y += 3.4;
      v.addScaledVector(new THREE.Vector3(this.player.vel.x, 0, this.player.vel.z), 0.55);
      this.spawnProjectile(start, v);
      sfx.grenadePin();
      this.cooking = false;
      this.game.onGrenadeThrow?.(this.grenades);
    };
    sfx.mech('pin');
  }

  spawnProjectile(pos, vel, owner = null) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4a5a38, roughness: 0.65, metalness: 0.35 }));
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.game.scene.add(mesh);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x8d8d92, metalness: 0.8, roughness: 0.35 }));
    lever.position.set(0, 0.06, 0.03);
    mesh.add(lever);
    this.projectiles.push({ mesh, pos: pos.clone(), vel: vel.clone(), fuse: GRENADE.fuse, owner: owner || this.player, bounces: 0 });
    return this.projectiles[this.projectiles.length - 1];
  }

  updateProjectiles(dt) {
    const grid = this.world.grid;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuse -= dt;
      p.vel.y -= 20 * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const len = step.length();
      if (len > 0.0001) {
        const dir = step.clone().normalize();
        const hit = rayHit(grid, p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z, len + 0.07);
        const gy = this.world.groundHeight(p.pos.x, p.pos.z);
        if (hit) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, 0.075);
          const vn = p.vel.dot(hit.normal);
          p.vel.addScaledVector(hit.normal, -2 * vn);
          p.vel.multiplyScalar(0.42);
          p.vel.x += rand(-0.4, 0.4); p.vel.z += rand(-0.4, 0.4);
          p.bounces++;
          sfx.grenadeBounce(Math.hypot(p.pos.x - this.player.pos.x, p.pos.z - this.player.pos.z));
        } else if (p.pos.y - 0.075 <= gy) {
          p.pos.y = gy + 0.075;
          p.vel.y = Math.abs(p.vel.y) * 0.34;
          p.vel.x *= 0.72; p.vel.z *= 0.72;
          p.bounces++;
          if (Math.abs(p.vel.y) > 1.2) sfx.grenadeBounce(Math.hypot(p.pos.x - this.player.pos.x, p.pos.z - this.player.pos.z));
        } else {
          p.pos.add(step);
        }
      }
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 8; p.mesh.rotation.z += dt * 5;
      if (p.fuse <= 0) {
        this.detonate(p.pos, p.owner);
        this.game.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  detonate(pos, owner) {
    this.fx.explosion(pos, GRENADE.radius, true);
    sfx.explosion(true);
    this.game.onExplosion?.(pos, GRENADE.radius);
    for (const ent of this.game.entities) {
      if (!ent.alive) continue;
      const dx = ent.pos.x - pos.x, dy = (ent.pos.y + ent.height * 0.5) - pos.y, dz = ent.pos.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > GRENADE.radius) continue;
      // line of sight: walls cut the blast
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      const hit = rayHit(this.world.grid, pos.x, pos.y, pos.z, dir.x, dir.y, dir.z, d - 0.4);
      if (hit) continue;
      const falloff = Math.pow(1 - d / GRENADE.radius, 1.6);
      const dmg = GRENADE.dmg * falloff;
      if (dmg < 4) continue;
      const killed = ent.damage(dmg, owner, 'FRAG', { explosion: true, dist: d });
      if (ent === this.player) this.player.addShake(clamp(falloff * 1.4, 0, 1));
      if (owner === this.player && killed) {
        sfx.killConfirm();
        this.game.onPlayerHit?.([{ ent, dmg, killed: true }], false, true);
      }
    }
  }

  // ═══════════════ per-frame ═══════════════
  update(dt, input, cmd, time) {
    const d = this.def;
    if (!d) return;
    this.fireT = Math.max(0, this.fireT - dt);
    this.spreadAcc = Math.max(0, this.spreadAcc - d.spread.decay * dt);
    if (this.cooking && this.grenades <= 0) this.cooking = false;

    // ── slot switching ──
    if (input.pressed('Digit1')) this.equip(this.loadout.primary);
    if (input.pressed('Digit2')) this.equip(this.loadout.secondary);
    if (input.pressed('Digit3')) this.equip(this.loadout.melee);
    if (input.pressed('KeyQ')) this.equip(this.currentId === this.loadout.melee ? this.loadout.primary : this.loadout.melee);
    if (input.pressed('KeyG')) this.throwGrenade();
    if (input.pressed('KeyF')) { this.anim.play('inspect', 1.1); this.state = 'idle'; }
    if (input.pressed('KeyR')) this.reload();
    const wheel = input.consumeWheel();
    if (wheel) this.cycleSlot(wheel > 0 ? 1 : -1);

    // ── ADS ──
    const canAds = this.state !== 'reload' && this.anim.state !== 'draw' && this.anim.state !== 'melee';
    const wantAds = input.right && canAds;
    this.ads = wantAds;
    const adsRate = 1 / Math.max(0.05, d.adsTime * (wantAds ? 1 : 1.25));
    this.adsT = clamp(this.adsT + (wantAds ? adsRate : -adsRate * 1.35) * dt, 0, 1);
    this.scoped = !!d.scope && this.adsT > 0.72;
    // sprinting pushes the FOV out a touch (MW-style speed read); the viewmodel
    // scale below follows the FOV, so the gun does not balloon while you run
    const sprintKick = (!this.ads && this.player.sprinting) ? 5.5 : 0;
    const targetFov = d.adsT > 0
      ? lerp(RENDER.fov + sprintKick, this.scoped ? RENDER.scopeFov : d.adsFov, this.adsT)
      : RENDER.fov + sprintKick;
    this.player.fov = damp(this.player.fov, targetFov, this.scoped ? 9 : 14, dt);
    this.player.ads = this.adsT > 0.4;

    // the ADS zoom narrows the world FOV, which magnifies the viewmodel too — scale it
    // with the zoom so the gun keeps a constant on-screen size (a separate FOV pass
    // would be cleaner, but this is one multiply)
    {
      const vm = this.view;
      if (vm) {
        const zoom = Math.tan(this.player.fov * Math.PI / 360) / Math.tan(RENDER.fov * Math.PI / 360);
        const s = VIEW_SCALE * zoom;
        if (Math.abs(vm.scale.x - s) > 1e-4) {
          vm.scale.setScalar(s);
          vm.userData.vmScale = s;
        }
      }
    }

    // ── reload / bolt state ──
    if (this.state === 'reload') {
      this.reloadT += dt;
      if (this.reloadT >= this.reloadDur) this.finishReload();
    } else if (this.state === 'bolt') {
      this.boltT -= dt;
      if (this.boltT <= 0) this.state = 'idle';
    }

    // ── firing input ──
    const wantFire = input.fire && this.game.inputLocked !== true;
    this.tryFire(dt, time, { fire: wantFire });

    // melee hit window
    if (this.pendingMelee && !this.pendingMelee.hit) {
      this.pendingMelee.t -= dt;
      if (this.pendingMelee.t <= 0) {
        this.pendingMelee.hit = true;
        this.doMeleeHit();
      }
    }

    // ── viewmodel animation layers ──
    const vm = this.view;
    if (vm) {
      const camDelta = input.peekLook ? input.peekLook() : input.consumeLook();
      this.anim.update(dt, {
        speed: this.player.speed,
        sprinting: this.player.sprinting && this.adsT < 0.3,
        adsT: this.adsT,
        holdingBreath: this.player.holdingBreath,
        bobT: this.player.bobT,
        dip: this.player.dip,
        mouseDX: camDelta.x,
        mouseDY: camDelta.y,
      }, time);
      // hidden while fully scoped (the scope overlay takes over)
      vm.visible = !(this.scoped && this.adsT > 0.94);
    }

    this.updateProjectiles(dt);
    this.game.updateAmmoHud?.(this);
  }

  // wipe live frags (match restart / respawn) so nothing carries over
  discardProjectiles() {
    for (const p of this.projectiles) this.game.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }

  refillForPickup() {
    const a = this.ammo;
    let taken = 0;
    for (const [id, st] of this.ammoStore) {
      const d = WEAPONS[id];
      if (d.cls === 'melee') continue;
      const want = Math.round(d.reserve * 0.6);
      const add = Math.min(want, d.reserve - st.reserve);
      st.reserve += add;
      taken += add;
    }
    this.grenades = Math.min(GRENADE.count + 1, this.grenades + 1);
    this.game.onGrenadeThrow?.(this.grenades);
    return taken;
  }

  stateSnapshot() {
    const a = this.ammo;
    return {
      id: this.currentId, name: this.def.name, full: this.def.full,
      mag: a ? a.mag : 0, reserve: a ? a.reserve : 0, magSize: this.def.mag,
      grenades: this.grenades, ads: this.adsT, scoped: this.scoped,
      reloading: this.state === 'reload', reloadT: this.reloadT / Math.max(0.001, this.reloadDur),
      holdBreath: this.player.holdBreathT,
    };
  }
}
