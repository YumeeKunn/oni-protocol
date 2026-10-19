<div align="center">

# DUST STRIKE

**Tactical FPS — right in your browser**

A browser tactical shooter in the spirit of *Riposte*: two game modes, four classes,
Quake/CS movement, a three-district Mediterranean arena. Three.js, ES modules,
**zero build step**.

<br/>

![Three.js](https://img.shields.io/badge/Built%20with-Three.js-1DB9D6?style=flat-square&logo=threejs&logoColor=white)
![WebGL](https://img.shields.io/badge/WebGL-Required-BrightGreen?style=flat-square&logo=webgl&logoColor=white)
![No Build](https://img.shields.io/badge/build-none-blue?style=flat-square)

</div>

## [+] Modes

| Mode | What it is |
|------|------------|
| **Survival** | Solo against escalating waves of hostiles. Clear a wave, get a breather, go again. |
| **TDM** | ALPHA vs BRAVO with bot squads. Team size, difficulty, kill limit and duration are all set in the menu. |

## [+] Classes

| Class | Primary | Secondary | Role |
|-------|---------|-----------|------|
| **Assault** | M4A1 | M9 | Mid-range rifleman |
| **Cleaner** | MP5 | M9 | Close-quarters entry |
| **Sniper** | L96A1 (scoped) | M9 | Recon, hold-breath on `L-Ctrl` |
| **Breacher** | M1014 | M9 | Shotgun, breach and clear |

Every class carries the knife (`3`) and two frag grenades (`G`).

## [+] Controls

| Input | Action |
|-------|--------|
| `W A S D` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch · **hold breath while scoped** |
| `Space` | Jump (buffered, with coyote time) |
| `Mouse 1` | Fire |
| `Mouse 2` | Aim down sights / scope |
| `R` | Reload |
| `1 2 3` | Primary / secondary / knife |
| `Q` | Last weapon |
| `G` | Throw frag |
| `Esc` | Pause menu |
| `M` | Mute |

## [+] Running Locally

No build step and no `npm install` — Three.js and the post-processing passes are
bundled in `libs/`.

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

> Requires WebGL. Works on any modern GPU or integrated graphics.

## [+] Project Layout

```
index.html          # DOM shell: HUD, menus, results, scope overlay
style.css           # HUD + menu styling
libs/               # bundled three.js, postprocessing, shaders
src/
  core/             # config, utils, input, audio, geometry merge
  world/            # texture kit, builder, props, map, world, minimap
  entities/         # physics, nav + A*, player, bot AI, match/squads
  weapons/          # defs, procedural viewmodels, anim layers, weapon system
  fx/               # muzzle flash, tracers, impacts, blood, grenades
  ui/               # HUD and menus
  main.js           # orchestrator: game loop, match lifecycle, callbacks
assets/audio/       # CC/PD gun recordings (see CREDITS.md)
tools/
  audio/            # audio build pipeline (python + gstreamer)
  test/             # headless harness, sim, probe, perf, bot debug
```

## [+] Tech Notes

- **Movement** — Quake-style `accelerate()` + `friction()` with air-strafe, crouch,
  slide, step-up, jump buffer and coyote time (constants in `src/core/config.js`).
- **Collision** — yawed AABBs in a spatial hash, capsule body with depenetration,
  per-axis wall sliding, roof-shell colliders so tent interiors stay walkable.
- **AI** — baked walkability grid (1.5 m), A* with line-of-sight smoothing,
  perception (FOV + LOS + sound), difficulty-scaled aim, wall-slide and dodge
  behaviour so bots never wedge on props.
- **Rendering** — static geometry is batched by material at load (≈4900 → ≈1600
  draw calls), procedural texture kit, bloom + vignette post chain.
- **Audio** — layered synth + real recordings, convolution reverb; credits in
  `assets/audio/CREDITS.md`.

## [+] Testing

Headless Chromium harnesses (puppeteer-core, SwiftShader):

```bash
node tools/test/harness.mjs          # smoke test, zero-error gate
node tools/test/sim.mjs              # full-match logic: TDM, survival, weapons, nav
node tools/test/perf.mjs             # draw calls / triangles / materials
node tools/test/probe.mjs --out …    # screenshot rig (hip/ADS/scope/killcam/results)
node tools/test/botdbg.mjs --secs 30 # nav probe + per-bot AI trace
```

