// ═══════════════ FEEL — movement feel probe ═══════════════
// Real key input, samples the speed curve: walk / sprint / slide / stop.
// Usage: node tools/test/feel.mjs
import { createRequire } from 'node:module';
import { ensureServer } from './_serve.mjs';
const require = createRequire(import.meta.url);
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/home/yadav/pwtest/node_modules/puppeteer-core'); }
const { existsSync } = await import('node:fs');
const CHROME = [process.env.CHROME_PATH, '/snap/bin/chromium', '/home/yadav/.hermes/tools/chromium-1208/chrome-linux64/chrome'].find(p => p && existsSync(p)) || '/snap/bin/chromium';
const PORT = 8099; await ensureServer(PORT);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio'], defaultViewport:{width:960,height:540} });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.booted', { timeout: 90000 });
await page.evaluate(() => { const g = window.__game; g.menus.hide(); g.startMatch({ mode:'tdm', classId:'assault', teamSize:4, difficulty:'regular' }); g.input.exitLock(); g.debug=true; });
await new Promise(r => setTimeout(r, 1500));

const sample = async (label, ms) => {
  const out = await page.evaluate(async ({ ms }) => {
    const g = window.__game; const rows = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise(r => requestAnimationFrame(r));
      rows.push({ t: +((performance.now()-t0)/1000).toFixed(2), sp: +g.player.speed.toFixed(2), y: +g.player.pos.y.toFixed(2), sliding: g.player.sliding, st: +(g.player.slideT||0).toFixed(2), cd: +(g.player.slideCd||0).toFixed(2), og: g.player.onGround, crouch: g.player.crouching, sprint: g.player.sprinting });
    }
    return rows;
  }, { ms });
  const step = Math.max(1, Math.floor(out.length / 8));
  console.log(label, out.filter((_, i) => i % step === 0).map(r => `${r.t}s:${r.sp}${r.sliding?'[sl st='+r.st+' cd='+r.cd+']':''}${r.og?'':'[air]'}`).join('  '));
};

await page.keyboard.down('KeyW');
await sample('walk ', 2000);
await page.keyboard.down('ShiftLeft');
await sample('sprint', 1500);
await page.keyboard.down('KeyC');
await sample('slide ', 1200);
await page.keyboard.up('KeyC');
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await sample('stop  ', 1200);
console.log('errors', errors.slice(0,5));
await browser.close();
