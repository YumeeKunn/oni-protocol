// ═══════════════ DUST STRIKE — main (game orchestrator) ═══════════════
// Wires world + player + weapons + bots + HUD into one game loop.
import * as THREE from 'three';
import { EffectComposer } from '../../libs/postprocessing/EffectComposer.js';
import { RenderPass } from '../../libs/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../libs/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../libs/postprocessing/OutputPass.js';
import { buildWorld } from './world/world.js';
import { ColliderGrid, rayHit } from './entities/physics.js';
import { buildNav } from './entities/nav.js';
import { Player } from './entities/player.js';
import { Match } from './entities/squad.js';
import { WeaponSystem } from './weapons/weapons.js';
import { Effects } from './fx/effects.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { Input } from './core/input.js';
import { initAudio, startAmbience, setMasterVolume, setAmbienceVolume, sfx } from './core/audio.js';
import { RENDER, MODES, COMBAT, VERSION } from './core/config.js';
import { clamp, lerp, damp, pick, $ } from './core/utils.js';

const DOM_IDS = [
  'hud', 'score-alpha', 'score-bravo', 'bar-alpha', 'bar-bravo', 'match-timer', 'match-target',
  'killfeed', 'hp-num', 'hp-fill', 'weapon-name', 'weapon-class', 'ammo-mag', 'ammo-reserve',
  'mag-pips', 'nades', 'zone-name', 'announce', 'announce-main', 'announce-sub', 'eliminated',
  'hitmarker', 'crosshair', 'scope', 'breath-meter', 'breath-fill', 'reload-bar', 'reload-fill',
  'reload-hint', 'hurt-flash', 'killcam', 'kc-killer', 'kc-weapon', 'kc-dist', 'respawn-timer',
  'compass', 'arcs-canvas', 'minimap', 'fps', 'results', 'res-title', 'res-sub', 'res-kills',
  'res-heads', 'res-deaths', 'res-kd', 'res-score', 'opt-mode', 'opt-class', 'row-teamsize',
  'row-difficulty', 'row-killlimit', 'row-duration', 'btn-start', 'btn-settings', 'btn-controls',
  'settings-body', 'controls-body', 'btn-resume', 'btn-pause-settings', 'btn-quit',
];

// input stub used while the match countdown is running
const FROZEN_INPUT = {
  left: false, right: false, fire: false, jump: false, crouch: false, reload: false,
  mouse: { left: false, right: false },
  pressed: () => false,
  peekLook: () => ({ x: 0, y: 0 }),
  consumeLook: () => ({ x: 0, y: 0 }),
  consumeWheel: () => 0,
};

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.uiScreen = 'menu';
    this.entities = [];
    this.debug = false;
    this.script = null;
    this.killcam = null;
    this.respawnIn = 0;
    this.look = { x: 0, y: 0 };
    this.lookY = 0;
    this.playerClassId = 'assault';
    this.frameStep = 0;
    this.fps = 60;
    this.menuT = 0;
    this.audioStarted = false;
    this.muted = false;
    this.lastShot = -9;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  // ═══════════ boot ═══════════
  async init() {
    this.missing = DOM_IDS.filter(id => !document.getElementById(id));
    if (this.missing.length) console.warn('[dust-strike] missing DOM ids:', this.missing.join(', '));

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(RENDER.pixelRatioCap, window.devicePixelRatio || 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = RENDER.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure ?? 1.02;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd8c8a7, 0.0042);

    // ── world ──
    this.world = buildWorld(this.scene, this.renderer);
    this.world.grid = new ColliderGrid(this.world.colliders, 5);
    this.world.surfaceAt = (x, z) => {
      if (Math.abs(x) < 34 && Math.abs(z) < 34) return 'cobble';
      if (Math.abs(z) < 30) return 'concrete';
      return 'dirt';
    };
    this.nav = buildNav(this.world.colliders, this.world.bounds, this.world.groundHeight, {
      cell: 1.5, radius: 0.5, bodyH: 1.8,
    });

    // ── player + viewmodel root ──
    this.player = new Player(this.world, { name: 'REYES', team: 'alpha' });
    this.player.reset({ x: 0, z: 44, yaw: 0 });
    this.scene.add(this.player.camRig);
    this.viewmodelRoot = new THREE.Object3D();
    this.player.camera.add(this.viewmodelRoot);
    this.entities = [this.player];

    this.fx = new Effects(this.scene, this.world.kit);
    this.weapons = new WeaponSystem(this);

    // ── ui ──
    this.hud = new HUD(this);
    this.hud.show(false);
    window.__hud = this.hud;
    this.menus = new Menus(this);
    this.wireEndScreens();
    this.weapons.setLoadout(this.playerClassId);

    // ── input ──
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.menus.settings.sensitivity;
    this.bindInput();

    // ── post ──
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.player.camera));
    const b = RENDER.bloom || { strength: 0.42, radius: 0.6, threshold: 0.86 };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), b.strength, b.radius, b.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.onResize());
    this.clock = performance.now() / 1000;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.booted = true;
    return this;
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
    this.bloom?.setSize(w, h);
  }

  async beginAudio() {
    if (this.audioStarted) return;
    this.audioStarted = true;
    try {
      await initAudio();
      const s = this.menus.settings;
      setMasterVolume(s.audioOn ? s.volume : 0);
      startAmbience('desert');
      setAmbienceVolume(s.ambience * (s.audioOn ? 1 : 0));
    } catch (e) {
      console.warn('[audio] init failed', e);
    }
  }

  bindInput() {
    this.canvas.addEventListener('click', () => {
      this.beginAudio();
      if (this.running && !this.uiScreen && !this.input.locked) this.input.requestLock();
    });
    this.input.on('keydown', e => {
      if (e.code === 'Escape') {
        if (this.running && !this.paused && !this.match?.ended) {
          this.paused = true;
          this.input.exitLock();
          this.menus.showPause();
        } else if (this.paused && this.bloom) {
          this.menus.resume();
        }
        return;
      }
      if (e.code === 'Space' && this.killcam && this.killcam.t > 0.7) this.skipKillcam();
      if (e.code === 'KeyM') {
        this.muted = !this.muted;
        setMasterVolume(this.muted ? 0 : this.menus.settings.volume);
        this.hud.announce(this.muted ? 'AUDIO MUTED' : 'AUDIO ON', '', 1.2);
      }
    });
    addEventListener('mousedown', e => {
      if (e.button === 0 && this.killcam && this.killcam.t > 0.7) this.skipKillcam();
    });
  }

  // ═══════════ end screens (results / redeploy) ═══════════
  wireEndScreens() {
    this.lockHint = $('lock-hint');
    $('btn-again')?.addEventListener('click', () => {
      sfx.ui('confirm');
      this.hud.hideResults();
      this.startMatch({ ...this.menus.settings });
    });
    $('btn-results-menu')?.addEventListener('click', () => {
      sfx.ui('back');
      this.hud.hideResults();
      this.quitToMenu();
    });
  }

  // ═══════════ match lifecycle ═══════════
  startMatch(settings = {}) {
    const mode = MODES[settings.mode] ? settings.mode : 'tdm';
    this.playerClassId = settings.classId || this.menus.settings.classId || 'assault';
    this.clearEntities();
    this.player.team = 'alpha';
    this.player.classId = this.playerClassId;
    this.player.reset({ x: 0, z: 44, yaw: 0 });
    this.weapons.setLoadout(this.playerClassId);
    this.weapons.discardProjectiles?.();
    this.killcam = null;
    this.respawnIn = 0;
    this.script = null;
    this.match = new Match(this, { ...settings, mode });
    this.squad = this.match;
    this.match.start();
    this.running = true;
    this.paused = false;
    this.time = 0;
    this.uiScreen = null;
    this.menus.hide();
    this.hud.show(true);
    this.hud.hideResults();
    this.beginAudio();
    this.input.enabled = true;
    if (!this.debug) this.input.requestLock();
    return this.match;
  }

  clearEntities() {
    if (this.match) {
      for (const b of this.match.bots.slice()) this.match.removeBot(b);
    }
    this.entities = [this.player];
  }

  quitToMenu() {
    this.running = false;
    this.paused = false;
    this.clearEntities();
    this.match = null;
    this.squad = null;
    this.hud.show(false);
    this.hud.hideResults();
    this.menus.showScreen('menu');
    this.input.exitLock();
  }

  endMatch(res) {
    this.running = false;
    this.paused = false;
    this.hud.showResults(res);
    this.input.exitLock();
    this.lastResult = res;
  }

  skipKillcam() {
    if (!this.killcam) return;
    this.killcam = null;
    this.respawnIn = 0.05;
  }

  // ═══════════ subsystem callbacks ═══════════
  isHostile(a, b) { return !!a && !!b && a.team !== b.team; }
  isPlayerTeam(ent) { return ent.team === this.player.team; }

  canSee(from, ent) {
    const eye = this._v1.copy(from?.pos || this.player.camera.position);
    eye.y += 1.55;
    const to = this._v2.set(ent.pos.x, ent.pos.y + 1.25, ent.pos.z);
    const dx = to.x - eye.x, dy = to.y - eye.y, dz = to.z - eye.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.6) return true;
    const hit = rayHit(this.world.grid, eye.x, eye.y, eye.z, dx / len, dy / len, dz / len, len - 0.5);
    return !hit;
  }

  onPlayerHit(events, head, killed) {
    this.hud.hitmarker(head);
    if (killed) sfx.killConfirm();
  }
  onShoot() { this.lastShot = this.time; }
  onDryFire() { this.hud.announce('PRESS R TO RELOAD', '', 0.9); }
  onReloadStart(d) { sfx.mech('mag'); }
  onReloadEnd() { sfx.mech('slide'); }
  onGrenadeThrow() { this.hud.announce('', '', 0); }

  onWeaponChange(d) {
    this.hud.announce('', '', 0);
    this.hud.weaponName.textContent = d.name;
  }

  onExplosion(pos, radius) {
    const d = Math.hypot(pos.x - this.player.pos.x, pos.y - this.player.pos.y, pos.z - this.player.pos.z);
    this.fx.shake = Math.min(1, (RENDER.shakeScale ?? 1) * clamp(1.4 * (1 - d / (radius * 3)), 0, 1.2));
    sfx.explosion(d < radius * 1.3);
    if (d < radius * 1.6) this.player.addShake(clamp(1 - d / (radius * 1.6), 0, 1) * 0.7);
  }

  onBotDeath(bot, from, weapon, opts) {
    if (from === this.player) this.hud.hitmarker(!!opts.headshot);
  }

  onPlayerDeath(killer, weapon, opts) {
    const dist = killer ? Math.hypot(killer.pos.x - this.player.pos.x, killer.pos.z - this.player.pos.z) : 0;
    this.killcam = {
      killer: killer ? String(killer.name).toUpperCase() : 'ENVIRONMENT',
      weapon: weapon || 'UNKNOWN',
      dist: Math.max(2, dist),
      t: 0,
      focus: killer && killer.pos ? killer.pos.clone() : this.player.pos.clone(),
    };
    this.respawnIn = this.match && this.match.mode === 'tdm' ? COMBAT.respawnDelay : 0;
    this.player.addShake(1);
  }

  onMatchEnd(res) { this.endMatch(res); }
  onWaveStart(n, count) { this.hud.announce(`WAVE ${n}`, `${count} HOSTILES INBOUND`, 2.4); }
  onWaveClear(n) { this.hud.announce('WAVE CLEARED', '', 1.6); }

  // ═══════════ frame ═══════════
  loop() {
    requestAnimationFrame(this.loop);
    if (this.noRender) return;                       // harness fast-forward
    const now = performance.now() / 1000;
    let dt = now - this.clock;
    this.clock = now;
    if (dt > 0.06) dt = 0.06;
    if (dt <= 0) dt = 1 / 60;
    this.fps = damp(this.fps, 1 / dt, 3, dt);

    if (this.booted && this.running && !this.paused && !this.uiScreen) {
      this.step(dt);
    } else if (this.booted) {
      this.menuT += dt;
      if (!this.running) {
        // slow live orbit behind the menu
        this.player.yaw += dt * 0.055;
        this.player.pitch = Math.sin(this.menuT * 0.11) * 0.05;
        this.player.pos.y = this.world.groundHeight(this.player.pos.x, this.player.pos.z);
        this.player.updateCamera(dt);
        this.world.update(dt, this.menuT, this.menuFocus || this.player.pos);
        this.fx.update(dt, this.player.camera);
      }
    }
    this.render();
  }

  step(dt) {
    this.time += dt;
    const input = this.input;

    // ── look (mouse) ──
    const d = input.consumeLook();
    this.look.x = d.x;
    this.look.y = d.y;
    const lx = this.look.x, ly = this.look.y;
    if (lx || ly) {
      let sens = input.sensitivity * (input.invertY ? -1 : 1);
      const ws = this.weapons;
      if (ws.def && ws.adsT > 0.02) sens *= lerp(1, ws.def.adsSens ?? 0.75, ws.adsT);
      this.player.yaw -= lx * sens;
      this.player.pitch = clamp(this.player.pitch - ly * sens, -1.45, 1.45);
    }

    const cmd = this.buildCmd(dt);
    // nobody moves during the "MATCH BEGINS IN 3" countdown — the squads hold
    // their spawns and the player cannot walk, shoot or jump
    const frozen = !!(this.match && this.match.state === 'countdown');
    if (frozen) {
      cmd.forward = 0; cmd.strafe = 0; cmd.sprint = false; cmd.crouch = false;
      cmd.jump = false; cmd.jumpPressed = false; cmd.fire = false; cmd.ads = false;
    }
    this.player.lastStrafe = cmd.strafe;

    if (this.player.alive) {
      this.player.update(dt, cmd, this.time);
    } else {
      this.player.update(dt, { forward: 0, strafe: 0, crouch: false, sprint: false }, this.time);
      this.updateKillcam(dt);
    }

    this.weapons.update(dt, frozen ? FROZEN_INPUT : input, cmd, this.time);

    if (!frozen) {
      const ents = this.entities;
      for (let i = 1; i < ents.length; i++) if (ents[i].update) ents[i].update(dt, this.time);
    }

    this.match?.update(dt);
    this.updateRespawn(dt);
    this.world.update(dt, this.time, this.player.pos);
    // no first-person arms while dead / in the killcam
    this.viewmodelRoot.visible = this.player.alive && !this.killcam;
    this.fx.update(dt, this.player.camera);
    this.hud.update(dt, this.time);
    if (this.lockHint) this.lockHint.classList.toggle('on', !this.input.locked && !this.script && this.player.alive);
    if (this.script) this.runScript(dt);
    this.input.endFrame();
    this.frameStep++;
  }

  buildCmd(dt) {
    const input = this.input;
    const s = this.script;
    const scoped = !!this.weapons.scoped;
    const cmd = { forward: 0, strafe: 0, jump: false, jumpPressed: false, crouch: false, sprint: false, holdBreath: false, ads: false, fire: false };
    if (s) {
      cmd.forward = s.forward || 0;
      cmd.strafe = s.strafe || 0;
      cmd.sprint = !!s.sprint;
      cmd.crouch = !!s.crouch;
      cmd.jump = !!s.jump;
      cmd.jumpPressed = !!s.jump && (this.frameStep % 37 === 0);
      cmd.ads = !!s.ads;
      cmd.fire = !!s.fire;
      input.mouse.left = !!s.fire;
      input.mouse.right = !!s.ads;
      this.player.yaw += (s.lookX || 0) * dt;
      this.player.pitch = clamp(this.player.pitch + (s.lookY || 0) * dt, -1.45, 1.45);
      return cmd;
    }
    cmd.forward = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    cmd.strafe = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const ctrl = input.down('ControlLeft') || input.down('ControlRight');
    cmd.crouch = (ctrl && !scoped) || input.down('KeyC');
    cmd.holdBreath = ctrl && scoped;
    cmd.sprint = input.down('ShiftLeft');
    cmd.jump = input.down('Space');
    cmd.jumpPressed = input.pressed('Space');
    cmd.ads = input.mouse.right;
    cmd.fire = input.mouse.left;
    return cmd;
  }

  updateKillcam(dt) {
    const kc = this.killcam;
    if (!kc) return;
    kc.t += dt;
    const p = this.player;
    if (kc.focus) {
      p.lookAt({ x: kc.focus.x, y: kc.focus.y + 1.25, z: kc.focus.z });
      p.pos.y = this.world.groundHeight(p.pos.x, p.pos.z);
      p.vel.set(0, 0, 0);
    }
  }

  updateRespawn(dt) {
    if (this.player.alive || !this.match) return;
    if (this.match.mode !== 'tdm' || this.match.ended) return;
    if (this.killcam) {
      if (this.killcam.t < 1.1) return;
      this.respawnIn -= dt;
      if (this.respawnIn > 0) return;
    } else if (this.respawnIn > 0) {
      this.respawnIn -= dt;
      return;
    }
    const sp = this.match.spawnPoint('alpha', null);
    this.player.reset(sp);
    this.weapons.setLoadout(this.playerClassId);
    this.weapons.resetAmmo();
    this.weapons.discardProjectiles?.();
    this.killcam = null;
    this.hud.announce('RESPAWNED', 'BACK IN THE FIGHT', 1.4);
  }

  render() {
    this.renderer.info.reset();
    this.composer.render();
    const gray = this.player.alive ? '' : 'grayscale(0.6) contrast(1.06)';
    if (this.canvas.style.filter !== gray) this.canvas.style.filter = gray;
  }

  // ═══════════ harness / debug API ═══════════
  debugTick(i) {
    const scripts = [
      { forward: 1, sprint: true, lookX: 0.5, fire: false, ads: false },
      { forward: 1, lookX: -0.45, fire: true, ads: true },
      { forward: 0.5, strafe: 1, lookX: 0.9, fire: true, ads: false },
      { forward: -0.5, lookX: -1.3, fire: true, ads: true, crouch: true },
    ];
    this.debug = true;
    this.input.enabled = false;
    this.script = { ...scripts[((i | 0) % scripts.length + scripts.length) % scripts.length], t: 0 };
    return this.script;
  }

  runScript(dt) { this.script.t = (this.script.t || 0) + dt; }

  debugSpawn(n = 3, dist = 12, team = 'bravo') {
    const out = [];
    if (!this.match) return out;
    const base = this.player.yaw;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.4;
      const x = this.player.pos.x - Math.sin(a) * dist;
      const z = this.player.pos.z - Math.cos(a) * dist;
      const bot = this.match.addBot(team, 'regular', 'debug', {
        spawn: { x, z, yaw: a + Math.PI },
        name: this.match.freshName(team),
        classId: pick(['m4a1', 'mp5', 'm1014']),
      });
      out.push(bot.name);
    }
    return out;
  }

  /** headless harness: advance the simulation N seconds without rendering */
  debugFast(seconds = 10, step = 1 / 60, maxSteps = 60000) {
    const n = Math.min(maxSteps, Math.max(1, Math.round(seconds / step)));
    const t0 = performance.now();
    this.noRender = true;
    for (let i = 0; i < n; i++) {
      if (this.match?.ended && !this.running) break;
      this.step(step);
    }
    this.noRender = false;
    const ms = Math.round(performance.now() - t0);
    return { steps: n, ms, sim: +this.time.toFixed(1), ...this.snapshot() };
  }

  /** per-bot diagnostics for the harness */
  debugBots() {
    return (this.match?.bots || []).map(b => ({
      n: b.name, team: b.team, alive: b.alive, st: b.state,
      overlaps: (() => {
        const list = [];
        this.world.grid.query(b.pos.x, b.pos.z, b.radius + 0.45, list);
        const out = [];
        for (const c of list) {
          const top = c.y + c.hy, bot = c.y - c.hy;
          if (top <= b.pos.y + 0.02 || bot >= b.pos.y + b.height) continue;
          let dx = b.pos.x - c.x, dz = b.pos.z - c.z;
          if (c.yaw) { const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw); const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; dx = lx; dz = lz; }
          const ox = c.hx + b.radius - Math.abs(dx), oz = c.hz + b.radius - Math.abs(dz);
          if (ox <= 0 || oz <= 0) continue;
          out.push({ tag: c.tag, c: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], h: [+c.hx.toFixed(2), +c.hy.toFixed(2), +c.hz.toFixed(2)], ov: [+ox.toFixed(2), +oz.toFixed(2)], yaw: +((c.yaw || 0)).toFixed(2), top: +top.toFixed(2), climb: !!c.climb });
        }
        return out;
      })(),
      tgt: b.target ? (b.target.name || b.target.team) : null,
      goal: [Math.round(b.goal.x), Math.round(b.goal.z)],
      pathN: b.path ? b.path.length : -1, pi: b.pathI,
      spd: +b.speed.toFixed(2), mag: b.mag, react: +b.reactT.toFixed(2),
      pos: [Math.round(b.pos.x), Math.round(b.pos.z)],
      stuck: +b.stuckT.toFixed(2), hp: Math.round(b.hp), kills: b.kills,
      shots: b.bShots || 0, hits: b.bHits || 0, wallHits: b.bWorld || 0,
      dbg: b.dbg || null,
      lastSeen: b.lastSeenPos ? [Math.round(b.lastSeenPos.x), Math.round(b.lastSeenPos.z)] : null,
    }));
  }

  debugHit() {
    // simulate taking damage so the damage arcs / hurt flash can be verified
    this.player.damage(22, this.entities.find(e => e.isBot && e.team !== this.player.team) || null, 'MP5');
  }

  // debug helper: cast the world raycast from the eye along a yaw/pitch
  debugRay(yaw = 0, pitch = 0, range = 30) {
    const p = this.player;
    const eye = this.camera ? this.camera.position : p.pos;
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    const hit = rayHit(this.world.grid, p.pos.x, p.pos.y + p.height * 0.92, p.pos.z, dx, dy, dz, range);
    if (!hit) return null;
    const c = hit.collider;
    return {
      tag: hit.tag, dist: +hit.dist.toFixed(2),
      pt: [+hit.point.x.toFixed(2), +hit.point.y.toFixed(2), +hit.point.z.toFixed(2)],
      col: { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), h: [+c.hx.toFixed(2), +c.hy.toFixed(2), +c.hz.toFixed(2)], yaw: +(c.yaw || 0).toFixed(2) },
    };
  }

  snapshot() {
    const p = this.player;
    const ws = this.weapons.stateSnapshot();
    const bots = this.match ? this.match.bots : [];
    return {
      mode: this.match?.mode || null,
      state: this.match?.state || null,
      uiScreen: this.uiScreen,
      running: this.running,
      time: +this.time.toFixed(2),
      fps: Math.round(this.fps),
      missingDom: this.missing,
      player: {
        pos: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
        hp: Math.round(p.hp), alive: p.alive, onGround: p.onGround,
        speed: +p.speed.toFixed(2), crouch: !!p.crouching, ads: +this.weapons.adsT.toFixed(2),
      },
      weapon: { name: ws.name, mag: ws.mag, reserve: ws.reserve, grenades: ws.grenades, scoped: ws.scoped },
      score: this.match ? { alpha: this.match.scoreFor('alpha'), bravo: this.match.scoreFor('bravo') } : null,
      entities: this.entities.length,
      bots: bots.length,
      aliveEnemies: bots.filter(b => b.alive && b.team !== p.team).length,
      killcam: !!this.killcam,
      respawnIn: +this.respawnIn.toFixed(2),
      renderer: { calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles },
      world: { colliders: this.world.colliders.length, zones: this.world.zones?.length || 0, meshes: this.world.B.stats?.meshes || 0 },
      version: VERSION,
    };
  }
}

// ── boot ──
const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);
window.__game = game;
game.init().then(() => {
  const s = game.snapshot();
  console.log(`[dust-strike] ${VERSION} booted · ${s.world.colliders} colliders · ${s.world.meshes} meshes · ${s.world.zones} zones`);
  if (game.missing.length) console.warn('[dust-strike] missing DOM:', game.missing.join(', '));
  document.getElementById('boot')?.classList.add('gone');
}).catch(err => {
  console.error('[dust-strike] boot failed\n' + (err && err.stack ? err.stack : String(err)));
  const b = document.getElementById('boot');
  if (b) b.innerHTML = `<pre class="err">BOOT FAILED\n${err && err.stack || err}</pre>`;
});

export default game;
