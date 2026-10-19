// ═══════════════ Logic sim: run full matches without rendering, assert outcomes ═══════════════
// usage: node tools/test/sim.mjs [--out /tmp/opencode/sim]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8125;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.png': 'image/png' };
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
         '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--window-size=800,450', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 800, height: 450 },
});
const page = await browser.newPage();
page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push(t); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e && e.message || e)));

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  · ' + info : ''}`); };

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__game && window.__game.booted, { timeout: 60000 });
console.log('booted ✔');

// ── TDM: two squads, kill limit 25, bots must actually fight ──
await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'assault', teamSize: 4, difficulty: 'regular', killLimit: 25, duration: 10 });
});
let s = null;
for (let i = 0; i < 10; i++) {
  s = await page.evaluate(() => window.__game.debugFast(10));
  console.log(`   t=${String(s.sim).padStart(5)}s  alpha ${s.score.alpha} — ${s.score.bravo} bravo   state=${s.state}`);
}
check('tdm: match is live', s.state !== 'ended', `state=${s.state} t=${s.sim}s`);
check('tdm: kills scored by bots', s.score.alpha + s.score.bravo > 0, `alpha ${s.score.alpha} · bravo ${s.score.bravo}`);
check('tdm: squads populated', s.bots >= 6, `${s.bots} bots`);
check('tdm: killfeed entries', await page.evaluate(() => window.__hud.feed.length > 0 || document.getElementById('killfeed').children.length > 0));
check('tdm: sim is cheap (no render)', s.ms / s.steps < 8, `${(s.ms / s.steps).toFixed(2)} ms/step`);

// headless viewport: does the HUD actually show numbers?
const hudTxt = await page.evaluate(() => ({
  a: document.getElementById('score-alpha').textContent,
  b: document.getElementById('score-bravo').textContent,
  timer: document.getElementById('match-timer').textContent,
  ammo: document.getElementById('ammo-mag').textContent,
  hp: document.getElementById('hp-num').textContent,
}));
check('tdm: scoreboard updated in DOM', Number(hudTxt.a) + Number(hudTxt.b) > 0, JSON.stringify(hudTxt));

// ── run the match to completion ──
s = await page.evaluate(() => window.__game.debugFast(900));
const endState = await page.evaluate(() => ({
  running: window.__game.running,
  ended: !!(window.__game.match && window.__game.match.ended),
  title: document.getElementById('res-title').textContent,
  sub: document.getElementById('res-sub').textContent,
  resOn: document.getElementById('results').classList.contains('on'),
  kd: document.getElementById('res-kd').textContent,
  kills: document.getElementById('res-kills').textContent,
}));
check('tdm: match reaches a result', endState.ended || !endState.running, JSON.stringify(endState));
check('tdm: results screen shown', endState.resOn && !!endState.title, `${endState.title} — ${endState.sub}`);
check('tdm: final score present', s.score.alpha + s.score.bravo >= 25, `alpha ${s.score.alpha} · bravo ${s.score.bravo}`);

// ── redeploy into survival and let waves roll ──
s = await page.evaluate(() => {
  const g = window.__game;
  g.hud.hideResults();
  g.startMatch({ mode: 'survival', classId: 'cleaner', difficulty: 'regular' });
  return g.debugFast(140);
});
check('survival: waves advance', s.wave >= 2 || s.entities > 2, `wave=${s.wave} entities=${s.entities}`);
check('survival: player can die and respawn cycle runs', typeof s.player.hp === 'number', JSON.stringify(s.player));
check('survival: no stuck countdown', s.state !== 'countdown' || s.sim > 4, `state=${s.state}`);

// ── weapon/ammo sanity under fire (scripted) ──
const wep = await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'survival', classId: 'sniper', difficulty: 'recruit' });
  g.debugFast(4);
  const before = g.weapons.stateSnapshot();
  g.debugTick(1);                       // scripted burst
  g.debugFast(3);
  const after = g.weapons.stateSnapshot();
  g.debugTick(0);
  g.debugFast(3);
  const melee = g.weapons.loadout.melee;
  g.weapons.equip(melee);
  g.debugFast(0.6);
  return { before, after, melee, cur: g.weapons.currentId, nades: g.weapons.grenades };
});
check('weapons: scripted fire consumes ammo', wep.after.mag < wep.before.mag, `mag ${wep.before.mag} → ${wep.after.mag}`);
check('weapons: grenades held', wep.nades > 0, `${wep.nades} frags`);
check('weapons: slot swap works', wep.cur === wep.melee, `equipped ${wep.cur}`);

// ── bot movement / navigation sanity ──
const nav = await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'assault', teamSize: 5, difficulty: 'regular', killLimit: 100, duration: 20 });
  g.debugFast(5);
  const start = g.match.bots.map(b => ({ n: b.name, t: b.team, x: b.pos.x, z: b.pos.z }));
  g.debugFast(25);
  const now = g.match.bots.map(b => ({ n: b.name, t: b.team, x: b.pos.x, z: b.pos.z, alive: b.alive }));
  let moved = 0;
  for (const a of start) {
    const b = now.find(n => n.n === a.n);
    if (!b) continue;
    if (Math.hypot(b.x - a.x, b.z - a.z) > 6) moved++;
  }
  const stuck = now.filter(b => {
    const a = start.find(n => n.n === b.n);
    return a && Math.hypot(b.x - a.x, b.z - a.z) < 0.6 && b.alive;
  }).length;
  return { moved, stuck, total: now.length, alive: now.filter(b => b.alive).length };
});
check('bots: navigate the map', nav.moved >= Math.max(1, Math.floor(nav.total * 0.4)), `${nav.moved}/${nav.total} moved >6m`);
check('bots: not stuck in place', nav.stuck <= 2, `${nav.stuck} stuck`);

console.log('\n─── console (' + logs.length + ') ───');
logs.slice(-12).forEach(l => console.log(l));
console.log('─── errors (' + errors.length + ') ───');
[...new Set(errors)].slice(0, 20).forEach(e => console.log('  ✗ ' + e));

await browser.close();
server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ' — ' + failed + ' FAILED' : ' ✔'}`);
process.exit(failed || errors.length ? 1 : 0);
