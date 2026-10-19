// ═══════════════ MATCH / SQUAD — TDM + survival orchestration ═══════════════
import { Bot } from './bot.js';
import { TEAMS, DIFFICULTIES, CALLSIGNS, COMBAT, SCORE } from '../core/config.js';
import { pick, shuffled, rand, chance, clamp } from '../core/utils.js';
import { sfx } from '../core/audio.js';
import { canStand } from './physics.js';

export class Match {
  constructor(game, settings) {
    this.game = game;
    this.mode = settings.mode || 'tdm';
    this.teamSize = settings.teamSize ?? 4;
    this.difficultyId = settings.difficulty || 'regular';
    this.killLimit = settings.killLimit ?? 50;
    this.duration = (settings.duration ?? 10) * 60;
    this.bots = [];
    this.score = { alpha: 0, bravo: 0 };
    this.playerScore = 0;
    this.time = 0;
    this.state = 'countdown';
    this.countdown = 3.6;
    this.ended = false;
    this.wave = 0;
    this.waveState = 'idle';
    this.waveT = 0;
    this.spawnQueue = [];
    this.usedNames = new Set();
    this.feed = [];
    this.teamKills = { alpha: 0, bravo: 0 };
    this.respawnQueue = [];
    this.stats = { kills: 0, headshots: 0, deaths: 0, damage: 0, grenades: 0, bestCombo: 0 };
  }

  // ═══════════ setup ═══════════
  start() {
    const g = this.game;
    if (this.mode === 'tdm') this.startTDM();
    else this.startSurvival();
  }

  alphaSpawns() { return this.game.world.spawns.alpha; }
  bravoSpawns() { return this.game.world.spawns.bravo; }

  freshName(team) {
    const pool = shuffled(CALLSIGNS);
    for (const n of pool) {
      if (!this.usedNames.has(n)) {
        this.usedNames.add(n);
        return n;
      }
    }
    const n = pick(CALLSIGNS) + ' ' + (Math.floor(Math.random() * 90) + 10);
    this.usedNames.add(n);
    return n;
  }

  spawnPoint(team, avoid) {
    const list = team === 'alpha' ? this.alphaSpawns() : this.bravoSpawns();
    const g = this.game;
    const grid = g.world.grid, gh = g.world.groundHeight;
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 6; i++) {
      const s = pick(list);
      const safe = canStand(grid, gh, s.x, s.z, null, 0.5, 1.8, 0.5) ? s : this.safeSpot(s.x, s.z);
      let score = Math.random() * 4;
      for (const e of g.entities) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - safe.x, e.pos.z - safe.z);
        if (this.game.isHostile({ team }, e)) score += Math.min(d, 60);
        else if (d < 6) score -= 26;
      }
      if (avoid) {
        const d = Math.hypot(avoid.x - safe.x, avoid.z - safe.z);
        if (d < 14) score -= (14 - d) * 3;
      }
      if (score > bestScore) { bestScore = score; best = { x: safe.x, z: safe.z, yaw: safe.yaw ?? s.yaw ?? 0 }; }
    }
    return best || { x: 0, z: 0, yaw: 0 };
  }

  /** nearest spot around (x,z) where a body actually fits (props can cover a spawn) */
  safeSpot(x, z) {
    const g = this.game;
    const grid = g.world.grid, gh = g.world.groundHeight;
    if (canStand(grid, gh, x, z, null, 0.5, 1.8, 0.5)) return { x, z };
    for (let i = 0; i < 26; i++) {
      const a = i * 2.4, r = 1.1 + i * 0.4;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (canStand(grid, gh, px, pz, null, 0.5, 1.8, 0.5)) return { x: px, z: pz };
    }
    return { x, z };
  }

  startTDM() {
    const g = this.game;
    const diff = this.difficultyId;
    // player joins alpha
    const _as = pick(this.alphaSpawns());
    const sp = { ...this.safeSpot(_as.x, _as.z), yaw: _as.yaw ?? 0 };
    g.player.team = 'alpha';
    g.player.reset(sp);
    g.player.classId = g.playerClassId;
    // alpha teammates
    for (let i = 0; i < Math.max(0, this.teamSize - 1); i++) {
      this.addBot('alpha', diff, 'regular');
    }
    for (let i = 0; i < this.teamSize; i++) {
      this.addBot('bravo', diff, 'regular');
    }
    this.state = 'countdown';
    this.countdown = 3.6;
    g.hud?.announce('MATCH BEGINS IN 3', `${TEAMS.alpha.name} vs ${TEAMS.bravo.name} · FIRST TO ${this.killLimit}`, 3.2);
    sfx.countdown();
    this.game.weapons?.setLoadout(g.playerClassId);
    this.game.weapons?.refillForPickup();
  }

  startSurvival() {
    const g = this.game;
    const sp = { ...this.safeSpot(0, 34), yaw: 0 };
    g.player.team = 'alpha';
    g.player.reset(sp);
    g.player.classId = g.playerClassId;
    this.wave = 0;
    this.waveState = 'intermission';
    this.waveT = 4.2;
    g.hud?.announce('SURVIVAL', 'HOLD THE COMPOUND — ENDLESS WAVES', 3.4);
    this.game.weapons?.setLoadout(g.playerClassId);
  }

  addBot(team, diffId, kind = 'regular', opts = {}) {
    const g = this.game;
    const sp = opts.spawn || this.spawnPoint(team);
    const bot = new Bot(g, {
      team,
      name: opts.name || this.freshName(team),
      difficulty: diffId,
      spawn: sp,
      classId: opts.classId,
      ghillie: opts.ghillie,
    });
    this.bots.push(bot);
    g.entities.push(bot);
    return bot;
  }

  // ═══════════ per-frame ═══════════
  update(dt) {
    if (this.ended) return;
    this.time += dt;

    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after >= 1) {
        sfx.countdown(false);
        this.game.hud?.announce(`MATCH BEGINS IN ${after}`, '', 0.9);
      }
      if (this.countdown <= 0) {
        this.state = 'live';
        sfx.countdown(true);
        this.game.hud?.announce('FIGHT', '', 1.1);
      }
      return;   // bots frozen during the countdown
    }

    if (this.mode === 'tdm') {
      // respawns
      for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
        const r = this.respawnQueue[i];
        r.t -= dt;
        if (r.t <= 0) {
          r.bot.reset(this.spawnPoint(r.bot.team));
          this.respawnQueue.splice(i, 1);
          this.game.hud?.announce('', '', 0);
        }
      }
      // timer
      this.duration -= dt;
      if (this.duration <= 0 || this.score.alpha >= this.killLimit || this.score.bravo >= this.killLimit) {
        this.endMatch(this.score.alpha >= this.killLimit ? 'alpha' : (this.score.bravo >= this.killLimit ? 'bravo' : (this.score.alpha > this.score.bravo ? 'alpha' : (this.score.bravo > this.score.alpha ? 'bravo' : 'draw'))));
      }
    } else {
      this.updateSurvival(dt);
    }
  }

  updateSurvival(dt) {
    const g = this.game;
    const aliveEnemies = this.bots.filter(b => b.alive && b.team === 'bravo').length;
    if (this.waveState === 'intermission') {
      this.waveT -= dt;
      if (this.waveT <= 0) {
        this.wave++;
        this.waveState = 'live';
        const count = Math.min(16, 3 + Math.round(this.wave * 1.7));
        const diffKeys = ['recruit', 'regular', 'veteran', 'elite'];
        const di = clamp(Math.floor((this.wave - 1) / 3), 0, 3);
        for (let i = 0; i < count; i++) {
          const sp = this.waveSpawnPoint(i);
          const bot = this.addBot('bravo', diffKeys[di], 'wave', {
            spawn: sp,
            name: this.freshName('bravo'),
            classId: pick(['m4a1', 'mp5', 'm1014']),
            ghillie: chance(0.25),
          });
          bot.spawnProtect = 0.6;
        }
        g.hud?.announce(`WAVE ${this.wave}`, `${count} HOSTILES INBOUND`, 2.6);
        sfx.waveStart();
        this.game.onWaveStart?.(this.wave, count);
      }
    } else if (this.waveState === 'live') {
      if (this.bots.filter(b => b.team === 'bravo').every(b => !b.alive)) {
        this.waveState = 'intermission';
        this.waveT = 5.5;
        this.playerScore += SCORE.waveClearBase + this.wave * 120;
        g.hud?.announce('WAVE CLEARED', `+${SCORE.waveClearBase + this.wave * 120} · next wave inbound`, 3);
        sfx.waveClear();
        this.game.onWaveClear?.(this.wave);
      }
      // clean the corpses up so the scene stays fast
      if (this.bots.length > 40) {
        const dead = this.bots.filter(b => !b.alive && b.model.deadT > 12);
        for (const b of dead) this.removeBot(b);
      }
    }
  }

  waveSpawnPoint(i) {
    // spawn on the perimeter, biased away from the player
    const p = this.game.player.pos;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(28, 48);
      const x = clamp(p.x + Math.cos(a) * r, -48, 48);
      const z = clamp(p.z + Math.sin(a) * r, -48, 48);
      if (!this.game.nav.walkable(x, z)) continue;
      return { x, z, yaw: Math.atan2(-(p.x - x), -(p.z - z)) };
    }
    return pick(this.bravoSpawns());
  }

  removeBot(bot) {
    const i = this.bots.indexOf(bot);
    if (i >= 0) this.bots.splice(i, 1);
    const j = this.game.entities.indexOf(bot);
    if (j >= 0) this.game.entities.splice(j, 1);
    this.game.scene.remove(bot.model.root);
    if (bot.tag) this.game.scene.remove(bot.tag);
    if (bot.droppedGun) this.game.scene.remove(bot.droppedGun);
  }

  // ═══════════ events ═══════════
  onDeath(victim, killer, weaponName, opts = {}) {
    const g = this.game;
    const victimTeam = victim.team;
    let killerName = null, killerTeam = null;
    if (killer && killer.team) {
      killerTeam = killer.team;
      killerName = killer.name;
      if (killerTeam !== victimTeam) {
        this.score[killerTeam] = (this.score[killerTeam] || 0) + 1;
        killer.kills = (killer.kills || 0) + 1;
        if (killer === g.player) {
          this.stats.kills++;
          if (opts.headshot) this.stats.headshots++;
          g.hud?.eliminatedBanner(victim.name, weaponName, opts.headshot);
        }
        if (killer.isBot && killerTeam === 'alpha') this.teamKills.alpha++;
      } else {
        // team kill — penalty
        this.score[killerTeam] = Math.max(0, (this.score[killerTeam] || 0) - 1);
        g.hud?.feed(killer.name, victim.name, weaponName, true);
      }
    }
    g.hud?.feed(killerName || 'WORLD', victim.name, weaponName, killerTeam === victimTeam, {
      killerTeam, victimTeam, headshot: opts.headshot, dist: opts.dist,
    });

    if (victim === g.player) {
      this.stats.deaths++;
      g.onPlayerDeath?.(killer, weaponName, opts);
    }
    if (this.mode === 'tdm' && victim.isBot) {
      const delay = rand(COMBAT.botRespawn[0], COMBAT.botRespawn[1]);
      this.respawnQueue.push({ bot: victim, t: delay });
    }
    if (this.mode === 'survival' && victim === g.player) {
      g.hud?.announce('ELIMINATED', 'SURVIVAL RUN OVER', 3);
      setTimeout(() => this.endMatch('bravo'), 2400);
    }
  }

  scoreFor(team) { return Math.round(this.score[team] || 0); }

  endMatch(winner) {
    if (this.ended) return;
    this.ended = true;
    this.state = 'over';
    const playerWon = winner === 'alpha';
    sfx.matchEnd(playerWon);
    this.game.onMatchEnd?.({
      winner,
      mode: this.mode,
      score: { ...this.score },
      stats: this.stats,
      wave: this.wave,
      playerScore: this.playerScore + this.stats.kills * 100,
      time: this.time,
      won: playerWon,
    });
  }
}
