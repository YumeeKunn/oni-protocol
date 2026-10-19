// ═══════════════ MAP — "SIDI BOU ALI" ═══════════════
// A 104 × 104 m three-lane arena:
//   south  · ALPHA BASE        desert motor pool, sandbags, palms
//   centre · SOUK SIDI BOU ALI Mediterranean town — plaza, alleys, minaret
//   west   · CONVOY ROAD       dunes, trucks, concrete barriers, watchtower
//   east   · INDUSTRIAL DEPOT  corrugated sheds, containers, forklifts, tyres
//   north  · BRAVO BASE        yard, containers, tents, watchtower
import * as THREE from 'three';
import { archGeo, barrierGeo, boxGeo, domeGeo, latheGeo } from '../core/geo.js';
import { rand, pick, chance, deg } from '../core/utils.js';
import {
  crate, crateStack, barrel, tyreStack, wasteBin, pallet, pots, shrub,
  townhouse, awning, awningRow, acUnit, downspout, streetLamp, wire, marketStall,
  fruitCart, hangingSign, mosque, shed, container, shelfRack, forklift,
  sandbagWall, jerseyLine, tent, truck, watchtower, palm, bush, rockCluster,
  flagpole, waterTower, stairway,
} from './props.js';

export const MAP_NAME = 'SIDI BOU ALI';
export const ARENA_HALF = 52;

// ── terrain heightfield: flat town, soft dunes on the outskirts ──
const DUNES = [
  { x: -47, z: 30, r: 17, a: 3.0 },
  { x: -45, z: -32, r: 15, a: 2.4 },
  { x: 47, z: 36, r: 16, a: 2.8 },
  { x: 45, z: -34, r: 14, a: 2.2 },
  { x: -51, z: 0, r: 13, a: 1.5 },
  { x: 51, z: 2, r: 12, a: 1.4 },
  { x: -22, z: 47, r: 15, a: 1.9 },
  { x: 24, z: 48, r: 14, a: 1.7 },
  { x: -24, z: -48, r: 15, a: 1.8 },
  { x: 26, z: -48, r: 14, a: 1.6 },
];

export function groundHeight(x, z) {
  // flat apron inside the built-up band, dunes only on the outskirts
  const inner = Math.max(0, Math.min(1, (Math.max(Math.abs(x) * 0.78, Math.abs(z)) - 26) / 16));
  if (inner <= 0) return 0;
  let h = 0;
  for (const d of DUNES) {
    const dx = x - d.x, dz = z - d.z;
    const q = (dx * dx + dz * dz) / (d.r * d.r);
    if (q < 4) h += d.a * Math.exp(-q * 1.6);
  }
  // ripple detail
  h += Math.sin(x * 0.32) * Math.cos(z * 0.27) * 0.16;
  return h * inner;
}

export function buildMap(B) {
  const S = { alpha: [], bravo: [] };

  // ═════════════ ground: roads, plaza, aprons ═════════════
  groundPass(B);

  // ═════════════ town: SOUK SIDI BOU ALI ═════════════
  const town = townPass(B);

  // ═════════════ west: convoy road + dunes ═════════════
  convoyPass(B);

  // ═════════════ east: industrial depot ═════════════
  depotPass(B);

  // ═════════════ south: alpha base ═════════════
  alphaPass(B, S.alpha);

  // ═════════════ north: bravo base ═════════════
  bravoPass(B, S.bravo);

  // ═════════════ perimeter: cliffs, walls, out of bounds ═════════════
  perimeterPass(B);

  return {
    name: MAP_NAME,
    zones: B.zones,
    spawns: S,
    colliders: B.colliders,
    bounds: ARENA_HALF,
  };
}

// ═══════════════════════════════════════════════════════════════
function groundPass(B) {
  // compacted dirt approach roads
  B.pad(15, 92, 'sand', 0, 46, 0.015, { rep: 3.2, matOpts: { color: 0xb5a279 } });
  B.pad(15, 92, 'sand', 0, -46, 0.015, { rep: 3.2, matOpts: { color: 0xb5a279 } });
  B.pad(14, 104, 'sand', -43, 0, 0.014, { rep: 3.4, matOpts: { color: 0xb0a077 } });
  B.pad(14, 104, 'sand', 43, 0, 0.014, { rep: 3.4, matOpts: { color: 0xb0a077 } });
  // 4-way plaza apron
  B.pad(30, 30, 'concrete', 0, 0, 0.016, { rep: 3.6, matOpts: { color: 0xc0b8a4 } });

  // main road (asphalt) through the town, interrupted by the souk plaza
  B.pad(12, 30, 'asphalt', 0, 38, 0.02, { rep: 3.2 });
  B.pad(12, 30, 'asphalt', 0, -38, 0.02, { rep: 3.2 });
  // cobbled souk plaza + alleys
  B.pad(46, 46, 'cobble', 0, 0, 0.03, { rep: 3.0 });
  B.pad(20, 8, 'cobble', -40, 0, 0.028, { rep: 3.0 });
  B.pad(20, 8, 'cobble', 40, 0, 0.028, { rep: 3.0 });
  B.pad(10, 26, 'cobble', -30, 18, 0.026, { rep: 3.0 });
  B.pad(10, 26, 'cobble', 30, -18, 0.026, { rep: 3.0 });
  B.pad(10, 26, 'cobble', -30, -18, 0.026, { rep: 3.0 });
  B.pad(10, 26, 'cobble', 30, 18, 0.026, { rep: 3.0 });
  // painted road lines on the approach
  for (let i = 0; i < 8; i++) {
    B.pad(0.4, 2.4, 'concrete', 0, 30 + i * 3.0, 0.05, { rep: 1, matOpts: { color: 0xd8d2be, roughness: 0.8 } });
    B.pad(0.4, 2.4, 'concrete', 0, -30 - i * 3.0, 0.05, { rep: 1, matOpts: { color: 0xd8d2be, roughness: 0.8 } });
  }
}

// ═══════════════════════════════════════════════════════════════
function townPass(B) {
  // ── blocks around the plaza ──
  // facing the square: doorFace 0:+z 1:+x 2:-z 3:-x
  const west = [
    { x: -26, z: -13, w: 10, d: 9, floors: 2, o: { roof: 'tile', shopfront: true } },
    { x: -26, z: -2, w: 10, d: 9, floors: 2, o: { shopfront: true, balcony: { floor: 1, face: 1 } } },
    { x: -26, z: 9, w: 10, d: 9, floors: 3, o: { roof: 'tile', shopfront: true, balcony: { floor: 1, face: 1 } } },
  ];
  const east = [
    { x: 26, z: -13, w: 10, d: 9, floors: 3, o: { roof: 'tile', shopfront: true, balcony: { floor: 1, face: 3 } } },
    { x: 26, z: -2, w: 10, d: 9, floors: 2, o: { shopfront: true } },
    { x: 26, z: 9, w: 10, d: 9, floors: 2, o: { roof: 'tile', shopfront: true, balcony: { floor: 1, face: 3 } } },
  ];
  const north = [
    { x: -31, z: -25, w: 10, d: 9, floors: 2, o: { roof: 'tile' } },
    { x: -14, z: -25, w: 12, d: 9, floors: 3, o: { balcony: { floor: 1, face: 0 }, shopfront: true, roof: 'tile' } },
    { x: 13, z: -25, w: 12, d: 9, floors: 2, o: { shopfront: true } },
    { x: 31, z: -25, w: 10, d: 9, floors: 2, o: { roof: 'tile', balcony: { floor: 1, face: 0 } } },
  ];
  const south = [
    { x: -31, z: 25, w: 10, d: 9, floors: 2, o: { roof: 'tile', balcony: { floor: 1, face: 2 } } },
    { x: -14, z: 25, w: 12, d: 9, floors: 2, o: { shopfront: true, roof: 'tile' } },
    { x: 13, z: 25, w: 12, d: 9, floors: 3, o: { balcony: { floor: 1, face: 2 }, shopfront: true } },
    { x: 31, z: 25, w: 10, d: 9, floors: 2, o: { roof: 'tile' } },
  ];
  const all = [
    ...west.map(h => ({ ...h, doorFace: 1 })),
    ...east.map(h => ({ ...h, doorFace: 3 })),
    ...north.map(h => ({ ...h, doorFace: 0 })),
    ...south.map(h => ({ ...h, doorFace: 2 })),
  ];
  const built = [];
  for (const h of all) {
    const r = townhouse(B, h.x, h.z, { w: h.w, d: h.d, floors: h.floors, doorFace: h.doorFace, ...h.o });
    built.push(r);
    // roof clutter + shadow line
    B.prop(boxGeo(1.2, 0.5, 1.2, 1.4), 'concrete', h.x + rand(-2, 2), h.floors * 3.4 + 0.3, h.z + rand(-2, 2), rand(0, 3), { matOpts: { color: 0x9a927e } });
    if (chance(0.6)) B.prop(new THREE.CylinderGeometry(0.34, 0.34, 0.6, 9), 'metalRust', h.x + rand(-3, 3), h.floors * 3.4 + 0.3, h.z + rand(-3, 3), 0, { matOpts: { color: 0x6d5f4a } });
  }

  // shop awnings facing the plaza
  awningRow(B, -21, -13, 9, Math.PI / 2, { y: 3.0 });
  awningRow(B, -21, -2, 9, Math.PI / 2, { y: 3.0 });
  awningRow(B, -21, 9, 9, Math.PI / 2, { y: 3.0 });
  awningRow(B, 21, -13, 9, -Math.PI / 2, { y: 3.0 });
  awningRow(B, 21, -2, 9, -Math.PI / 2, { y: 3.0 });
  awningRow(B, 21, 9, 9, -Math.PI / 2, { y: 3.0 });
  awningRow(B, -14, 20.5, 10, 0, { y: 3.0 });
  awningRow(B, 13, 20.5, 10, 0, { y: 3.0 });
  awningRow(B, -14, -20.5, 10, Math.PI, { y: 3.0 });
  awningRow(B, 13, -20.5, 10, Math.PI, { y: 3.0 });

  // hanging shop signs + AC units + downspouts
  hangingSign(B, -21.4, 2.9, -13, 'SOUK', Math.PI / 2);
  hangingSign(B, -21.4, 2.9, -2, 'CAFÉ', Math.PI / 2);
  hangingSign(B, 21.4, 2.9, 9, 'POTERIE', -Math.PI / 2);
  hangingSign(B, -14, 2.9, 20.6, 'TAPIS', 0);
  hangingSign(B, 13, 2.9, -20.6, 'ÉPICES', Math.PI);
  for (const h of all) {
    const [dx, dz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][h.doorFace];
    const px = h.x + (dx ? dx * (h.w / 2 + 0.24) : h.w / 2 - 0.7);
    const pz = h.z + (dz ? dz * (h.d / 2 + 0.24) : h.d / 2 - 0.7);
    acUnit(B, px, 2.6, pz, dx ? dx * Math.PI / 2 : (dz > 0 ? 0 : Math.PI));
    if (chance(0.7)) downspout(B, h.x + (dx ? dx * (h.w / 2 - 0.4) : -h.w / 2 + 0.5), h.z + (dz ? dz * (h.d / 2 - 0.4) : -h.d / 2 + 0.5), h.floors * 3.4);
  }

  // overhead arches (the town gates) + a covered passage
  const gate = (x, z, yaw) => {
    const g = archGeo(22, 6.6, 8.4, 5.6, 1.1, 1.6);
    const m = B.prop(g, 'stucco', x, 0, z, yaw, { matOpts: { color: 0xd9cdae } });
    B.solid(x - 7.6, 3.3, z, 3.4, 3.3, 0.55, 0, 'stone');
    B.solid(x + 7.6, 3.3, z, 3.4, 3.3, 0.55, 0, 'stone');
    B.prop(boxGeo(24, 0.3, 1.5, 1.6), 'stucco', x, 6.9, z, yaw, { cast: false, matOpts: { color: 0xcdc0a0 } });
  };
  gate(0, 22.5, 0);
  gate(0, -22.5, 0);

  // souk square dressing
  marketStall(B, -7.5, 3.5, deg(12));
  marketStall(B, -7.0, -3.0, deg(-8));
  marketStall(B, 7.4, 3.0, deg(190));
  marketStall(B, 7.2, -3.6, deg(175));
  fruitCart(B, -3.4, 8.5, deg(20));
  fruitCart(B, 4.0, -8.0, deg(200));
  pots(B, -12.5, -12.0, 4);
  pots(B, 12.4, 12.2, 4);
  pots(B, -11.8, 12.6, 3);
  streetLamp(B, -16, 16, Math.PI, 5.4);
  streetLamp(B, 16, 16, Math.PI * 0.75, 5.4);
  streetLamp(B, 16, -16, -Math.PI / 2, 5.4);
  streetLamp(B, -16, -16, 0, 5.4);
  streetLamp(B, -3.6, 32, Math.PI * 0.92, 5.6);
  streetLamp(B, 3.6, -32, -0.22, 5.6);
  // main road clutter (cover)
  jerseyLine(B, -4.6, 31, 5, 0);
  jerseyLine(B, 4.6, -31, 5, 0);
  crateStack(B, -8.6, 27, 3);
  crateStack(B, 8.4, -27, 2);
  pallet(B, 6.5, 30, 0.4);
  pallet(B, -6.6, -30, 2.1);
  barrel(B, 9.5, 28);
  barrel(B, 10.2, 27.4);
  barrel(B, -9.4, -28.6);
  // plaza centre: fountain + palms
  fountain(B, 0, 1.5);
  palm(B, -17.5, 19.5, { h: 8.4 });
  palm(B, 17.6, 19.2, { h: 7.6, bend: 0.4 });
  palm(B, -17.2, -19.4, { h: 8.0, bend: -0.3 });
  palm(B, 17.4, -19.6, { h: 8.8 });
  bush(B, -19.5, 6, 1.5);
  bush(B, 19.6, -6.5, 1.4);
  bush(B, -6.4, 19.4, 1.3);

  // alleys between blocks — crates as choke cover
  crateStack(B, -23.5, -20.5, 3);
  crateStack(B, -23.2, 20.4, 2);
  crateStack(B, 22.4, -20.6, 2);
  crateStack(B, 22.6, 20.2, 3);
  barrel(B, -23.6, 5.0);
  barrel(B, 23.4, -5.0);
  tyreStack(B, -23.8, 14.0, 3);
  tyreStack(B, 23.6, -14.0, 3);
  wasteBin(B, -23.4, -8.0);
  wasteBin(B, 23.3, 8.0);

  // stairway to a rooftop perch on the west block
  stairway(B, -35.6, -6, { steps: 20, rise: 0.36, run: 0.42, w: 1.5, yaw: Math.PI / 2, dir: -1, mat: 'stucco' });
  const roofPerch = new THREE.Vector3(-26, 6.8, -7.5);
  B.prop(boxGeo(3.0, 0.25, 2.0, 1.6), 'concrete', roofPerch.x, roofPerch.y - 0.2, roofPerch.z, 0, { matOpts: { color: 0xb3aa96 } });
  sandbagWall(B, -26, -8.4, 3.2, 0, 2);
  sandbagWall(B, -24.6, -7.5, 3.2, Math.PI / 2, 2);
  // and a stair up to the south block terrace
  stairway(B, 35.4, 25, { steps: 20, rise: 0.36, run: 0.42, w: 1.5, yaw: Math.PI / 2, dir: -1, mat: 'stucco' });
  sandbagWall(B, 31, 26.6, 3.2, 0, 2);

  // power lines across the square and alleys
  wire(B, -21.2, 5.6, -13, -21.2, 5.4, 9, 0.7);
  wire(B, 21.2, 5.6, -13, 21.2, 5.4, 9, 0.7);
  wire(B, -14, 6.9, -20.4, 13, 6.9, -20.4, 1.1);
  wire(B, -31, 6.9, 20.4, 31, 6.9, 20.4, 1.4);
  wire(B, -21.2, 5.4, -13, -35, 5.0, -20, 0.8);
  wire(B, 21.2, 5.4, 13, 35, 4.8, 20, 0.8);

  // minaret / mosque as the east landmark (mirrors the reference screenshot)
  mosque(B, 25, -25);

  return built;
}

function fountain(B, x, z) {
  const r = 2.6;
  B.prop(latheGeo([[0, 0], [r, 0], [r, 0.55], [r - 0.3, 0.55], [r - 0.3, 0.1], [0, 0.1]], 16, 1.2), 'concrete', x, 0, z, 0, { matOpts: { color: 0xc8bfa8 } });
  B.prop(new THREE.CircleGeometry(r - 0.35, 20).rotateX(-Math.PI / 2), 'metal', x, 0.16, z, 0, { cast: false, matOpts: { color: 0x2e5a63, roughness: 0.12, metal: 0.25, transparent: true, opacity: 0.86 } });
  B.prop(new THREE.CylinderGeometry(0.34, 0.46, 1.25, 12), 'concrete', x, 0.62, z, 0, { matOpts: { color: 0xbdb49c } });
  B.prop(latheGeo([[0, 0], [0.92, 0], [0.86, 0.18], [0.3, 0.24], [0, 0.24]], 14, 1), 'concrete', x, 1.25, z, 0, { matOpts: { color: 0xc8bfa8 } });
  B.prop(new THREE.SphereGeometry(0.22, 10, 8), 'metal', x, 1.7, z, 0, { cast: false, matOpts: { color: 0xc9b06a, metal: 0.6, roughness: 0.35 } });
  B.solid(x, 0.3, z, r, 0.3, r, 0, 'stone');
}

// ═══════════════════════════════════════════════════════════════
function convoyPass(B) {
  // dunes + palms + rocks on the far west
  for (let i = 0; i < 14; i++) {
    const x = rand(-51, -38), z = rand(-50, 50);
    if (Math.abs(z) < 12 && x > -46) continue;
    palm(B, x, z, { h: rand(5.5, 9.0) });
  }
  rockCluster(B, -47, 12, 5, 2.0);
  rockCluster(B, -49, -14, 4, 1.8);
  rockCluster(B, -44, 40, 5, 2.2);
  rockCluster(B, -46, -38, 4, 1.9);
  bush(B, -38, 26, 1.6);
  bush(B, -37, -18, 1.5);

  // convoy on the dirt road
  truck(B, -43.5, -28, { yaw: deg(92), covered: true });
  truck(B, -43.0, -6, { yaw: deg(-88), covered: false });
  truck(B, -44.5, 22, { yaw: deg(86), covered: true });
  jerseyLine(B, -43, 8, 12, Math.PI / 2);
  jerseyLine(B, -43, -16, 10, Math.PI / 2);
  sandbagWall(B, -37, 34, 6.5, 0, 3);
  sandbagWall(B, -37, -34, 6.5, 0, 3);
  sandbagWall(B, -48, -2, 5.5, Math.PI / 2, 2);
  watchtower(B, -47, -24, 6.6);
  crateStack(B, -39, 14, 3);
  crateStack(B, -40.5, 15.4, 2);
  crate(B, -39.8, -12.5, { s: 1.0 });
  barrel(B, -36.5, 28);
  barrel(B, -37.2, 28.6);
  barrel(B, -36.8, 29.4);
  pallet(B, -41, 4, 1.2);
  tyreStack(B, -46, 30, 4);
  flagpole(B, -40, -44, 0xb2a06a);

  // dune-top sniper nest
  sandbagWall(B, -48, 34, 4.5, deg(30), 2);
  B.zone('CONVOY ROAD', -43, 0, 15);
  B.zone('DUNES', -47, 26, 13);
  B.zone('WEST RIDGE', -47, -26, 12);
}

// ═══════════════════════════════════════════════════════════════
function depotPass(B) {
  // corrugated perimeter + sheds
  for (let i = 0; i < 7; i++) {
    B.box(0.36, 4.6, 13.5, 'metal', 51.5, 0, -42 + i * 14, 0, { rep: 1.8, matOpts: { color: 0x6f6a5c }, tag: 'metal' });
  }
  shed(B, 45, -10, { w: 13, d: 10, h: 4.9, roofMat: 'metalRust' });
  shed(B, 43, 12, { w: 11, d: 9, h: 4.4, roofMat: 'metalRust' });
  shed(B, 44, 34, { w: 12, d: 9, h: 4.2, mat: 'metalRust', roofMat: 'metalRust' });

  container(B, 38.5, -24, 0, 0x7a4a3a);
  container(B, 38.5, -26.6, 0, 0x3f5a6b);
  container(B, 39.2, -25.3, Math.PI / 2, 0x5a6144);
  container(B, 45.5, -26, Math.PI / 2, 0x7a6a3a);
  container(B, 41, 1.5, 0, 0x6b4a52);
  container(B, 37.5, 22, 0.12, 0x4a6b5a);
  container(B, 45, 22.5, Math.PI / 2, 0x7a4a3a);
  container(B, 48.5, 6, 0, 0x5a6b7a);
  shelfRack(B, 47.5, -3.5, 0);
  shelfRack(B, 47.5, 0, 0.05);
  shelfRack(B, 36.5, 9, Math.PI / 2);
  forklift(B, 41.5, -3, 0.7);
  forklift(B, 39.5, 17, -0.5);
  tyreStack(B, 46.5, 8.5, 5);
  tyreStack(B, 47.6, 9.6, 3);
  tyreStack(B, 47.0, 9.0, 6);
  wasteBin(B, 36.4, -14.5);
  wasteBin(B, 37.3, -13.2);
  wasteBin(B, 46.2, 17.5);
  crateStack(B, 36.5, 6.0, 4);
  crateStack(B, 42.5, 20.0, 3);
  crateStack(B, 49, -18, 3);
  pallet(B, 43.5, 2.0, 0.9);
  barrel(B, 36.8, -20.5);
  barrel(B, 37.6, -19.7);
  barrel(B, 48.4, 20.0);
  waterTower(B, 48.5, -16);
  jerseyLine(B, 35.5, 0, 8, Math.PI / 2);
  jerseyLine(B, 35.5, 14, 8, Math.PI / 2);
  palm(B, 37, 30, { h: 7.4 });
  palm(B, 50, 30, { h: 8.2, bend: 0.3 });
  bush(B, 36.6, -8, 1.4);
  B.zone('DEPOT', 43, 6, 13);
  B.zone('CONTAINER YARD', 42, -24, 13);
}

// ═══════════════════════════════════════════════════════════════
function alphaPass(B, spawns) {
  // motor pool: helipad apron, tents, trucks, sandbag line, watchtower
  B.pad(16, 16, 'concrete', 0, 36, 0.02, { rep: 3.6, matOpts: { color: 0xbdb6a2 } });
  B.prop(new THREE.RingGeometry(4.6, 5.4, 28).rotateX(-Math.PI / 2), 'concrete', 0, 0.04, 36, 0, { cast: false, matOpts: { color: 0xdad3bd, roughness: 0.9 } });
  B.prop(boxGeo(0.5, 0.02, 3.6, 1), 'concrete', -0.9, 0.05, 36, 0, { cast: false, matOpts: { color: 0xdad3bd } });
  B.prop(boxGeo(0.5, 0.02, 3.6, 1), 'concrete', 0.9, 0.05, 36, 0, { cast: false, matOpts: { color: 0xdad3bd } });
  B.prop(boxGeo(2.3, 0.02, 0.5, 1), 'concrete', 0, 0.05, 36, 0, { cast: false, matOpts: { color: 0xdad3bd } });

  tent(B, -13, 44, { w: 7, d: 6, h: 2.6, yaw: deg(6), kit: 'clothSand' });
  tent(B, 13, 44, { w: 7, d: 6, h: 2.6, yaw: deg(-4), kit: 'clothSand' });
  tent(B, 19, 34, { w: 6, d: 5, h: 2.4, yaw: deg(94), kit: 'clothOlive' });
  truck(B, -17, 38, { yaw: deg(92), covered: true });
  truck(B, -17.6, 32, { yaw: deg(92), covered: false });
  truck(B, 16, 48, { yaw: deg(-6), covered: true });
  sandbagWall(B, -7, 43, 8, 0, 3);
  sandbagWall(B, 7, 43, 8, 0, 3);
  sandbagWall(B, 0, 30, 12, 0, 2);
  jerseyLine(B, 0, 48, 22, 0);
  jerseyLine(B, -24, 44, 12, Math.PI / 2);
  jerseyLine(B, 24, 44, 12, Math.PI / 2);
  watchtower(B, 23, 47, 6.4);
  waterTower(B, -24, 33);
  flagpole(B, -5, 47, 0x4f7a52, 8);
  crateStack(B, 6, 31, 3);
  crateStack(B, -8, 31, 2);
  barrel(B, 13.4, 36.4);
  barrel(B, 14.1, 35.6);
  barrel(B, 13.1, 35.4);
  pallet(B, -9, 34, 0.3);
  tyreStack(B, 21, 40, 4);
  palm(B, -21, 47, { h: 8.6 });
  palm(B, 22, 27, { h: 7.8, bend: 0.35 });
  palm(B, -23, 27, { h: 8.0, bend: -0.3 });
  bush(B, -6, 39, 1.5);
  bush(B, 6, 39, 1.3);
  wasteBin(B, 12.5, 39.5);
  streetLamp(B, -12, 30, 0, 5.4);
  streetLamp(B, 12, 30, 0, 5.4);
  B.zone('ALPHA BASE', 0, 42, 17);

  for (const s of [
    [-4, 46.5], [4, 46.5], [0, 42.5], [-9, 44], [9, 44], [-3, 38], [3, 38],
    [-14, 36.5], [14, 36.5], [-19, 41], [19, 41], [0, 33.5], [-9, 35.5], [9, 35.5],
  ]) spawns.push({ x: s[0], z: s[1], yaw: 0 });          // alpha: face north, into the map
}

// ═══════════════════════════════════════════════════════════════
function bravoPass(B, spawns) {
  shed(B, 22, -42, { w: 13, d: 10, h: 5.0, roofMat: 'metalRust' });
  shed(B, -24, -44, { w: 10, d: 8, h: 4.2, mat: 'metalRust', roofMat: 'metalRust' });
  container(B, 8, -47, 0, 0x5a6144);
  container(B, 14.4, -47, 0, 0x7a4a3a);
  container(B, -12, -45.5, Math.PI / 2, 0x3f5a6b);
  container(B, -6, -33, 0.1, 0x6b4a52);
  tent(B, -17, -39, { w: 7, d: 6, h: 2.6, yaw: deg(8), kit: 'clothSand' });
  tent(B, -8, -33, { w: 6, d: 5, h: 2.4, yaw: deg(-10), kit: 'clothOlive' });
  tent(B, 15, -32, { w: 6, d: 5, h: 2.4, yaw: deg(3), kit: 'clothSand' });
  truck(B, -19, -47, { yaw: deg(88), covered: true });
  truck(B, 10, -37, { yaw: deg(184), covered: false });
  truck(B, -2, -52, { yaw: deg(4), covered: true });
  sandbagWall(B, -2, -43, 9, 0, 3);
  sandbagWall(B, -2, -37, 9, 0, 3);
  sandbagWall(B, 19, -33, 6, Math.PI / 2, 2);
  jerseyLine(B, 0, -48, 22, 0);
  jerseyLine(B, -24, -36, 10, Math.PI / 2);
  watchtower(B, -22, -46, 6.4);
  waterTower(B, 25, -33);
  flagpole(B, 4, -48, 0x9a4a3a, 8);
  crateStack(B, -6, -38, 3);
  crateStack(B, 6, -40, 2);
  shelfRack(B, -9, -45, 0);
  barrel(B, 3, -36);
  barrel(B, 3.8, -35.4);
  barrel(B, 3.4, -34.6);
  tyreStack(B, -20, -32, 4);
  pallet(B, 12, -42, 1.1);
  wasteBin(B, -4, -33.5);
  forklift(B, 17, -45, 2.2);
  palm(B, -23, -30, { h: 8.0 });
  palm(B, 23, -28, { h: 8.4, bend: 0.3 });
  bush(B, -12, -32, 1.4);
  bush(B, 12, -33, 1.5);
  streetLamp(B, -12, -30, Math.PI, 5.4);
  streetLamp(B, 12, -30, Math.PI, 5.4);
  B.zone('BRAVO BASE', 0, -42, 17);
  B.zone('BRAVO YARD', 22, -42, 12);

  for (const s of [
    [-4, -46.5], [4, -46.5], [0, -42.5], [-9, -44], [9, -44], [-3, -38], [3, -38],
    [-14, -36.5], [14, -36.5], [-19, -41], [19, -41], [0, -33.5], [-9, -35.5], [9, -35.5],
  ]) spawns.push({ x: s[0], z: s[1], yaw: Math.PI });    // bravo: face south, into the map
}

// ═══════════════════════════════════════════════════════════════
function perimeterPass(B) {
  // rocky cliff ring + hard boundary so nothing escapes the arena
  const H = ARENA_HALF - 1;
  for (let i = 0; i < 46; i++) {
    const t = (i / 46) * Math.PI * 2;
    const x = Math.cos(t) * (H + rand(1.5, 6));
    const z = Math.sin(t) * (H + rand(1.5, 6));
    const s = rand(2.2, 5.5);
    B.prop(new THREE.DodecahedronGeometry(s, 0), 'concrete', x, -s * 0.25, z, rand(0, 6.28), {
      matOpts: { color: new THREE.Color().setHSL(0.09, 0.16, 0.4 + Math.random() * 0.2).getHex(), roughness: 1 },
      scaleV: new THREE.Vector3(1, rand(1.1, 1.9), 1),
    });
  }
  for (let i = 0; i < 26; i++) {
    const s = rand(1.2, 2.6);
    const side = i % 4;
    const t = rand(-48, 48);
    const x = side === 0 ? H + rand(0, 3) : side === 1 ? -H - rand(0, 3) : t;
    const z = side === 2 ? H + rand(0, 3) : side === 3 ? -H - rand(0, 3) : t;
    B.prop(new THREE.DodecahedronGeometry(s, 0), 'concrete', x, -s * 0.2, z, rand(0, 6.28), {
      matOpts: { color: new THREE.Color().setHSL(0.09, 0.14, 0.44 + Math.random() * 0.14).getHex(), roughness: 1 },
    });
  }
  const walls = [
    [0, ARENA_HALF + 1.5, ARENA_HALF * 2 + 12, 0.6, 6],
    [0, -ARENA_HALF - 1.5, ARENA_HALF * 2 + 12, 0.6, 6],
    [-ARENA_HALF - 1.5, 0, 0.6, ARENA_HALF * 2 + 12, 6],
    [ARENA_HALF + 1.5, 0, 0.6, ARENA_HALF * 2 + 12, 6],
  ];
  for (const [x, z, sx, sz, y] of walls) B.solid(x, y / 2, z, Math.max(sx, 0.4), y / 2, Math.max(sz, 0.4), 0, 'stone');
}
