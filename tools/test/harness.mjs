// ═══════════════ Headless smoke test: load game, drive UI, screenshot ═══════════════
// usage: node tools/test/harness.mjs [--shots 3] [--mode tdm] [--out /tmp/opencode/shots]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8123;

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('out', '/tmp/opencode/shots');
const SHOTS = +arg('shots', 3);

fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.png': 'image/png', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const logs = [];
const errors = [];
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

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}

// ── drive: click through menu buttons that exist ──
const clickText = async (sel) => {
  const el = await page.$(sel);
  if (!el) return false;
  await el.click().catch(() => {});
  return true;
};

await shot('00-boot');

// menus.js exposes a debug API for the harness
const api = await page.evaluate(() => (window.__game ? Object.keys(window.__game) : null));
console.log('debug api:', api);
console.log('booted:', await page.evaluate(() => !!(window.__game && window.__game.booted)));

try {
if (api) {
  // start a match: optionally with mode/difficulty
  const mode = arg('mode', 'survival');
  await page.evaluate((mode) => window.__game.startMatch({ mode, teamSize: 4, difficulty: 'regular', killLimit: 25, duration: 5 }), mode);
  await new Promise(r => setTimeout(r, 2000));
  await shot('01-match-start');

  for (let i = 0; i < SHOTS; i++) {
    await page.evaluate((i) => window.__game.debugTick(i), i).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    await shot(`02-play-${i}`);
  }

  const state = await page.evaluate(() => window.__game.snapshot());
  console.log('STATE:', JSON.stringify(state, null, 1));
} else {
  // fallback: click the start button
  const clicked = await clickText('#btn-start');
  console.log('clicked start:', clicked);
  await new Promise(r => setTimeout(r, 2500));
  await shot('01-start-clicked');
}
} catch (e) {
  console.log('\n!! harness drive failed:', e && e.message);
  errors.push('HARNESS: ' + (e && e.message));
}

await browser.close();
server.close();

console.log('\n─── console (' + logs.length + ') ───');
logs.slice(0, 80).forEach(l => console.log(l));
console.log('\n─── errors (' + errors.length + ') ───');
[...new Set(errors)].slice(0, 40).forEach(e => console.log('  ✗ ' + e));
process.exit(errors.length ? 1 : 0);
