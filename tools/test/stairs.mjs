// ═══════════════ STAIRS — does the old-quarter ruin actually climb? ═══════════════
import { createRequire } from 'node:module';
import { ensureServer } from './_serve.mjs';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/home/yadav/pwtest/node_modules/puppeteer-core'); }
const { existsSync } = await import('node:fs');
const CHROME = [process.env.CHROME_PATH, '/snap/bin/chromium', '/home/yadav/.hermes/tools/chromium-1208/chrome-linux64/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => p && existsSync(p)) || '/snap/bin/chromium';
const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '8099';
await ensureServer(+PORT);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 450 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.booted', { timeout: 90000 });

const out = await page.evaluate(() => {
  const g = window.__game;
  g.menus.hide();
  g.startMatch({ mode: 'tdm', classId: 'assault', teamsize: 2, difficulty: 'regular', killlimit: 50, duration: 10 });
  g.input.exitLock();
  g.match.bots.slice().forEach(b => g.match.removeBot(b));

  // find the ruin stair (climb colliders) on the west flank
  const climbs = g.world.colliders
    .filter(c => c.climb && c.x < -25 && c.z > -8 && c.z < 10)
    .sort((a, b) => (a.y + a.hy) - (b.y + b.hy));
  if (!climbs.length) return { error: 'no climb colliders near the ruin' };
  const low = climbs[0], top = climbs[climbs.length - 1];
  const lowTop = low.y + low.hy, topTop = top.y + top.hy;

  // stand 1.2 m behind the lowest step, walk straight up
  const dx = top.x - low.x, dz = top.z - low.z;
  const len = Math.hypot(dx, dz) || 1;
  const yaw = Math.atan2(-dx / len, -dz / len);
  g.player.reset({ x: low.x - (dx / len) * 1.2, z: low.z - (dz / len) * 1.2, yaw });
  // fast-forward the pre-match countdown so the walk starts live
  let guard = 0;
  while (g.match && g.match.state === 'countdown' && guard++ < 400) g.step(1 / 60);
  g.script = { forward: 1, lookX: 0 };
  const before = g.player.pos.y;
  for (let i = 0; i < 300; i++) g.step(1 / 60);
  const climbedTo = g.player.pos.y;
  g.script = null;

  return {
    steps: climbs.length, lowTop: +lowTop.toFixed(2), topTop: +topTop.toFixed(2),
    startY: +before.toFixed(2), endY: +climbedTo.toFixed(2),
    endPos: [+g.player.pos.x.toFixed(1), +g.player.pos.z.toFixed(1)],
    onGround: g.player.onGround,
  };
});

console.log(JSON.stringify(out, null, 2));
// the ruin deck sits at 3.2 m; ending up on it (and still grounded) is the pass
const okClimb = !out.error && out.endY > 3.0 && out.endY < 4.2 && out.onGround;
console.log(okClimb ? 'PASS  ruin stairs are climbable and the deck holds' : 'FAIL  could not climb the ruin stairs');
if (errors.length) { console.log('ERRORS', errors.slice(0, 5)); process.exitCode = 1; }
else if (!okClimb) process.exitCode = 1;
await browser.close();
