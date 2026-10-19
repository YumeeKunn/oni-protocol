// ═══════════════ NAV — baked walkability grid + A* for bots ═══════════════
// The map is built from yawed AABB colliders, so walkability is baked once at
// load into a coarse grid; bots then path with A* + line-of-sight smoothing.
import { clamp } from '../core/utils.js';

export const CELL = 1.5;

function colliderBlocks(c, px, pz, y0, y1) {
  // yawed box test in the collider's local frame
  const top = c.y + c.hy, bot = c.y - c.hy;
  if (top <= y0 + 0.12 || bot >= y1) return false;
  let dx = px - c.x, dz = pz - c.z;
  if (c.yaw) {
    const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
    const rx = dx * cs - dz * sn;
    const rz = dx * sn + dz * cs;
    dx = rx; dz = rz;
  }
  return Math.abs(dx) <= c.hx && Math.abs(dz) <= c.hz;
}

function surfaceAt(c, px, pz) {
  let dx = px - c.x, dz = pz - c.z;
  if (c.yaw) {
    const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
    const rx = dx * cs - dz * sn;
    const rz = dx * sn + dz * cs;
    dx = rx; dz = rz;
  }
  return Math.abs(dx) <= c.hx && Math.abs(dz) <= c.hz ? c.y + c.hy : -Infinity;
}

export function buildNav(colliders, half, groundHeight, opts = {}) {
  const cell = opts.cell || CELL;
  const radius = opts.radius ?? 0.55;
  const bodyH = opts.bodyH ?? 1.75;
  const n = Math.ceil((half * 2) / cell);
  const idx = (ix, iz) => iz * n + ix;
  const toWorld = (ix, iz) => ({ x: -half + (ix + 0.5) * cell, z: -half + (iz + 0.5) * cell });
  const toCell = (x, z) => ({
    ix: clamp(Math.floor((x + half) / cell), 0, n - 1),
    iz: clamp(Math.floor((z + half) / cell), 0, n - 1),
  });

  // bucket colliders per cell for a fast bake
  const buckets = new Array(n * n);
  for (const c of colliders) {
    if (c.y - c.hy > 4.5) continue;                          // rookery / roofs: unreachable
    const ext = Math.max(c.hx, c.hz) + Math.abs(Math.sin(c.yaw)) * 0.5 + 1;
    const a = toCell(c.x - ext, c.z - ext), b = toCell(c.x + ext, c.z + ext);
    for (let iz = a.iz; iz <= b.iz; iz++) {
      for (let ix = a.ix; ix <= b.ix; ix++) {
        (buckets[idx(ix, iz)] ||= []).push(c);
      }
    }
  }

  const walk = new Uint8Array(n * n);
  const ground = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = idx(ix, iz);
      const w = toWorld(ix, iz);
      const g0 = groundHeight(w.x, w.z);
      let g = g0;
      const list = buckets[i];
      if (list) {
        for (const c of list) {
          const s = surfaceAt(c, w.x, w.z);
          if (s > g && s - g0 <= 1.05) g = s;                // low platform we can stand on
        }
      }
      ground[i] = g;
      let ok = true;
      if (list) {
        for (const c of list) {
          if (colliderBlocks(c, w.x, w.z, g + 0.08, g + bodyH)) { ok = false; break; }
        }
      }
      walk[i] = ok ? 1 : 0;
    }
  }

  // agent radius: erode walkable cells that are too close to blocked cells
  const rCells = Math.max(1, Math.round((radius + 0.22) / cell));
  const walkEroded = new Uint8Array(walk);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      if (!walk[idx(ix, iz)]) continue;
      let blocked = false;
      for (let dz = -rCells; dz <= rCells && !blocked; dz++) {
        for (let dx = -rCells; dx <= rCells; dx++) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n || !walk[idx(jx, jz)]) { blocked = true; break; }
        }
      }
      if (blocked) walkEroded[idx(ix, iz)] = 0;
    }
  }
  // never erode everything: keep a fallback of the raw grid
  let count = 0;
  for (let i = 0; i < walkEroded.length; i++) count += walkEroded[i];
  const nav = count > 40 ? walkEroded : walk;

  // ── A* ──
  const gScore = new Float32Array(n * n);
  const fScore = new Float32Array(n * n);
  const cameFrom = new Int32Array(n * n);
  const stamp = new Int32Array(n * n);
  const open = [];
  let epoch = 0;

  const pushOpen = (i, f) => {
    open.push(i);
    let k = open.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (fScore[open[p]] <= fScore[open[k]]) break;
      const t = open[p]; open[p] = open[k]; open[k] = t;
      k = p;
    }
  };
  const popOpen = () => {
    const top = open[0];
    const last = open.pop();
    if (open.length) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < open.length && fScore[open[l]] < fScore[open[m]]) m = l;
        if (r < open.length && fScore[open[r]] < fScore[open[m]]) m = r;
        if (m === k) break;
        const t = open[m]; open[m] = open[k]; open[k] = t;
        k = m;
      }
    }
    return top;
  };

  const smooth = (pts) => {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) { if (nav.lineClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) break; }
      out.push(pts[j]);
      i = j;
    }
    return out;
  };

  nav.n = n;
  nav.cell = cell;
  nav.half = half;

  nav.walkable = (x, z) => {
    const { ix, iz } = toCell(x, z);
    return nav[idx(ix, iz)] === 1;
  };
  nav.groundAt = (x, z) => {
    const { ix, iz } = toCell(x, z);
    return ground[idx(ix, iz)];
  };
  nav.world = (ix, iz) => toWorld(ix, iz);
  nav.cellOf = toCell;

  /** straight-line walkability test (for path smoothing + bot steering) */
  nav.lineClear = (x0, z0, x1, z1) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (cell * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!nav.walkable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  };

  /** A* path; returns a smoothed waypoint list (world coords) or null */
  nav.path = (fx, fz, tx, tz) => {
    const a = toCell(fx, fz), b = toCell(tx, tz);
    const start = idx(a.ix, a.iz), goal = idx(b.ix, b.iz);
    if (start === goal) return [{ x: tx, z: tz }];
    if (!nav[goal]) {
      // snap the goal to the closest walkable cell
      let best = -1, bestD = 1e9;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const jx = b.ix + dx, jz = b.iz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          if (!nav[idx(jx, jz)]) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = idx(jx, jz); }
        }
      }
      if (best < 0) return null;
      epoch++;
      return nav.path(fx, fz, toWorld(best % n, (best / n) | 0).x, toWorld(best % n, (best / n) | 0).z);
    }
    epoch++;
    open.length = 0;
    gScore[start] = 0;
    fScore[start] = Math.hypot(a.ix - b.ix, a.iz - b.iz);
    cameFrom[start] = -1;
    stamp[start] = epoch;
    pushOpen(start, fScore[start]);

    const h = (ix, iz) => Math.hypot(ix - b.ix, iz - b.iz) * 1.02;
    let found = false, guard = 0;
    while (open.length && guard++ < 9000) {
      const cur = popOpen();
      if (cur === goal) { found = true; break; }
      const cx = cur % n, cz = (cur / n) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const jx = cx + dx, jz = cz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = idx(jx, jz);
          if (!nav[j]) continue;
          if (dx && dz) {
            if (!nav[idx(cx + dx, cz)] || !nav[idx(cx, cz + dz)]) continue;   // no corner cutting
          }
          const step = dx && dz ? 1.414 : 1;
          const g = gScore[cur] + step;
          if (stamp[j] === epoch && gScore[j] <= g) continue;
          stamp[j] = epoch;
          gScore[j] = g;
          fScore[j] = g + h(jx, jz);
          cameFrom[j] = cur;
          pushOpen(j, fScore[j]);
        }
      }
    }
    if (!found) return null;
    const pts = [];
    let cur = goal;
    while (cur !== -1) {
      const p = toWorld(cur % n, (cur / n) | 0);
      pts.push(p);
      cur = cameFrom[cur];
      if (pts.length > 600) break;
    }
    pts.reverse();
    pts[0] = { x: fx, z: fz };
    pts[pts.length - 1] = { x: tx, z: tz };
    return smooth(pts);
  };

  /** A* to (tx,tz) that keeps trying: if the spot is unreachable it ring-samples
   *  around it and returns the first reachable goal as { goal, path }. */
  nav.goalNear = (fx, fz, tx, tz, r = 9, tries = 7) => {
    let path = nav.path(fx, fz, tx, tz);
    if (path) return { goal: { x: tx, z: tz }, path };
    for (let i = 0; i < tries; i++) {
      const rad = r * (0.45 + i * 0.42);
      const a = Math.random() * Math.PI * 2;
      const gx = clamp(tx + Math.cos(a) * rad, -half + 3, half - 3);
      const gz = clamp(tz + Math.sin(a) * rad, -half + 3, half - 3);
      if (!nav.walkable(gx, gz)) continue;
      path = nav.path(fx, fz, gx, gz);
      if (path) return { goal: { x: gx, z: gz }, path };
    }
    return null;
  };

  /** random walkable point near (x,z) within r */
  nav.randomNear = (x, z, r) => {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (px < -half + 3 || pz < -half + 3 || px > half - 3 || pz > half - 3) continue;
      if (nav.walkable(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  };

  nav.randomPoint = () => {
    for (let i = 0; i < 200; i++) {
      const p = toWorld((Math.random() * n) | 0, (Math.random() * n) | 0);
      if (nav.walkable(p.x, p.z)) return p;
    }
    return { x: 0, z: 0 };
  };

  return nav;
}
