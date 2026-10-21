// ═══════════════ VIEW — vantage-point screenshot ═══════════════
// Usage: node tools/test/view.mjs name x z yaw [pitch]   → /tmp/opencode/view-<name>.png
import { createRequire } from 'node:module';
import { ensureServer } from './_serve.mjs';
const require = createRequire(import.meta.url);
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/home/yadav/pwtest/node_modules/puppeteer-core'); }
const { existsSync } = await import('node:fs');
const CHROME = [process.env.CHROME_PATH, '/snap/bin/chromium', '/home/yadav/.hermes/tools/chromium-1208/chrome-linux64/chrome'].find(p => p && existsSync(p)) || '/snap/bin/chromium';
const PORT = 8099; await ensureServer(PORT);
const a = process.argv.slice(2);
const name = a[0] || 'view', X = +a[1] || 0, Z = +a[2] || 0, YAW = +a[3] || 0, PITCH = +a[4] || 0;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio'], defaultViewport:{width:1280,height:720} });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.booted', { timeout: 90000 });
await page.evaluate(() => { const g = window.__game; g.menus.hide(); g.startMatch({ mode:'tdm', classId:'assault', teamSize:4, difficulty:'regular' }); g.input.exitLock(); document.getElementById('lock-hint')?.classList.remove('on'); });
await new Promise(r=>setTimeout(r,1200));
await page.evaluate(({X,Z,YAW,PITCH}) => { const g = window.__game; g.player.reset({ x:X, z:Z, yaw:YAW }); g.player.pitch = PITCH; }, {X,Z,YAW,PITCH});
await new Promise(r=>setTimeout(r,700));
await page.screenshot({ path: `/tmp/opencode/view-${name}.png` });
console.log('shot → /tmp/opencode/view-' + name + '.png', 'errors', errors.slice(0,3));
await browser.close();
