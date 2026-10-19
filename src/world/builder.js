// ═══════════════ BUILDER — shared kit for map + prop construction ═══════════════
// Materials are pooled per texture kit (one material per kit variant), tiling is
// baked into geometry UVs by core/geo.js, so the whole map stays draw-call cheap.
import * as THREE from 'three';
import { boxGeo, projectUV, padGeo } from '../core/geo.js';

export function createBuilder(scene, kit) {
  const mats = new Map();

  const B = {
    scene, kit, root: new THREE.Group(),
    colliders: [], lights: [], anim: [], pmap: [], zones: [],
    spawns: { alpha: [], bravo: [], free: [] },
    stats: { meshes: 0 },
    /** ground-height callback — props placed with y=0 sit on the dunes */
    gy: () => 0,

    /** material for a texture kit entry (pooled by kit + tuning) */
    mat(name, o = {}) {
      const key = name + '|' + JSON.stringify(o);
      let m = mats.get(key);
      if (m) return m;
      const k = kit[name];
      if (!k) throw new Error('unknown texture kit: ' + name);
      m = new THREE.MeshStandardMaterial({
        map: k.map,
        roughness: o.rough ?? 0.93,
        metalness: o.metal ?? 0,
        color: o.color ?? 0xffffff,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 1,
        transparent: !!o.transparent,
        opacity: o.opacity ?? 1,
        side: o.side ?? THREE.FrontSide,
        alphaTest: o.alphaTest ?? 0,
        depthWrite: o.depthWrite ?? true,
      });
      if (k.bumpNormal && o.normal !== false) {
        m.normalMap = k.bumpNormal;
        const s = o.normalScale ?? 0.6;
        m.normalScale = new THREE.Vector2(s, s);
      }
      m.userData.surface = o.surface || name;
      mats.set(key, m);
      return m;
    },

    add(obj) { B.root.add(obj); B.stats.meshes++; return obj; },

    /** box by size, positioned by bottom-face centre */
    box(w, h, d, matName, x, yb, z, yaw = 0, o = {}) {
      const rep = o.rep ?? 1.6;
      const g = o.geo || boxGeo(w, h, d, rep);
      const y0 = yb + B.gy(x, z);
      const m = new THREE.Mesh(g, o.mat || B.mat(matName, o.matOpts || {}));
      m.position.set(x, y0 + h / 2, z);
      m.rotation.y = yaw;
      m.castShadow = o.cast !== false;
      m.receiveShadow = o.recv !== false;
      B.add(m);
      if (o.solid !== false) {
        B.solid(x, y0 + h / 2, z, w / 2, h / 2, d / 2, yaw, o.tag || o.surface || matName, o.climb, false);
      }
      return m;
    },

    /** mesh only, no collider */
    prop(geo, matName, x, y, z, yaw = 0, o = {}) {
      const m = new THREE.Mesh(geo, o.mat || B.mat(matName, o.matOpts || {}));
      m.position.set(x, y + B.gy(x, z), z);
      // yaw first, then pitch/roll in the prop's own frame — otherwise a rotated
      // roof or awning ends up tilting along the world axis
      m.rotation.order = 'YXZ';
      m.rotation.set(o.rx || 0, yaw, o.rz || 0);
      if (o.scale) m.scale.setScalar(o.scale);
      if (o.scaleV) m.scale.copy(o.scaleV);
      m.castShadow = o.cast !== false;
      m.receiveShadow = o.recv !== false;
      B.add(m);
      return m;
    },

    cyl(rt, rb, h, matName, x, yb, z, o = {}) {
      const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 12, 1, false);
      projectUV(g, o.rep || 1.1);
      const m = B.prop(g, matName, x, yb + h / 2, z, o.yaw || 0, o);
      if (o.solid) B.solid(x, yb + h / 2, z, Math.max(rt, rb), h / 2, Math.max(rt, rb), o.yaw || 0, o.tag || matName, o.climb);
      return m;
    },

    /** ground decal plane (roads, plazas, painted lines) */
    pad(w, d, matName, x, z, y = 0.02, o = {}) {
      const g = padGeo(w, d, o.rep ?? 3.4);
      if (o.rot) g.rotateY(o.rot);
      const m = new THREE.Mesh(g, o.mat || B.mat(matName, o.matOpts || {}));
      m.position.set(x, y, z);
      m.receiveShadow = true;
      m.castShadow = false;
      m.renderOrder = o.renderOrder ?? 1;
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -4;
      m.material.polygonOffsetUnits = -4;
      B.add(m);
      return m;
    },

    /** collide-only volume (invisible), for doorways, ramps, out-of-bounds */
    solid(x, y, z, hx, hy, hz, yaw = 0, tag = 'stone', climb = false, useGround = true) {
      B.colliders.push({ x, y: useGround ? y + B.gy(x, z) : y, z, hx, hy, hz, yaw, tag, climb: !!climb });
      return B.colliders[B.colliders.length - 1];
    },

    zone(name, x, z, r) { B.zones.push({ name, x, z, r }); },

    light(l) { B.lights.push(l); scene.add(l); return l; },
  };

  scene.add(B.root);
  return B;
}
