// ═══════════════ SHOT — headless screenshot rig (puppeteer-core + SwiftShader) ═══════════════
// Usage: node tools/test/shot.mjs [--port 8099] [--out shots] [--views menu,hip,ads,lineup]
import { createRequire } from 'node:module';
import { ensureServer } from './_serve.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/home/yadav/pwtest/node_modules/puppeteer-core'); }
const { existsSync } = await import('node:fs');
const CHROME = [process.env.CHROME_PATH, '/snap/bin/chromium', '/home/yadav/.hermes/tools/chromium-1208/chrome-linux64/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => p && existsSync(p)) || '/snap/bin/chromium';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const PORT = arg('port', '8099');
await ensureServer(+PORT);
const OUT = path.resolve(arg('out', 'shots'));
const views = arg('views', 'menu,hip,ads,lineup').split(',');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--hide-scrollbars',
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.booted', { timeout: 90000 });
await new Promise(r => setTimeout(r, 1200));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('  shot →', name + '.png');
};
const wait = ms => new Promise(r => setTimeout(r, ms));

for (const v of views) {
  if (v === 'menu') {
    await wait(600);
    await shot('menu');
  } else if (v === 'hip' || v === 'ads' || v === 'lineup' || v === 'world') {
    // start a match without pointer lock
    await page.evaluate(() => {
      const g = window.__game;
      g.menus.hide();
      g.startMatch({ mode: 'tdm', classId: 'assault', teamsize: 4, difficulty: 'regular', killlimit: 50, duration: 10 });
      g.input.exitLock();
      document.getElementById('lock-hint')?.classList.remove('on');
    });
    await wait(900);
    // place the player somewhere photogenic, facing the souk
    await page.evaluate(() => {
      const g = window.__game;
      g.player.reset({ x: 0, z: 30, yaw: 0 });
      g.player.pitch = -0.02;
    });
    await wait(400);
    if (v === 'hip') {
      await page.evaluate(() => { window.__game.weapons.adsTarget = 0; });
      await wait(700);
      await shot('hip');
    }
    if (v === 'ads') {
      await page.evaluate(() => { window.__game.input.mouse.right = true; });
      await wait(1400);
      await shot('ads');
      await page.evaluate(() => { window.__game.input.mouse.right = false; });
    }
    if (v === 'lineup') {
      // line up three operators in front of the player for model/animation checks
      await page.evaluate(() => {
        const g = window.__game;
        g.debugSpawn(3, 6, 'bravo');
      });
      await wait(1500);
      await shot('lineup');
    }
    if (v === 'world') {
      await page.evaluate(() => {
        const g = window.__game;
        g.player.yaw = Math.PI * 0.25;
        g.player.pos.set(20, 0, 20);
      });
      await wait(700);
      await shot('world');
    }
  }
}

const snap = await page.evaluate(() => window.__game.snapshot());
console.log('snapshot:', JSON.stringify({ fps: snap.fps, calls: snap.renderer.calls, tris: snap.renderer.tris, colliders: snap.world.colliders }));
if (errors.length) {
  console.log('CONSOLE ERRORS:');
  for (const e of errors.slice(0, 20)) console.log('  ', e);
  process.exitCode = 1;
} else console.log('no console errors');
await browser.close();
