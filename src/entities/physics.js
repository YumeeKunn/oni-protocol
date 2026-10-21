// ═══════════════ PHYSICS — capsule vs yawed-AABB world, hitscan rays ═══════════════
import * as THREE from 'three';

/** spatial hash of map colliders for fast queries */
export class ColliderGrid {
  constructor(colliders, cell = 5) {
    this.cell = cell;
    this.map = new Map();
    this.all = colliders;
    for (const c of colliders) {
      const r = Math.hypot(c.hx, c.hz) + 0.5;
      const x0 = Math.floor((c.x - r) / cell), x1 = Math.floor((c.x + r) / cell);
      const z0 = Math.floor((c.z - r) / cell), z1 = Math.floor((c.z + r) / cell);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = x + ':' + z;
          let arr = this.map.get(k);
          if (!arr) { arr = []; this.map.set(k, arr); }
          arr.push(c);
        }
      }
    }
    this._out = [];
  }

  /** colliders whose bucket overlaps the circle (x,z,r) — deduped */
  query(x, z, r, out = this._out) {
    out.length = 0;
    const cell = this.cell;
    const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
    const z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.map.get(cx + ':' + cz);
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c)) continue;
          seen.add(c);
          out.push(c);
        }
      }
    }
    return out;
  }
}

/**
 * world-space point → collider local space.
 * three.js rotates a mesh by R_y(yaw), so the inverse is R_y(-yaw):
 *   lx =  cos(yaw)·dx - sin(yaw)·dz
 *   lz =  sin(yaw)·dx + cos(yaw)·dz
 * Getting the handedness wrong here mirrors every rotated collider, which is how
 * you end up walking through a wall that visually is not there.
 */
export function local(c, x, z) {
  const dx = x - c.x, dz = z - c.z;
  if (c.yaw) {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    return [dx * cs - dz * sn, dx * sn + dz * cs];
  }
  return [dx, dz];
}

/** one vertical hop: land on the highest supporting top, or bonk a ceiling */
function stepVertical(body, grid, groundHeight, res, prevY, step) {
  const { pos, vel } = body;
  const r = body.radius, h = body.height;
  const gy = groundHeight ? groundHeight(pos.x, pos.z) : 0;
  const cols = grid.query(pos.x, pos.z, r + 0.1, []);
  if (vel.y <= 0) {
    let bestTop = gy;
    for (const c of cols) {
      const top = c.y + c.hy;
      if (top > prevY + 0.001 || top < pos.y - step - 0.35) continue;
      const [lx, lz] = local(c, pos.x, pos.z);
      if (Math.abs(lx) > c.hx + r * 0.85 || Math.abs(lz) > c.hz + r * 0.85) continue;
      if (top > bestTop) bestTop = top;
    }
    if (bestTop >= pos.y) {
      res.landSpeed = Math.max(res.landSpeed, Math.abs(vel.y));
      pos.y = bestTop;
      vel.y = 0;
      res.grounded = true;
    }
    return true;
  }
  // rising: shortest overlap from below
  for (const c of cols) {
    const bot = c.y - c.hy;
    if (bot < pos.y + h - 0.001) continue;
    const [lx, lz] = local(c, pos.x, pos.z);
    if (Math.abs(lx) > c.hx + r * 0.85 || Math.abs(lz) > c.hz + r * 0.85) continue;
    pos.y = bot - h - 0.001;
    vel.y = 0;
    res.ceiling = true;
    return true;
  }
  return true;
}

/** local space → world space contact normal for a yawed collider */
function worldNormal(c, lx, lz, axis) {
  const cs = Math.cos(c.yaw || 0), sn = Math.sin(c.yaw || 0);
  if (axis === 'x') { const s = Math.sign(lx) || 1; return [s * cs, -s * sn]; }
  const s = Math.sign(lz) || 1; return [s * sn, s * cs];
}

/**
 * Move a vertical capsule-body through the collider set.
 * body = { pos: Vector3 (feet), vel: Vector3, radius, height, step }
 * returns { grounded, landSpeed, hitWall, ceiling }
 */
export function moveBody(body, dt, grid, groundHeight, o = {}) {
  const { pos, vel } = body;
  const r = body.radius, h = body.height;
  const step = o.step ?? body.step ?? 0.5;
  const res = { grounded: false, landSpeed: 0, hitWall: false, ceiling: false, wallNormal: new THREE.Vector3() };
  const list = [];
  const prevBottom = pos.y;

  // ── vertical ──
  // split long falls into short hops: at terminal velocity a single 60 ms step
  // can skip straight past a thin roof / crate top and drop the body inside it
  let remainY = vel.y * dt;
  const maxHop = 0.22;
  const hops = Math.min(24, Math.max(1, Math.ceil(Math.abs(remainY) / maxHop)));
  const hopY = remainY / hops;
  for (let s = 0; s < hops; s++) {
    const before = pos.y;
    pos.y += hopY;
    if (!stepVertical(body, grid, groundHeight, res, before, step)) {
      pos.y = before;
      break;
    }
    if (res.grounded || res.ceiling) break;
  }
  let gy = groundHeight ? groundHeight(pos.x, pos.z) : 0;

  // ── depenetration: if we start inside geometry, exit through the nearest face ──
  // The whole overlap is resolved in one move: resolving half of it and then
  // re-picking the "nearest face" flips sides and leaves the body jittering inside
  // the box (that was the old wall-glitch).
  for (let it = 0; it < 3; it++) {
    const cols0 = grid.query(pos.x, pos.z, r + 0.2, list);
    let bestPen = 0, bnx = 0, bnz = 0, stepped = false;
    for (const c of cols0) {
      const top = c.y + c.hy, bot = c.y - c.hy;
      if (top <= pos.y + 0.02 || bot >= pos.y + h) continue;
      const [lx, lz] = local(c, pos.x, pos.z);
      const ex = c.hx + r - Math.abs(lx);
      const ez = c.hz + r - Math.abs(lz);
      if (ex <= 0 || ez <= 0) continue;
      // low obstacle → stand on it instead of pushing out
      if (top - pos.y <= step + 0.02 && top - pos.y > -0.02) { pos.y = top; vel.y = 0; stepped = true; continue; }
      const pen = Math.min(ex, ez);
      if (pen > bestPen) {
        bestPen = pen;
        const [nx, nz] = worldNormal(c, lx, lz, ex <= ez ? 'x' : 'z');
        bnx = nx; bnz = nz;
      }
    }
    if (bestPen <= 0.005) break;
    const move = Math.min(bestPen + 0.002, 1.6);
    pos.x += bnx * move;
    pos.z += bnz * move;
    if (stepped) break;
  }

  // ── horizontal: axis separated (clean wall sliding) and sub-stepped (no tunnelling) ──
  for (const axis of ['x', 'z']) {
    const d = vel[axis] * dt;
    if (Math.abs(d) < 1e-6) continue;
    // 0.14 m per hop: a 34 cm stucco wall can never be skipped at sprint speed
    const hops = Math.min(12, Math.max(1, Math.ceil(Math.abs(d) / 0.14)));
    const hopD = d / hops;
    for (let s = 0; s < hops; s++) {
      pos[axis] += hopD;
      let guard = 0;
      for (;;) {
        let push = 0, nx = 0, nz = 0, stepUp = null;
        const cols2 = grid.query(pos.x, pos.z, r + 0.4, list);
        for (const c of cols2) {
          const top = c.y + c.hy, bot = c.y - c.hy;
          if (top <= pos.y + 0.02 || bot >= pos.y + h) continue;
          const [lx, lz] = local(c, pos.x, pos.z);
          const ox = c.hx + r - Math.abs(lx);
          const oz = c.hz + r - Math.abs(lz);
          if (ox <= 0 || oz <= 0) continue;
          // step up over low obstacles
          if (top - pos.y <= step + 0.02 && top - pos.y > -0.02) { if (stepUp === null || top > stepUp) stepUp = top; continue; }
          const pen = Math.min(ox, oz);
          if (pen > push) {
            push = pen;
            const [cx, cz] = worldNormal(c, lx, lz, ox <= oz ? 'x' : 'z');
            nx = cx; nz = cz;
          }
        }
        if (stepUp !== null) { pos.y = stepUp; vel.y = Math.max(0, vel.y); }
        if (push <= 0) break;
        // push straight back out along the contact normal — this is what makes
        // sliding on a rotated wall behave like the wall instead of the world axes
        const amt = Math.min(push + 0.002, 0.4);
        pos.x += nx * amt;
        pos.z += nz * amt;
        const into = vel.x * nx + vel.z * nz;
        if (into < 0) { vel.x -= nx * into; vel.z -= nz * into; }
        res.hitWall = true;
        res.wallNormal.set(nx, 0, nz);
        if (++guard > 3) break;
      }
    }
  }

  // ── final ground snap ──
  gy = groundHeight ? groundHeight(pos.x, pos.z) : 0;
  if (!res.grounded && vel.y <= 0) {
    const cols3 = grid.query(pos.x, pos.z, r, list);
    let bestTop = gy;
    for (const c of cols3) {
      const top = c.y + c.hy;
      if (top > pos.y + 0.06 || top < pos.y - 0.14) continue;
      const [lx, lz] = local(c, pos.x, pos.z);
      if (Math.abs(lx) > c.hx + r * 0.75 || Math.abs(lz) > c.hz + r * 0.75) continue;
      if (top > bestTop) bestTop = top;
    }
    if (pos.y <= bestTop + 0.04) {
      pos.y = bestTop;
      if (vel.y < 0) res.landSpeed = Math.max(res.landSpeed, Math.abs(vel.y));
      vel.y = 0;
      res.grounded = true;
    }
  }
  return res;
}

/** does a body fit at this spot? (spawn / teleport checks) */
export function canStand(grid, groundHeight, x, z, y = null, radius = 0.45, height = 1.75, step = 0.5) {
  const gy = groundHeight(x, z);
  const base = y == null ? gy : Math.max(gy, y);
  const list = grid.query(x, z, radius + 0.4, []);
  for (const c of list) {
    const top = c.y + c.hy, bot = c.y - c.hy;
    if (top <= base + step + 0.02 || bot >= base + height) continue;
    const [lx, lz] = local(c, x, z);
    if (Math.abs(lx) < c.hx + radius && Math.abs(lz) < c.hz + radius) return false;
  }
  return true;
}

/** hitscan: nearest collider hit along a ray (slab test in each collider's local frame) */
export function rayHit(grid, ox, oy, oz, dx, dy, dz, maxDist, out = {}) {
  const step = 6;
  const seen = new Set();
  let best = null, bestT = maxDist;
  let x = ox, z = oz;
  const cells = Math.ceil(maxDist / step);
  for (let i = 0; i <= cells; i++) {
    const t0 = i * step;
    const px = ox + dx * t0, pz = oz + dz * t0;
    const list = grid.query(px, pz, step * 0.6, []);
    for (const c of list) {
      if (seen.has(c)) continue;
      seen.add(c);
      const t = rayBox(c, ox, oy, oz, dx, dy, dz);
      if (t != null && t >= 0 && t < bestT) { bestT = t; best = c; }
    }
  }
  if (!best) return null;
  out.dist = bestT;
  out.collider = best;
  out.tag = best.tag;
  out.point = new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
  // normal = the axis with the smallest overlap
  const [lx, lz] = local(best, out.point.x, out.point.z);
  const ly = out.point.y - best.y;
  const dxs = Math.abs(Math.abs(lx) - best.hx);
  const dys = Math.abs(Math.abs(ly) - best.hy);
  const dzs = Math.abs(Math.abs(lz) - best.hz);
  const n = new THREE.Vector3();
  if (dys <= dxs && dys <= dzs) n.set(0, Math.sign(ly) || 1, 0);
  else {
    const [nx, nz] = worldNormal(best, lx, lz, dxs <= dzs ? 'x' : 'z');
    n.set(nx, 0, nz);
  }
  out.normal = n;
  return out;
}

/** ray vs yawed box, slab method in local space */
export function rayBox(c, ox, oy, oz, dx, dy, dz) {
  let lx = ox - c.x, lz = oz - c.z;
  let ldx = dx, ldz = dz;
  if (c.yaw) {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const rx = lx * cs - lz * sn, rz = lx * sn + lz * cs;
    const rdx = ldx * cs - ldz * sn, rdz = ldx * sn + ldz * cs;
    lx = rx; lz = rz; ldx = rdx; ldz = rdz;
  }
  const ly = oy - c.y;
  let tmin = -Infinity, tmax = Infinity;
  const axes = [[lx, ldx, c.hx], [ly, dy, c.hy], [lz, ldz, c.hz]];
  for (const [o, d, h] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < -h || o > h) return null;
      continue;
    }
    let t1 = (-h - o) / d, t2 = (h - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}
