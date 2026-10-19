// ═══════════════ FX — pooled particles, tracers, decals, explosions ═══════════════
import * as THREE from 'three';
import { rand, clamp, pick } from '../core/utils.js';

const MAX_P = 700;

function softTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.42, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function holeTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 64, 64);
  c.fillStyle = 'rgba(10,8,6,0.92)';
  c.beginPath(); c.arc(32, 32, 7, 0, 7); c.fill();
  c.strokeStyle = 'rgba(140,130,115,0.55)';
  c.lineWidth = 2.4;
  c.beginPath(); c.arc(32, 32, 9.5, 0, 7); c.stroke();
  c.strokeStyle = 'rgba(90,82,70,0.5)';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * 7;
    c.lineWidth = 0.8 + Math.random();
    c.beginPath();
    c.moveTo(32 + Math.cos(a) * 8, 32 + Math.sin(a) * 8);
    c.lineTo(32 + Math.cos(a) * (14 + Math.random() * 16), 32 + Math.sin(a) * (14 + Math.random() * 16));
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene, kit) {
    this.scene = scene;
    this.kit = kit;
    this.t = 0;

    // ── particle pool (single Points object, custom shader for per-particle size/alpha) ──
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 4);
    this.pSize = new Float32Array(MAX_P);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    this.pgeo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTex() }, uScale: { value: window.innerHeight * 0.5 } },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec4 aColor; attribute float aSize;
        varying vec4 vColor; uniform float uScale;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * uScale / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.01) discard;
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.pmat = mat;
    this.parts = [];
    for (let i = 0; i < MAX_P; i++) this.parts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.2, grav: 0, drag: 0.9, col: [1, 1, 1, 1], fade: 1 });
    this.pCursor = 0;

    // ── decals ──
    this.decalTex = holeTex();
    this.decalMat = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const dg = new THREE.PlaneGeometry(0.22, 0.22);
    this.decals = [];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(dg, this.decalMat);
      m.visible = false;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
    this.dCursor = 0;

    // ── tracers ──
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const tg = new THREE.PlaneGeometry(1, 1);
    tg.translate(0.5, 0, 0);
    this.tracers = [];
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tCursor = 0;

    // ── casings ──
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xb08a44, metalness: 0.9, roughness: 0.35 });
    const cg = new THREE.CylinderGeometry(0.008, 0.009, 0.028, 6);
    cg.rotateZ(Math.PI / 2);
    this.casings = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(cg, this.casingMat);
      m.visible = false;
      scene.add(m);
      this.casings.push({ mesh: m, life: 0, v: new THREE.Vector3(), w: new THREE.Vector3() });
    }
    this.cCursor = 0;

    // ── explosion light + flash sprite pool ──
    this.exploLight = new THREE.PointLight(0xffa040, 0, 34, 2);
    scene.add(this.exploLight);
    this.exploFlashT = 0;
    this.shake = 0;

    // ── muzzle light for the world (first-person flash bounce) ──
    this.muzzleLight = new THREE.PointLight(0xffbb66, 0, 12, 2);
    scene.add(this.muzzleLight);
  }

  spawn(x, y, z, o = {}) {
    const p = this.parts[this.pCursor];
    this.pCursor = (this.pCursor + 1) % MAX_P;
    p.life = o.life ?? 0.6;
    p.max = p.life;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.size = o.size ?? 0.25;
    p.grav = o.grav ?? 0;
    p.drag = o.drag ?? 2.2;
    p.fade = o.fade ?? 1;
    p.grow = o.grow ?? 0;
    p.col = o.col || [1, 1, 1, 1];
    this.pPos[this.pCursor * 3] = x;
    this.pPos[this.pCursor * 3 + 1] = y;
    this.pPos[this.pCursor * 3 + 2] = z;
    p.x = x; p.y = y; p.z = z;
    return p;
  }

  /** bullet impact: dust puff, chips and sparks depending on the surface */
  impact(point, normal, tag = 'stone', dist = 0) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    const blood = tag === 'flesh';
    const base = blood ? [0.62, 0.05, 0.06, 0.9] : this.surfaceColor(tag);
    const count = blood ? 14 : (tag === 'metal' ? 8 : 10);
    for (let i = 0; i < count; i++) {
      const sp = rand(0.6, 3.4) * (blood ? 1.3 : 1);
      const dir = new THREE.Vector3(
        n.x + rand(-0.9, 0.9), n.y + rand(-0.5, 1.1) + (blood ? 0.4 : 0.1), n.z + rand(-0.9, 0.9),
      ).normalize();
      this.spawn(
        point.x + n.x * 0.03, point.y + n.y * 0.03, point.z + n.z * 0.03,
        {
          vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp,
          life: blood ? rand(0.5, 1.0) : rand(0.28, 0.7),
          size: blood ? rand(0.1, 0.26) : rand(0.09, 0.24),
          grav: blood ? 7 : 2.4,
          drag: blood ? 2.4 : 3.2,
          grow: blood ? 0.35 : 0.5,
          col: blood ? base : [base[0], base[1], base[2], rand(0.5, 0.95)],
        },
      );
    }
    if (tag === 'metal' && !blood) {
      for (let i = 0; i < 6; i++) {
        const dir = new THREE.Vector3(n.x + rand(-1, 1), n.y + rand(0, 1.4), n.z + rand(-1, 1)).normalize();
        this.spawn(point.x, point.y, point.z, {
          vx: dir.x * rand(3, 7), vy: dir.y * rand(3, 7), vz: dir.z * rand(3, 7),
          life: rand(0.14, 0.3), size: 0.05, grav: 12, drag: 0.6, col: [1, 0.82, 0.4, 1],
        });
      }
      this.spawn(point.x, point.y, point.z, { life: 0.09, size: 0.5, col: [1, 0.85, 0.5, 0.85], drag: 6 });
    }
    if (!blood) this.decal(point, n, tag);
  }

  surfaceColor(tag) {
    switch (tag) {
      case 'metal': case 'iron': case 'metalRust': case 'metalGreen': return [0.75, 0.72, 0.66];
      case 'wood': return [0.52, 0.38, 0.22];
      case 'cloth': case 'sandbags': case 'sandbag': return [0.72, 0.64, 0.46];
      case 'glass': return [0.7, 0.85, 0.9];
      case 'tyre': return [0.16, 0.16, 0.17];
      case 'concrete': return [0.74, 0.72, 0.66];
      default: return [0.78, 0.72, 0.58];
    }
  }

  decal(point, normal, tag) {
    const d = this.decals[this.dCursor];
    this.dCursor = (this.dCursor + 1) % this.decals.length;
    const m = d.mesh;
    m.visible = true;
    m.position.copy(point).addScaledVector(normal, 0.012);
    const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    m.up.copy(up);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = rand(0.75, 1.45) * (tag === 'cloth' || tag === 'sandbag' || tag === 'sandbags' ? 1.5 : 1);
    m.scale.setScalar(s);
    d.life = 26;
  }

  tracer(from, to, o = {}) {
    const t = this.tracers[this.tCursor];
    this.tCursor = (this.tCursor + 1) % this.tracers.length;
    const m = t.mesh;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    m.visible = true;
    m.position.copy(from);
    m.scale.set(len, o.width || 0.022, 1);
    m.lookAt(to);
    m.rotateY(-Math.PI / 2);
    m.material.color.setHex(o.color ?? 0xffe6a0);
    m.material.opacity = o.opacity ?? 0.85;
    t.life = o.life ?? 0.06;
    t.max = t.life;
  }

  casing(pos, dir, side = 1, big = false) {
    const c = this.casings[this.cCursor];
    this.cCursor = (this.cCursor + 1) % this.casings.length;
    c.mesh.visible = true;
    c.mesh.position.copy(pos);
    c.mesh.scale.setScalar(big ? 1.35 : 1);
    c.v.set(dir.x * rand(1.2, 2.4) + side * rand(1.2, 2.6), rand(1.6, 3.4), dir.z * rand(1.2, 2.4));
    c.w.set(rand(-16, 16), rand(-16, 16), rand(-16, 16));
    c.life = 3.2;
  }

  explosion(p, radius = 7, big = true) {
    // flash
    for (let i = 0; i < 26; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1.4), rand(-1, 1)).normalize();
      this.spawn(p.x, p.y + 0.2, p.z, {
        vx: dir.x * rand(4, 16), vy: dir.y * rand(3, 13), vz: dir.z * rand(4, 16),
        life: rand(0.3, 0.8), size: rand(0.4, 1.3), grav: -1.2, drag: 1.4, grow: 1.6,
        col: [rand(0.9, 1), rand(0.5, 0.75), rand(0.15, 0.3), rand(0.5, 0.95)],
      });
    }
    for (let i = 0; i < 30; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize();
      this.spawn(p.x, p.y + 0.3, p.z, {
        vx: dir.x * rand(1, 6), vy: dir.y * rand(1.5, 5), vz: dir.z * rand(1, 6),
        life: rand(0.8, 2.0), size: rand(0.6, 1.7), grav: 0.4, drag: 1.1, grow: 2.4,
        col: [0.32, 0.3, 0.28, rand(0.25, 0.55)],
      });
    }
    // dirt / debris ring
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(p.x, p.y + 0.05, p.z, {
        vx: Math.cos(a) * rand(5, 14), vy: rand(2, 7), vz: Math.sin(a) * rand(5, 14),
        life: rand(0.35, 0.9), size: rand(0.12, 0.4), grav: 9, drag: 1.1,
        col: [0.6, 0.52, 0.36, 0.95],
      });
    }
    this.exploLight.position.copy(p);
    this.exploLight.intensity = big ? 320 : 150;
    this.exploLight.distance = radius * 5;
    this.exploFlashT = 0.28;
    this.shake = Math.max(this.shake, big ? 1 : 0.6);
  }

  update(dt, camera) {
    this.t += dt;
    // particles
    let n = 0;
    for (let i = 0; i < MAX_P; i++) {
      const p = this.parts[i];
      if (p.life <= 0) { this.pSize[i] = 0; this.pCol[i * 4 + 3] = 0; continue; }
      p.life -= dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d;
      p.vy = p.vy * d + (p.grav - p.vy * 0) * dt;
      p.vy += p.grav * dt - p.vy * (1 - d) * 0.4;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy = Math.abs(p.vy) * 0.18; p.vx *= 0.6; p.vz *= 0.6; }
      const k = clamp(p.life / p.max, 0, 1);
      this.pPos[i * 3] = p.x; this.pPos[i * 3 + 1] = p.y; this.pPos[i * 3 + 2] = p.z;
      this.pSize[i] = p.size * (1 + p.grow * (1 - k)) * (0.35 + k * 0.65);
      this.pCol[i * 4] = p.col[0]; this.pCol[i * 4 + 1] = p.col[1]; this.pCol[i * 4 + 2] = p.col[2];
      this.pCol[i * 4 + 3] = p.col[3] * Math.min(1, k * p.fade * 2.4);
      n++;
    }
    this.pgeo.attributes.position.needsUpdate = true;
    this.pgeo.attributes.aColor.needsUpdate = true;
    this.pgeo.attributes.aSize.needsUpdate = true;
    this.points.visible = n > 0;
    this.pmat.uniforms.uScale.value = window.innerHeight * 0.5;

    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = clamp(t.life / t.max, 0, 1) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    // decals
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) d.mesh.visible = false;
      else if (d.life < 3) d.mesh.material = this.decalMat;
    }
    // casings
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.v.y -= 22 * dt;
      c.mesh.position.addScaledVector(c.v, dt);
      if (c.mesh.position.y < 0.02) { c.mesh.position.y = 0.02; c.v.y = Math.abs(c.v.y) * 0.28; c.v.multiplyScalar(0.6); c.w.multiplyScalar(0.5); }
      c.mesh.rotation.x += c.w.x * dt; c.mesh.rotation.y += c.w.y * dt; c.mesh.rotation.z += c.w.z * dt;
    }
    // explosion light
    if (this.exploFlashT > 0) {
      this.exploFlashT -= dt;
      this.exploLight.intensity *= Math.exp(-9 * dt);
      if (this.exploFlashT <= 0) this.exploLight.intensity = 0;
    }
    // muzzle light follows the camera a touch ahead
    if (this.muzzleLight.intensity > 0) this.muzzleLight.intensity *= Math.exp(-26 * dt);
  }

  /** first-person muzzle light bounce (brightens nearby walls for a frame) */
  muzzle(pos, dir, strength = 1) {
    this.muzzleLight.position.copy(pos).addScaledVector(dir, 0.4);
    this.muzzleLight.intensity = 26 * strength;
    this.muzzleLight.distance = 14;
  }
}
