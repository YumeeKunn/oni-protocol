// quick probe: does a bot acquire + shoot at a nearby player?
import { createRequire } from 'node:module';
import { ensureServer } from './_serve.mjs';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/home/yadav/pwtest/node_modules/puppeteer-core'); }
const { existsSync } = await import('node:fs');
const CHROME = [process.env.CHROME_PATH, '/snap/bin/chromium', '/home/yadav/.hermes/tools/chromium-1208/chrome-linux64/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(p => p && existsSync(p)) || '/snap/bin/chromium';
const PORT = 8099;
await ensureServer(PORT);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game && window.__game.booted', { timeout: 90000 });
const out = await page.evaluate(() => {
  const g = window.__game;
  g.menus.hide();
  g.startMatch({ mode: 'tdm', classId: 'assault', teamsize: 2, difficulty: 'regular', killlimit: 50, duration: 10 });
  g.input.exitLock();
  g.match.bots.slice().forEach(b => g.match.removeBot(b));
  g.player.reset({ x: 0, z: 30, yaw: 0 });
  const bot = g.match.addBot('bravo', 'regular', 'debug', { spawn: { x: 0, z: 40, yaw: Math.PI }, name: 'TEST', classId: 'm4a1' });
  const log = [];
  for (let i = 0; i < 240; i++) {
    g.step(1 / 60);
    if (i % 30 === 0) log.push({ i, tgt: bot.target ? bot.target.name : null, st: bot.state, pos: [+bot.pos.x.toFixed(1), +bot.pos.z.toFixed(1)], mag: bot.mag, shots: bot.bShots || 0, react: +bot.reactT.toFixed(2), dist: +Math.hypot(bot.pos.x - g.player.pos.x, bot.pos.z - g.player.pos.z).toFixed(1), engage: +bot.engageRange.toFixed(1) });
  }
  return { log, shotDists: bot.shotDists || [], hp: g.player.hp, alive: g.player.alive, weaponsMag: g.weapons.mag };
});
console.log(JSON.stringify(out, null, 1));
if (errors.length) console.log('ERR', errors.slice(0, 5));
await browser.close();
