// ═══════════════ Perf probe: draw calls / triangles / material count ═══════════════
// usage: node tools/test/perf.mjs [--out /tmp/opencode/perf]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8127;
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
         '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: { width: 640, height: 360 },
});
const page = await browser.newPage();
const allLogs = [];
page.on('console', m => { allLogs.push('[' + m.type() + '] ' + m.text()); if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + (e && e.message || e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
try { await page.waitForFunction(() => window.__game && window.__game.booted, { timeout: 60000 }); }
catch (e) { console.log('BOOT FAILED'); allLogs.slice(-25).forEach(x => console.log('  ' + x)); await browser.close(); server.close(); process.exit(1); }

const stat = await page.evaluate(() => {
  const g = window.__game;
  g.startMatch({ mode: 'tdm', classId: 'assault', teamSize: 4, difficulty: 'regular', killLimit: 25, duration: 10 });
  g.debugFast(6);
  g.renderer.info.autoReset = false;
  g.renderer.info.reset();
  g.composer.render();
  const r = g.renderer.info.render;
  let meshes = 0, tris = 0, mats = new Set(), geos = new Set();
  g.scene.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    geos.add(o.geometry.uuid);
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m.uuid));
    const gi = o.geometry.index;
    tris += (gi ? gi.count : o.geometry.attributes.position.count) / 3;
  });
  return {
    drawCalls: r.calls, shadedTris: r.triangles,
    meshes, sceneTris: Math.round(tris), materials: mats.size, geometries: geos.size,
    programs: g.renderer.info.programs ? g.renderer.info.programs.length : -1,
    memGeoms: g.renderer.info.memory.geometries, memTex: g.renderer.info.memory.textures,
  };
});
console.log(JSON.stringify(stat, null, 1));
console.log('errors:', errors.length);
await browser.close();
server.close();
