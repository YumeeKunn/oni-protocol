// ═══════════════ SIM — headless match simulation (bot engagement behaviour) ═══════════════
// Boots the game in SwiftShader, starts a TDM, fast-forwards the simulation and
// reports where the bots actually choose to fight. No rendering needed for the
// logic, so this is the cheap gate for AI changes.
import { createRequire } from 'node:module';
import { ensureServer } from './_serve.mjs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/home/yadav/pwtest/node_modules/puppeteer-core'); }
const { existsSync } = await import('node:fs');
const CHROME = [process.env.CHROME_PATH, '/snap/bin/chromium', '/home/yadav/.hermes/tools/chromium-1208/chrome-linux64/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => p && existsSync(p)) || '/snap/bin/chromium';

const argv = process.argv.slice(2);
const arg = (n, def) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : def; };
const PORT = arg('port', '8099');
const SECS = +arg('secs', '45');
await ensureServer(+PORT);
const DIFF = arg('difficulty', 'regular');

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.booted', { timeout: 90000 });

const out = await page.evaluate(async ({ secs, diff }) => {
  const g = window.__game;
  g.menus.hide();
  g.startMatch({ mode: 'tdm', classId: 'assault', teamsize: 6, difficulty: diff, killlimit: 100, duration: 20 });
  g.input.exitLock();
  // park the player somewhere safe so bots have to hunt and close in
  g.player.reset({ x: 0, z: 36, yaw: 0 });
  const snap = g.debugFast(secs, 1 / 60);
  const bots = g.debugBots();
  const all = g.match.bots.filter(b => b.shotDists && b.shotDists.length);
  const dists = all.flatMap(b => b.shotDists);
  const avg = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  const max = dists.length ? Math.max(...dists) : 0;
  const within15 = dists.filter(d => d <= 15).length;
  return {
    snap, bots: bots.length,
    shots: dists.length, avgDist: +avg.toFixed(1), maxDist: +max.toFixed(1),
    pctWithin15: dists.length ? Math.round((within15 / dists.length) * 100) : 0,
    perBot: all.map(b => ({ n: b.name, w: b.classId, shots: b.shotDists.length, avg: +(b.shotDists.reduce((x, y) => x + y, 0) / b.shotDists.length).toFixed(1), range: +b.engageRange.toFixed(1), kills: b.kills })),
    states: bots.map(b => ({ n: b.n, t: b.team, st: b.st, pos: b.pos, hp: b.hp, tgt: b.tgt, goal: b.goal, pathN: b.pathN, pi: b.pi, shots: b.shots, wallHits: b.wallHits })),
    overlaps: bots.reduce((n, b) => n + b.overlaps.length, 0),
    stuck: bots.filter(b => b.stuck > 0.8).length,
    playerHp: Math.round(g.player.hp), playerAlive: g.player.alive,
    score: snap.score,
  };
}, { secs: SECS, diff: DIFF });

console.log(JSON.stringify(out, null, 2));
if (errors.length) { console.log('ERRORS:', errors.slice(0, 10)); process.exitCode = 1; }
await browser.close();
