// ═══════════════ AUDIO — real recorded gunshots + synth layers + outdoor reverb ═══════════════
// Recorded weapon audio lives in assets/audio (see assets/audio/CREDITS.md).
// Every shot = recorded crack + synth sub-thump + outdoor convolution tail, so the
// same sample never sounds flat and distance/echo reads like an open desert/town.

const CLIPS = {
  rifle_fire_1: 'assets/audio/rifle_fire_1.ogg',
  rifle_fire_2: 'assets/audio/rifle_fire_2.ogg',
  rifle_fire_3: 'assets/audio/rifle_fire_3.ogg',
  rifle_fire_4: 'assets/audio/rifle_fire_4.ogg',
  smg_fire_1: 'assets/audio/smg_fire_1.ogg',
  smg_fire_2: 'assets/audio/smg_fire_2.ogg',
  smg_fire_3: 'assets/audio/smg_fire_3.ogg',
  pistol_fire_1: 'assets/audio/pistol_fire_1.ogg',
  pistol_fire_2: 'assets/audio/pistol_fire_2.ogg',
  pistol_fire_3: 'assets/audio/pistol_fire_3.ogg',
  sniper_fire_1: 'assets/audio/sniper_fire_1.ogg',
  sniper_fire_2: 'assets/audio/sniper_fire_2.ogg',
  shotgun_fire_1: 'assets/audio/shotgun_fire_1.ogg',
  shotgun_fire_2: 'assets/audio/shotgun_fire_2.ogg',
  mech_1: 'assets/audio/mech_1.ogg',
  mech_2: 'assets/audio/mech_2.ogg',
  war_ambience: 'assets/audio/war_ambience.ogg',
};

const GROUPS = {
  rifle: ['rifle_fire_1', 'rifle_fire_2', 'rifle_fire_3', 'rifle_fire_4'],
  smg: ['smg_fire_1', 'smg_fire_2', 'smg_fire_3'],
  pistol: ['pistol_fire_1', 'pistol_fire_2', 'pistol_fire_3'],
  sniper: ['sniper_fire_1', 'sniper_fire_2'],
  shotgun: ['shotgun_fire_1', 'shotgun_fire_2'],
  mech: ['mech_1', 'mech_2'],
};

// per-weapon synth layer: [subHz, subGain, crackGain, tailGain]
const LAYERS = {
  rifle: [78, 0.5, 0.34, 0.5],
  smg: [92, 0.32, 0.3, 0.36],
  pistol: [104, 0.34, 0.28, 0.34],
  sniper: [58, 0.74, 0.5, 0.8],
  shotgun: [54, 0.82, 0.42, 0.72],
};

let ctx = null, master = null, comp = null, dryBus = null, reverbBus = null, limiter = null;
let buffers = new Map();
let ready = false;
let ambience = null;
let enabled = true;
let masterVol = 0.62;

export const audioReady = () => ready;

export async function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 22; comp.ratio.value = 3.4;
  comp.attack.value = 0.004; comp.release.value = 0.16;

  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.09;

  master = ctx.createGain(); master.gain.value = masterVol;
  comp.connect(limiter).connect(master).connect(ctx.destination);

  dryBus = ctx.createGain(); dryBus.gain.value = 1; dryBus.connect(comp);

  // outdoor tail: convolution with a synthetic impulse response
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(1.9, 2.6);
  reverbBus = ctx.createGain(); reverbBus.gain.value = 0.5;
  reverbBus.connect(conv).connect(comp);

  await loadClips();
  ready = true;
}

function makeImpulse(seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // early slap reflections then diffuse exponential tail
    const taps = [0.013, 0.029, 0.047, 0.071, 0.103, 0.149];
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / seconds, decay);
    }
    for (const tap of taps) {
      const idx = Math.floor((tap + (ch ? 0.004 : 0)) * rate);
      if (idx < len) d[idx] += (ch ? 0.34 : -0.34);
    }
    // gentle low-pass shape: running average kills the fizzy top end
    let acc = 0;
    for (let i = 0; i < len; i++) { acc += (d[i] - acc) * 0.34; d[i] = acc; }
  }
  return buf;
}

async function loadClips() {
  const entries = Object.entries(CLIPS);
  await Promise.all(entries.map(async ([name, url]) => {
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      buffers.set(name, await ctx.decodeAudioData(arr));
    } catch (e) {
      console.warn('[audio] failed to load', name, e && e.message);
    }
  }));
}

// ── low level ──
function noise(dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function playBuffer(buf, { vol = 1, rate = 1, when = 0, dest = null, pan = 0, lp = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  let node = src;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp;
    node.connect(f); node = f;
  }
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p); node = p;
  }
  const g = ctx.createGain(); g.gain.value = vol;
  node.connect(g);
  g.connect(dest || dryBus);
  if (reverbBus && dest !== reverbBus) g.connect(reverbBus);
  src.start(ctx.currentTime + when);
  return src;
}

function tone(f0, f1, dur, type = 'sine', vol = 0.3, when = 0, dest = null) {
  const o = ctx.createOscillator();
  o.type = type;
  const t0 = ctx.currentTime + when;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest || dryBus);
  if (reverbBus) g.connect(reverbBus);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function burst(dur, freq, q, vol, { type = 'bandpass', when = 0, slide = null, dest = null } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise(dur);
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const t0 = ctx.currentTime + when;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g); g.connect(dest || dryBus);
  if (reverbBus) g.connect(reverbBus);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

// ═══════════════ public SFX ═══════════════
export const sfx = {
  /**
   * Weapon report. dist = metres from listener (0 = first person),
   * pan = -1..1, cat = rifle|smg|pistol|sniper|shotgun
   */
  gunshot(cat = 'rifle', { dist = 0, pan = 0, indoors = false, first = true } = {}) {
    if (!ready) return;
    const layer = LAYERS[cat] || LAYERS.rifle;
    const g = GROUPS[cat] || GROUPS.rifle;
    const name = g[(Math.random() * g.length) | 0];
    const buf = buffers.get(name);

    // distance: delay (speed of sound), attenuation, air absorption, wider stereo
    const delay = dist / 343;
    const att = first ? 1 : Math.max(0.06, 1 / (1 + dist * dist * 0.0022));
    const airLp = dist > 12 ? Math.max(600, 9000 - dist * 90) : 0;
    const vol = (first ? 0.95 : 0.55 + att * 0.5) * att;

    if (buf) {
      playBuffer(buf, {
        vol, rate: 0.97 + Math.random() * 0.07,
        when: delay, pan: pan * (0.4 + Math.min(1, dist / 40) * 0.6), lp: airLp,
      });
    }
    // punch layer: synth thump + crack, scaled by distance
    tone(layer[0], layer[0] * 0.45, cat === 'shotgun' || cat === 'sniper' ? 0.3 : 0.14,
      'sine', layer[1] * att * 0.9, delay);
    burst(0.06, 4200, 0.7, layer[2] * att, { slide: 900, when: delay });
    // travelling tail for far shots
    if (dist > 10) {
      burst(0.55, 320, 0.4, layer[3] * att * 0.5, { type: 'lowpass', slide: 90, when: delay + 0.11 });
    }
    if (indoors) {
      tone(layer[0] * 0.5, layer[0] * 0.3, 0.22, 'sine', 0.18 * att, delay + 0.01);
    }
  },

  // mechanical: mag out/in, bolt, pump, slide — layered synthetic + recorded handle noise
  mech(kind = 'mag') {
    if (!ready) return;
    if (kind === 'mag') {
      burst(0.05, 1500, 2.2, 0.24, { slide: 700 });
      tone(340, 180, 0.05, 'square', 0.14, 0.02);
      burst(0.06, 2400, 1.6, 0.2, { when: 0.23 });
      tone(200, 430, 0.06, 'square', 0.16, 0.3);
    } else if (kind === 'bolt') {
      burst(0.045, 2600, 2, 0.3);
      tone(520, 240, 0.05, 'square', 0.2, 0.09);
      burst(0.05, 1900, 1.5, 0.24, { when: 0.14 });
    } else if (kind === 'slide') {
      burst(0.05, 3000, 1.8, 0.28);
      tone(600, 300, 0.045, 'square', 0.18, 0.05);
      tone(260, 520, 0.05, 'square', 0.2, 0.13);
    } else if (kind === 'pump') {
      burst(0.07, 1300, 1.4, 0.3, { slide: 600 });
      tone(170, 300, 0.07, 'square', 0.22, 0.04);
      burst(0.06, 1700, 1.4, 0.24, { when: 0.16 });
    } else if (kind === 'pin') {
      tone(1400, 800, 0.04, 'square', 0.14);
    }
    const hb = buffers.get('mech_1');
    if (hb) playBuffer(hb, { vol: 0.12, rate: 0.9 + Math.random() * 0.25 });
  },

  shellDrop() {
    if (!ready) return;
    const t = Math.random() * 0.35;
    tone(2400 + Math.random() * 900, 900, 0.06, 'triangle', 0.05, t);
    tone(1700, 700, 0.09, 'triangle', 0.035, t + 0.11 + Math.random() * 0.08);
  },

  dryFire() { if (ready) { tone(1500, 700, 0.035, 'square', 0.13); burst(0.03, 3200, 2, 0.1); } },

  explosion(big = false) {
    if (!ready) return;
    const d = big ? 1.1 : 0.6;
    burst(d, 260, 0.4, big ? 0.85 : 0.55, { type: 'lowpass', slide: 40 });
    tone(85, 26, d * 0.9, 'sawtooth', big ? 0.5 : 0.3);
    burst(0.14, 2600, 0.5, 0.28, { slide: 500 });
    if (big) burst(0.9, 180, 0.3, 0.24, { type: 'lowpass', slide: 60, when: 0.16 });
  },

  impact(mat = 'concrete', dist = 0) {
    if (!ready) return;
    const v = Math.max(0.03, 1 / (1 + dist * dist * 0.01));
    if (mat === 'flesh') { burst(0.09, 420, 1.1, 0.4 * v, { type: 'lowpass' }); tone(180, 70, 0.09, 'sine', 0.24 * v); }
    else if (mat === 'metal') { burst(0.06, 3200, 3, 0.34 * v); tone(2400, 900, 0.08, 'triangle', 0.14 * v); }
    else if (mat === 'wood') { burst(0.07, 900, 1.6, 0.32 * v, { slide: 300 }); }
    else { burst(0.06, 1800, 1.2, 0.3 * v, { slide: 600 }); tone(420, 150, 0.05, 'square', 0.1 * v); }
  },

  ricochet(dist = 0) {
    if (!ready) return;
    const v = Math.max(0.04, 1 / (1 + dist * dist * 0.008));
    const f = 1600 + Math.random() * 2600;
    tone(f, f * (0.3 + Math.random() * 0.3), 0.22, 'sawtooth', 0.1 * v);
    tone(f * 1.7, f * 0.5, 0.15, 'triangle', 0.06 * v, 0.02);
  },

  whoosh(dist = 0) {
    if (!ready) return;
    const v = Math.max(0.05, 1 / (1 + dist * dist * 0.02));
    burst(0.13, 900, 0.6, 0.22 * v, { slide: 2600 });
  },

  footstep(vol = 0.14, surface = 'dirt') {
    if (!ready) return;
    if (surface === 'stone') {
      burst(0.05, 1500 + Math.random() * 700, 1.4, vol * 1.15);
      tone(180 + Math.random() * 60, 90, 0.05, 'square', vol * 0.5);
    } else {
      burst(0.06, 300 + Math.random() * 200, 0.7, vol, { type: 'lowpass' });
      burst(0.035, 2100 + Math.random() * 900, 1.1, vol * 0.5);
    }
    // gear rattle
    if (Math.random() < 0.35) burst(0.04, 3400, 2.2, vol * 0.28);
  },

  land(force = 1) {
    if (!ready) return;
    burst(0.11, 240, 0.6, 0.24 * force, { type: 'lowpass' });
    tone(130, 55, 0.12, 'sine', 0.2 * force);
    burst(0.06, 1700, 1, 0.12 * force);
  },

  jump() { if (ready) { tone(280, 480, 0.08, 'sine', 0.1); burst(0.06, 900, 0.8, 0.08); } },
  slide() { if (ready) burst(0.42, 700, 0.5, 0.22, { slide: 180, type: 'bandpass' }); },
  dash() { if (ready) { burst(0.24, 1200, 0.8, 0.26, { slide: 2800 }); tone(340, 720, 0.18, 'sine', 0.1); } },

  hurt(hp = 1) { if (ready) { tone(200, 80, 0.16, 'sawtooth', 0.24); burst(0.14, 500, 0.9, 0.16); } },
  death() {
    if (!ready) return;
    tone(360, 40, 1.2, 'sawtooth', 0.32);
    burst(1.0, 700, 0.5, 0.24, { slide: 70, type: 'lowpass' });
  },

  hitmarker(head = false) {
    if (!ready) return;
    if (head) { tone(1900, 800, 0.07, 'triangle', 0.24); tone(2600, 1300, 0.05, 'sine', 0.15, 0.02); }
    else tone(1250, 620, 0.05, 'triangle', 0.16);
  },
  killConfirm() {
    if (!ready) return;
    [880, 1180, 1560].forEach((f, i) => tone(f, f * 1.1, 0.09, 'triangle', 0.12, i * 0.05));
  },

  grenadeBounce(dist = 0) {
    if (!ready) return;
    const v = Math.max(0.05, 1 / (1 + dist * dist * 0.02));
    tone(900, 380, 0.05, 'square', 0.16 * v);
    burst(0.05, 2600, 1.5, 0.14 * v);
  },
  grenadePin() { if (ready) { tone(1500, 900, 0.04, 'square', 0.12); } },

  ui(kind = 'click') {
    if (!ready) return;
    if (kind === 'click') tone(900, 1400, 0.05, 'square', 0.09);
    else if (kind === 'back') tone(900, 600, 0.05, 'square', 0.08);
    else if (kind === 'ready') { tone(560, 840, 0.12, 'square', 0.12); tone(840, 1260, 0.14, 'square', 0.1, 0.1); }
    else if (kind === 'warning') { tone(420, 420, 0.16, 'square', 0.1); tone(320, 320, 0.18, 'square', 0.1, 0.2); }
  },

  countdown(final = false) {
    if (!ready) return;
    if (final) { tone(760, 1200, 0.32, 'square', 0.2); tone(1200, 1600, 0.34, 'triangle', 0.14, 0.12); }
    else tone(520, 700, 0.16, 'square', 0.16);
  },

  matchEnd(win = true) {
    if (!ready) return;
    const notes = win ? [600, 760, 900, 1200] : [700, 560, 440, 320];
    notes.forEach((f, i) => tone(f, f * 1.02, 0.34, 'triangle', 0.16, i * 0.16));
  },

  pickup(kind = 'ammo') {
    if (!ready) return;
    const f = kind === 'health' ? 720 : 560;
    tone(f, f * 1.5, 0.1, 'sine', 0.13);
    tone(f * 1.5, f * 1.9, 0.1, 'sine', 0.1, 0.07);
  },

  waveStart() {
    if (!ready) return;
    tone(190, 380, 0.42, 'square', 0.16);
    tone(380, 760, 0.44, 'square', 0.13, 0.22);
  },
  waveClear() {
    if (!ready) return;
    [620, 830, 1240].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.14, i * 0.13));
  },
  combo(n) { if (ready) tone(680 + n * 90, 1080 + n * 120, 0.11, 'square', 0.11); },
  katanaSwing() { if (ready) { burst(0.13, 5200, 2, 0.32, { type: 'highpass', slide: 1200 }); tone(1500, 420, 0.09, 'sine', 0.07); } },
  katanaHit() { if (ready) { burst(0.1, 3200, 1.4, 0.4); tone(880, 210, 0.09, 'triangle', 0.2); } },
};

// ── ambience beds ──
export function startAmbience(kind = 'desert') {
  if (!ready || ambience) return;
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(dryBus);

  // wind bed (always)
  const wind = ctx.createBufferSource();
  wind.buffer = noise(6); wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.5;
  const wg = ctx.createGain(); wg.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
  const lfoG = ctx.createGain(); lfoG.gain.value = 210;
  lfo.connect(lfoG).connect(wf.frequency);
  wind.connect(wf).connect(wg).connect(out);
  wind.start(); lfo.start();

  // distant war rumble loop (recorded, CC0) — quiet bed under the map
  const warBuf = buffers.get('war_ambience');
  let war = null;
  if (warBuf) {
    war = ctx.createBufferSource();
    war.buffer = warBuf; war.loop = true;
    const wfd = ctx.createBiquadFilter(); wfd.type = 'lowpass'; wfd.frequency.value = 2600;
    const wgd = ctx.createGain(); wgd.gain.value = kind === 'town' ? 0.1 : 0.14;
    war.connect(wfd).connect(wgd).connect(out);
    war.start();
  }
  ambience = { out, wind, war, lfo };
}

export function setAmbienceVolume(v) { if (ambience) ambience.out.gain.value = v; }

export function toggleAudio() {
  enabled = !enabled;
  if (master) master.gain.value = enabled ? masterVol : 0;
  return enabled;
}
export function isAudioEnabled() { return enabled; }
export function setMasterVolume(v) { masterVol = v; if (master && enabled) master.gain.value = v; }
