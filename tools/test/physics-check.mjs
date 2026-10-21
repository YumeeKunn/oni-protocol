// ═══════════════ PHYSICS CHECK — headless collision sanity (no browser) ═══════════════
// Runs the real src/entities/physics.js with the bundled three build so wall
// sliding / tunnelling / hitscan behaviour can be asserted without a GPU.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd();
const tmp = path.join(root, 'tools', 'test', '.tmp');
mkdirSync(tmp, { recursive: true });
const threeUrl = pathToFileURL(path.join(root, 'libs', 'three.module.js')).href;
const src = readFileSync(path.join(root, 'src', 'entities', 'physics.js'), 'utf8')
  .replace("from 'three'", `from '${threeUrl}'`);
const modPath = path.join(tmp, 'physics.mjs');
writeFileSync(modPath, src);
const { ColliderGrid, moveBody, rayHit, canStand } = await import(pathToFileURL(modPath).href);

const grid = (cols) => new ColliderGrid(cols, 5);
const ground = () => 0;
const body = (x, z, yaw) => ({ pos: { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }, vel: { x: 0, y: 0, z: 0 }, radius: 0.42, height: 1.75, step: 0.52 });
// moveBody mutates pos.{x,y,z} directly, so a plain object works
function mkBody(x, z) {
  return { pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, radius: 0.42, height: 1.75, step: 0.52 };
}

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};
function inside(c, b) {
  let dx = b.pos.x - c.x, dz = b.pos.z - c.z;
  if (c.yaw) {
    // inverse of the mesh's R_y(yaw) — the same convention the physics uses
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn; dz = dx * sn + dz * cs; dx = lx;
  }
  const ox = c.hx + b.radius - Math.abs(dx);
  const oz = c.hz + b.radius - Math.abs(dz);
  return ox > 0.02 && oz > 0.02;
}
function simRun(cols, start, dir, seconds, velMul = 1, label) {
  const g = grid(cols);
  const b = mkBody(start.x, start.z);
  const dt = 1 / 60;
  let worst = 0;
  for (let i = 0; i < seconds / dt; i++) {
    b.vel.x = dir.x * velMul;
    b.vel.z = dir.z * velMul;
    moveBody(b, dt, g, ground);
    for (const c of cols) if (inside(c, b)) worst = Math.max(worst, 1);
  }
  ok(label, worst === 0, `end=(${b.pos.x.toFixed(2)}, ${b.pos.y.toFixed(2)}, ${b.pos.z.toFixed(2)})`);
  return b;
}

// 1) rotated wall (yaw 37°) — sprint straight into it from the south
{
  const c = { x: 0, y: 1.5, z: 0, hx: 6, hy: 1.5, hz: 0.2, yaw: 0.65, tag: 'stone' };
  const n = { x: Math.sin(0.65), z: Math.cos(0.65) };
  simRun([c], { x: -n.x * 8, z: -n.z * 8 }, n, 2.5, 8.5, 'rotated wall: no penetration at sprint speed');
}

// 2) thin wall (34 cm) charged at high speed — must not tunnel
{
  const c = { x: 0, y: 1.5, z: 0, hx: 0.17, hy: 1.5, hz: 4, yaw: 0, tag: 'stone' };
  const b = simRun([c], { x: -3, z: 0 }, { x: 1, z: 0 }, 1.2, 9.5, 'thin wall: high-speed impact stays outside');
  ok('thin wall: stopped on the approach side', b.pos.x < -0.5, `x=${b.pos.x.toFixed(2)}`);
}

// 3) sliding along a rotated wall keeps tangential speed
{
  const c = { x: 0, y: 1.5, z: 0, hx: 8, hy: 1.5, hz: 0.2, yaw: 0.5, tag: 'stone' };
  const g = grid([c]);
  const b = mkBody(0, -2);
  const dir = { x: 0.7, z: 0.7 };
  // press into the wall while running across it
  b.pos.x = -Math.sin(0.5) * 0.8;
  b.pos.z = -Math.cos(0.5) * 0.8;
  let startX = b.pos.x;
  for (let i = 0; i < 90; i++) {
    b.vel.x = 3; b.vel.z = 3;
    moveBody(b, 1 / 60, g, ground);
  }
  ok('rotated wall: slides instead of sticking', Math.abs(b.pos.x - startX) > 1.5, `dx=${(b.pos.x - startX).toFixed(2)}`);
}

// 4) stairs: the body must climb a 20-step stairway
{
  const cols = [];
  for (let i = 0; i < 20; i++) cols.push({ x: 0, y: (i + 1) * 0.18, z: -4 + i * 0.42, hx: 0.75, hy: (i + 1) * 0.18, hz: 0.21, yaw: 0, tag: 'stone', climb: true });
  const g = grid(cols);
  const b = mkBody(0, -5.5);
  for (let i = 0; i < 180; i++) { b.vel.x = 0; b.vel.z = 3.2; moveBody(b, 1 / 60, g, ground); }
  ok('stairs: walked to the top', b.pos.y > 2.8, `y=${b.pos.y.toFixed(2)} z=${b.pos.z.toFixed(2)}`);
}

// 5) hitscan normal on a rotated wall points out of the wall
{
  const c = { x: 0, y: 1.5, z: 0, hx: 6, hy: 1.5, hz: 0.2, yaw: 0.65, tag: 'stone' };
  const g = grid([c]);
  const n = { x: Math.sin(0.65), z: Math.cos(0.65) };
  const hit = rayHit(g, -n.x * 6, 1.2, -n.z * 6, n.x, 0, n.z, 20);
  const dot = hit ? hit.normal.x * -n.x + hit.normal.z * -n.z : 0;
  ok('hitscan: normal faces the shooter', !!hit && dot > 0.95, hit ? `dot=${dot.toFixed(2)}` : 'no hit');
}

// 6) spawn check: cannot stand inside a crate
{
  const c = { x: 0, y: 0.45, z: 0, hx: 0.45, hy: 0.45, hz: 0.45, yaw: 0, tag: 'wood' };
  const g = grid([c]);
  ok('canStand: rejects a point inside a crate', canStand(g, ground, 0, 0) === false);
  ok('canStand: accepts open ground', canStand(g, ground, 4, 4) === true);
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall physics checks passed');
process.exitCode = fails ? 1 : 0;
