// ═══════════════ MENUS — deploy screen, class picker, match setup, settings ═══════════════
import { MODES, TEAM_SIZES, KILL_LIMITS, DURATIONS, DIFFICULTIES, VERSION } from '../core/config.js';
import { CLASSES, WEAPONS } from '../weapons/defs.js';
import { $, el } from '../core/utils.js';
import { sfx, setMasterVolume, setAmbienceVolume } from '../core/audio.js';

const CONTROLS = [
  ['W A S D', 'Move'],
  ['SHIFT', 'Sprint'],
  ['CTRL / C', 'Crouch · hold while scoped = hold breath'],
  ['SPACE', 'Jump · skip killcam'],
  ['MOUSE 1', 'Fire'],
  ['MOUSE 2', 'Aim down sights'],
  ['R', 'Reload'],
  ['1 2 3', 'Primary · Sidearm · Knife'],
  ['Q', 'Quick knife'],
  ['G', 'Frag grenade'],
  ['F', 'Inspect weapon'],
  ['MOUSE WHEEL', 'Cycle weapons'],
  ['ESC', 'Pause'],
  ['TAB', 'Scoreboard'],
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.settings = {
      mode: 'tdm',
      classId: 'assault',
      teamSize: 4,
      difficulty: 'regular',
      killLimit: 50,
      duration: 10,
      sensitivity: 0.0022,
      volume: 0.75,
      ambience: 0.5,
      invertY: false,
      audioOn: true,
    };
    this.build();
  }

  build() {
    // ── mode cards ──
    const modeWrap = $('opt-mode');
    modeWrap.innerHTML = '';
    for (const m of Object.values(MODES)) {
      const card = el('button', 'card mode-card' + (this.settings.mode === m.id ? ' on' : ''));
      card.dataset.mode = m.id;
      card.innerHTML = `<span class="ico">${m.icon}</span>
        <span class="txt"><b>${m.name}</b><i>${m.sub}</i><em>${m.desc}</em></span>`;
      card.onclick = () => {
        this.settings.mode = m.id;
        sfx.ui('click');
        this.build();
      };
      modeWrap.appendChild(card);
    }

    // ── class cards ──
    const classWrap = $('opt-class');
    classWrap.innerHTML = '';
    for (const c of Object.values(CLASSES)) {
      const p = WEAPONS[c.primary], s = WEAPONS[c.secondary];
      const card = el('button', 'card class-card' + (this.settings.classId === c.id ? ' on' : ''));
      card.innerHTML = `<span class="ico">${c.icon}</span>
        <span class="txt">
          <b>${c.name}</b><i>${c.sub}</i>
          <em>${p.name} · ${s.name}</em>
          <span class="bars">
            <label>DMG<i style="--v:${Math.min(100, p.dmg * (p.pellets > 1 ? p.pellets : 1) * 2.2)}%"></i></label>
            <label>RATE<i style="--v:${Math.min(100, p.rpm / 9)}%"></i></label>
            <label>RNG<i style="--v:${Math.min(100, p.falloff[1] * 1.1)}%"></i></label>
          </span>
        </span>`;
      card.onclick = () => {
        this.settings.classId = c.id;
        sfx.ui('click');
        this.build();
      };
      classWrap.appendChild(card);
    }

    // ── match setup rows ──
    this.row('row-teamsize', 'TEAM SIZE', TEAM_SIZES.map(n => ({ v: n, label: `${n}v${n}` })), 'teamSize');
    this.row('row-difficulty', 'BOT DIFFICULTY', Object.values(DIFFICULTIES).map(d => ({ v: d.id, label: d.name })), 'difficulty');
    {
      // one line that says what the selected skill level actually does
      const wrap = $('row-difficulty');
      const note = el('i', 'row-note', DIFFICULTIES[this.settings.difficulty]?.desc || '');
      wrap.appendChild(note);
    }
    this.row('row-killlimit', 'KILL LIMIT', KILL_LIMITS.map(n => ({ v: n, label: String(n) })), 'killLimit');
    this.row('row-duration', 'DURATION', DURATIONS.map(m => ({ v: m, label: `${m} MIN` })), 'duration');

    const tdm = this.settings.mode === 'tdm';
    for (const id of ['row-teamsize', 'row-killlimit', 'row-duration']) {
      $(id).classList.toggle('off', !tdm);
    }

    const v = $('menu-version');
    if (v) v.textContent = VERSION;

    // ── buttons ──
    $('btn-start').onclick = () => this.deploy();
    $('btn-settings').onclick = () => { sfx.ui('click'); this.showScreen('settings'); };
    $('btn-controls').onclick = () => { sfx.ui('click'); this.buildControls(); this.showScreen('controls'); };
    for (const b of document.querySelectorAll('[data-close]')) {
      b.onclick = () => { sfx.ui('back'); this.showScreen(b.dataset.close); };
    }
    this.buildSettings();
    this.buildControls();
  }

  row(id, label, opts, key) {
    const wrap = $(id);
    wrap.innerHTML = `<span class="lbl">${label}</span>`;
    const grp = el('div', 'grp');
    for (const o of opts) {
      const b = el('button', 'pill' + (this.settings[key] === o.v ? ' on' : ''), o.label);
      b.onclick = () => {
        this.settings[key] = o.v;
        sfx.ui('click');
        this.build();
      };
      grp.appendChild(b);
    }
    wrap.appendChild(grp);
  }

  buildSettings() {
    const wrap = $('settings-body');
    wrap.innerHTML = '';
    const mkSlider = (label, key, min, max, step, fmt) => {
      const row = el('div', 's-row');
      const out = el('b', 's-val', fmt(this.settings[key]));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = this.settings[key];
      input.oninput = () => {
        this.settings[key] = +input.value;
        out.textContent = fmt(+input.value);
        this.applySettings();
      };
      row.appendChild(el('span', 'lbl', label));
      row.appendChild(input);
      row.appendChild(out);
      wrap.appendChild(row);
    };
    const mkVoid = (label, key, note = '') => {
      const row = el('div', 's-row');
      const b = el('button', 'pill' + (this.settings[key] ? ' on' : ''), this.settings[key] ? 'ON' : 'OFF');
      b.onclick = () => {
        this.settings[key] = !this.settings[key];
        b.classList.toggle('on', this.settings[key]);
        b.textContent = this.settings[key] ? 'ON' : 'OFF';
        sfx.ui('click');
        this.applySettings();
      };
      row.appendChild(el('span', 'lbl', label));
      row.appendChild(b);
      row.appendChild(el('i', 'note', note));
      wrap.appendChild(row);
    };
    const mkPills = (label, key, opts, note = '') => {
      const row = el('div', 's-row');
      const grp = el('div', 'grp');
      for (const o of opts) {
        const b = el('button', 'pill' + (this.settings[key] === o.v ? ' on' : ''), o.label);
        b.onclick = () => {
          this.settings[key] = o.v;
          sfx.ui('click');
          this.build();          // rebuild so both screens stay in sync
          this.buildSettings();
        };
        grp.appendChild(b);
      }
      row.appendChild(el('span', 'lbl', label));
      row.appendChild(grp);
      row.appendChild(el('i', 'note', note));
      wrap.appendChild(row);
    };
    mkPills('BOT DIFFICULTY', 'difficulty', Object.values(DIFFICULTIES).map(d => ({ v: d.id, label: d.name })),
      DIFFICULTIES[this.settings.difficulty]?.desc || '');
    mkSlider('MOUSE SENSITIVITY', 'sensitivity', 0.0006, 0.006, 0.0001, v => v.toFixed(4));
    mkSlider('MASTER VOLUME', 'volume', 0, 1, 0.01, v => `${Math.round(v * 100)}%`);
    mkSlider('AMBIENCE', 'ambience', 0, 1, 0.01, v => `${Math.round(v * 100)}%`);
    mkVoid('INVERT MOUSE Y', 'invertY');
    mkVoid('AUDIO ENABLED', 'audioOn', 'synth fallback if muted');
  }

  buildControls() {
    const wrap = $('controls-body');
    if (wrap.children.length) return;
    for (const [k, d] of CONTROLS) {
      const row = el('div', 'c-row');
      row.appendChild(el('kbd', '', k));
      row.appendChild(el('span', 'lbl', d));
      wrap.appendChild(row);
    }
  }

  applySettings() {
    const g = this.game;
    const s = this.settings;
    if (g.input) {
      g.input.sensitivity = s.sensitivity;
      g.input.invertY = s.invertY;
    }
    setMasterVolume(s.audioOn ? s.volume : 0);
    setAmbienceVolume(s.ambience * (s.audioOn ? 1 : 0));
  }

  deploy() {
    sfx.ui('confirm');
    const s = this.settings;
    this.game.beginAudio();
    this.hide();
    this.game.startMatch({
      mode: s.mode,
      classId: s.classId,
      teamSize: s.teamSize,
      difficulty: s.difficulty,
      killLimit: s.killLimit,
      duration: s.duration,
    });
  }

  showScreen(name) {
    for (const id of ['menu', 'settings', 'controls', 'pause']) {
      const node = $(id);
      if (!node) continue;
      node.classList.toggle('hidden', id !== name);
      node.classList.toggle('on', id === name);
    }
    this.game.uiScreen = name;
  }

  hide() {
    for (const id of ['menu', 'settings', 'controls', 'pause']) {
      const node = $(id);
      if (node) { node.classList.add('hidden'); node.classList.remove('on'); }
    }
    this.game.uiScreen = null;
  }

  showPause() {
    $('btn-resume').onclick = () => {
      sfx.ui('back');
      this.resume();
    };
    $('btn-pause-settings').onclick = () => { sfx.ui('click'); this.showScreen('settings'); };
    $('btn-quit').onclick = () => {
      sfx.ui('back');
      this.game.quitToMenu();
    };
    this.showScreen('pause');
  }

  resume() {
    this.hide();
    this.game.paused = false;
    this.game.input?.requestLock();
  }
}
