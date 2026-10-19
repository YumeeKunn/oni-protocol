// ═══════════════ Bot/nav diagnostics (no render) ═══════════════
// usage: node tools/test/botdbg.mjs [--secs 30]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8126;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SECS = +arg('secs', 30);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ogg': 'audio/ogg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const logs = [], errors = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/snap/bin/chromium',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
         '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 640, height: 360 },
});
const page = await browser.newPage();
page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push(t); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e && e.message || e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__game && window.__game.booted, { timeout: 60000 });

// ── nav probe: can A* connect the parts of the map? ──
const navProbe = await page.evaluate(() => {
  const g = window.__game, nav = g.nav;
  const pts = [];
  for (let i = 0; i < 60; i++) {
    const p = nav.randomPoint();
    if (nav.walkable(p.x, p.z)) pts.push(p);
  }
  let ok = 0, fail = 0, lens = [];
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const a = pts[(i * 7) % pts.length], b = pts[(i * 13 + 3) % pts.length];
    if (!a || !b) continue;
    const p = nav.path(a.x, a.z, b.x, b.z);
    if (!p || !p.length) { fail++; continue; }
    ok++;
    lens.push(p.length);
    if (i < 6) samples.push({ from: [Math.round(a.x), Math.round(a.z)], to: [Math.round(b.x), Math.round(b.z)], n: p.length, end: p.length ? [Math.round(p[p.length - 1].x), Math.round(p[p.length - 1].z)] : null });
  }
  const walk = (() => { let n = 0; for (let x = -52; x <= 52; x += 2) for (let z = -52; z <= 52; z += 2) if (nav.walkable(x, z)) n++; return n; })();
  return { walkable: walk, ok, fail, avgLen: lens.length ? +(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1) : 0, samples };
});
console.log('NAV:', JSON.stringify(navProbe, null, 1));

// ── collider dump around the sticky spots ──
const colDump = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  for (const [x, z] of [[6, 31], [-8, -23], [-6, -38], [12, -1]]) {
    const list = [];
    g.world.grid.query(x, z, 3.5, list);
    out[`${x},${z}`] = list.map(c => ({ tag: c.tag, x: +c.x.toFixed(1), y: +c.y.toFixed(2), z: +c.z.toFixed(1), h: [+c.hx.toFixed(2), +c.hy.toFixed(2), +c.hz.toFixed(2)], yaw: +(c.yaw || 0).toFixed(2), top: +(c.y + c.hy).toFixed(2) }));
  }
  return out;
});
console.log('COLLIDERS NEAR STICKY SPOTS:', JSON.stringify(colDump, null, 1));

// ── TDM bot behaviour over time ──
await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'assault', teamSize: 4, difficulty: 'regular', killLimit: 100, duration: 20 });
});
for (let t = 0; t <= SECS; t += 10) {
  const out = await page.evaluate((dt) => {
    const g = window.__game;
    const r = g.debugFast(dt);
    return { sim: r.sim, score: r.score, bots: g.debugBots(), playerPos: r.player.pos, hp: r.player.hp, alive: r.player.alive };
  }, 10);
  console.log(`\n── t=${out.sim}s  score ${out.score.alpha}-${out.score.bravo}  player hp ${out.hp} ${out.alive ? 'alive' : 'DEAD'} @${out.playerPos}`);
  for (const b of out.bots) {
    console.log(`   ${b.team[0].toUpperCase()} ${b.n.padEnd(9)} ${b.alive ? ' ' : '✗'} ${b.st.padEnd(10)} tgt=${String(b.tgt).padEnd(8)} path=${String(b.pathN).padStart(3)}/${b.pi} spd=${String(b.spd).padStart(5)} mag=${String(b.mag).padStart(3)} pos=${b.pos} goal=${b.goal} stuck=${b.stuck} k=${b.kills} shots=${b.shots} hit=${b.hits}\n        dbg=${JSON.stringify(b.dbg)}\n        OV=${JSON.stringify(b.overlaps)}`);
  }
}

console.log('\nerrors:', [...new Set(errors)].slice(0, 10));
await browser.close();
server.close();
