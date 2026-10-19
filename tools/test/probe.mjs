// ═══════════════ Visual probe: drive real input, grab framed screenshots ═══════════════
// usage: node tools/test/probe.mjs [--mode tdm] [--class sniper] [--out /tmp/opencode/probe]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8124;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('out', '/tmp/opencode/probe');
const MODE = arg('mode', 'tdm');
fs.mkdirSync(OUT, { recursive: true });

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
         '--window-size=1280,720', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push(t); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e && e.message || e)));
page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
await wait(2500);

const ready = await page.evaluate(() => !!(window.__game && window.__game.booted));
console.log('booted:', ready);
if (!ready) { console.log(logs.join('\n')); console.log(errors.join('\n')); await browser.close(); server.close(); process.exit(1); }

// look straight down the street, no scripted input, real keys/mouse
const cls = arg('class', 'assault');
await page.evaluate(({ MODE, cls }) => {
  const g = window.__game;
  g.startMatch({ mode: MODE, classId: cls, teamSize: 3, difficulty: 'regular', killLimit: 25, duration: 5 });
  g.debug = true;
  g.script = null;
}, { MODE, cls });
await wait(1200);

async function grab(name, { hold = 0, keys = [], mouse = null, ms = 1200 } = {}) {
  if (mouse === 'right') await page.mouse.down({ button: 'right' });
  for (const k of keys) await page.keyboard.down(k);
  if (hold) await wait(hold);
  await wait(ms);
  await shot(name);
  for (const k of keys) await page.keyboard.up(k);
  if (mouse === 'right') await page.mouse.up({ button: 'right' });
  await wait(400);
}

// face into the map so the frame is readable
await page.evaluate(() => { window.__game.player.yaw = 0; });
await perf('menu-spawn');
await grab('10-hip');
await perf('assault-hip');
await grab('11-ads', { mouse: 'right', hold: 900, ms: 600 });
console.log('ADS DIAG (assault)', JSON.stringify(await page.evaluate(() => {
  const g = window.__game, w = g.weapons;
  return { right: g.input.mouse.right, ads: w.ads, adsT: w.adsT, scoped: w.scoped, st: w.state, anim: w.anim.state, fov: Math.round(g.player.fov) };
})));
await grab('12-walk', { keys: ['KeyW'], ms: 1600 });
await grab('13-sprint', { keys: ['KeyW', 'ShiftLeft'], ms: 1500 });
// fire a burst, then reload from a partial mag so the reload bar shows
await page.evaluate(() => { window.__game.player.yaw = 0.35; });
await page.mouse.down({ button: 'left' });
await wait(260); await shot('14-firing');
await wait(120); await shot('14b-firing2');
await page.mouse.up({ button: 'left' });
await wait(300);
await page.keyboard.press('KeyR');
await wait(900); await shot('15-reloading');
await wait(1800); await shot('16-reloaded');
await page.evaluate(() => { window.__game.player.yaw = 0.6; });
await page.keyboard.press('KeyG');
await wait(450); await shot('17-grenade-throw');
await wait(1800); await shot('18-grenade-boom');
// sniper + scope
await page.evaluate((cls) => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'sniper', teamSize: 3, difficulty: 'regular', killLimit: 25, duration: 5 });
  g.debug = true; g.script = null;
  g.player.yaw = 0;
  g.debugSpawn(3, 26);
  const w = g.weapons;
  if (!w.__patched) {
    w.__patched = true;
    const orig = w.update.bind(w);
    w.update = (...a) => { window.__wu = (window.__wu || 0) + 1; window.__rightSeen = a[1] && a[1].right; return orig(...a); };
  }
}, cls);
await wait(1400);
await shot('20-sniper-hip');
await perf('sniper-hip');
await page.mouse.down({ button: 'right' });
await wait(1500); await shot('21-scope');
console.log('ADS DIAG', JSON.stringify(await page.evaluate(() => {
  const g = window.__game, w = g.weapons;
  return { right: g.input.mouse.right, ads: w.ads, adsT: w.adsT, scoped: w.scoped, st: w.state, anim: w.anim.state, fov: Math.round(g.player.fov), cur: w.currentId, locked: g.input.locked,
    paused: g.paused, ui: g.uiScreen, running: g.running, frame: g.frameStep, updates: window.__wu || 0, rightSeen: window.__rightSeen, countdown: Math.round((g.match && g.match.countdown) * 10) / 10 };
})));
await wait(600);
console.log('ADS DIAG2', JSON.stringify(await page.evaluate(() => {
  const g = window.__game, w = g.weapons;
  return { ads: w.ads, adsT: w.adsT, updates: window.__wu || 0, frame: g.frameStep, paused: g.paused, countdown: Math.round((g.match && g.match.countdown) * 10) / 10 };
})));
await page.keyboard.down('ControlLeft');
await wait(900); await shot('22-scope-holdbreath');
await page.keyboard.up('ControlLeft');
await page.mouse.up({ button: 'right' });
await wait(500);
// shotgun closer look + a bot in frame
await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'breacher', teamSize: 3, difficulty: 'regular', killLimit: 25, duration: 5 });
  g.debug = true; g.script = null;
  g.player.yaw = 0;
  g.debugSpawn(3, 14);
});
await wait(1500);
await shot('30-shotgun-bots');
await page.mouse.down({ button: 'left' });
await wait(160); await shot('31-muzzle-flash');
await page.mouse.up({ button: 'left' });
await wait(1400);
await page.evaluate(() => window.__game.debugHit());
await wait(200); await shot('32-damage');
// killcam + results
await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'assault', teamSize: 3, difficulty: 'regular', killLimit: 25, duration: 5 });
  g.debug = true; g.script = null;
  g.player.yaw = 0;
  g.debugSpawn(2, 20);
});
await wait(1500);
await shot('33-bots-20m');
await page.evaluate(() => {
  const g = window.__game;
  const foe = g.entities.reverse().find(e => e.isBot && e.team === 'bravo');
  g.player.spawnProtect = 0;
  g.player.hp = 4;
  g.player.damage(60, foe, 'MP5', {});
});
await wait(800); await shot('40-killcam');
await wait(900); await shot('41-killcam-late');
await page.evaluate(() => { const g = window.__game; window.__game.skipKillcam(); });
await wait(900); await shot('42-respawned');
await page.evaluate(() => window.__game.match.endMatch('alpha'));
await wait(1200); await shot('50-results');

// menu screens
await page.evaluate(() => window.__game.quitToMenu());
await wait(600); await shot('51-menu');
await page.click('#btn-settings').catch(() => {});
await wait(500); await shot('52-settings');
await page.click('#settings button[data-close="menu"]').catch(() => {});
await page.click('#btn-controls').catch(() => {});
await wait(500); await shot('53-controls');

async function perf(tag) {
  const a = await page.evaluate(() => ({ f: window.__game.frameStep, c: window.__game.renderer.info.render.calls, t: window.__game.renderer.info.render.triangles, alive: window.__game.player.alive, dead: !!window.__game.killcam, filt: !!window.__game.canvas.style.filter }));
  await wait(1200);
  const b = await page.evaluate(() => ({ f: window.__game.frameStep }));
  console.log(`PERF ${tag}: ${((b.f - a.f) / 1.2).toFixed(1)} fps · calls ${a.c} · tris ${a.t} · alive ${a.alive} · killcam ${a.dead} · cssFilter ${a.filt}`);
}

const state = await page.evaluate(() => window.__game.snapshot());
console.log('STATE:', JSON.stringify(state, null, 1));

await browser.close();
server.close();
console.log('\n─── console (' + logs.length + ') ───');
logs.slice(0, 60).forEach(l => console.log(l));
console.log('\n─── errors (' + errors.length + ') ───');
[...new Set(errors)].slice(0, 30).forEach(e => console.log('  ✗ ' + e));
process.exit(errors.length ? 1 : 0);
