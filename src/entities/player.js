// ═══════════════ PLAYER — Quake/CS movement, camera rig, vitals ═══════════════
import * as THREE from 'three';
import { MOVE, COMBAT, RENDER } from '../core/config.js';
import { clamp, damp, lerp, rand } from '../core/utils.js';
import { moveBody, canStand } from './physics.js';
import { sfx } from '../core/audio.js';

export class Player {
  constructor(world, o = {}) {
    this.world = world;
    this.grid = world.grid;
    this.pos = new THREE.Vector3(0, 0, 40);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.radius = MOVE.radius;
    this.height = 1.75;
    this.step = MOVE.stepHeight;

    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.sliding = false;
    this.slideT = 0;
    this.slideDir = new THREE.Vector2();
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.wasJumpDown = false;

    this.maxHp = o.hp ?? 100;
    this.hp = this.maxHp;
    this.alive = true;
    this.team = o.team || 'alpha';
    this.name = o.name || 'REYES';
    this.isBot = !!o.isBot;
    this.spawnProtect = COMBAT.spawnProtect;
    this.lastHit = -99;
    this.lastAttacker = null;
    this.deaths = 0;
    this.kills = 0;
    this.assists = 0;
    this.headshots = 0;
    this.respawnTimer = 0;
    this.deathInfo = null;

    // view
    this.baseFov = RENDER.fov;
    this.fov = RENDER.fov;
    this.adsT = 0;
    this.ads = false;
    this.holdBreathT = 6;      // stamina in seconds
    this.holdingBreath = false;
    this.bobT = 0;
    this.bob = 0;
    this.dip = 0;
    this.roll = 0;
    this.kick = new THREE.Vector2();
    this.kickVel = new THREE.Vector2();
    this.trauma = 0;
    this.eyeH = MOVE.eyeStand;
    this.speed = 0;
    this.footT = 0;
    this.strafeTilt = 0;
    this.hurtDirs = [];
    this.lastDamageTime = -99;

    // camera rig
    this.camRig = new THREE.Object3D();
    this.camPitch = new THREE.Object3D();
    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 16 / 9, 0.06, 900);
    this.camRig.add(this.camPitch);
    this.camPitch.add(this.camera);
    this.camRig.position.set(0, MOVE.eyeStand, 0);

    // death cam
    this.deathCam = null;
    this.shells = [];
    this.recoilOffset = new THREE.Vector3();
  }

  reset(spawn) {
    this.pos.set(spawn.x, this.world.groundHeight(spawn.x, spawn.z), spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = spawn.yaw != null ? spawn.yaw : 0;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.height = 1.75;
    this.crouching = false;
    this.sliding = false;
    this.spawnProtect = COMBAT.spawnProtect;
    this.holdBreathT = 6;
    this.ads = false;
    this.adsT = 0;
    this.kick.set(0, 0);
    this.kickVel.set(0, 0);
    this.deathCam = null;
    this.updateCamera(0);
  }

  get eyeHeight() { return this.crouching || this.sliding ? MOVE.eyeCrouch : MOVE.eyeStand; }

  addKick(pitchKick, yawKick) {
    this.kickVel.x += pitchKick;
    this.kickVel.y += yawKick;
  }

  addShake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  lookAt(target) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dy = (target.y || 1.4) - (this.pos.y + this.eyeH);
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  damage(amount, from, weaponName = 'M4A1', opts = {}) {
    if (!this.alive || this.spawnProtect > 0) return false;
    const before = this.hp;
    this.hp -= amount;
    this.lastHit = performance.now() / 1000;
    this.lastAttacker = from ? { name: from.name, team: from.team, pos: from.pos.clone() } : null;
    if (from) {
      const dx = from.pos.x - this.pos.x, dz = from.pos.z - this.pos.z;
      this.hurtDirs.push({ a: Math.atan2(-dx, -dz), t: 0 });
      if (this.hurtDirs.length > 3) this.hurtDirs.shift();
    }
    this.trauma = Math.min(1, this.trauma + amount * 0.012);
    if (this.hp <= 0) {
      this.die(from, weaponName, opts);
      return true;
    }
    if (!this.isBot) {
      sfx.hurt(amount / 40);
      window.__hud?.flashDamage(amount, this.hp / this.maxHp);
    }
    return true;
  }

  die(from, weaponName, opts = {}) {
    this.alive = false;
    this.hp = 0;
    this.deaths++;
    this.deathInfo = {
      killer: from ? from.name : 'ENVIRONMENT',
      killerTeam: from ? from.team : null,
      weapon: weaponName,
      dist: from ? Math.hypot(from.pos.x - this.pos.x, from.pos.z - this.pos.z) : 0,
      headshot: !!opts.headshot,
      t: performance.now() / 1000,
    };
    if (this.isBot) {
      sfx.death();
    } else {
      sfx.death();
      this.deathCam = { t: 0, focus: from ? from.pos.clone() : this.pos.clone().add(new THREE.Vector3(0, 1, 0)) };
      // route through the match so the killfeed, stats, killcam and respawn all fire
      const squad = window.__game?.squad;
      if (squad?.onDeath) squad.onDeath(this, from, weaponName, opts);
      else window.__game?.onPlayerDeath?.(from, weaponName, opts);
    }
  }

  update(dt, cmd, time) {
    if (!this.alive) {
      this.updateDeathCam(dt);
      this.updateCamera(dt);
      return;
    }
    const w = MOVE;
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);

    // ── desired direction (world space from yaw) ──
    let fx = 0, fz = 0;
    if (cmd.forward || cmd.strafe) {
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      fx = -sinY * cmd.forward + cosY * cmd.strafe;
      fz = -cosY * cmd.forward - sinY * cmd.strafe;
      const len = Math.hypot(fx, fz);
      if (len > 0) { fx /= len; fz /= len; }
    }
    const wishSpeed0 = this.speedTarget(cmd);
    this.sprinting = !!cmd.sprint && !cmd.crouch && cmd.forward > 0.1 && !this.ads;

    // ── crouch / slide ──
    const wantsCrouch = !!cmd.crouch;
    if (wantsCrouch && !this.crouching && this.onGround && this.speed > 6.2 && !this.sliding && !this.ads) {
      this.sliding = true;
      this.slideT = w.slideTime;
      this.slideDir.set(fx || -Math.sin(this.yaw), fz || -Math.cos(this.yaw)).normalize();
      const cur = Math.hypot(this.vel.x, this.vel.z);
      this.vel.x = this.slideDir.x * Math.max(cur, 6.0) * (1 + w.slideBoost * 0.028);
      this.vel.z = this.slideDir.y * Math.max(cur, 6.0) * (1 + w.slideBoost * 0.028);
      sfx.slide();
    }
    this.crouching = wantsCrouch || this.sliding;
    if (this.sliding) {
      this.slideT -= dt;
      // steer the slide a little, then drop back to a crouch
      const steer = clamp(cmd.strafe, -1, 1) * 1.6 * dt;
      const a = Math.atan2(this.slideDir.y, this.slideDir.x) + steer;
      this.slideDir.set(Math.cos(a), Math.sin(a));
      if (this.slideT <= 0) this.sliding = false;
    }

    // ── body height + headroom ──
    const targetH = this.crouching ? 1.25 : 1.75;
    if (targetH > this.height) {
      if (canStand(this.grid, this.world.groundHeight, this.pos.x, this.pos.z, this.pos.y, this.radius, 1.75, this.step)) {
        this.height = Math.min(targetH, this.height + dt * 3.2);
        if (this.height >= 1.74) { this.height = 1.75; this.crouching = false; }
      }
    } else {
      this.height = Math.max(targetH, this.height - dt * 3.6);
    }

    // ── jump (buffer + coyote) ──
    this.jumpBuffer = cmd.jumpPressed ? w.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
    if (this.onGround) this.coyote = w.coyote; else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.sliding) {
      this.vel.y = w.jumpVel;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.onGround = false;
      this.sliding = false;
      if (!this.isBot) sfx.jump();
    }

    // ── accel / friction ──
    const wishSpeed = wishSpeed0 * (this.sliding ? 1 : 1);
    if (this.onGround && !this.sliding) {
      frictionXZ(this.vel, dt, w.friction, w.stopSpeed);
      accelerateXZ(this.vel, fx, fz, wishSpeed, w.accel, dt);
    } else if (this.onGround && this.sliding) {
      frictionXZ(this.vel, dt, w.slideFriction, 1.0);
      accelerateXZ(this.vel, fx, fz, wishSpeed * 0.35, 2.2, dt);
    } else {
      // air: quake-style — small cap on the added speed enables strafe jumping
      accelerateXZ(this.vel, fx, fz, Math.min(wishSpeed, w.airWishCap), w.airAccel, dt);
    }
    this.vel.y -= w.gravity * dt;
    this.vel.y = Math.max(this.vel.y, -46);

    // ── collide & move ──
    const res = moveBody({ pos: this.pos, vel: this.vel, radius: this.radius, height: this.height, step: this.step }, dt, this.grid, this.world.groundHeight);
    if (!res.grounded && this.onGround && this.vel.y <= 0.01 && res.landSpeed < 0.1) this.onGround = false;
    if (res.grounded) {
      if (!this.onGround) {
        const f = clamp(res.landSpeed / 16, 0, 1.4);
        this.dip = Math.max(this.dip, f * 0.42);
        if (!this.isBot) {
          if (res.landSpeed > 4) sfx.land(clamp(res.landSpeed / 12, 0.25, 1.5));
          if (res.landSpeed > 2.4) this.addShake(clamp(res.landSpeed / 40, 0, 0.5));
          if (res.landSpeed > 17) {
            const dmg = Math.round((res.landSpeed - 17) * 9);
            if (dmg > 0) this.damage(dmg, null, 'FALL');
          }
        }
      }
      this.onGround = true;
      if (this.sliding && Math.hypot(this.vel.x, this.vel.z) < 3.4) this.sliding = false;
    } else {
      this.onGround = false;
    }

    // keep everyone inside the arena
    const lim = this.world.bounds - 1.2;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ── footsteps ──
    if (this.onGround && this.speed > 1.6 && !this.sliding) {
      this.footT -= dt * this.speed;
      if (this.footT <= 0) {
        this.footT = this.sprinting ? 3.1 : 2.6;
        if (!this.isBot) sfx.footstep(clamp(0.055 + this.speed * 0.012, 0.05, 0.2), this.world.surfaceAt ? this.world.surfaceAt(this.pos.x, this.pos.z) : 'dirt');
        else if (this.distToListener && this.distToListener < 22) sfx.footstep(clamp(0.02 + this.speed * 0.004, 0.015, 0.08) * (1 - this.distToListener / 22));
      }
    } else if (this.sliding) {
      this.footT = 2.6;
    }

    // ── reload-free vitals ──
    if (this.lastHit > 0 && time - this.lastHit > COMBAT.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + COMBAT.regenRate * dt);
    }

    // damage direction timers
    for (const d of this.hurtDirs) d.t += dt;
    this.hurtDirs = this.hurtDirs.filter(d => d.t < 2.4);

    // ── hold breath (sniper) ──
    this.holdingBreath = !!cmd.holdBreath && this.ads && this.holdBreathT > 0;
    if (this.holdingBreath) this.holdBreathT = Math.max(0, this.holdBreathT - dt);
    else this.holdBreathT = Math.min(6, this.holdBreathT + dt * 0.55);

    this.updateCamera(dt);
  }

  speedTarget(cmd) {
    let s = MOVE.walk;
    if (this.sprinting) s = MOVE.sprint;
    if (this.crouching) s = MOVE.crouch;
    if (this.ads) s *= MOVE.adsMul;
    if (cmd.forward < -0.1) s *= 0.86;
    return s;
  }

  updateDeathCam(dt) {
    if (!this.deathCam) return;
    this.deathCam.t += dt;
    const t = Math.min(1, this.deathCam.t / 0.9);
    const target = this.deathCam.focus;
    const wanted = Math.atan2(-(target.x - this.pos.x), -(target.z - this.pos.z));
    const wantedP = Math.atan2((target.y + 0.6) - (this.pos.y + 1.1), Math.hypot(target.x - this.pos.x, target.z - this.pos.z));
    this.yaw = lerp(this.yaw, wanted, t * 0.25);
    this.pitch = lerp(this.pitch, wantedP * 0.6, t * 0.18);
    this.eyeH = lerp(this.eyeH, 0.55, dt * 2.4);
    const tgtFov = 74;
    this.fov = damp(this.fov, tgtFov, 3, dt);
  }

  updateCamera(dt) {
    const sp = this.speed;
    const moving = this.onGround && sp > 0.8;
    if (moving && !this.ads) {
      this.bobT += dt * (this.sprinting ? 11.4 : 8.8) * clamp(sp / MOVE.walk, 0.4, 1.5);
    }
    const amp = moving && !this.ads ? clamp(sp / MOVE.sprint, 0, 1) * (this.crouching ? 0.35 : 1) : 0;
    const targetBob = Math.sin(this.bobT * 2) * 0.045 * amp;
    const targetSway = Math.cos(this.bobT) * 0.032 * amp;
    this.bob = damp(this.bob, targetBob, 16, dt);
    this.bobSway = damp(this.bobSway || 0, targetSway, 16, dt);

    this.dip = damp(this.dip, 0, 7.5, dt);
    const eyeTarget = this.crouching || this.sliding ? MOVE.eyeCrouch : MOVE.eyeStand;
    this.eyeH = damp(this.eyeH, eyeTarget, this.sliding ? 9 : 13, dt);

    // weapon kick spring
    this.kickVel.multiplyScalar(Math.exp(-9 * dt));
    this.kick.x = damp(this.kick.x, 0, 7, dt);
    this.kick.y = damp(this.kick.y, 0, 7, dt);
    this.kick.x += this.kickVel.x * dt;
    this.kick.y += this.kickVel.y * dt;

    // weapon-driven recoil offset (viewmodel punch) recovers here
    this.recoilOffset.multiplyScalar(Math.exp(-11 * dt));

    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma;
    const shakeX = (Math.random() - 0.5) * sh * 0.05;
    const shakeY = (Math.random() - 0.5) * sh * 0.05;

    // strafe / slide camera roll
    const strafe = clamp((this.lastStrafe || 0), -1, 1) * 0.012;
    const wantRoll = (this.sliding ? -0.055 : 0) + strafe + this.kick.y * 0.35;
    this.roll = damp(this.roll, wantRoll, 7, dt);

    this.camRig.position.set(this.pos.x, this.pos.y + this.eyeH + this.bob + this.dip + this.recoilOffset.y, this.pos.z);
    this.camRig.rotation.y = this.yaw + this.kick.y * 0.6 + this.bobSway * 0.35 + shakeX;
    this.camPitch.rotation.x = clamp(this.pitch + this.kick.x + this.bob * 0.6 + shakeY, -1.52, 1.52);
    this.camera.rotation.z = this.roll;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

// ── quake movement primitives ──
export function accelerateXZ(vel, wx, wz, wishSpeed, accel, dt) {
  const current = vel.x * wx + vel.z * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > add) accelSpeed = add;
  vel.x += wx * accelSpeed;
  vel.z += wz * accelSpeed;
}

export function frictionXZ(vel, dt, fr, stop) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.02) { vel.x = 0; vel.z = 0; return; }
  const drop = Math.max(speed * fr * dt, stop * dt);
  const ns = Math.max(0, speed - drop) / speed;
  vel.x *= ns;
  vel.z *= ns;
}
