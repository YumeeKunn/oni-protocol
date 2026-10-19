// ═══════════════ WORLD — sky, sun, terrain, dressing passes ═══════════════
import * as THREE from 'three';
import { buildTextureKit } from './textures.js';
import { createBuilder } from './builder.js';
import { buildMap, groundHeight, ARENA_HALF, MAP_NAME } from './map.js';
import { padGeo, mergeGeos } from '../core/geo.js';
import { rand, chance, clamp } from '../core/utils.js';
import { RENDER } from '../core/config.js';

/**
 * Static batching: the map is authored as a few thousand small props, which costs one
 * draw call each (twice with the shadow pass). Everything that never moves is baked
 * into one mesh per material, so the render cost drops to a few hundred calls.
 * Meshes flagged `userData.noMerge` (vertex-animated flags) and one-off materials stay
 * as they are.
 */
function batchStatics(root) {
  const groups = new Map();
  const keep = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, m = o.material;
    if (!g || !m || Array.isArray(m) || o.isSkinnedMesh || o.morphTargetInfluences) { keep.push(o); return; }
    if (o.userData.noMerge || m.isShaderMaterial || m.transparent) { keep.push(o); return; }
    if (!g.attributes.position || !g.attributes.normal || !g.attributes.uv) { keep.push(o); return; }
    if (g.attributes.uv2 || g.attributes.color) { keep.push(o); return; }
    const key = `${m.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
    let e = groups.get(key);
    if (!e) groups.set(key, e = { mat: m, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder, list: [] });
    e.list.push(o);
  });

  const batched = new THREE.Group();
  batched.name = 'batched';
  let merged = 0;
  for (const e of groups.values()) {
    if (e.list.length < 2) { for (const o of e.list) batched.add(o); continue; }
    const geos = [];
    for (const o of e.list) {
      o.updateWorldMatrix(true, false);
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      geos.push(g);
    }
    const geo = mergeGeos(geos);
    if (!geo) { for (const o of e.list) batched.add(o); continue; }
    const mesh = new THREE.Mesh(geo, e.mat);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.recv;
    mesh.renderOrder = e.order;
    mesh.matrixAutoUpdate = false;
    batched.add(mesh);
    merged++;
  }
  for (const o of keep) batched.add(o);
  const parent = root.parent;
  if (parent) { parent.remove(root); parent.add(batched); }
  return { merged, batches: merged, kept: keep.length };
}

const SUN_DIR = new THREE.Vector3(0.46, 0.66, -0.59).normalize();
export const SUN = { dir: SUN_DIR, color: 0xfff1d2, intensity: 2.55, ambient: 0x9fb0c6 };

export function buildWorld(scene, renderer) {
  const kit = buildTextureKit();
  const B = createBuilder(scene, kit);
  B.gy = groundHeight;                    // props now follow the dunes

  // ── terrain ──
  const terrain = buildTerrain(scene, kit);

  // ── map content ──
  const map = buildMap(B);

  // ── sky dome + sun + lights ──
  const sky = buildSky(scene);
  const lights = buildLights(scene);

  // ── airborne dust ──
  const dust = buildDust(scene);

  // ── minimap footprint data ──
  const pmap = buildMinimapData(B, map);

  // ── static batching (huge draw-call win, nothing animated gets batched) ──
  const batchInfo = batchStatics(B.root);

  return {
    kit, B, map, terrain, sky, lights, dust, pmap, batchInfo,
    meshStats: { meshes: B.stats.meshes, batches: batchInfo.merged, kept: batchInfo.kept },
    colliders: B.colliders,
    zones: map.zones,
    spawns: map.spawns,
    bounds: ARENA_HALF,
    name: MAP_NAME,
    groundHeight,
    update(dt, t, focus) {
      for (const fn of B.anim) fn(dt, t);
      dust.update(dt, t);
      sky.update(t);
      // keep the shadow frustum centred on the player, snapped to shadow texels
      // so the edges don't crawl as you walk
      if (focus) {
        const texel = (lights.S * 2) / RENDER.shadowMap;
        const sx = Math.round(focus.x / texel) * texel;
        const sz = Math.round(focus.z / texel) * texel;
        lights.sun.target.position.set(sx, 0, sz);
        lights.sun.position.set(sx + SUN_DIR.x * 90, SUN_DIR.y * 90, sz + SUN_DIR.z * 90);
        lights.sun.target.updateMatrixWorld();
      }
    },
  };
}

// ═══════════════ terrain ═══════════════
function buildTerrain(scene, kit) {
  const size = ARENA_HALF * 2 + 30;
  const geo = new THREE.PlaneGeometry(size, size, 120, 120);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
  }
  geo.computeVertexNormals();

  // uv = metric tiling for the sand albedo, uv2 = coarser tile for the ripple normals
  const uv = new Float32Array(pos.count * 2);
  const uv2 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv[i * 2] = x / 9; uv[i * 2 + 1] = z / 9;
    uv2[i * 2] = x / 3.2; uv2[i * 2 + 1] = z / 3.2;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv2, 2));

  const sand = kit.sand;
  const map = sand.map.clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const nrm = sand.bumpNormal.clone();
  nrm.needsUpdate = true;
  nrm.channel = 1;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map, normalMap: nrm, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(0.5, 0.5),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}

// ═══════════════ sky ═══════════════
function buildSky(scene) {
  const uniforms = {
    top: { value: new THREE.Color(0x3f7fc4) },
    mid: { value: new THREE.Color(0xa8c6e0) },
    bottom: { value: new THREE.Color(0xe8d9b8) },
    sunDir: { value: SUN_DIR.clone() },
    sunColor: { value: new THREE.Color(0xfff0cc) },
    time: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 top, mid, bottom, sunColor, sunDir;
      uniform float time;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(bottom, mid, smoothstep(-0.02, 0.30, h));
        col = mix(col, top, smoothstep(0.22, 0.85, h));
        // sun disc + bloom halo
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * pow(sd, 900.0) * 6.0;
        col += sunColor * pow(sd, 12.0) * 0.34;
        col += sunColor * pow(sd, 3.0) * 0.10;
        // high haze band near horizon
        col = mix(col, vec3(0.92, 0.87, 0.76), pow(1.0 - clamp(h * 3.0, 0.0, 1.0), 3.0) * 0.45);
        // thin cirrus
        if (d.y > 0.02) {
          vec2 p = d.xz / max(d.y, 0.05) * 0.55 + vec2(time * 0.004, time * 0.002);
          float n = noise(p * 1.4) * 0.6 + noise(p * 3.7) * 0.4;
          float cloud = smoothstep(0.62, 0.94, n) * smoothstep(0.02, 0.35, d.y);
          col = mix(col, vec3(1.0, 0.99, 0.96), cloud * 0.55);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  return { mesh: sky, uniforms, update(t) { uniforms.time.value = t; } };
}

// ═══════════════ lights ═══════════════
function buildLights(scene) {
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.position.copy(SUN_DIR).multiplyScalar(90);
  sun.castShadow = true;
  // a tight frustum that follows the player gives ~2× the texel density of a
  // map-wide one, which is what kills the striped shadow acne on plaster walls
  const S = 36;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
  sun.shadow.mapSize.set(RENDER.shadowMap, RENDER.shadowMap);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.075;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd4f0, 0xb99a68, 1.42);
  scene.add(hemi);

  // bounce light from the hot ground so shadowed faces aren't black
  const bounce = new THREE.DirectionalLight(0xffe0b0, 0.5);
  bounce.position.set(-SUN_DIR.x * 40, 6, -SUN_DIR.z * 40);
  scene.add(bounce);

  return { sun, hemi, bounce, S };
}

// ═══════════════ dust motes ═══════════════
function buildDust(scene) {
  const N = 900;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    p[i * 3] = rand(-ARENA_HALF, ARENA_HALF);
    p[i * 3 + 1] = rand(0.2, 14);
    p[i * 3 + 2] = rand(-ARENA_HALF, ARENA_HALF);
    seed[i] = Math.random() * 100;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const tex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,246,224,0.85)');
    grd.addColorStop(1, 'rgba(255,246,224,0)');
    c.fillStyle = grd; c.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mat = new THREE.PointsMaterial({
    size: 0.16, map: tex, transparent: true, opacity: 0.5,
    depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    color: 0xffeccc,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const base = p.slice();
  return {
    points: pts,
    update(dt, t) {
      const arr = g.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const s = seed[i];
        arr[i * 3] = base[i * 3] + Math.sin(t * 0.35 + s) * 1.6 + t * 0.42 % 8;
        arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.6 + s * 2.1) * 0.5;
        const z = base[i * 3 + 2] + Math.cos(t * 0.28 + s) * 1.4;
        arr[i * 3 + 2] = z;
        if (arr[i * 3] > ARENA_HALF) arr[i * 3] -= ARENA_HALF * 2;
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = 0.36 + Math.sin(t * 0.5) * 0.08;
    },
  };
}

// ═══════════════ minimap footprint bake ═══════════════
function buildMinimapData(B, map) {
  const blocks = [];
  for (const c of B.colliders) {
    const top = c.y + c.hy;
    const area = (c.hx * 2) * (c.hz * 2);
    if (top < 1.1 || area < 0.9) continue;                 // ignore kerbs / low clutter
    if (Math.abs(c.x) > ARENA_HALF || Math.abs(c.z) > ARENA_HALF) continue;
    if (c.tag === 'stone' && c.hx > 60) continue;          // boundary walls
    if (!blocks.some(b => b.x === c.x && b.z === c.z && b.w === c.hx * 2 && b.d === c.hz * 2)) {
      blocks.push({ x: c.x, z: c.z, w: c.hx * 2, d: c.hz * 2, yaw: c.yaw, tall: top > 3.4 });
    }
  }
  const streets = [
    { x: 0, z: 38, w: 12, d: 30, kind: 'road' },
    { x: 0, z: -38, w: 12, d: 30, kind: 'road' },
    { x: 0, z: 0, w: 46, d: 46, kind: 'plaza' },
    { x: -43, z: 0, w: 14, d: 104, kind: 'dirt' },
    { x: 43, z: 0, w: 14, d: 104, kind: 'dirt' },
    { x: -40, z: 0, w: 20, d: 8, kind: 'road' },
    { x: 40, z: 0, w: 20, d: 8, kind: 'road' },
    { x: -30, z: 18, w: 10, d: 26, kind: 'road' },
    { x: 30, z: -18, w: 10, d: 26, kind: 'road' },
    { x: -30, z: -18, w: 10, d: 26, kind: 'road' },
    { x: 30, z: 18, w: 10, d: 26, kind: 'road' },
  ];
  return { blocks, streets, bounds: ARENA_HALF };
}
