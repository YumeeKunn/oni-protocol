// ═══════════════ Quick shot: one screenshot of a live match ═══════════════
// usage: node tools/test/shot.mjs --out /tmp/opencode/s.png [--class assault] [--mode survival]
//        [--wait 6] [--ads 1] [--fire 1] [--holdbreath 1] [--dist 18] [--spec] [--pos "0,34"]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8128 + Math.floor(Math.random() * 200);
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes('--' + k);
const out = arg('out', '/tmp/opencode/shot.png');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ogg': 'audio/ogg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const errors = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/snap/bin/chromium',
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
         '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e && e.message || e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__game && window.__game.booted, { timeout: 60000 });

await page.evaluate((o) => {
  const g = window.__game;
  document.getElementById('menu').classList.remove('on');
  document.getElementById('hud').classList.add('on');
  g.inputLocked = false;
  g.beginAudio();
  g.startMatch({ mode: o.mode, classId: o.class, difficulty: o.diff });
  g.debugFast(3);
  if (o.ads) { g.weapons.setADS?.(true); g.input.mouse.right = true; }
}, { mode: arg('mode', 'survival'), class: arg('class', 'assault'), diff: arg('diff', 'regular'), ads: flag('ads') });

if (flag('dist')) await page.evaluate(d => window.__game.debugSpawn(3, d), parseFloat(arg('dist', '18')));
if (flag('spec')) await page.evaluate(() => window.__game.debugSpawn(1, 40));

const wait = parseFloat(arg('wait', '4'));
await page.evaluate(async (w) => {
  const g = window.__game;
  const step = 1 / 60, n = Math.round(w / step);
  for (let i = 0; i < n; i++) g.debugFast(step, step);
}, wait);

if (flag('fire')) await page.evaluate(() => { window.__game.input.mouse.left = true; });
if (flag('holdbreath')) await page.evaluate(() => { window.__game.input.keys['ControlLeft'] = true; });
await new Promise(r => setTimeout(r, flag('ads') || flag('spec') ? 2500 : 900));
if (flag('fire')) await new Promise(r => setTimeout(r, 1200));

await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const g = window.__game;
  return { fps: g.fps ? +g.fps.toFixed(1) : null, calls: g.renderer.info.render.calls, w: g.weapons.stateSnapshot(), player: g.snapshot().player };
});
console.log('shot →', out);
console.log(JSON.stringify(info));
if (errors.length) { console.log('ERRORS:'); errors.slice(0, 8).forEach(e => console.log('  ' + e)); }
await browser.close();
server.close();
