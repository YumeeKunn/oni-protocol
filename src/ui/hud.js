// ═══════════════ HUD — score bar, minimap, killfeed, ammo, crosshair, killcam ═══════════════
import { Minimap } from '../world/minimap.js';
import { $, el, fmtTime, clamp, damp, lerp } from '../core/utils.js';
import { TEAMS, MINIMAP } from '../core/config.js';
import { WEAPONS, GRENADE } from '../weapons/defs.js';

const WEAPON_GLYPH = { rifle: '⌖', smg: '≡', shotgun: '✶', sniper: '◎', pistol: '∙', melee: '⚔', grenade: '✹' };
// weapon display name → category, so the feed can show the right glyph
const WEAPON_CLASS = (() => {
  const m = {};
  for (const w of [...Object.values(WEAPONS), GRENADE]) if (w && w.name) m[w.name] = w.cls || w.id;
  return m;
})();

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.scoreA = $('score-alpha');
    this.scoreB = $('score-bravo');
    this.barA = $('bar-alpha');
    this.barB = $('bar-bravo');
    this.timer = $('match-timer');
    this.target = $('match-target');
    this.feedEl = $('killfeed');
    this.hpNum = $('hp-num');
    this.hpFill = $('hp-fill');
    this.weaponName = $('weapon-name');
    this.weaponClass = $('weapon-class');
    this.ammoMag = $('ammo-mag');
    this.ammoReserve = $('ammo-reserve');
    this.magPips = $('mag-pips');
    this.nades = $('nades');
    this.zoneEl = $('zone-name');
    this.annMain = $('announce-main');
    this.annSub = $('announce-sub');
    this.announceEl = $('announce');
    this.elimEl = $('eliminated');
    this.hitEl = $('hitmarker');
    this.crossEl = $('crosshair');
    this.scopeEl = $('scope');
    this.breathEl = $('breath-meter');
    this.breathFill = $('breath-fill');
    this.reloadBar = $('reload-bar');
    this.reloadFill = $('reload-fill');
    this.reloadHint = $('reload-hint');
    this.hurtEl = $('hurt-flash');
    this.killcam = $('killcam');
    this.killcamKiller = $('kc-killer');
    this.killcamWeapon = $('kc-weapon');
    this.killcamDist = $('kc-dist');
    this.respawnEl = $('respawn-timer');
    this.compass = $('compass');
    this.compassCtx = this.compass.getContext('2d');
    this.arcs = $('arcs-canvas');
    this.arcsCtx = this.arcs.getContext('2d');
    this.minimap = new Minimap($('minimap'), game.world.pmap);
    this.pipCount = -1;
    this.announceT = 0;
    this.hitT = 0;
    this.elimT = 0;
    this.hurtT = 0;
    this.acc = 0;
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.fpsEl = $('fps');
    this.scoreShown = { alpha: 0, bravo: 0 };
    this.lastScore = { alpha: 0, bravo: 0 };
    this.comp = { x: 0, y: 0 };
    this.visible = false;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.arcDpr = dpr;
    this.arcs.width = Math.round(w * dpr);
    this.arcs.height = Math.round(h * dpr);
    this.arcs.style.width = w + 'px';
    this.arcs.style.height = h + 'px';
    this.arm = Math.min(w, h) * 0.24;
  }

  show(on) {
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
  }

  // ── notifications ──
  announce(main, sub = '', dur = 2) {
    if (!main && !sub) { this.announceEl.classList.remove('on'); return; }
    this.announceEl.classList.add('on');
    if (main) this.annMain.textContent = main;
    if (sub != null) this.annSub.textContent = sub;
    this.announceT = dur;
  }

  eliminatedBanner(name, weapon, headshot) {
    this.elimEl.innerHTML = `ELIMINATED <b>${name}</b>${headshot ? ' <i>HEADSHOT</i>' : ''}<span class="w">${weapon}</span>`;
    this.elimEl.classList.add('on');
    this.elimT = 2.4;
  }

  hitmarker(head = false) {
    this.hitEl.classList.remove('on', 'head');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('on');
    if (head) this.hitEl.classList.add('head');
    this.hitT = 0.22;
  }

  flashDamage(amount, hpFrac) {
    this.hurtT = Math.min(0.7, this.hurtT + clamp(amount / 60, 0.12, 0.6));
    this.hurtEl.style.opacity = String(clamp(this.hurtT, 0, 0.72));
  }

  feat(msg, sub) { this.announce(msg, sub, 2.6); }

  feed(killer, victim, weapon, teamkill = false, opts = {}) {
    const row = el('div', 'kf-row' + (teamkill ? ' tk' : ''));
    const cls = opts.weaponClass || WEAPON_CLASS[weapon] || 'rifle';
    const glyph = WEAPON_GLYPH[cls] || '⌖';
    row.innerHTML = `
      <span class="kf-k ${opts.killerTeam ? 'kf-' + opts.killerTeam : ''}">${killer}</span>
      <span class="kf-w">${glyph} ${weapon}${opts.headshot ? '<i>HS</i>' : ''}</span>
      <span class="kf-v ${opts.victimTeam ? 'kf-' + opts.victimTeam : ''}">${victim}</span>`;
    this.feedEl.appendChild(row);
    while (this.feedEl.children.length > 6) this.feedEl.removeChild(this.feedEl.firstChild);
    setTimeout(() => {
      row.classList.add('out');
      setTimeout(() => row.remove(), 700);
    }, 6200);
  }

  // ── per frame ──
  update(dt, time) {
    const g = this.game;
    const m = g.match;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) {
      if (this.fpsEl) this.fpsEl.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS`;
      this.fpsAcc = 0; this.fpsN = 0;
    }

    // score + timer
    if (m) {
      const ta = m.scoreFor('alpha'), tb = m.scoreFor('bravo');
      if (ta !== this.lastScore.alpha) { this.lastScore.alpha = ta; this.scoreA.classList.add('pop'); setTimeout(() => this.scoreA.classList.remove('pop'), 320); }
      if (tb !== this.lastScore.bravo) { this.lastScore.bravo = tb; this.scoreB.classList.add('pop'); setTimeout(() => this.scoreB.classList.remove('pop'), 320); }
      this.scoreShown.alpha = lerp(this.scoreShown.alpha, ta, 1 - Math.exp(-8 * dt));
      this.scoreShown.bravo = lerp(this.scoreShown.bravo, tb, 1 - Math.exp(-8 * dt));
      this.scoreA.textContent = Math.round(this.scoreShown.alpha);
      this.scoreB.textContent = Math.round(this.scoreShown.bravo);
      this.timer.textContent = m.mode === 'tdm' ? fmtTime(m.duration) : fmtTime(m.time);
      this.target.textContent = m.mode === 'tdm' ? `FIRST TO ${m.killLimit}` : `WAVE ${Math.max(1, m.wave)} · SURVIVAL`;
      const lim = Math.max(1, m.mode === 'tdm' ? m.killLimit : 40);
      this.barA.style.width = `${clamp(ta / lim, 0, 1) * 100}%`;
      this.barB.style.width = `${clamp(tb / lim, 0, 1) * 100}%`;
    }

    // vitals
    const p = g.player;
    const hp = Math.max(0, Math.round(p.hp));
    this.hpNum.textContent = hp;
    this.hpFill.style.width = `${clamp(p.hp / p.maxHp, 0, 1) * 100}%`;
    this.hpFill.classList.toggle('low', p.hp / p.maxHp < 0.34);

    // ammo panel
    const ws = g.weapons?.stateSnapshot?.();
    if (ws) {
      if (this.weaponName.textContent !== ws.name) this.weaponName.textContent = ws.name;
      const cls = (g.weapons.currentId && g.weapons.def) ? g.weapons.def.cls.toUpperCase() : '';
      if (this.weaponClass.textContent !== cls) this.weaponClass.textContent = cls;
      this.ammoMag.textContent = ws.mag === Infinity ? '∞' : ws.mag;
      this.ammoMag.classList.toggle('low', ws.mag <= (ws.magSize > 0 ? Math.max(1, Math.round(ws.magSize * 0.25)) : 0));
      this.ammoReserve.textContent = ws.reserve === Infinity ? '' : `/ ${ws.reserve}`;
      if (this.pipCount !== ws.magSize || this.pipsFor !== ws.id) {
        this.pipsFor = ws.id;
        this.pipCount = ws.magSize;
        this.magPips.innerHTML = '';
        const n = Math.min(34, ws.magSize);
        for (let i = 0; i < n; i++) this.magPips.appendChild(el('i'));
      }
      for (let i = 0; i < this.magPips.children.length; i++) {
        const on = i < Math.round((ws.mag / Math.max(1, ws.magSize)) * this.magPips.children.length);
        this.magPips.children[i].classList.toggle('on', on);
      }
      // grenades
      if (this.nadeShown !== ws.grenades) {
        this.nadeShown = ws.grenades;
        this.nades.innerHTML = '';
        for (let i = 0; i < 3; i++) this.nades.appendChild(el('i', i < ws.grenades ? 'on' : ''));
      }
      this.reloadBar.classList.toggle('on', ws.reloading);
      if (ws.reloading) this.reloadFill.style.width = `${clamp(ws.reloadT, 0, 1) * 100}%`;
      this.reloadHint.classList.toggle('on', ws.mag === 0 && !ws.reloading && ws.reserve > 0);
      // hold-breath meter while scoped
      const showBreath = ws.scoped;
      this.breathEl.classList.toggle('on', showBreath);
      if (showBreath) this.breathFill.style.width = `${clamp(ws.holdBreath / 6, 0, 1) * 100}%`;
      // scope overlay
      this.scopeEl.classList.toggle('on', ws.scoped);
      // crosshair
      const spreadPx = 8 + (g.weapons.def ? Math.min(26, g.weapons.spreadNow(p.speed > 1.2, !p.onGround) * 3.4) : 0);
      this.crossEl.style.setProperty('--gap', `${spreadPx}px`);
      this.crossEl.classList.toggle('scoped', ws.scoped);
      this.crossEl.classList.toggle('hide', ws.scoped || p.alive === false);
    }

    // compass + minimap
    this.compassCtx.clearRect(0, 0, this.compass.width, this.compass.height);
    drawCompass(this.compassCtx, this.compass.width, this.compass.height, p.yaw);
    this.mapAcc = (this.mapAcc || 0) + dt;
    if (this.mapAcc > 1 / 30) {
      this.mapAcc = 0;
      this.minimap.draw(p, g.entities, g, dt);
      this.zoneEl.textContent = this.minimap.zone;
    }

    // damage arcs (dead players don't need hit indicators)
    this.arcDirs = p.alive ? p.hurtDirs : null;
    this.drawArcs(dt, p);

    // timers — big centre text yields to the killcam and the results sheet
    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0 || g.killcam || this.resultsOn()) {
        this.announceT = 0;
        this.announceEl.classList.remove('on');
      }
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitEl.classList.remove('on');
    }
    if (this.elimT > 0) {
      this.elimT -= dt;
      if (this.elimT <= 0) this.elimEl.classList.remove('on');
    }
    if (this.hurtT > 0) {
      this.hurtT = Math.max(0, this.hurtT - dt * 0.9);
      this.hurtEl.style.opacity = String(this.hurtT * 0.8);
    }

    // killcam + respawn (hidden while a full-screen sheet owns the view)
    const sheetUp = this.resultsOn();
    const kc = sheetUp ? null : g.killcam;
    this.killcam.classList.toggle('on', !!kc && !sheetUp);
    if (kc) {
      this.killcamKiller.textContent = kc.killer;
      this.killcamWeapon.textContent = kc.weapon;
      this.killcamDist.textContent = `${Math.max(1, Math.round(kc.dist))} M`;
    }
    const rp = g.respawnIn;
    this.respawnEl.classList.toggle('on', rp > 0 && !sheetUp);
    if (rp > 0) this.respawnEl.textContent = `RESPAWN IN ${rp.toFixed(1)}`;
  }

  resultsOn() {
    const r = document.getElementById('results');
    const menu = document.getElementById('menu');
    return !!((r && r.classList.contains('on')) || (menu && menu.classList.contains('on')));
  }

  drawArcs(dt, p) {
    const c = this.arcsCtx;
    const dpr = this.arcDpr || 1;
    const W = this.arcs.width / dpr, H = this.arcs.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!this.arcDirs || !this.arcDirs.length) return;
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.19;
    const lw = Math.max(2.5, Math.min(W, H) * 0.0085);
    for (const d of this.arcDirs) {
      const k = clamp(1 - d.t / 2.4, 0, 1);
      const rel = d.a - p.yaw;   // world bearing → view space
      c.save();
      c.translate(cx, cy);
      c.rotate(rel + Math.PI);
      c.globalAlpha = k * 0.9;
      c.strokeStyle = '#ff4646';
      c.lineWidth = lw;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(0, 0, r, -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4);
      c.stroke();
      c.globalAlpha = k * 0.16;
      c.lineWidth = lw * 2.2;
      c.stroke();
      c.restore();
    }
  }

  showResults(res) {
    // results take over the screen: drop the death overlays
    this.killcam.classList.remove('on');
    this.respawnEl.classList.remove('on');
    this.hurtT = 0;
    this.hurtEl.style.opacity = '0';
    this.announceT = 0;
    this.announceEl.classList.remove('on');
    this.elimEl.classList.remove('on');
    this.arcDirs = null;
    this.drawArcs(0, { yaw: 0 });
    const el = $('results');
    el.classList.add('on');
    const won = res.won;
    $('res-title').textContent = won ? 'VICTORY' : (res.winner === 'draw' ? 'DRAW' : 'DEFEAT');
    $('res-title').className = won ? 'win' : (res.winner === 'draw' ? 'draw' : 'lose');
    $('res-sub').textContent = res.mode === 'tdm'
      ? `${TEAMS.alpha.name} ${res.score.alpha} — ${res.score.bravo} ${TEAMS.bravo.name}`
      : `SURVIVED ${Math.floor(res.time)}s · WAVE ${res.wave}`;
    $('res-kills').textContent = res.stats.kills;
    $('res-heads').textContent = res.stats.headshots;
    $('res-deaths').textContent = res.stats.deaths;
    const kd = res.stats.deaths ? (res.stats.kills / res.stats.deaths) : res.stats.kills;
    $('res-kd').textContent = kd.toFixed(2);
    $('res-score').textContent = res.playerScore;
  }

  hideResults() { $('results').classList.remove('on'); }
}

function drawCompass(c, w, h, yaw) {
  c.clearRect(0, 0, w, h);
  const deg = ((-yaw * 180) / Math.PI + 360 * 4) % 360;
  const pxPerDeg = w / 120;
  const center = w / 2;
  c.font = 'bold 13px "Rajdhani", Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // ticks
  for (let d0 = -70; d0 <= 70; d0 += 5) {
    const abs = (Math.round((deg + d0) / 5) * 5 + 360) % 360;
    const x = center + (abs - deg + 360 * 2) % 360 * pxPerDeg - (abs - deg > 180 ? 360 * pxPerDeg : 0);
    const xx = center + d0 * pxPerDeg;
    const major = abs % 45 === 0;
    c.strokeStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.28)';
    c.lineWidth = major ? 1.6 : 1;
    c.beginPath();
    c.moveTo(xx, major ? h * 0.42 : h * 0.55);
    c.lineTo(xx, h * 0.78);
    c.stroke();
  }
  const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (const [k, name] of Object.entries(labels)) {
    let d = (Number(k) - deg + 540) % 360 - 180;
    if (Math.abs(d) > 70) continue;
    const xx = center + d * pxPerDeg;
    c.fillStyle = name.length === 1 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    c.font = name.length === 1 ? 'bold 16px "Rajdhani", Arial' : 'bold 10px "Rajdhani", Arial';
    c.fillText(name, xx, h * 0.2);
  }
  // centre marker
  c.fillStyle = '#ffd45e';
  c.beginPath();
  c.moveTo(center, h * 0.86);
  c.lineTo(center - 5, h * 0.98);
  c.lineTo(center + 5, h * 0.98);
  c.closePath();
  c.fill();
}
