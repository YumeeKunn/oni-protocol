// ═══════════════ VIEWMODEL — first-person weapons built from primitives ═══════════════
// Cast-iron stippled receiver finish, polymer furniture, gloved hands with camo
// sleeves — matches the art direction without shipping any binary assets.
import * as THREE from 'three';
import { boxGeo, projectUV } from '../core/geo.js';
import { rand } from '../core/utils.js';

const M = {};
function mats(kit) {
  if (M.kit === kit) return M;
  M.kit = kit;
  M.iron = new THREE.MeshStandardMaterial({ map: kit.iron.map, normalMap: kit.iron.bumpNormal, normalScale: new THREE.Vector2(0.7, 0.7), color: 0x2a2b2e, roughness: 0.62, metalness: 0.55 });
  M.polymer = new THREE.MeshStandardMaterial({ map: kit.iron.map, normalMap: kit.iron.bumpNormal, normalScale: new THREE.Vector2(1.1, 1.1), color: 0x141517, roughness: 0.78, metalness: 0.12 });
  M.poly2 = new THREE.MeshStandardMaterial({ map: kit.iron.map, normalMap: kit.iron.bumpNormal, normalScale: new THREE.Vector2(0.9, 0.9), color: 0x1d1f21, roughness: 0.68, metalness: 0.2 });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.92 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.5, metalness: 0.4 });
  M.barrel = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.42, metalness: 0.7 });
  // scope lens: a cheap tinted glass look (transmission would re-render the whole
  // scene through the transmission pass and tank the frame rate)
  M.glass = new THREE.MeshStandardMaterial({
    color: 0x21404c, roughness: 0.1, metalness: 0.85,
    transparent: true, opacity: 0.78, emissive: 0x0b1a20, emissiveIntensity: 0.6,
  });
  M.blade = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.18, metalness: 0.95 });
  M.glove = new THREE.MeshStandardMaterial({ map: kit.tyre.map, normalMap: kit.tyre.bumpNormal, color: 0x24242a, roughness: 0.82 });
  M.sleeve = new THREE.MeshStandardMaterial({ map: kit.camoAlpha.map, normalMap: kit.camoAlpha.bumpNormal, roughness: 0.95, color: 0xbfb79a });
  M.band = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.85 });
  M.wood = new THREE.MeshStandardMaterial({ map: kit.wood.map, normalMap: kit.wood.bumpNormal, color: 0x7a6a4e, roughness: 0.72 });
  M.frag = new THREE.MeshStandardMaterial({ map: kit.metal.map, color: 0x3d4a30, roughness: 0.7, metalness: 0.35 });
  M.leather = new THREE.MeshStandardMaterial({ map: kit.wood.map, color: 0x4a3a28, roughness: 0.85 });
  return M;
}

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
const B = (w, h, d, rep = 0.35) => boxGeo(w, h, d, rep);

function tube(parent, r1, r2, len, mat, x, y, z, rx = Math.PI / 2) {
  const g = new THREE.CylinderGeometry(r1, r2, len, 12, 1, false);
  projectUV(g, 0.3);
  return part(parent, g, mat, x, y, z, rx, 0, 0);
}

// ── gloved hands (a forearm + glove per side) ──
function hand(kit, side = 1) {
  const g = new THREE.Group();
  const m = mats(kit);
  const s = side;   // 1 = right, -1 = left
  // glove
  const glove = part(g, B(0.085, 0.075, 0.13, 0.2), m.glove, 0, 0, 0);
  part(g, B(0.09, 0.03, 0.055, 0.2), m.glove, 0, 0.036 * 0 + 0.012, -0.055, 0.25, 0, 0);   // fingers
  part(g, B(0.028, 0.06, 0.09, 0.2), m.glove, s * 0.055, 0.01, -0.02, 0, 0, 0);            // thumb
  // wristband
  part(g, B(0.1, 0.085, 0.045, 0.2), m.band, 0, 0, 0.085);
  // sleeve
  const sleeve = part(g, B(0.115, 0.1, 0.26, 0.4), m.sleeve, 0, -0.004, 0.24);
  sleeve.scale.set(1, 1, 1);
  part(g, B(0.125, 0.11, 0.09, 0.4), m.sleeve, 0, -0.004, 0.14, 0.05, 0, 0);
  return g;
}

function hands(kit, parent, rightPos, leftPos) {
  const r = hand(kit, 1), l = hand(kit, -1);
  r.position.set(rightPos[0], rightPos[1], rightPos[2]);
  r.rotation.set(rightPos[3] || 0, rightPos[4] || 0, rightPos[5] || 0);
  l.position.set(leftPos[0], leftPos[1], leftPos[2]);
  l.rotation.set(leftPos[3] || 0, leftPos[4] || 0, leftPos[5] || 0);
  parent.add(r, l);
  return { right: r, left: l };
}

// ── muzzle flash rig shared by every gun ──
let _flashTex = null;
function flashTex() {
  if (_flashTex) return _flashTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,245,1)');
  g.addColorStop(0.18, 'rgba(255,236,180,0.92)');
  g.addColorStop(0.42, 'rgba(255,170,60,0.45)');
  g.addColorStop(0.72, 'rgba(220,110,20,0.14)');
  g.addColorStop(1, 'rgba(160,60,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  // hot streaks (4-point star, horizontal dominate)
  c.globalCompositeOperation = 'lighter';
  const st = c.createLinearGradient(0, 64, 128, 64);
  st.addColorStop(0, 'rgba(255,210,120,0)');
  st.addColorStop(0.5, 'rgba(255,245,210,0.75)');
  st.addColorStop(1, 'rgba(255,210,120,0)');
  c.fillStyle = st;
  c.fillRect(0, 58, 128, 12);
  const st2 = c.createLinearGradient(64, 0, 64, 128);
  st2.addColorStop(0, 'rgba(255,190,90,0)');
  st2.addColorStop(0.5, 'rgba(255,230,170,0.5)');
  st2.addColorStop(1, 'rgba(255,190,90,0)');
  c.fillStyle = st2;
  c.fillRect(58, 0, 12, 128);
  _flashTex = new THREE.CanvasTexture(cv);
  return _flashTex;
}

function flashRig(kit, parent, z, scale = 1) {
  const g = new THREE.Group();
  g.position.z = z;
  const tex = flashTex();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.06 * scale, 0.26 * scale, 9, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xffa53a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  cone.rotation.x = Math.PI / 2;
  cone.position.z = -0.12 * scale;
  g.add(cone);
  const star = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42 * scale, 0.42 * scale),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xfff0c4, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  star.position.z = -0.02 * scale;
  g.add(star);
  const star2 = star.clone();
  star2.rotation.z = Math.PI / 2;
  star2.scale.setScalar(0.62);
  star2.position.z = -0.03 * scale;
  g.add(star2);
  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(0.1 * scale, 6, 5),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xbfb6a6, transparent: true, opacity: 0, depthWrite: false }),
  );
  smoke.position.z = -0.18 * scale;
  g.add(smoke);
  const light = new THREE.PointLight(0xffc070, 0, 9, 2);
  light.position.z = -0.06;
  g.add(light);
  g.userData = { cone, star, star2, smoke, light, scale };
  g.visible = false;
  parent.add(g);
  return g;
}

// ═══════════════ models ═══════════════

function baseRig(kit, name) {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

/** M4A1 — flat-top receiver, quad rail, front sight post, collapsible stock */
export function buildM4A1(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'm4a1');
  part(g, B(0.052, 0.075, 0.3, 0.4), m.iron, 0, 0, -0.06);                 // upper receiver
  part(g, B(0.05, 0.062, 0.2, 0.4), m.polymer, 0, -0.005, 0.06);           // lower receiver
  part(g, B(0.03, 0.045, 0.05, 0.2), m.metal, 0, 0.052, -0.03);            // charging handle
  part(g, B(0.048, 0.05, 0.24, 0.4), m.poly2, 0, -0.002, -0.31);           // handguard
  for (let i = 0; i < 6; i++) part(g, B(0.052, 0.012, 0.02, 0.2), m.iron, 0, 0.028, -0.23 - i * 0.037);   // rail
  part(g, B(0.02, 0.055, 0.03, 0.2), m.iron, 0, 0.055, -0.2);              // front sight post
  part(g, B(0.038, 0.014, 0.02, 0.2), m.iron, 0, 0.032, -0.2);             // front sight wings
  part(g, B(0.036, 0.048, 0.05, 0.2), m.iron, 0, 0.052, 0.05);             // rear sight block
  part(g, B(0.028, 0.014, 0.03, 0.2), m.dark, 0, 0.062, 0.055);            // aperture
  tube(g, 0.011, 0.011, 0.24, m.barrel, 0, 0.005, -0.5);
  tube(g, 0.014, 0.014, 0.06, m.dark, 0, 0.005, -0.64);                    // muzzle device
  const mag = part(g, B(0.036, 0.16, 0.075, 0.3), m.poly2, 0, -0.11, 0.02, 0.28, 0, 0);
  mag.geometry.translate(0, -0.02, 0);
  part(g, B(0.03, 0.075, 0.035, 0.3), m.polymer, 0, -0.06, 0.035, 0.12, 0, 0);   // pistol grip
  part(g, B(0.045, 0.075, 0.19, 0.4), m.poly2, 0, -0.012, 0.23);                 // stock
  part(g, B(0.05, 0.09, 0.03, 0.3), m.polymer, 0, -0.02, 0.33);                  // butt pad
  part(g, B(0.012, 0.026, 0.02, 0.2), m.metal, 0, 0.03, -0.11);                  // ejection port
  const eject = new THREE.Object3D(); eject.position.set(0.05, 0.02, -0.1); g.add(eject);
  const h = hands(kit, g, [0.022, -0.075, 0.075, 0.15, -0.1, 0], [-0.03, -0.045, -0.3, 0.1, 0.25, 0.2]);
  return finish(kit, g, { muzzleZ: -0.7, aim: { x: 0, y: -0.062, z: 0.05 }, eject, mag, hands: h, sightH: 0.062 });
}

/** MP5 — matte black, hooded front sight, curved mag, rear diopter drum */
export function buildMP5(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'mp5');
  const body = tube(g, 0.032, 0.032, 0.42, m.iron, 0, 0, -0.02);           // tubular receiver
  body.rotation.x = Math.PI / 2;
  part(g, B(0.05, 0.055, 0.3, 0.4), m.poly2, 0, -0.012, -0.1);
  // hooded front sight: ring + post
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 6, 14), m.iron);
  hood.position.set(0, 0.042, -0.24);
  g.add(hood);
  part(g, B(0.008, 0.03, 0.008, 0.15), m.iron, 0, 0.038, -0.24);
  // rear diopter drum
  const drum = tube(g, 0.022, 0.022, 0.02, m.iron, 0, 0.042, 0.06, 0);
  drum.rotation.set(0, 0, Math.PI / 2);
  part(g, B(0.03, 0.02, 0.03, 0.2), m.iron, 0, 0.035, 0.06);
  // curved magazine
  const mag = new THREE.Group();
  mag.position.set(0, -0.075, -0.06);
  g.add(mag);
  for (let i = 0; i < 5; i++) {
    const seg = part(mag, B(0.036, 0.036, 0.06, 0.25), m.poly2, 0, -i * 0.033, -i * i * 0.0065, 0.24 * i, 0, 0);
  }
  part(g, B(0.028, 0.07, 0.032, 0.3), m.polymer, 0, -0.055, 0.06, 0.16, 0, 0);      // grip
  part(g, B(0.04, 0.055, 0.16, 0.4), m.poly2, 0, -0.008, 0.2);                       // stock
  part(g, B(0.044, 0.08, 0.025, 0.3), m.polymer, 0, -0.016, 0.29);
  tube(g, 0.012, 0.012, 0.16, m.barrel, 0, 0, -0.36);
  part(g, B(0.045, 0.03, 0.16, 0.4), m.poly2, 0, -0.008, -0.3);                      // handguard
  const eject = new THREE.Object3D(); eject.position.set(0.04, 0.03, -0.05); g.add(eject);
  const h = hands(kit, g, [0.02, -0.07, 0.1, 0.14, -0.12, 0], [-0.032, -0.05, -0.29, 0.06, 0.28, 0.22]);
  return finish(kit, g, { muzzleZ: -0.44, aim: { x: 0, y: -0.038, z: 0.06 }, eject, mag, hands: h, sightH: 0.042 });
}

/** M1014 — heavy barrel + heat shield, top rail, polymer forend, raised irons */
export function buildM1014(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'm1014');
  tube(g, 0.026, 0.026, 0.5, m.barrel, 0, 0.012, -0.18);
  tube(g, 0.031, 0.031, 0.34, m.iron, 0, 0.012, -0.24);                  // heat shield
  for (let i = 0; i < 7; i++) part(g, B(0.07, 0.014, 0.012, 0.15), m.iron, 0, 0.042, -0.08 - i * 0.045);
  part(g, B(0.06, 0.075, 0.26, 0.4), m.iron, 0, 0.004, 0.06);            // receiver
  part(g, B(0.075, 0.05, 0.16, 0.4), m.poly2, 0, -0.02, -0.12);          // polymer forend
  part(g, B(0.02, 0.03, 0.02, 0.15), m.iron, 0, 0.062, -0.3);            // raised front sight
  part(g, B(0.034, 0.014, 0.02, 0.15), m.iron, 0, 0.075, -0.3);
  part(g, B(0.03, 0.03, 0.02, 0.15), m.iron, 0, 0.058, 0.16);            // rear ghost ring
  part(g, B(0.028, 0.07, 0.035, 0.3), m.polymer, 0, -0.062, 0.05, 0.14, 0, 0);
  part(g, B(0.05, 0.08, 0.2, 0.4), m.poly2, 0, -0.012, 0.24);
  part(g, B(0.055, 0.095, 0.03, 0.3), m.polymer, 0, -0.02, 0.34);
  tube(g, 0.014, 0.014, 0.42, m.iron, 0, -0.03, -0.22);                  // tube magazine
  const mag = new THREE.Group(); mag.position.set(0, -0.02, -0.05); g.add(mag);
  const eject = new THREE.Object3D(); eject.position.set(0.06, 0.02, 0.0); g.add(eject);
  const h = hands(kit, g, [0.025, -0.085, 0.085, 0.18, -0.1, 0], [-0.04, -0.06, -0.2, 0.12, 0.3, 0.25]);
  return finish(kit, g, { muzzleZ: -0.48, aim: { x: 0, y: -0.062, z: 0.16 }, eject, mag, hands: h, sightH: 0.075 });
}

/** L96A1 — long barrel, big scope, bolt handle, thumbhole chassis */
export function buildL96A1(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'l96a1');
  part(g, B(0.05, 0.075, 0.44, 0.4), m.poly2, 0, -0.005, -0.06);          // chassis body
  tube(g, 0.016, 0.018, 0.62, m.barrel, 0, 0.012, -0.44);
  part(g, B(0.03, 0.03, 0.07, 0.2), m.dark, 0, 0.012, -0.76);            // muzzle brake
  part(g, B(0.05, 0.055, 0.14, 0.3), m.poly2, 0, -0.02, 0.16, -0.06, 0, 0);
  part(g, B(0.045, 0.07, 0.2, 0.4), m.polymer, 0, -0.03, 0.3);           // buttstock
  part(g, B(0.05, 0.05, 0.04, 0.3), m.band, 0, -0.035, 0.4);             // cheek rest
  part(g, B(0.016, 0.06, 0.02, 0.15), m.metal, 0.032, 0.005, 0.05, 0, 0, -0.5);  // bolt handle
  part(g, B(0.024, 0.024, 0.03, 0.15), m.metal, 0.046, -0.01, 0.05);
  // scope
  const scope = new THREE.Group();
  scope.position.set(0, 0.062, -0.06);
  g.add(scope);
  tube(scope, 0.026, 0.026, 0.34, m.dark, 0, 0, 0);
  tube(scope, 0.034, 0.03, 0.05, m.dark, 0, 0, -0.17);                   // objective
  tube(scope, 0.03, 0.034, 0.05, m.dark, 0, 0, 0.17);                    // eyepiece
  part(scope, new THREE.CircleGeometry(0.028, 16), m.glass, 0, 0, -0.19, 0, Math.PI, 0);
  part(scope, new THREE.CircleGeometry(0.026, 16), m.glass, 0, 0, 0.196);
  tube(scope, 0.014, 0.014, 0.03, m.dark, 0, 0.03, 0, 0, 0, Math.PI / 2); // turret
  tube(scope, 0.012, 0.012, 0.03, m.dark, 0.03, 0, 0, 0, 0, Math.PI / 2);
  for (const z of [-0.06, 0.06]) part(g, B(0.03, 0.05, 0.02, 0.15), m.metal, 0, 0.036, z);   // rings
  // folded bipod
  part(g, B(0.012, 0.012, 0.2, 0.2), m.metal, 0.03, -0.03, -0.3, 0.2, 0, 0);
  part(g, B(0.012, 0.012, 0.2, 0.2), m.metal, -0.03, -0.03, -0.3, 0.2, 0, 0);
  part(g, B(0.028, 0.07, 0.035, 0.3), m.polymer, 0, -0.062, 0.1, 0.1, 0, 0);
  const mag = part(g, B(0.036, 0.07, 0.09, 0.3), m.poly2, 0, -0.055, -0.05);
  const eject = new THREE.Object3D(); eject.position.set(0.05, 0.02, 0.0); g.add(eject);
  const h = hands(kit, g, [0.024, -0.085, 0.12, 0.16, -0.1, 0], [-0.05, -0.06, -0.25, 0.1, 0.32, 0.3]);
  return finish(kit, g, { muzzleZ: -0.82, aim: { x: 0, y: -0.02, z: -0.03 }, eject, mag, hands: h, sightH: 0.062, scope });
}

/** M9 — slide, exposed hammer, polymer frame */
export function buildM9(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'm9');
  part(g, B(0.032, 0.045, 0.2, 0.3), m.iron, 0, 0.028, -0.05);           // slide
  part(g, B(0.03, 0.038, 0.17, 0.3), m.polymer, 0, -0.008, -0.04);       // frame
  tube(g, 0.008, 0.008, 0.06, m.barrel, 0, 0.026, -0.16);
  part(g, B(0.012, 0.016, 0.02, 0.15), m.dark, 0, 0.048, -0.13);         // front sight
  part(g, B(0.022, 0.018, 0.02, 0.15), m.dark, 0, 0.05, 0.03);           // rear sight
  part(g, B(0.028, 0.02, 0.028, 0.15), m.metal, 0, 0.03, 0.06);          // hammer
  part(g, B(0.03, 0.09, 0.042, 0.3), m.polymer, 0, -0.05, -0.005, 0.16, 0, 0);   // grip
  part(g, B(0.028, 0.09, 0.03, 0.3), m.poly2, 0, -0.05, -0.02, 0.16, 0, 0);      // magazine in grip
  part(g, B(0.026, 0.05, 0.02, 0.2), m.iron, 0, 0.012, 0.05, -0.2, 0, 0);        // trigger guard
  const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.01); g.add(mag);
  const eject = new THREE.Object3D(); eject.position.set(0.03, 0.04, -0.05); g.add(eject);
  const h = hands(kit, g, [0.018, -0.06, 0.06, 0.16, -0.1, 0], [-0.03, -0.05, -0.06, 0.2, 0.4, 0.3]);
  return finish(kit, g, { muzzleZ: -0.22, aim: { x: 0, y: -0.026, z: 0.04 }, eject, mag, hands: h, sightH: 0.05 });
}

/** combat knife */
export function buildKnife(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'knife');
  part(g, B(0.01, 0.032, 0.2, 0.2), m.blade, 0, 0.01, -0.13);
  part(g, B(0.006, 0.05, 0.03, 0.2), m.blade, 0, 0.01, -0.03);
  part(g, B(0.018, 0.022, 0.1, 0.2), m.leather, 0, 0, 0.03);
  part(g, B(0.024, 0.028, 0.02, 0.2), m.dark, 0, 0, -0.02);
  part(g, B(0.02, 0.05, 0.02, 0.2), m.metal, 0, -0.01, -0.11);
  const h = hands(kit, g, [0.008, -0.02, 0.06, 0.3, -0.2, 0.1], [-0.04, -0.05, 0.02, 0.4, 0.5, 0.5]);
  return finish(kit, g, { muzzleZ: -0.2, aim: { x: 0, y: -0.02, z: 0.02 }, eject: new THREE.Object3D(), mag: new THREE.Object3D(), hands: h, melee: true });
}

/** frag grenade in the right hand */
export function buildGrenade(kit) {
  const m = mats(kit);
  const g = baseRig(kit, 'grenade');
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), m.frag);
  body.scale.set(1, 1.2, 1);
  g.add(body);
  part(g, B(0.03, 0.02, 0.03, 0.1), m.metal, 0, 0.068, 0);
  const lever = part(g, B(0.016, 0.012, 0.09, 0.1), m.metal, 0, 0.062, 0.04, 0.4, 0, 0);
  const pin = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 5, 10), m.metal);
  pin.position.set(0.03, 0.07, -0.005);
  g.add(pin);
  const h = hands(kit, g, [0.01, -0.05, 0.02, 0.4, -0.3, 0.1], [-0.06, -0.09, 0.04, 0.5, 0.4, 0.4]);
  return finish(kit, g, { muzzleZ: -0.1, aim: { x: 0, y: 0, z: 0 }, eject: new THREE.Object3D(), mag: lever, hands: h, throwable: true });
}

function finish(kit, g, o) {
  // muzzle + flash
  const muzzle = new THREE.Object3D();
  muzzle.position.z = o.muzzleZ;
  g.add(muzzle);
  const flash = flashRig(kit, g, o.muzzleZ, o.scope ? 1.4 : (o.melee ? 0 : 1));
  // rear furniture (stock, butt pad, sleeves) is clipped out of the frame while
  // aiming down the sights, exactly like a cheek-welded rifle in a real FPS
  g.updateMatrixWorld(true);
  const rear = [];
  const tmp = new THREE.Vector3();
  g.traverse(n => {
    if (!n.isMesh) return;
    n.getWorldPosition(tmp);
    if (tmp.z > 0.105) { n.userData.rear = true; rear.push(n); }
  });
  g.userData = {
    aim: o.aim, muzzleZ: o.muzzleZ, eject: o.eject, mag: o.mag, hands: o.hands,
    flash, scope: o.scope || null, melee: !!o.melee, throwable: !!o.throwable, muzzle,
    rear, rearHidden: false,
  };
  g.traverse(n => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; n.frustumCulled = false; } });
  return g;
}

export const BUILDERS = {
  m4a1: buildM4A1, mp5: buildMP5, m1014: buildM1014, l96a1: buildL96A1,
  m9: buildM9, knife: buildKnife, grenade: buildGrenade,
};

export function buildWeaponView(kit, id) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error('no viewmodel for ' + id);
  return fn(kit);
}
