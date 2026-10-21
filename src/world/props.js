// ═══════════════ PROPS — the street furniture of the map ═══════════════
// Every builder takes the map builder `B` and places real geometry + colliders.
import * as THREE from 'three';
import { boxGeo, projectUV, domeGeo, barrierGeo, archGeo, trunkGeo, latheGeo, rockGeo, leafGeo } from '../core/geo.js';
import { makeSign } from './textures.js';
import { rand, pick, chance, deg } from '../core/utils.js';

// ── shared one-off materials ──
let _glass = null, _frond = null, _leaf = null, _terracotta = null, _fruitMats = null, _dark = null;

const canvasMat = (draw, o = {}) => {
  const cv = document.createElement('canvas');
  cv.width = o.w || 128; cv.height = o.h || 128;
  draw(cv.getContext('2d'), cv.width, cv.height);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, ...o.mat });
};

function frondMat(B) {
  if (_frond) return _frond;
  _frond = canvasMat((c, w, h) => {
    c.clearRect(0, 0, w, h);
    // central rib
    c.fillStyle = '#6d7f3c';
    c.fillRect(0, h / 2 - 2, w, 4);
    // feather leaflets
    for (let i = 0; i < w; i += 3) {
      const t = i / w;
      const len = (h / 2 - 4) * (0.35 + Math.sin(t * Math.PI) * 0.9);
      c.strokeStyle = `rgb(${70 + t * 30 | 0},${104 + t * 26 | 0},${44 + t * 24 | 0})`;
      c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(i, h / 2); c.lineTo(i + 5, h / 2 - len); c.stroke();
      c.beginPath(); c.moveTo(i, h / 2); c.lineTo(i + 5, h / 2 + len); c.stroke();
    }
  }, { w: 192, h: 96, mat: { transparent: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 } });
  return _frond;
}

function leafMat(B) {
  if (_leaf) return _leaf;
  _leaf = canvasMat((c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 66; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * w * 0.42;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.8;
      c.fillStyle = `rgb(${52 + Math.random() * 42 | 0},${78 + Math.random() * 44 | 0},${36 + Math.random() * 30 | 0})`;
      c.beginPath(); c.ellipse(x, y, 5 + Math.random() * 7, 3 + Math.random() * 4, Math.random() * 3, 0, 7); c.fill();
    }
  }, { w: 96, h: 96, mat: { transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 } });
  return _leaf;
}

// window glass is its own untextured material — reusing a plaster map tints it muddy
export const glassMat = B => (_glass ||= new THREE.MeshStandardMaterial({ color: 0x223037, roughness: 0.14, metalness: 0.55 }));

// car paint — its own material, because tinting the dark 'metal' kit turned
// every vehicle into a black blob
const _carPaint = new Map();
export function carPaintMat(tint, wreck = false) {
  const key = `${tint}|${wreck ? 'w' : 'n'}`;
  if (_carPaint.has(key)) return _carPaint.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    metalness: wreck ? 0.16 : 0.38,
    roughness: wreck ? 0.82 : 0.46,
  });
  _carPaint.set(key, m);
  return m;
}
export const darkMat = B => (_dark ||= B.mat('stucco', { matOpts: { color: 0x2a2621, roughness: 0.95, normal: false } }));
const terracottaMat = B => (_terracotta ||= B.mat('concrete', { matOpts: { color: 0xb06a44, roughness: 0.9 } }));

// ═══════════════ crates / barrels / clutter ═══════════════

export function crate(B, x, z, o = {}) {
  const s = o.s || 0.9, y = o.y || 0, yaw = o.yaw || rand(0, Math.PI * 2);
  const tint = { color: o.tint || 0xd8cdbb };
  B.box(s, s, s, o.kit || 'wood', x, y, z, yaw, { rep: 1.1, matOpts: tint, tag: 'wood' });
  // corner battens for silhouette
  const t = s * 0.075;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    B.prop(boxGeo(t, s * 1.01, t, 1.2), o.kit || 'wood', x + dx * (s / 2 - t / 2), y + s / 2, z + dz * (s / 2 - t / 2), yaw, { matOpts: tint, cast: false });
  }
  return { x, z, y, s };
}

export function crateStack(B, x, z, n = 3) {
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = 0.9 - rand(0, 0.14);
    crate(B, x + rand(-0.16, 0.16), z + rand(-0.16, 0.16), { s, y, yaw: rand(0, 6.28), tint: 0xc9bda8 });
    y += s;
  }
}

export function barrel(B, x, z, o = {}) {
  const h = 0.92, r = 0.31, y = o.y || 0, yaw = o.yaw || rand(0, 6.28);
  B.cyl(r, r, h, o.kit || 'metalRust', x, y, z, { yaw, solid: true, tag: 'metal', matOpts: { color: o.tint || 0xffffff } });
  for (const ry of [h * 0.22, h * 0.78]) {
    B.prop(new THREE.TorusGeometry(r + 0.015, 0.032, 5, 14).rotateX(Math.PI / 2), o.kit || 'metalRust', x, y + ry, z, yaw, { matOpts: { color: 0x8a7a63 }, cast: false });
  }
}

export function tyreStack(B, x, z, n = 4) {
  for (let i = 0; i < n; i++) {
    B.prop(new THREE.TorusGeometry(0.42, 0.16, 7, 16).rotateX(Math.PI / 2), 'tyre', x, 0.16 + i * 0.3, z, rand(0, 6.28));
  }
  B.solid(x, n * 0.15, z, 0.56, n * 0.15, 0.56, 0, 'tyre');
}

export function wasteBin(B, x, z, yaw = rand(0, 6.28)) {
  B.box(0.62, 1.05, 0.62, 'metalGreen', x, 0, z, yaw, { rep: 0.9, tag: 'metal', matOpts: { color: 0x4a6b3a, roughness: 0.7 } });
  B.box(0.68, 0.07, 0.68, 'metalGreen', x, 1.05, z, yaw, { rep: 0.9, solid: false, matOpts: { color: 0x3f5c32 } });
}

export function pallet(B, x, z, yaw = 0) {
  for (let i = 0; i < 3; i++) B.prop(boxGeo(1.1, 0.09, 0.14, 1.2), 'wood', x, 0.05 + (i === 1 ? 0.1 : 0), z, yaw, { cast: false });
  B.box(1.12, 0.06, 1.0, 'wood', x, 0.12, z, yaw, { rep: 1.1, solid: false, matOpts: { color: 0xa8997f } });
}

export function pots(B, x, z, n = 3) {
  const profile = [[0, 0], [0.16, 0.02], [0.24, 0.24], [0.3, 0.42], [0.3, 0.47], [0.24, 0.5], [0.18, 0.5], [0.18, 0.44], [0.2, 0.42], [0.2, 0.28], [0.1, 0.06], [0, 0.05]];
  const geo = latheGeo(profile, 12, 0.6);
  for (let i = 0; i < n; i++) {
    const s = rand(0.7, 1.5);
    const px = x + rand(-0.9, 0.9), pz = z + rand(-0.9, 0.9);
    B.prop(geo, 'concrete', px, 0, pz, rand(0, 6.28), { scale: s, mat: terracottaMat(B), cast: true });
    if (s > 0.9) B.solid(px, 0.25 * s, pz, 0.26 * s, 0.25 * s, 0.26 * s, 0, 'clay');
  }
}

export function shrub(B, x, z, s = 1) {
  const g = new THREE.PlaneGeometry(1.5 * s, 1.1 * s);
  for (let i = 0; i < 3; i++) {
    B.prop(i === 0 ? g : g.clone(), 'stucco', x, 0.5 * s, z, i * 1.05, { mat: leafMat(B) });
  }
}

// ═══════════════ town ═══════════════

/** window: recessed frame + glass + shutters */
function windowSlot(B, x, y, z, yaw, w = 1.05, h = 1.35, shutter = null) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const fx = x + nx * 0.09, fz = z + nz * 0.09;
  B.prop(boxGeo(w + 0.22, h + 0.22, 0.06, 1), 'stucco', fx, y, fz, yaw, { cast: false, matOpts: { color: 0xe6ddc8, roughness: 0.9 } });
  B.prop(boxGeo(w, h, 0.04, 1), 'stucco', fx + nx * 0.04, y, fz + nz * 0.04, yaw, { cast: false, mat: glassMat(B) });
  // mullions
  B.prop(boxGeo(0.05, h, 0.05, 1), 'wood', fx + nx * 0.05, y, fz + nz * 0.05, yaw, { cast: false, matOpts: { color: 0x8c7f68 } });
  B.prop(boxGeo(w, 0.05, 0.05, 1), 'wood', fx + nx * 0.05, y, fz + nz * 0.05, yaw, { cast: false, matOpts: { color: 0x8c7f68 } });
  if (shutter) {
    for (const sgn of [-1, 1]) {
      const ox = Math.cos(yaw) * sgn * (w / 2 + 0.13);
      const oz = -Math.sin(yaw) * sgn * (w / 2 + 0.13);
      B.prop(boxGeo(w / 2, h + 0.2, 0.05, 0.8), shutter, x + ox + nx * 0.12, y, z + oz + nz * 0.12, yaw * 0, { cast: false });
    }
  }
}

/**
 * Stucco townhouse. Floors of plaster, tiled or parapet roof, door on one face,
 * optional balcony / awning / AC / downspout. Ground floor can be enterable.
 */
export function townhouse(B, x, z, o = {}) {
  const w = o.w ?? 9, d = o.d ?? 8;
  const floors = o.floors ?? 2, fh = o.floorH ?? 3.4;
  const mat = o.mat || pick(['stucco', 'stuccoWarm', 'stuccoPale']);
  const t = 0.34;
  const h = floors * fh;
  const tint = o.tint ? { color: o.tint } : {};
  const doorFace = o.doorFace ?? 0;                       // 0:+z 1:+x 2:-z 3:-x
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const [dx, dz] = dirs[doorFace];

  for (let f = 0; f < floors; f++) {
    const yb = f * fh;
    const groundDoor = o.enter && f === 0;
    // two parallel walls (along x) and two ends
    for (const side of [1, -1]) {
      const zz = z + side * (d / 2 - t / 2);
      if (side === dz && groundDoor) {
        // split for a doorway
        const openW = 1.5;
        const segW = (w - openW) / 2;
        B.box(segW, fh, t, mat, x - (openW / 2 + segW / 2), yb, zz, 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
        B.box(segW, fh, t, mat, x + (openW / 2 + segW / 2), yb, zz, 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
        B.box(openW, fh - 2.25, t, mat, x, yb + 2.25, zz, 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
      } else {
        B.box(w, fh, t, mat, x, yb, zz, 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
      }
    }
    const inner = d - t * 2;
    for (const side of [1, -1]) {
      const xx = x + side * (w / 2 - t / 2);
      if (side === dx && groundDoor) {
        const openW = 1.5, segD = (inner - openW) / 2;
        B.box(t, fh, segD, mat, xx, yb, z + (openW / 2 + segD / 2), 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
        B.box(t, fh, segD, mat, xx, yb, z - (openW / 2 + segD / 2), 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
        B.box(t, fh - 2.25, openW, mat, xx, yb + 2.25, z, 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
      } else {
        B.box(t, fh, inner, mat, xx, yb, z, 0, { rep: 2.4, matOpts: tint, tag: 'stone' });
      }
    }
    if (f > 0 || !o.enter) {
      // interior floor slab so you can't see through to the sky
      B.box(w - t * 2, 0.2, d - t * 2, 'concrete', x, yb - 0.2, z, 0, { rep: 2.4, solid: false, matOpts: { color: 0xb9b3a4 } });
    }
  }

  // roof
  if (o.roof === 'tile') {
    const rise = 1.5;
    for (const s of [1, -1]) {
      const g = boxGeo(w + 0.5, 0.22, d / 2 + 0.3, 1.6);
      const pitch = Math.atan2(rise, d / 2);
      B.prop(g, 'roof', x, h + rise / 2 - 0.2, z + s * d / 4, 0, { rx: s * pitch });
    }
    B.box(w * 0.16, rise, d * 0.16, mat, x, h, z, 0, { rep: 2, solid: false, matOpts: tint });
  } else {
    B.box(w + 0.4, 0.3, d + 0.4, 'concrete', x, h, z, 0, { rep: 2.4, matOpts: { color: 0xb2ab99 } });
    const ph = 0.75, pt = 0.26;
    for (const [sx, sz] of [[0, d / 2 + 0.1], [0, -d / 2 - 0.1]]) B.box(w + 0.4, ph, pt, mat, x + sx, h + 0.3, z + sz, 0, { rep: 2, solid: false, matOpts: tint });
    for (const [sx, sz] of [[w / 2 + 0.1, 0], [-w / 2 - 0.1, 0]]) B.box(pt, ph, d + 0.4, mat, x + sx, h + 0.3, z + sz, 0, { rep: 2, solid: false, matOpts: tint });
  }

  // windows on street faces
  if (o.windows !== false) {
    const wins = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let f = o.windowsFrom ?? 1; f < floors; f++) {
      for (const [sx, sz] of wins) {
        const n = sx ? Math.max(1, Math.round((d - 2) / 3.1)) : Math.max(1, Math.round((w - 2) / 3.1));
        if (o.skipFace != null && Math.abs(sx) === Math.abs(dirs[o.skipFace][0]) && Math.abs(sz) === Math.abs(dirs[o.skipFace][1])) continue;
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * (sx ? (d - 3.2) : (w - 3.2));
          const wx = x + (sx ? sx * (w / 2) : off);
          const wz = z + (sz ? sz * (d / 2) : off);
          const yaw = sx ? sx * Math.PI / 2 : (sz > 0 ? 0 : Math.PI);
          windowSlot(B, wx, f * fh + 1.85, wz, yaw, 1.05, 1.4, o.shutters === false ? null : (chance(0.45) ? pick(['woodGreen', 'woodBlue']) : null));
        }
      }
    }
    // ground-floor shopfronts on non-door faces
    if (o.shopfront) {
      for (const [sx, sz] of wins) {
        if (sx === dx && sz === dz) continue;
        windowSlot(B, x + sx * (w / 2 - 0.02), 1.6, z + sz * (d / 2 - 0.02), sx ? sx * Math.PI / 2 : (sz > 0 ? 0 : Math.PI), 1.9, 1.5);
      }
    }
  }

  // door leaf
  if (o.enter || o.door !== false) {
    const doorCol = o.doorColor || pick(['woodGreen', 'woodBlue', 'woodRed']);
    const lx = dx ? x + dx * (w / 2 - 0.1) : x;
    const lz = dz ? z + dz * (d / 2 - 0.1) : z;
    const yaw = dx ? dx * Math.PI / 2 : (dz > 0 ? 0 : Math.PI);
    B.prop(boxGeo(1.42, 2.22, 0.1, 1.2), doorCol, lx, 1.11, lz, yaw, { cast: false });
    B.prop(boxGeo(1.6, 0.16, 0.16, 1), 'concrete', lx, 2.28, lz, yaw, { cast: false, matOpts: { color: 0xd6cdb8 } });
  }

  // balcony
  if (o.balcony) {
    const bf = o.balcony.floor ?? 1;
    const of = o.balcony.face ?? doorFace;
    const [bx, bz] = dirs[of];
    const bw = o.balcony.w ?? Math.min(w, 3.6);
    const cx = x + bx * (w / 2 + 0.62) + (bx ? 0 : 0);
    const cz = z + bz * (d / 2 + 0.62);
    const px = bx ? x + bx * (w / 2) : x;
    const pz = bz ? z + bz * (d / 2) : z;
    const y = bf * fh;
    B.box(bx ? 1.35 : bw, 0.2, bz ? 1.35 : bw, 'concrete', px + bx * 0.68, y, pz + bz * 0.68, 0, { rep: 1.6, matOpts: { color: 0xc3bba6 } });
    // railing
    const rl = (bw / 2) * 1;
    const railYaw = bz ? 0 : Math.PI / 2;
    const rx = px + bx * 1.3, rz = pz + bz * 1.3;
    B.prop(boxGeo(bw, 0.08, 0.08, 1), 'metal', rx, y + 1.05, rz, railYaw, { cast: false, matOpts: { color: 0x2a2a2c, metal: 0.4, roughness: 0.5 } });
    const n = Math.max(3, Math.round(bw / 0.5));
    for (let i = 0; i <= n; i++) {
      const off = (i / n - 0.5) * bw;
      const bxp = railYaw === 0 ? rx + off : rx;
      const bzp = railYaw === 0 ? rz : rz + off;
      B.prop(boxGeo(0.05, 1.05, 0.05, 1), 'metal', bxp, y + 0.52, bzp, 0, { cast: false, matOpts: { color: 0x2a2a2c, metal: 0.4, roughness: 0.5 } });
    }
    if (chance(0.7)) B.prop(boxGeo(bw, 0.14, 0.3, 1.2), 'wood', rx, y + 1.1, rz, railYaw, { cast: false, matOpts: { color: 0x8a7b5e } });
  }

  // street dressing: awning, AC, downspout, wires are added by the map layer

  return { x, z, w, d, h, mat, floors, doorFace };
}

/** shuttered shop awning over a doorway / market front */
export function awning(B, x, y, z, w, yaw, o = {}) {
  const depth = o.depth ?? 1.7;
  const drop = o.drop ?? 0.5;
  const kit = o.kit || 'clothStriped';
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(drop, depth), yaw, 0, 'YXZ'));
  const canopy = B.prop(boxGeo(w, 0.06, depth, 1.1), kit, x + nx * depth / 2, y - drop / 2, z + nz * depth / 2, yaw, { cast: true, matOpts: o.tint ? { color: o.tint } : {} });
  canopy.quaternion.copy(q);
  // scalloped valance
  B.prop(boxGeo(w, 0.3, 0.05, 1.1), kit, x + nx * depth, y - drop - 0.08, z + nz * depth, yaw, { cast: false, matOpts: o.tint ? { color: o.tint } : {} });
  if (o.poles) {
    for (const s of [-1, 1]) {
      const ox = Math.cos(yaw) * s * (w / 2 - 0.1), oz = -Math.sin(yaw) * s * (w / 2 - 0.1);
      B.cyl(0.035, 0.035, y - drop - 0.1, 'metal', x + ox + nx * depth * 0.92, 0, z + oz + nz * depth * 0.92, { seg: 6, matOpts: { color: 0x3a3a3c, metal: 0.5, roughness: 0.4 } });
    }
  }
}

export function acUnit(B, x, y, z, yaw) {
  B.prop(boxGeo(0.85, 0.6, 0.42, 0.9), 'metal', x, y, z, yaw, { matOpts: { color: 0xb9b4a8, roughness: 0.7 } });
  B.prop(new THREE.CircleGeometry(0.2, 12), 'metal', x + Math.sin(yaw) * 0.22, y, z + Math.cos(yaw) * 0.22, yaw, { cast: false, matOpts: { color: 0x2e2e30 } });
  B.prop(boxGeo(1.0, 0.06, 0.5, 0.9), 'metal', x, y - 0.34, z, yaw, { cast: false, matOpts: { color: 0x6b675c } });
}

export function downspout(B, x, z, h, yaw = 0) {
  B.cyl(0.07, 0.07, h, 'metalGreen', x, 0, z, { seg: 6, matOpts: { color: 0x6c7362, roughness: 0.75 } });
  B.prop(boxGeo(0.18, 0.14, 0.18, 0.6), 'metalGreen', x, h, z, yaw, { cast: false, matOpts: { color: 0x6c7362 } });
}

export function streetLamp(B, x, z, yaw = 0, h = 5.2) {
  B.cyl(0.06, 0.09, h, 'metal', x, 0, z, { seg: 7, solid: true, tag: 'metal', matOpts: { color: 0x6e7166, metal: 0.35, roughness: 0.6 } });
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const arm = boxGeo(0.09, 0.09, 1.25, 1);
  B.prop(arm, 'metal', x + nx * 0.6, h - 0.1, z + nz * 0.6, yaw, { matOpts: { color: 0x6e7166, metal: 0.35, roughness: 0.6 } });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.28, 8), B.mat('metal', { color: 0x2c2e2a, metal: 0.4, roughness: 0.5 }));
  head.position.set(x + nx * 1.2, h - 0.26, z + nz * 1.2);
  head.castShadow = true;
  B.add(head);
  B.prop(new THREE.SphereGeometry(0.14, 8, 6), 'concrete', x + nx * 1.2, h - 0.42, z + nz * 1.2, 0, { cast: false, matOpts: { color: 0xfff0c8, emissive: 0x2a2418 } });
}

export function wire(B, x1, y1, z1, x2, y2, z2, sag = 0.8) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(
      x1 + (x2 - x1) * t,
      y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * sag,
      z1 + (z2 - z1) * t,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 12, 0.035, 5, false);
  B.prop(g, 'metal', 0, 0, 0, 0, { cast: false, matOpts: { color: 0x24231f, roughness: 0.85 } });
}

export function marketStall(B, x, z, yaw = 0) {
  const w = 3.0, d = 1.7;
  // table
  B.box(w, 0.09, d, 'wood', x, 0.88, z, yaw, { rep: 1.1, tag: 'wood', matOpts: { color: 0xb59d74 } });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ox = Math.cos(yaw) * sx * (w / 2 - 0.12) - Math.sin(yaw) * sz * (d / 2 - 0.12);
    const oz = -Math.sin(yaw) * sx * (w / 2 - 0.12) - Math.cos(yaw) * sz * (d / 2 - 0.12);
    B.prop(boxGeo(0.08, 0.88, 0.08, 1), 'wood', x - ox, 0.44, z - oz, yaw, { cast: false, matOpts: { color: 0x8b7a58 } });
  }
  // canopy
  const post = 2.25;
  for (const s of [-1, 1]) {
    const ox = Math.cos(yaw) * s * (w / 2 - 0.1), oz = -Math.sin(yaw) * s * (w / 2 - 0.1);
    B.prop(boxGeo(0.07, post, 0.07, 1), 'wood', x + ox, post / 2, z + oz, yaw, { cast: false, matOpts: { color: 0x7d6b4c } });
  }
  const cw = w + 0.5, cd = d + 0.6;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.14, yaw, 0, 'YXZ'));
  const can = B.prop(boxGeo(cw, 0.05, cd, 1.2), 'clothStriped', x, post + 0.06, z, yaw, { cast: true });
  can.quaternion.copy(q);
  B.prop(boxGeo(cw, 0.24, 0.05, 1.2), 'clothStriped', x + Math.sin(yaw) * cd * 0.5, post - 0.28, z + Math.cos(yaw) * cd * 0.5, yaw, { cast: false });
  // produce
  const cols = [0xd8c352, 0xc24a34, 0x7fa03c, 0xb8683a, 0xd8a03c];
  for (let i = 0; i < 4; i++) {
    const ox = Math.cos(yaw) * (i - 1.5) * 0.7, oz = -Math.sin(yaw) * (i - 1.5) * 0.7;
    B.prop(boxGeo(0.62, 0.22, 0.62, 0.8), 'wood', x + ox, 0.98, z + oz, yaw, { cast: false, matOpts: { color: 0x9c8558 } });
    for (let k = 0; k < 5; k++) {
      B.prop(new THREE.SphereGeometry(0.09, 6, 5), 'concrete', x + ox + rand(-0.2, 0.2), 1.14, z + oz + rand(-0.2, 0.2), 0, { cast: false, matOpts: { color: cols[(i + k) % cols.length], roughness: 0.7 } });
    }
  }
}

export function fruitCart(B, x, z, yaw = 0) {
  B.box(1.9, 0.12, 1.0, 'wood', x, 0.72, z, yaw, { rep: 1, tag: 'wood', matOpts: { color: 0xa8916a } });
  for (const s of [-1, 1]) {
    B.prop(boxGeo(0.1, 0.72, 0.1, 1), 'wood', x + Math.cos(yaw) * s * 0.7, 0.36, z - Math.sin(yaw) * s * 0.7, yaw, { cast: false });
  }
  const wheel = new THREE.TorusGeometry(0.32, 0.07, 6, 14);
  for (const s of [-1, 1]) {
    B.prop(wheel.clone(), 'tyre', x + Math.cos(yaw) * 0.55 + Math.sin(yaw) * s * 0.55, 0.34, z - Math.sin(yaw) * 0.55 + Math.cos(yaw) * s * 0.55, yaw + Math.PI / 2);
  }
  for (let i = 0; i < 4; i++) {
    B.prop(new THREE.SphereGeometry(0.13, 7, 6), 'concrete', x + rand(-0.7, 0.7), 0.86, z + rand(-0.35, 0.35), 0, { cast: false, matOpts: { color: pick([0xd8c352, 0xc24a34, 0x7fa03c, 0xd8a03c]) } });
  }
  B.solid(x, 0.5, z, 1.0, 0.5, 0.6, yaw, 'wood');
}

// ═══════════════ mosque landmark ═══════════════

export function mosque(B, x, z, yaw = 0) {
  const w = 16, d = 13, h = 5.2, t = 0.42;
  const mat = 'stuccoPale';
  for (const side of [1, -1]) {
    B.box(w, h, t, mat, x, 0, z + side * (d / 2 - t / 2), 0, { rep: 2.6, tag: 'stone', matOpts: { color: 0xe8dfc6 } });
    B.box(t, h, d - t * 2, mat, x + side * (w / 2 - t / 2), 0, z, 0, { rep: 2.6, tag: 'stone', matOpts: { color: 0xe8dfc6 } });
  }
  // arcade of arches on the +z face
  for (let i = -1; i <= 1; i++) {
    const ax = x + i * 4.4;
    B.prop(archGeo(3.4, 3.6, 2.5, 3.2, 0.5, 1.6), mat, ax, 0, z + d / 2 - 0.02, 0, { matOpts: { color: 0xe8dfc6 } });
  }
  // prayer hall interior floor + dome
  B.box(w - t * 2, 0.2, d - t * 2, 'concrete', x, -0.2, z, 0, { rep: 2.4, solid: false, matOpts: { color: 0xc9c0aa } });
  const dome = new THREE.Mesh(domeGeo(5.6, 0.78, 1.4), B.mat(mat, { color: 0x6d8f7a, roughness: 0.7, normal: false }));
  dome.position.set(x, h, z);
  dome.castShadow = true; dome.receiveShadow = true;
  B.add(dome);
  B.prop(new THREE.CylinderGeometry(5.4, 5.4, 0.5, 18), mat, x, h + 0.1, z, 0, { cast: false, matOpts: { color: 0xe8dfc6 } });
  B.prop(new THREE.SphereGeometry(0.42, 10, 8), mat, x, h + 4.6, z, 0, { cast: false, matOpts: { color: 0xc9a13c, metal: 0.6, roughness: 0.35 } });
  // minaret
  const mx = x + w / 2 + 2.6, mz = z - 2.5;
  const mh = 15.5;
  B.box(2.6, mh, 2.6, mat, mx, 0, mz, 0, { rep: 2.2, tag: 'stone', matOpts: { color: 0xe4dac0 } });
  B.box(3.5, 0.35, 3.5, mat, mx, mh - 2.2, mz, 0, { rep: 1.4, solid: false, matOpts: { color: 0xd8cdae } });
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    B.prop(boxGeo(sx ? 0.9 : 3.3, 1.0, sz ? 0.9 : 3.3, 0.9), mat, mx + sx * 1.3, mh - 1.85, mz + sz * 1.3, 0, { cast: false, matOpts: { color: 0xd2c7a6 } });
  }
  for (let i = 0; i < 3; i++) {
    B.prop(new THREE.CylinderGeometry(0.72 - i * 0.14, 0.86 - i * 0.14, 1.3, 10), mat, mx, mh + 0.3 + i * 1.2, mz, 0, { matOpts: { color: 0xdfd5b8 } });
  }
  B.prop(new THREE.SphereGeometry(0.55, 10, 8), mat, mx, mh + 3.9, mz, 0, { matOpts: { color: 0xbf9440, metal: 0.7, roughness: 0.3 } });
  // small slit windows on the minaret
  for (let i = 0; i < 4; i++) {
    for (const [sx, sz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      B.prop(boxGeo(sx ? 0.06 : 0.5, 0.9, sz ? 0.06 : 0.5, 1), mat, mx + sx * 1.31, 2.4 + i * 3.2, mz + sz * 1.31, 0, { cast: false, mat: glassMat(B) });
    }
  }
}

// ═══════════════ industrial ═══════════════

export function shed(B, x, z, o = {}) {
  const w = o.w ?? 10, d = o.d ?? 7, h = o.h ?? 4.4, t = 0.22;
  const mat = o.mat || 'metalGreen';
  const tint = o.tint ? { color: o.tint } : {};
  const yaw = o.yaw || 0;
  const openSide = o.open ?? 0;   // number of walls missing on +z side
  for (const side of [1, -1]) B.box(w, h, t, mat, x, 0, z + side * (d / 2 - t / 2), yaw, { rep: 1.6, matOpts: tint, tag: 'metal' });
  for (const side of [1, -1]) B.box(t, h, d - t * 2, mat, x + side * (w / 2 - t / 2), 0, z, yaw, { rep: 1.6, matOpts: tint, tag: 'metal' });
  // gable roof (two slabs)
  const rise = o.rise ?? 1.35;
  for (const s of [1, -1]) {
    const g = boxGeo(w + 0.7, 0.16, d / 2 + 0.5, 1.7);
    const m = B.prop(g, o.roofMat || 'metalRust', x + Math.sin(yaw) * s * d / 4, h + rise / 2 + 0.02, z + Math.cos(yaw) * s * d / 4, yaw, { matOpts: o.roofMat ? {} : { color: 0x9a8a6c } });
    m.rotation.z = 0;
    m.rotation.x = s * Math.atan2(rise, d / 2);
  }
  B.box(w * 0.1, 0.5, d * 0.1, mat, x - w * 0.3, h + 1.1, z, 0, { rep: 1, solid: false, matOpts: { color: 0x5a5a52 } });
  // door frame
  B.prop(boxGeo(2.6, 0.16, 0.9, 1), 'metal', x, h - 1.1, z + d / 2 + 0.3, yaw, { cast: false, matOpts: { color: 0x4a4a44 } });
  if (o.clutter !== false) {
    B.cyl(0.16, 0.16, h - 0.6, 'metalRust', x - w / 2 + 0.7, 0, z + d / 2 + 0.2, { seg: 8, matOpts: { color: 0x7a6a52 } });
  }
}

export function container(B, x, z, yaw = 0, tint = 0x7a4a3a) {
  const w = 6.1, h = 2.6, d = 2.44;
  B.box(w, h, d, 'metal', x, 0, z, yaw, { rep: 1.5, tag: 'metal', matOpts: { color: tint, roughness: 0.72, metal: 0.25 } });
  // ribs + door end
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  for (const s of [-1, 1]) {
    B.prop(boxGeo(w + 0.06, 0.12, d + 0.06, 1), 'metal', x, 0.18, z, yaw, { cast: false, matOpts: { color: 0x3a3a36 } });
    B.prop(boxGeo(w + 0.06, 0.12, d + 0.06, 1), 'metal', x, h - 0.2, z, yaw, { cast: false, matOpts: { color: 0x3a3a36 } });
  }
  B.prop(boxGeo(0.12, h - 0.3, d - 0.2, 1), 'metal', x - Math.cos(yaw) * w / 2, h / 2, z + Math.sin(yaw) * w / 2, yaw, { cast: false, matOpts: { color: 0x4a4136 } });
  B.prop(boxGeo(0.12, h - 0.3, d - 0.2, 1), 'metal', x + Math.cos(yaw) * w / 2, h / 2, z - Math.sin(yaw) * w / 2, yaw, { cast: false, matOpts: { color: 0x4a4136 } });
}

export function shelfRack(B, x, z, yaw = 0) {
  const w = 3.6, d = 1.1, h = 3.0;
  const tint = { color: 0x5c6470, metal: 0.4, roughness: 0.55 };
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ox = Math.cos(yaw) * sx * w / 2 - Math.sin(yaw) * sz * d / 2;
    const oz = -Math.sin(yaw) * sx * w / 2 - Math.cos(yaw) * sz * d / 2;
    B.prop(boxGeo(0.09, h, 0.09, 1), 'metal', x + ox, h / 2, z + oz, yaw, { matOpts: tint });
  }
  for (let i = 0; i < 4; i++) {
    B.prop(boxGeo(w, 0.06, d, 1.4), 'metal', x, 0.35 + i * 0.85, z, yaw, { matOpts: { ...tint, color: 0x6b7078 } });
    if (chance(0.75)) {
      const s = rand(0.5, 0.75);
      B.prop(boxGeo(s, s, s, 1), 'wood', x + rand(-1.3, 1.3), 0.38 + i * 0.85 + s / 2, z + rand(-0.2, 0.2), rand(0, 6.28), { matOpts: { color: pick([0xb9a480, 0x9aa07c, 0xa88f6c]) } });
    }
  }
  B.solid(x, h / 2, z, w / 2, h / 2, d / 2, yaw, 'metal');
}

export function forklift(B, x, z, yaw = 0) {
  const yellow = { color: 0xd8a12c, roughness: 0.6, metal: 0.2 };
  B.prop(boxGeo(1.5, 0.9, 2.2, 1.2), 'metal', x, 0.65, z, yaw, { matOpts: yellow });
  B.prop(boxGeo(1.3, 0.9, 1.0, 1), 'metal', x - Math.sin(yaw) * 0.4, 1.65, z - Math.cos(yaw) * 0.4, yaw, { matOpts: { color: 0x2c2c2e, roughness: 0.7 } });
  B.prop(boxGeo(1.45, 0.12, 1.2, 1), 'metal', x - Math.sin(yaw) * 0.45, 2.18, z - Math.cos(yaw) * 0.45, yaw, { matOpts: yellow });
  // mast + forks
  const fx = x + Math.sin(yaw) * 1.15, fz = z + Math.cos(yaw) * 1.15;
  for (const s of [-1, 1]) {
    B.prop(boxGeo(0.12, 2.7, 0.12, 1), 'metal', fx + Math.cos(yaw) * s * 0.42, 1.35, fz - Math.sin(yaw) * s * 0.42, yaw, { matOpts: { color: 0x4a4a4c, metal: 0.5 } });
  }
  for (const s of [-1, 1]) {
    B.prop(boxGeo(0.14, 0.07, 1.3, 1), 'metal', fx + Math.cos(yaw) * s * 0.42 + Math.sin(yaw) * 0.5, 0.34, fz - Math.sin(yaw) * s * 0.42 + Math.cos(yaw) * 0.5, yaw, { matOpts: { color: 0x3c3c3e, metal: 0.5 } });
  }
  const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10).rotateZ(Math.PI / 2);
  for (const [ox, oz] of [[0.62, 0.75], [-0.62, 0.75], [0.62, -0.8], [-0.62, -0.8]]) {
    const rx = Math.cos(yaw) * ox - Math.sin(yaw) * oz;
    const rz = -Math.sin(yaw) * ox - Math.cos(yaw) * oz;
    B.prop(tyre.clone(), 'tyre', x + rx, 0.34, z + rz, yaw);
  }
  B.solid(x, 0.85, z, 0.9, 0.85, 1.3, yaw, 'metal');
}

// ═══════════════ desert / military ═══════════════

export function sandbagWall(B, x, z, len, yaw = 0, rows = 3) {
  const bag = new THREE.SphereGeometry(0.42, 7, 5);
  bag.scale(0.92, 0.56, 0.66);
  const perRow = Math.max(1, Math.round(len / 0.74));
  let y = 0;
  for (let r = 0; r < rows; r++) {
    const shift = (r % 2) * 0.43;
    const n = perRow - (r > 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 0.74 + shift * 0.8;
      const bx = x + Math.cos(yaw) * t, bz = z - Math.sin(yaw) * t;
      B.prop(bag.clone(), 'sandbags', bx, y + 0.17, bz, yaw + rand(-0.16, 0.16), {
        scale: 1 - r * 0.03,
        matOpts: { color: new THREE.Color().setHSL(0.10, 0.15, 0.44 + Math.random() * 0.12).getHex() },
      });
    }
    y += 0.25;
  }
  B.solid(x, rows * 0.15, z, len / 2 + 0.2, rows * 0.16, 0.4, yaw, 'sandbag');
}

export function jerseyLine(B, x, z, len, yaw = 0) {
  const n = Math.max(1, Math.round(len / 3.1));
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * 3.1;
    const bx = x + Math.cos(yaw) * t, bz = z - Math.sin(yaw) * t;
    const g = barrierGeo(3.0, 0.85, 0.66, 1.4);
    B.prop(g, 'concrete', bx, 0, bz, yaw + Math.PI / 2, { matOpts: { color: 0xcfc9b8 } });
    B.solid(bx, 0.42, bz, 1.5, 0.43, 0.36, yaw + Math.PI / 2, 'concrete');
  }
}

export function tent(B, x, z, o = {}) {
  const w = o.w ?? 6.2, d = o.d ?? 5.0, h = o.h ?? 2.5, yaw = o.yaw || 0;
  const kit = o.kit || 'clothSand';
  const rise = o.rise ?? 1.5;
  for (const s of [1, -1]) {
    const g = boxGeo(w + 0.3, 0.1, Math.hypot(d / 2, rise) + 0.25, 1.6);
    // the underside of a sunlit canvas gets plenty of bounced light — lift it so it
    // doesn't read as a black slab when you stand under it
    const m = B.prop(g, kit, x + Math.sin(yaw) * s * d / 4, h + rise / 2 - 0.35, z + Math.cos(yaw) * s * d / 4, yaw, {
      matOpts: { side: THREE.DoubleSide, emissive: 0x2a2519, emissiveIntensity: 1, ...(o.tint ? { color: o.tint } : {}) },
    });
    m.rotation.x = s * Math.atan2(rise, d / 2);
  }
  // end walls
  for (const s of [1, -1]) {
    B.prop(boxGeo(0.08, h, d - 0.4, 1.2), kit, x + Math.cos(yaw) * s * w / 2, h / 2, z - Math.sin(yaw) * s * w / 2, yaw, { matOpts: o.tint ? { color: o.tint } : {} });
  }
  // frame poles
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const rx = Math.cos(yaw) * ox * w / 2 - Math.sin(yaw) * oz * d / 2;
    const rz = -Math.sin(yaw) * ox * w / 2 - Math.cos(yaw) * oz * d / 2;
    B.prop(boxGeo(0.09, h, 0.09, 1), 'metal', x + rx, h / 2, z + rz, yaw, { cast: false, matOpts: { color: 0x5a5a52 } });
  }
  // roof shell only — the tent interior stays walkable
  B.solid(x, h + rise * 0.55, z, w / 2 + 0.2, 0.2, d / 2 + 0.12, yaw, 'cloth');
}

export function truck(B, x, z, o = {}) {
  const yaw = o.yaw || 0;
  const kit = o.covered === false ? 'metalGreen' : 'clothSand';
  const body = o.covered === false ? 'metalGreen' : 'clothSand';
  // bed + cover
  B.box(6.4, 1.5, 2.5, body, x, 1.0, z, yaw, { rep: 1.7, tag: 'metal', matOpts: o.covered === false ? { color: 0x6b7358 } : { color: 0xb0a382 } });
  B.box(6.4, 0.35, 2.6, 'metalGreen', x, 0.68, z, yaw, { rep: 1.7, solid: false, matOpts: { color: 0x53584a } });
  // cab
  const cx = x + Math.cos(yaw) * 4.0, cz = z - Math.sin(yaw) * 4.0;
  B.box(2.6, 1.9, 2.4, 'metalGreen', cx, 1.0, cz, yaw, { rep: 1.6, tag: 'metal', matOpts: { color: 0x5f6d4a } });
  B.prop(boxGeo(0.1, 0.8, 2.1, 1.2), 'metal', cx + Math.cos(yaw) * 1.25, 2.0, cz - Math.sin(yaw) * 1.25, yaw, { cast: false, mat: glassMat(B) });
  B.prop(boxGeo(2.4, 0.16, 2.5, 1.4), 'metalGreen', cx, 2.94, cz, yaw, { cast: false, matOpts: { color: 0x565f45 } });
  B.prop(boxGeo(1.2, 0.5, 0.36, 1), 'metal', cx + Math.cos(yaw) * 1.35, 1.5, cz - Math.sin(yaw) * 1.35, yaw, { cast: false, matOpts: { color: 0x3a3c36 } });
  // wheels — the cylinder is built along X (axle direction), so it only needs the truck yaw
  const tyre = new THREE.CylinderGeometry(0.52, 0.52, 0.36, 12).rotateZ(Math.PI / 2);
  for (const [ax, az] of [[2.4, 1.3], [2.4, -1.3], [-2.1, 1.3], [-2.1, -1.3], [-3.4, 1.3], [-3.4, -1.3]]) {
    const rx = Math.cos(yaw) * ax - Math.sin(yaw) * az;
    const rz = -Math.sin(yaw) * ax - Math.cos(yaw) * az;
    B.prop(tyre.clone(), 'tyre', x + rx, 0.52, z + rz, yaw);
  }
  B.solid(x, 1.2, z, 3.2, 1.2, 1.3, yaw, 'metal');
}

export function watchtower(B, x, z, h = 6.4) {
  const half = 1.5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    B.prop(boxGeo(0.22, h, 0.22, 1.2), 'wood', x + sx * half, h / 2, z + sz * half, 0, { matOpts: { color: 0x8e7c5a } });
    B.solid(x + sx * half, h / 2, z + sz * half, 0.18, h / 2, 0.18, 0, 'wood');
  }
  for (let i = 1; i < 4; i++) {
    B.prop(boxGeo(half * 2, 0.1, 0.1, 1), 'wood', x, i * (h / 4), z + half, 0, { cast: false, matOpts: { color: 0x8a7856 } });
    B.prop(boxGeo(half * 2, 0.1, 0.1, 1), 'wood', x, i * (h / 4), z - half, 0, { cast: false, matOpts: { color: 0x8a7856 } });
  }
  B.box(half * 2.4, 0.24, half * 2.4, 'wood', x, h, z, 0, { rep: 1.4, matOpts: { color: 0x9a8663 } });
  for (const sz of [1, -1]) B.box(half * 2.4, 1.05, 0.12, 'wood', x, h + 0.24, z + sz * half * 1.2, 0, { rep: 1.2, solid: false, matOpts: { color: 0x84714f } });
  for (const sx of [1, -1]) B.box(0.12, 1.05, half * 2.4, 'wood', x + sx * half * 1.2, h + 0.24, z, 0, { rep: 1.2, solid: false, matOpts: { color: 0x84714f } });
  // roof
  for (const sz of [1, -1]) {
    const g = boxGeo(half * 3.4, 0.12, half * 1.4, 1.6);
    const m = B.prop(g, 'metalRust', x, h + 2.1, z + sz * half * 0.6, 0, { matOpts: { color: 0x8a7a5e } });
    m.rotation.x = -sz * 0.42;
  }
  B.prop(boxGeo(0.14, 1.4, 0.14, 1), 'metal', x + half, h + 1.1, z + half, 0, { cast: false, matOpts: { color: 0x5a5a52 } });
}

export function palm(B, x, z, o = {}) {
  const h = o.h ?? rand(6.5, 9.5);
  const trunk = trunkGeo(h, 0.34, 0.19, o.bend ?? rand(-0.5, 0.5), 8);
  B.prop(trunk, 'wood', x, 0, z, rand(0, 6.28), { matOpts: { color: 0x9a8259, roughness: 0.95 } });
  const crownY = h;
  const fronds = 9;
  const leaf = leafGeo(3.5, 0.42);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rand(-0.2, 0.2);
    const tilt = -0.22 - Math.random() * 0.6;
    const m = B.prop(leaf.clone(), 'metal', x, crownY - 0.1, z, a, { ry: 0, cast: true });
    m.rotation.order = 'YXZ';
    m.rotation.set(tilt, a, 0);
    m.material = frondMat(B);
  }
  for (let i = 0; i < 3; i++) {   // dead hanging fronds
    const a = rand(0, 6.28);
    const m = B.prop(leaf.clone(), 'metal', x, crownY - 0.25, z, a, { cast: true });
    m.rotation.order = 'YXZ';
    m.rotation.set(-2.2, a, 0);
    m.material = frondMat(B);
  }
  B.prop(new THREE.SphereGeometry(0.3, 8, 6), 'wood', x, crownY - 0.05, z, 0, { matOpts: { color: 0x7b7040 } });
  B.solid(x, h / 2, z, 0.3, h / 2, 0.3, 0, 'wood');
}

export function bush(B, x, z, s = 1.4) {
  const g = new THREE.PlaneGeometry(s, s * 0.8);
  for (let i = 0; i < 3; i++) B.prop(g.clone(), 'metal', x, s * 0.35, z, i * 1.05, { mat: leafMat(B) });
}

export function rockCluster(B, x, z, n = 4, r = 1.2) {
  for (let i = 0; i < n; i++) {
    const s = rand(0.5, 1) * r;
    const g = rockGeo(s, i * 7.3);
    const px = x + rand(-r, r) * 0.9, pz = z + rand(-r, r) * 0.9;
    B.prop(g, 'concrete', px, s * 0.2, pz, rand(0, 6.28), { matOpts: { color: new THREE.Color().setHSL(0.09, 0.16, 0.42 + Math.random() * 0.16).getHex(), roughness: 1 } });
    if (s > 0.75) B.solid(px, s * 0.32, pz, s * 0.7, s * 0.3, s * 0.7, 0, 'stone');
  }
}

export function flagpole(B, x, z, color = 0xc44a3a, h = 7.5) {
  B.cyl(0.07, 0.09, h, 'metal', x, 0, z, { seg: 8, solid: true, tag: 'metal', matOpts: { color: 0xb8b3a4, metal: 0.4, roughness: 0.5 } });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95, 8, 3), B.mat('clothSand', { color, side: THREE.DoubleSide, roughness: 0.85, normal: false }));
  flag.position.set(x + 0.98, h - 0.75, z);
  flag.castShadow = true;
  flag.userData.noMerge = true;                 // vertex-animated
  B.add(flag);
  const base = flag.geometry.attributes.position;
  const rest = [];
  for (let i = 0; i < base.count; i++) rest.push(base.getX(i));
  B.anim.push((dt, t) => {
    for (let i = 0; i < base.count; i++) {
      const x0 = rest[i];
      base.setZ(i, Math.sin(x0 * 2.2 - t * 3.4) * 0.16 * (x0 + 0.95));
      base.setY(i, base.getY(i));
    }
    base.needsUpdate = true;
  });
}

export function waterTower(B, x, z) {
  const h = 5.0;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    B.prop(boxGeo(0.16, h, 0.16, 1.2), 'metal', x + sx * 1.1, h / 2, z + sz * 1.1, 0, { matOpts: { color: 0x6a6a62, metal: 0.4 } });
    B.solid(x + sx * 1.1, h / 2, z + sz * 1.1, 0.14, h / 2, 0.14, 0, 'metal');
  }
  B.box(2.2, 0.14, 2.2, 'metal', x - 1.1, h, z, 0, { rep: 1.2, solid: false, matOpts: { color: 0x6a6a62 } });
  B.cyl(1.5, 1.5, 2.4, 'metalRust', x, h + 1.5, z, { seg: 14, matOpts: { color: 0x8a6a44 } });
  B.prop(new THREE.ConeGeometry(1.55, 0.8, 14), 'metalRust', x, h + 3.1, z, 0, { matOpts: { color: 0x7a5c3c } });
  B.solid(x, h + 2.7, z, 1.5, 1.2, 1.5, 0, 'metal');
}

/**
 * external stairway — colliders flagged climb so the step-up logic walks it.
 * The tread runs along the direction of travel: cos/sin place the boxes, so the
 * geometry has to be built (run, height, width) to match that travel axis.
 */
export function stairway(B, x, z, o = {}) {
  const steps = o.steps ?? 10, rise = o.rise ?? 0.42, run = o.run ?? 0.44, w = o.w ?? 1.5;
  const yaw = o.yaw || 0;
  const dir = o.dir ?? 1;    // +1 climbs along (cos yaw, -sin yaw)
  for (let i = 0; i < steps; i++) {
    const t = dir * (i - (steps - 1) / 2) * run;
    const bx = x + Math.cos(yaw) * t;
    const bz = z - Math.sin(yaw) * t;
    B.box(run, rise * (i + 1), w, o.mat || 'concrete', bx, 0, bz, yaw, { rep: 1.4, climb: true, tag: 'stone', matOpts: { color: 0xbdb6a4 } });
  }
}

export function awningRow(B, x, z, w, yaw, o = {}) {
  const n = Math.max(1, Math.round(w / 3.2));
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * 3.2;
    const bx = x + Math.cos(yaw) * t, bz = z - Math.sin(yaw) * t;
    awning(B, bx, o.y ?? 2.9, bz, 2.9, yaw, { kit: i % 2 ? 'clothStriped' : 'clothSand', poles: o.poles });
  }
}

export function hangingSign(B, x, y, z, text, yaw) {
  const tex = makeSign(text, '#c9b48a', '#3b3226');
  const m = new THREE.Mesh(boxGeo(0.06, 0.62, 1.25, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  m.position.set(x, y, z);
  m.rotation.y = yaw + Math.PI / 2;
  m.castShadow = true;
  B.add(m);
  B.prop(boxGeo(0.7, 0.05, 0.05, 1), 'metal', x - Math.sin(yaw) * 0.35, y + 0.42, z - Math.cos(yaw) * 0.35, yaw, { cast: false, matOpts: { color: 0x2e2c28 } });
}

// ═══════════════ vehicles / drums / ruins ═══════════════

/**
 * Parked sedan — the CS/Standoff-style hard cover that breaks long sightlines.
 * Body, greenhouse, glass band, wheels, bumpers, one collider.
 */
export function car(B, x, z, o = {}) {
  const yaw = o.yaw ?? 0;
  const tint = o.tint ?? pick([0xb0aa9c, 0x6d7f8c, 0x8f8560, 0x8a5048, 0x5f6f5c, 0x9c9a92]);
  const paint = { color: tint, metal: 0.5, roughness: 0.42 };
  const trim = { color: 0x2b2c2e, metal: 0.3, roughness: 0.6 };
  const L = o.len ?? 4.35, W = 1.86;
  const rust = o.wreck ? 0.72 : 0.42;
  paint.roughness = rust;
  paint.metal = o.wreck ? 0.2 : 0.5;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const at = (ax, az) => [x + cos * ax + sin * az, z - sin * ax + cos * az];

  // chassis + fenders
  const paintMat = carPaintMat(tint, o.wreck);
  B.box(L, 0.6, W, 'metal', x, 0.28, z, yaw, { rep: 1.5, tag: 'metal', mat: paintMat });
  B.box(L * 0.98, 0.12, W * 1.02, 'metal', x, 0.82, z, yaw, { rep: 1.4, solid: false, mat: paintMat });
  // greenhouse
  const [gx, gz] = at(-0.14, 0);
  B.box(2.35, 0.6, W - 0.16, 'metal', gx, 0.9, gz, yaw, { rep: 1.2, solid: false, mat: paintMat });
  B.box(2.1, 0.1, W - 0.26, 'metal', gx, 1.52, gz, yaw, { rep: 1.1, solid: false, mat: paintMat });
  // glass: windscreen, backlight, side windows
  const glass = glassMat(B);
  const [wx, wz] = at(0.98, 0);
  const w1 = B.prop(boxGeo(0.06, 0.5, W - 0.34, 1), 'metal', wx, 1.2, wz, yaw, { mat: glass, cast: false });
  w1.rotation.z = 0.22;
  const [bx2, bz2] = at(-1.24, 0);
  const w2 = B.prop(boxGeo(0.06, 0.5, W - 0.34, 1), 'metal', bx2, 1.2, bz2, yaw, { mat: glass, cast: false });
  w2.rotation.z = -0.24;
  for (const s of [-1, 1]) {
    const [sx, sz] = at(-0.14, s * (W / 2 - 0.1));
    B.prop(boxGeo(2.1, 0.44, 0.05, 1), 'metal', sx, 1.16, sz, yaw, { mat: glass, cast: false });
  }
  // wheels (axle along the car's width)
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateX(Math.PI / 2);
  for (const ax of [1.42, -1.42]) {
    for (const az of [W / 2 - 0.06, -(W / 2 - 0.06)]) {
      const [px, pz] = at(ax, az);
      B.prop(wheel.clone(), 'tyre', px, 0.33, pz, yaw);
      const [hx, hz] = at(ax, az * 0.82);
      B.prop(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10).rotateX(Math.PI / 2), 'metal', hx, 0.33, hz, yaw, { matOpts: trim, cast: false });
    }
  }
  // bumpers + lamps
  for (const ax of [L / 2 - 0.06, -(L / 2 - 0.06)]) {
    const [px, pz] = at(ax, 0);
    B.prop(boxGeo(0.16, 0.24, W * 0.96, 1), 'metal', px, 0.42, pz, yaw, { matOpts: trim, cast: false });
  }
  for (const s of [-1, 1]) {
    const [px, pz] = at(L / 2 - 0.02, s * 0.62);
    B.prop(boxGeo(0.05, 0.16, 0.32, 1), 'metal', px, 0.72, pz, yaw, { matOpts: { color: 0xf2ead2, emissive: 0x14100a, roughness: 0.3 }, cast: false });
  }
  // occasional door left open
  if (o.wreck) {
    const [dx2, dz2] = at(0.35, W / 2 + 0.18);
    B.prop(boxGeo(1.1, 0.9, 0.08, 1), 'metal', dx2, 0.75, dz2, yaw + 0.75, { matOpts: paint });
  }
  B.solid(x, 0.62, z, L / 2, 0.62, W / 2, yaw, 'metal');
  // worn sill line so the body reads as painted metal, not plastic
  const [lx3, lz3] = at(0, W / 2 - 0.02);
  B.prop(boxGeo(L * 0.86, 0.07, 0.03, 1), 'metal', lx3, 0.5, lz3, yaw, { matOpts: { color: 0x3a3128, roughness: 0.95 }, cast: false });
  return { x, z, yaw };
}

/** oil drums: upright stack + one on its side */
export function drumCluster(B, x, z, n = 3, o = {}) {
  const tints = [0x8a5a3a, 0x5f6b52, 0x44566a, 0x7a6a44, 0x6b4a44];
  for (let i = 0; i < n; i++) {
    barrel(B, x + rand(-1.0, 1.0), z + rand(-1.0, 1.0), { tint: o.tint ?? pick(tints) });
  }
  if (o.tipped !== false) {
    const g = new THREE.CylinderGeometry(0.31, 0.31, 0.92, 14).rotateZ(Math.PI / 2);
    B.prop(g, 'metalRust', x + rand(-0.7, 0.7), 0.31, z + rand(-0.7, 0.7), rand(0, 6.28), { matOpts: { color: pick(tints) } });
    B.solid(x, 0.31, z + 0.7, 0.46, 0.31, 0.31, 0, 'metal');
  }
}

/** low walled planter with greenery — waist-high cover that still lets you shoot over it */
export function planter(B, x, z, w = 2.6, d = 1.2, yaw = 0) {
  B.box(w, 0.62, d, 'stucco', x, 0, z, yaw, { rep: 1.4, tag: 'stone', matOpts: { color: 0xc4bca6 } });
  B.box(w - 0.24, 0.08, d - 0.24, 'concrete', x, 0.6, z, yaw, { rep: 1.2, solid: false, matOpts: { color: 0x4a3b2a } });
  for (let i = 0; i < 3; i++) {
    const t = (i - 1) * (w / 3.4);
    const px = x + Math.cos(yaw) * t, pz = z - Math.sin(yaw) * t;
    shrub(B, px, pz, rand(0.55, 0.95));
  }
}

/**
 * Old ruined building: three broken walls, a raised concrete deck you can hold,
 * and an external stair up to it. This is the vertical play the map was missing.
 */
export function ruin(B, x, z, o = {}) {
  const yaw = o.yaw ?? 0;
  const w = o.w ?? 9.0, d = o.d ?? 8.0;
  const h = o.h ?? 4.6;
  const deckY = o.deckY ?? 3.2;
  const mat = o.mat || 'stucco';
  const tint = o.tint ?? 0xcbbfa4;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const at = (ax, az) => [x + cos * ax + sin * az, z - sin * ax + cos * az];
  const t = 0.38;
  const put = (ax, az, bw, bh, bd, yb, opts = {}) => {
    const [px, pz] = at(ax, az);
    return B.box(bw, bh, bd, mat, px, yb, pz, yaw, { rep: 2.2, tag: 'stone', matOpts: { color: tint }, ...opts });
  };

  // back wall — full height, a broken window punched out of the middle
  put(0, -d / 2, w, h, t, 0);
  put(0, -d / 2 + t * 0.9, 2.4, h * 0.28, 0.1, h * 0.55, { solid: false, matOpts: { color: 0x2a2620, roughness: 0.95 } });
  // left wall, collapsed at the far end
  put(-w / 2, 0, t, h * 0.78, d * 0.62, 0);
  put(-w / 2, d * 0.28, t, h * 0.32, d * 0.42, 0);
  // right wall — only the front third stands
  put(w / 2, d * 0.22, t, h * 0.52, d * 0.5, 0);
  // front: two stubby pillars + a lintel that survived
  for (const s of [-1, 1]) put(s * (w / 2 - 0.55), d / 2, 0.9, h * 0.9, t, 0);
  put(0, d / 2, w - 2.0, 0.55, t, h * 0.72);
  // upper storey fragment on the back wall
  put(-w * 0.22, -d / 2, w * 0.5, 1.5, t, h);

  // deck slab (the hold point) with a broken edge
  const [dxp, dzp] = at(-0.3, -d * 0.24);
  B.box(w * 0.96, 0.26, d * 0.44, 'concrete', dxp, deckY, dzp, yaw, { rep: 1.8, matOpts: { color: 0xb4ab97 } });
  const [lxp, lzp] = at(-0.3, d * 0.12);
  B.box(w * 0.9, 0.18, 1.1, 'concrete', lxp, deckY, lzp, yaw, { rep: 1.6, matOpts: { color: 0xa9a08c } });
  // sandbag parapet on the deck
  const [sxp, szp] = at(-0.3, -d * 0.44);
  sandbagWall(B, sxp, szp, w * 0.7, yaw, 2);
  // support columns under the deck
  for (const ax of [-w * 0.36, w * 0.36]) {
    const [px, pz] = at(ax, -d * 0.05);
    B.cyl(0.18, 0.22, deckY, 'concrete', px, 0, pz, { seg: 8, solid: true, tag: 'stone', matOpts: { color: 0xa79f8b } });
  }

  // external stair running up the open side to the deck
  const [sx2, sz2] = at(w / 2 + 1.35, 0.4);
  stairway(B, sx2, sz2, {
    steps: Math.round(deckY / 0.36), rise: 0.36, run: 0.42, w: 1.5,
    yaw: yaw + Math.PI / 2, dir: 1, mat: 'concrete',
  });
  // landing that ties the stair to the deck
  const [lx2, lz2] = at(w / 2 + 0.55, -d * 0.24);
  B.box(1.5, 0.24, 1.6, 'concrete', lx2, deckY, lz2, yaw, { rep: 1.4, matOpts: { color: 0xb4ab97 } });

  // rubble spilling out of the collapsed corner
  const [rx, rz] = at(-w / 2 - 0.6, d * 0.35);
  rockCluster(B, rx, rz, 4, 1.1);
  const [rx2, rz2] = at(w * 0.2, -d / 2 - 0.5);
  B.prop(boxGeo(1.2, 0.5, 0.7, 1.2), mat, rx2, 0.25, rz2, rand(0, 3), { matOpts: { color: tint } });
  // blown-out interior dressing
  const [cx, cz] = at(w * 0.1, 0);
  crateStack(B, cx, cz, 2);
  const [wx, wz] = at(-w * 0.25, d * 0.05);
  tyreStack(B, wx, wz, 3);
  return { x, z, yaw, deckY };
}
