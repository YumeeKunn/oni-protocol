import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const PORT = 8477, MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.ogg':'audio/ogg','.png':'image/png' };
const server = http.createServer((req,res)=>{ const u=decodeURIComponent(req.url.split('?')[0]); const f=path.join(ROOT,u==='/'?'index.html':u);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end('nf');return;}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res); });
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser = await puppeteer.launch({ executablePath:'/snap/bin/chromium', headless:'shell',
 args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio'], defaultViewport:{width:640,height:360} });
const page = await browser.newPage();
page.on('pageerror', e=>console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>window.__game&&window.__game.booted,{timeout:60000});
const out = await page.evaluate(()=>{
  const g = window.__game;
  g.startMatch({ mode:'tdm', classId:'assault', teamSize:4, difficulty:'regular' });
  const p = g.player.pos;
  const res = { pos:[+p.x.toFixed(2), +p.z.toFixed(2)], rays:{} };
  for (const [k,y] of Object.entries({ n:0, e:Math.PI/2, s:Math.PI, w:-Math.PI/2, ne:Math.PI/4, nw:-Math.PI/4 })) res.rays[k] = g.debugRay(y, 0, 20);
  return res;
});
console.log('pos', out.pos.join(','));
for (const [k, v] of Object.entries(out.rays)) console.log(k.padEnd(3), v ? `${v.tag} @${v.dist}m  col=${v.col.x},${v.col.z} h=${v.col.h.join('x')}` : 'clear');
await browser.close(); server.close();
