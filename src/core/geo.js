// ═══════════════ GEO — geometry helpers with real-world UV baking ═══════════════
// Textures are shared (one per kit) and tiling is baked into the UVs, so a whole
// district can be built from a handful of materials without texture clones.
import * as THREE from 'three';

// BoxGeometry face order: +x, -x, +y, -y, +z, -z — 4 verts each.
const FACE_UV = [[2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1]];

/** bake metric, per-face tiling into a BoxGeometry's UVs (matches face aspect) */
export function bakeBoxUV(geo, w, h, d, rep = 1) {
  const dims = [w, h, d];
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [ui, vi] = FACE_UV[f];
    const su = dims[ui] / rep, sv = dims[vi] / rep;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** box geometry with metric UVs, centred on origin */
export function boxGeo(w, h, d, rep = 1.6) {
  const g = new THREE.BoxGeometry(w, h, d);
  return bakeBoxUV(g, w, h, d, rep);
}

/** planar projection: UV from the plane perpendicular to each triangle's dominant normal */
export function projectUV(geo, rep = 1.6) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv || new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv.setXY(i, u / rep, v / rep);
  }
  uv.needsUpdate = true;
  geo.setAttribute('uv', uv);
  return geo;
}

/** merge geometries that share an attribute layout (pos/normal/uv, indexed) */
export function mergeGeos(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  let vTotal = 0, iTotal = 0;
  for (const g of list) { vTotal += g.attributes.position.count; iTotal += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const idx = new Uint32Array(iTotal);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      if (n) { nrm[(vo + i) * 3] = n.getX(i); nrm[(vo + i) * 3 + 1] = n.getY(i); nrm[(vo + i) * 3 + 2] = n.getZ(i); }
      if (t) { uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i); }
    }
    if (g.index) { const gi = g.index; for (let k = 0; k < gi.count; k++) idx[io + k] = gi.getX(k) + vo; io += gi.count; }
    else { for (let k = 0; k < p.count; k++) idx[io + k] = vo + k; io += p.count; }
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ── parametric shapes ──

/** extruded profile, then UV-projected (walls, barriers, arches) */
export function extrudeGeo(shape, depth, rep = 1.6, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return projectUV(g, rep);
}

/** jersey barrier profile extruded along Z */
export function barrierGeo(len, h = 0.85, baseW = 0.62, rep = 1.5) {
  const s = new THREE.Shape();
  s.moveTo(-baseW / 2, 0);
  s.lineTo(baseW / 2, 0);
  s.lineTo(baseW * 0.22, h * 0.42);
  s.lineTo(baseW * 0.18, h);
  s.lineTo(-baseW * 0.18, h);
  s.lineTo(-baseW * 0.22, h * 0.42);
  s.closePath();
  return extrudeGeo(s, len, rep);
}

/** arch wall: rectangle with a semicircular opening */
export function archGeo(w, h, openW, openH, depth, rep = 1.4) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  const hole = new THREE.Path();
  const r = openW / 2;
  hole.moveTo(-r, 0);
  hole.lineTo(-r, openH - r);
  hole.absarc(0, openH - r, r, Math.PI, 0, true);
  hole.lineTo(r, 0);
  hole.closePath();
  s.holes.push(hole);
  return extrudeGeo(s, depth, rep);
}

/** dome (mosque, radar, bunker tops) */
export function domeGeo(r, squash = 1, rep = 1.2) {
  const g = new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, squash, 1);
  return projectUV(g, rep);
}

/** tapered, gently curved trunk (palms) */
export function trunkGeo(h, r0, r1, bend = 0.1, seg = 7) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t * t, t * h));
  }
  const g = new THREE.LatheGeometry(pts, 9);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + bend * y * y * 0.16);
  }
  g.computeVertexNormals();
  return projectUV(g, 1.1);
}

/** lathe from a profile of [radius, height] pairs */
export function latheGeo(profile, segments = 12, rep = 1) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return projectUV(new THREE.LatheGeometry(pts, segments), rep);
}

/** flat quad facing +Y at y=0 with metric UVs */
export function padGeo(w, d, rep = 3.5) {
  const g = new THREE.PlaneGeometry(w, d, 1, 1);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / rep), uv.getY(i) * (d / rep));
  return g;
}

/** low-poly rock */
export function rockGeo(r, seed = 0) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = Math.sin(i * 12.9898 + seed) * 43758.5453;
    const f = 0.72 + (n - Math.floor(n)) * 0.5;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.72, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return projectUV(g, 1.4);
}

/** textured frond / leaf card (alpha) */
export function leafGeo(len, wid) {
  const g = new THREE.PlaneGeometry(len, wid, 4, 1);
  g.translate(len / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) / len);
    p.setZ(i, Math.sin(t * Math.PI) * 0.16 * wid * 6 * 0.06);
    const sag = t * t * len * 0.34;
    p.setY(i, p.getY(i) * (1 - t * 0.75) - sag);
  }
  g.computeVertexNormals();
  return g;
}
