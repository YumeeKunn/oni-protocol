// ═══════════════ SHARED TEST SERVER — make sure a static server is up ═══════════════
// The test rigs all talk to a plain http://127.0.0.1:<port>/ server. If one is
// already running (the VPS workflow starts it by hand) we reuse it, otherwise we
// spawn a throwaway one rooted at the project directory.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function alive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/index.html`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function ensureServer(port = 8099) {
  if (await alive(port)) return null;
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  proc.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await alive(port)) return proc;
  }
  throw new Error('static server did not come up on port ' + port);
}
