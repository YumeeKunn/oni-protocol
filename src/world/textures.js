// ═══════════════ TEXTURES — procedural kit (albedo + bump → normal maps) ═══════════════
import * as THREE from 'three';

function canvasOf(w, h, fn, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  fn(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const linear = t => { t.colorSpace = THREE.NoColorSpace; return t; };

function speckle(c, w, h, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = Math.random();
    c.fillStyle = light ? `rgba(255,250,240,${alpha * v})` : `rgba(20,14,8,${alpha * v})`;
    c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function grimeBottom(c, w, h, strength = 0.5) {
  const g = c.createLinearGradient(0, h * 0.5, 0, h);
  g.addColorStop(0, 'rgba(42,30,18,0)');
  g.addColorStop(1, `rgba(42,30,18,${strength})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}

function streaks(c, w, h, n = 8, alpha = 0.22) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const g = c.createLinearGradient(x, 0, x, h * (0.3 + Math.random() * 0.6));
    g.addColorStop(0, `rgba(54,44,30,${alpha})`);
    g.addColorStop(1, 'rgba(54,44,30,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, 2 + Math.random() * 5, h);
  }
}

// heightmap canvas → tangent-space normal map (accepts a canvas or a CanvasTexture)
export function normalFromCanvas(cv, strength = 1.4) {
  const cnv = cv && cv.isTexture ? cv.image : cv;
  if (!cnv || typeof cnv.getContext !== 'function') {
    console.warn('[textures] normalFromCanvas expects a canvas');
    return null;
  }
  const w = cnv.width, h = cnv.height;
  const src = cnv.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const dst = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      dst[i] = (-dx * inv * 0.5 + 0.5) * 255;
      dst[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      dst[i + 2] = (inv * 0.5 + 0.5) * 255;
      dst[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export const cloneTex = src => { const t = src.clone(); t.needsUpdate = true; return t; };

// ═════════ stretching helpers ═════════

/** returns a MeshStandardMaterial whose map/normal tile at `scale` metres per repeat */
export function tiled(kit, w, h, { repeat = 4, normalScale = 0.45, ...rest } = {}) {
  const map = kit.map.clone(); map.needsUpdate = true;
  map.repeat.set(Math.max(1, w / repeat), Math.max(1, h / repeat));
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, ...rest });
  if (kit.bump) {
    const nrm = cloneTex(kit.bumpNormal || kit.bump);
    nrm.repeat.copy(map.repeat);
    mat.normalMap = nrm;
    mat.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  return mat;
}

// ═════════ kits ═════════

export function makeSand() {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#c2a675'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 5000, 0.07, true);
    speckle(c, w, h, 1500, 0.04, false);
    c.strokeStyle = 'rgba(130,104,62,0.09)';
    for (let y = 0; y < h; y += 10) {
      c.lineWidth = 1.4; c.beginPath();
      for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x * 0.05 + y * 0.6) * 3);
      c.stroke();
    }
    // pebbles + small stones
    for (let i = 0; i < 90; i++) {
      const r = 0.8 + Math.random() * 2.4;
      c.fillStyle = `rgba(${150 + Math.random() * 50 | 0},${128 + Math.random() * 40 | 0},${96 + Math.random() * 30 | 0},0.5)`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, r, 0, 7); c.fill();
    }
    grimeBottom(c, w, h, 0.12);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#8a8a8a'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 6000, 0.3, true);
    for (let i = 0; i < 90; i++) {
      c.fillStyle = `rgba(${180 + Math.random() * 60 | 0},0,0,1)`;
      c.fillStyle = `rgb(${200 + Math.random() * 55 | 0},${200 + Math.random() * 55 | 0},${200 + Math.random() * 55 | 0})`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 0.9 + Math.random() * 2.4, 0, 7); c.fill();
    }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 0.8);
  return kit;
}

export function makeCobble() {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#6d6459'; c.fillRect(0, 0, w, h);
    const cell = 42;
    for (let row = 0, y = 0; y < h; y += cell * 0.86, row++) {
      const off = (row % 2) * cell * 0.5;
      for (let x = -cell; x < w + cell; x += cell) {
        const cx = x + off + cell / 2 + (Math.random() - 0.5) * 5;
        const cy = y + cell / 2 + (Math.random() - 0.5) * 4;
        const rx = cell * (0.40 + Math.random() * 0.06);
        const ry = cell * 0.36;
        const tone = 0.84 + Math.random() * 0.34;
        c.fillStyle = `rgb(${148 * tone | 0},${138 * tone | 0},${124 * tone | 0})`;
        c.beginPath(); c.ellipse(cx, cy, rx, ry, (Math.random() - .5) * 0.35, 0, 7); c.fill();
        c.fillStyle = `rgba(255,245,230,${0.06 + Math.random() * 0.08})`;
        c.beginPath(); c.ellipse(cx - rx * 0.2, cy - ry * 0.35, rx * 0.7, ry * 0.35, 0, 0, 7); c.fill();
      }
    }
    speckle(c, w, h, 2200, 0.09, false);
    speckle(c, w, h, 1400, 0.07, true);
    streaks(c, w, h, 5, 0.12);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#3a3a3a'; c.fillRect(0, 0, w, h);
    const cell = 42;
    for (let row = 0, y = 0; y < h; y += cell * 0.86, row++) {
      const off = (row % 2) * cell * 0.5;
      for (let x = -cell; x < w + cell; x += cell) {
        const cx = x + off + cell / 2 + (Math.random() - 0.5) * 5;
        const cy = y + cell / 2 + (Math.random() - 0.5) * 4;
        c.fillStyle = `rgb(${190 + Math.random() * 45 | 0},${190 + Math.random() * 45 | 0},${190 + Math.random() * 45 | 0})`;
        c.beginPath(); c.ellipse(cx, cy, cell * 0.4, cell * 0.36, 0, 0, 7); c.fill();
      }
    }
    speckle(c, w, h, 2500, 0.25, true);
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.9);
  return kit;
}

// smooth stucco plaster, Mediterranean cream
export function makeStucco(tint = '#d8c9a4') {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = tint; c.fillRect(0, 0, w, h);
    // patchy plaster tone — keep it faint, big opaque blobs read as polka dots
    for (let i = 0; i < 7; i++) {
      c.fillStyle = `rgba(${205 + Math.random() * 30 | 0},${192 + Math.random() * 26 | 0},${160 + Math.random() * 24 | 0},0.10)`;
      c.beginPath();
      c.ellipse(Math.random() * w, Math.random() * h, 28 + Math.random() * 46, 18 + Math.random() * 32, Math.random() * 3, 0, 7);
      c.fill();
    }
    // fine mottle
    for (let i = 0; i < 110; i++) {
      c.fillStyle = `rgba(${Math.random() < .5 ? '118,102,76' : '238,230,208'},0.05)`;
      c.beginPath();
      c.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 9, 0, 7);
      c.fill();
    }
    speckle(c, w, h, 1600, 0.05, false);
    speckle(c, w, h, 900, 0.06, true);
    // hairline cracks
    c.strokeStyle = 'rgba(110,92,66,0.28)';
    for (let i = 0; i < 7; i++) {
      c.lineWidth = 0.7 + Math.random(); c.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      c.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (Math.random() - .5) * 80; y += (Math.random() - .5) * 80; c.lineTo(x, y); }
      c.stroke();
    }
    streaks(c, w, h, 6, 0.14);
    grimeBottom(c, w, h, 0.26);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#c4c4c4'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 2200, 0.18, true);
    speckle(c, w, h, 1400, 0.16, false);
    // exposed stone patches → real relief
    for (let i = 0; i < 26; i++) {
      c.fillStyle = `rgb(${150 + Math.random() * 60 | 0},${150 + Math.random() * 60 | 0},${150 + Math.random() * 60 | 0})`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 9, 0, 7); c.fill();
    }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.15);
  return kit;
}

export function makeBrick() {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#6e5a44'; c.fillRect(0, 0, w, h);
    const bh = 34, bw = 84;
    for (let row = 0, y = 4; y < h; y += bh, row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        c.fillStyle = `rgb(${150 + Math.random() * 55 | 0},${105 + Math.random() * 40 | 0},${74 + Math.random() * 30 | 0})`;
        c.fillRect(x + off + 3, y + 3, bw - 6, bh - 6);
        c.fillStyle = 'rgba(255,240,220,0.2)';
        c.fillRect(x + off + 3, y + 3, bw - 6, 4);
        c.fillStyle = 'rgba(30,18,10,0.3)';
        c.fillRect(x + off + 3, y + bh - 7, bw - 6, 4);
        if (Math.random() < 0.4) {
          c.fillStyle = 'rgba(70,55,40,0.8)';
          c.fillRect(x + off + Math.random() * (bw - 14) + 4, y + Math.random() * (bh - 10) + 4, 3 + Math.random() * 6, 2 + Math.random() * 4);
        }
      }
    }
    speckle(c, w, h, 1100, 0.09, false);
    grimeBottom(c, w, h, 0.35);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#303030'; c.fillRect(0, 0, w, h);
    const bh = 34, bw = 84;
    for (let row = 0, y = 4; y < h; y += bh, row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        const v = 200 + Math.random() * 40 | 0;
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(x + off + 3, y + 3, bw - 6, bh - 6);
      }
    }
    speckle(c, w, h, 1500, 0.25, true);
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.7);
  return kit;
}

// chipped-paint wood (doors, crates, shutters)
export function makeWood(paint = null) {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#4a3320'; c.fillRect(0, 0, w, h);
    const pw = 64;
    for (let x = 0; x < w; x += pw) {
      const tone = 0.85 + Math.random() * 0.3;
      c.fillStyle = `rgb(${138 * tone | 0},${98 * tone | 0},${58 * tone | 0})`;
      c.fillRect(x + 2, 0, pw - 4, h);
      c.strokeStyle = `rgba(70,45,22,${0.3 + Math.random() * 0.3})`;
      for (let g = 0; g < 6; g++) {
        c.lineWidth = 0.8 + Math.random(); c.beginPath();
        const gx = x + 6 + Math.random() * (pw - 12);
        c.moveTo(gx, 0);
        for (let y = 0; y <= h; y += 24) c.lineTo(gx + Math.sin(y * 0.05 + gx) * 4, y);
        c.stroke();
      }
      c.fillStyle = 'rgba(255,230,200,0.14)'; c.fillRect(x + 2, 0, 2, h);
      c.fillStyle = 'rgba(25,14,6,0.4)'; c.fillRect(x + pw - 4, 0, 2, h);
      c.fillStyle = '#2a2a2e';
      c.fillRect(x + 8, 14, 4, 4); c.fillRect(x + pw - 14, h - 20, 4, 4);
    }
    if (paint) {
      // painted door: chipped paint showing wood underneath
      c.fillStyle = paint; c.globalAlpha = 1; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) {
        const r = 1 + Math.random() * 7;
        c.beginPath(); c.arc(Math.random() * w, Math.random() * h, r, 0, 7); c.fill();
      }
      for (let i = 0; i < 24; i++) {   // long chips along plank seams
        c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 8 + Math.random() * 40);
      }
      c.globalCompositeOperation = 'source-over';
    }
    speckle(c, w, h, 500, 0.07, false);
    grimeBottom(c, w, h, 0.22);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#787878'; c.fillRect(0, 0, w, h);
    const pw = 64;
    for (let x = 0; x < w; x += pw) {
      c.fillStyle = '#c0c0c0'; c.fillRect(x + 2, 0, pw - 4, h);
      c.fillStyle = '#303030'; c.fillRect(x + pw - 4, 0, 3, h);
    }
    speckle(c, w, h, 700, 0.2, true);
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.4);
  return kit;
}

// corrugated / painted metal
export function makeMetal(base = '#7c828a', rust = 0.9) {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 26) {
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x, 0, 6, h);
      c.fillStyle = 'rgba(255,255,255,0.13)'; c.fillRect(x + 13, 0, 6, h);
    }
    for (let i = 0; i < 40 * rust; i++) {
      c.fillStyle = `rgba(${132 + Math.random() * 60 | 0},${60 + Math.random() * 26 | 0},${20 + Math.random() * 16 | 0},${0.12 + Math.random() * 0.34})`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 11, 0, 7); c.fill();
    }
    // rivet rows
    c.fillStyle = 'rgba(30,30,34,0.55)';
    for (let y = 18; y < h; y += 96) for (let x = 12; x < w; x += 52) { c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill(); }
    speckle(c, w, h, 700, 0.09, false);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#909090'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 26) {
      c.fillStyle = '#3a3a3a'; c.fillRect(x, 0, 6, h);
      c.fillStyle = '#d8d8d8'; c.fillRect(x + 13, 0, 6, h);
    }
    for (let y = 18; y < h; y += 96) for (let x = 12; x < w; x += 52) {
      c.fillStyle = '#f0f0f0'; c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill();
    }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 2.1);
  return kit;
}

export function makeConcrete() {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#aaa69c'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 1800, 0.08, false);
    speckle(c, w, h, 2600, 0.13, true);
    c.strokeStyle = 'rgba(58,56,52,0.5)'; c.lineWidth = 3;
    c.strokeRect(2, 2, w - 4, h - 4);
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
    for (let i = 0; i < 8; i++) {
      c.fillStyle = `rgba(70,62,50,${0.1 + Math.random() * 0.18})`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 16 + Math.random() * 46, 0, 7); c.fill();
    }
    grimeBottom(c, w, h, 0.3);
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#b5b5b5'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 3600, 0.28, false);
    speckle(c, w, h, 2000, 0.22, true);
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.4);
  return kit;
}

export function makeAsphalt() {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#4c4a48'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 5000, 0.1, false);
    speckle(c, w, h, 4200, 0.13, true);
    for (let i = 0; i < 22; i++) {   // cracks + patches
      c.strokeStyle = 'rgba(24,22,20,0.6)'; c.lineWidth = 0.8 + Math.random() * 1.8;
      c.beginPath(); let x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (Math.random() - .5) * 70; y += (Math.random() - .5) * 70; c.lineTo(x, y); }
      c.stroke();
    }
    for (let i = 0; i < 6; i++) {
      c.fillStyle = `rgba(60,58,56,${0.3 + Math.random() * 0.3})`;
      c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 20 + Math.random() * 40, Math.random() * 3, 0, 7); c.fill();
    }
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#8c8c8c'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 6000, 0.35, true);
    speckle(c, w, h, 3000, 0.3, false);
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.6);
  return kit;
}

// heavy canvas (tents, truck covers, awnings)
export function makeCanvasCloth(color = '#5f6b46', stripe = null) {
  const map = canvasOf(256, 256, (c, w, h) => {
    c.fillStyle = color; c.fillRect(0, 0, w, h);
    if (stripe) {
      for (let x = 0; x < w; x += 64) { c.fillStyle = stripe; c.fillRect(x, 0, 32, h); }
    }
    // weave
    c.strokeStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < h; y += 4) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    for (let x = 0; x < w; x += 4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let i = 0; i < 14; i++) {   // weathering + folds
      c.fillStyle = `rgba(${Math.random() < .5 ? '44,42,30' : '220,212,188'},${0.02 + Math.random() * 0.035})`;
      c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 12 + Math.random() * 42, 8 + Math.random() * 26, Math.random() * 3, 0, 7); c.fill();
    }
    speckle(c, w, h, 900, 0.05, false);
    grimeBottom(c, w, h, 0.2);
  });
  const bump = canvasOf(256, 256, (c, w, h) => {
    c.fillStyle = '#a0a0a0'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { c.fillStyle = '#787878'; c.fillRect(0, y, w, 2); }
    for (let x = 0; x < w; x += 4) { c.fillStyle = '#c8c8c8'; c.fillRect(x, 0, 2, h); }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 0.9);
  return kit;
}

export function makeRoofTile() {
  const map = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#8d4a30'; c.fillRect(0, 0, w, h);
    const tw = 40, th = 52;
    for (let row = 0, y = 0; y < h; y += th, row++) {
      for (let x = (row % 2) * tw * 0.5 - tw; x < w + tw; x += tw) {
        const tone = 0.8 + Math.random() * 0.4;
        c.fillStyle = `rgb(${168 * tone | 0},${86 * tone | 0},${54 * tone | 0})`;
        c.fillRect(x + 2, y + 2, tw - 4, th - 3);
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.fillRect(x + 2, y + th - 8, tw - 4, 6);
        c.fillStyle = 'rgba(255,220,190,0.14)';
        c.fillRect(x + 2, y + 2, tw - 4, 4);
      }
    }
    speckle(c, w, h, 1200, 0.08, false);
    for (let i = 0; i < 16; i++) {   // moss / dust
      c.fillStyle = `rgba(${110 + Math.random() * 40 | 0},${120 + Math.random() * 30 | 0},${70 + Math.random() * 30 | 0},0.22)`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 16, 0, 7); c.fill();
    }
  });
  const bump = canvasOf(512, 512, (c, w, h) => {
    c.fillStyle = '#4a4a4a'; c.fillRect(0, 0, w, h);
    const tw = 40, th = 52;
    for (let row = 0, y = 0; y < h; y += th, row++) {
      for (let x = (row % 2) * tw * 0.5 - tw; x < w + tw; x += tw) {
        c.fillStyle = `rgb(${190 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0})`;
        c.fillRect(x + 2, y + 2, tw - 4, th - 3);
      }
    }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.6);
  return kit;
}

// cast-iron stippled finish — weapon bodies, tool boxes
export function makeStippledIron(tint = '#26262a') {
  const map = canvasOf(256, 256, (c, w, h) => {
    c.fillStyle = tint; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = Math.random();
      c.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.05 + v * 0.07})` : `rgba(0,0,0,${0.1 + v * 0.2})`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 0.7 + Math.random() * 1.5, 0, 7); c.fill();
    }
    // machined edges
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, 0, w, 2);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, h - 3, w, 3);
  });
  const bump = canvasOf(256, 256, (c, w, h) => {
    c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      const v = 120 + Math.random() * 120;
      c.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 0.7 + Math.random() * 1.6, 0, 7); c.fill();
    }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 2.4);
  return kit;
}

// camo fabric, tiled — desert (alpha) / black-ish (bravo) / ghillie
export function makeCamo(blobs, base) {
  const map = canvasOf(256, 256, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 5; layer++) {
      const col = blobs[layer % blobs.length];
      for (let i = 0; i < 26; i++) {
        c.fillStyle = col;
        const cx = Math.random() * w, cy = Math.random() * h;
        c.beginPath();
        const pts = 5 + (Math.random() * 4 | 0);
        for (let p = 0; p < pts; p++) {
          const a = (p / pts) * Math.PI * 2;
          const r = 8 + Math.random() * 22;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.75;
          p === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.closePath(); c.fill();
      }
    }
    // fabric weave + wear
    c.strokeStyle = 'rgba(0,0,0,0.05)';
    for (let y = 0; y < h; y += 3) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    speckle(c, w, h, 700, 0.05, true);
  });
  const bump = canvasOf(256, 256, (c, w, h) => {
    c.fillStyle = '#909090'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { c.fillStyle = '#787878'; c.fillRect(0, y, w, 1); }
    speckle(c, w, h, 900, 0.14, true);
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 0.7);
  return kit;
}

export function makeTyre() {
  const map = canvasOf(128, 128, (c, w, h) => {
    c.fillStyle = '#1c1c1e'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) { c.fillStyle = 'rgba(255,255,255,0.04)'; c.fillRect(x, 0, 5, h); }
    speckle(c, w, h, 800, 0.12, true);
    speckle(c, w, h, 400, 0.2, false);
  });
  const bump = canvasOf(128, 128, (c, w, h) => {
    c.fillStyle = '#606060'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) { c.fillStyle = '#c0c0c0'; c.fillRect(x, 0, 5, h); }
  }, false);
  const kit = { map, bump: linear(bump) };
  kit.bumpNormal = normalFromCanvas(bump, 1.6);
  return kit;
}

// wall sign / graffiti plate
export function makeSign(text, bg, fg) {
  return canvasOf(256, 128, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.font = 'bold 54px "Rajdhani", "Arial Narrow", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
    // wear
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) { c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 0, 7); c.fill(); }
    c.globalCompositeOperation = 'source-over';
  });
}

// ═════════ texture registry — built once, cloned per mesh ═════════
export function buildTextureKit() {
  const kit = {
    sand: makeSand(),
    cobble: makeCobble(),
    stucco: makeStucco('#d8c9a4'),
    stuccoWarm: makeStucco('#cfae86'),
    stuccoPale: makeStucco('#e0d6bd'),
    brick: makeBrick(),
    wood: makeWood(),
    woodGreen: makeWood('#3f6b4a'),
    woodBlue: makeWood('#3d6b8a'),
    woodRed: makeWood('#8a4436'),
    metal: makeMetal('#7c828a', 1),
    metalGreen: makeMetal('#5b6b57', 0.7),
    metalRust: makeMetal('#8a7a5c', 1.4),
    concrete: makeConcrete(),
    asphalt: makeAsphalt(),
    clothOlive: makeCanvasCloth('#77835a'),
    clothSand: makeCanvasCloth('#c9b48c'),
    clothStriped: makeCanvasCloth('#c8b28a', '#9a4535'),
    roof: makeRoofTile(),
    iron: makeStippledIron('#26262a'),
    ironWarm: makeStippledIron('#3a352e'),
    tyre: makeTyre(),
    camoAlpha: makeCamo(['#8b8b6a', '#6d7350', '#4d5238', '#a9a586'], '#7a7c5c'),
    camoBravo: makeCamo(['#3a3f34', '#2a2e26', '#4a4a3a', '#22261f'], '#33372c'),
    ghillie: makeCamo(['#4d5a35', '#3a4629', '#6b7a48', '#2e3a22'], '#43502f'),
    sandbags: (() => {
      const map = canvasOf(128, 128, (c, w, h) => {
        c.fillStyle = '#a3926092'; c.fillStyle = '#a39260'; c.fillRect(0, 0, w, h);
        speckle(c, w, h, 900, 0.09, false);
        c.strokeStyle = 'rgba(70,58,35,0.25)';
        for (let y = 0; y < h; y += 5) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
        for (let x = 0; x < w; x += 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
        grimeBottom(c, w, h, 0.3);
      });
      const bump = canvasOf(128, 128, (c, w, h) => {
        c.fillStyle = '#909090'; c.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 4) { c.fillStyle = '#b0b0b0'; c.fillRect(0, y, w, 2); }
        speckle(c, w, h, 700, 0.2, true);
      }, false);
      const k = { map, bump: linear(bump) };
      k.bumpNormal = normalFromCanvas(bump, 1.1);
      return k;
    })(),
  };
  return kit;
}
