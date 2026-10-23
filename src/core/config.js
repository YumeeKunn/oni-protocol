// ═══════════════ CONFIG — all tuning in one place ═══════════════

export const VERSION = 'v2.0';

// ── match modes ──
export const MODES = {
  survival: {
    id: 'survival',
    name: 'SURVIVAL',
    sub: 'SINGLE PLAYER // ENDLESS WAVES',
    desc: 'Hold the compound. Endless hostile waves. How long can you last?',
    icon: '◈',
  },
  tdm: {
    id: 'tdm',
    name: 'TEAM DEATHMATCH',
    sub: 'ALPHA vs BRAVO // BOTS',
    desc: 'Two squads. First team to the kill limit — or highest score when time runs out.',
    icon: '⚔',
  },
};

export const TEAM_SIZES = [2, 3, 4, 5, 6, 8];
export const KILL_LIMITS = [25, 50, 75, 100];
export const DURATIONS = [5, 10, 15, 20];   // minutes

// ── bot difficulty ──
// `engage` scales how far a bot will take a shot before closing the gap, `aggr`
// how hard it pushes toward the player. Bots fight up close — they are not turrets.
export const DIFFICULTIES = {
  recruit: {
    id: 'recruit', name: 'RECRUIT',
    desc: 'Slow reactions, loose aim — they miss a lot',
    dmg: 0.65, hp: 0.85, spread: 2.1, reaction: 0.42, fireRate: 0.75, speed: 0.9, accuracyRange: 0.75,
    engage: 0.72, aggr: 0.55,
  },
  regular: {
    id: 'regular', name: 'REGULAR',
    desc: 'Balanced — pushes in and fights at close range',
    dmg: 1.0, hp: 1.0, spread: 1.0, reaction: 0.24, fireRate: 1.0, speed: 1.0, accuracyRange: 1.0,
    engage: 0.88, aggr: 0.72,
  },
  veteran: {
    id: 'veteran', name: 'VETERAN',
    desc: 'Sharp reactions, holds the lane and flanks',
    dmg: 1.3, hp: 1.15, spread: 0.68, reaction: 0.15, fireRate: 1.2, speed: 1.06, accuracyRange: 1.2,
    engage: 1.0, aggr: 0.88,
  },
  elite: {
    id: 'elite', name: 'ELITE',
    desc: 'Brutal — fast, accurate, never stops closing',
    dmg: 1.6, hp: 1.3, spread: 0.45, reaction: 0.08, fireRate: 1.45, speed: 1.12, accuracyRange: 1.45,
    engage: 1.1, aggr: 1.0,
  },
};

// preferred fighting distance per weapon class (metres). Bots close to roughly
// these ranges and only open fire once they are inside `engage`.
export const BOT_RANGE = {
  shotgun: 4.0,
  smg: 8.0,
  pistol: 9.0,
  rifle: 13.0,
  sniper: 17.0,
  melee: 2.0,
};

// ── operator names (killfeed / scoreboard personality) ──
export const CALLSIGNS = [
  'Dubois', 'Petrenko', 'Reyes', 'Okafor', 'Novak', 'Silva', 'Haddad', 'Kovacs',
  'Mercer', 'Volkov', 'Nakamura', 'Ferreira', 'Bauer', 'Osei', 'Rahman', 'Costa',
  'Lindqvist', 'Moreno', 'Abadi', 'Sokolov', 'Duarte', 'Kessler', 'Ivanov', 'Marsh',
  'Takeda', 'Bernard', 'Aziz', 'Larsen', 'Romero', 'Vance', 'Novotny', 'Diallo',
];

// ── teams ──
export const TEAMS = {
  alpha: { id: 'alpha', name: 'ALPHA', color: 0x4ade80, css: '#4ade80', dark: 0x14532d, spawn: { x: 0, z: 40, yaw: Math.PI } },
  bravo: { id: 'bravo', name: 'BRAVO', color: 0xf87171, css: '#f87171', dark: 0x7f1d1d, spawn: { x: 0, z: -40, yaw: 0 } },
};

// ── map zones (for the minimap location readout) ──
export const ZONES = [
  { name: 'ALPHA BASE', x: 0, z: 40, r: 16 },
  { name: 'BRAVO BASE', x: 0, z: -40, r: 16 },
  { name: 'MID COMPOUND', x: 0, z: 0, r: 15 },
  { name: 'CONVOY ROAD', x: -34, z: 0, r: 16 },
  { name: 'CONTAINER YARD', x: 34, z: 0, r: 16 },
  { name: 'WATCHTOWER', x: -20, z: -18, r: 11 },
  { name: 'FUEL DEPOT', x: 20, z: 18, r: 11 },
  { name: 'TUNNEL RUN', x: 0, z: 20, r: 10 },
];

// ── arena / movement ──
export const ARENA = { half: 52 };

/**
 * Movement tuning — calibrated against Modern Warfare (2019/II).
 *   base run   4.57 m/s   ·  sprint 7.01 m/s   ·  crouch 2.44 m/s
 *   jump apex  0.60 m     ·  slide burst 8.84 m/s
 * The model is *target velocity* based (MW style), not Quake's exponential
 * accelerate(): the ground response rate is 92 m/s², so the stick feels tight
 * and there is a short slide-off tail instead of a dead stop.
 */
export const MOVE = {
  walk: 4.25,
  sprint: 6.15,
  crouch: 2.25,
  strafeScale: 0.92,    // slower sideways
  backScale: 0.8,       // slower still backwards
  adsMul: 0.5,          // aiming costs half your speed
  accel: 66,            // m/s² toward the target velocity
  decel: 42,            // decelerating to a slower target
  stopDecel: 24,        // extra braking when the stick is released
  airAccelScale: 0.22,  // air control is a fraction of ground authority
  airSpeedCap: 3.4,     // air control may not add speed past this
  airAccel: 15,         // legacy key (accel * airAccelScale)
  airWishCap: 3.4,
  friction: 6.6,        // legacy key
  stopSpeed: 3.0,       // legacy key
  gravity: 20.5,
  jumpVel: 4.96,        // v = sqrt(2 * g * 0.6) → 0.60 m apex
  jumpBuffer: 0.13,
  coyote: 0.09,
  jumpCooldown: 0.28,
  slideBoost: 8.84,     // slide entry speed
  slideTime: 0.9,
  slideFriction: 0.75,  // exponential drag (1/s)
  slideBrake: 0.85,     // linear brake (m/s²)
  slideExit: 2.95,      // below this the slide becomes a crouch walk
  slideMinEntry: 6.2,   // a slide always feels like a burst
  slideMinSpeed: 5.2,   // minimum speed to start one
  slideCooldown: 0.55,
  slideSteer: 2.6,      // steering authority while sliding
  stepHeight: 0.52,
  eyeStand: 1.66,
  eyeCrouch: 1.02,
  radius: 0.42,
  strideLength: 1.48,   // metres per step — the view bob is locked to this
};

export const COMBAT = {
  headMultDefault: 2.0,
  regenDelay: 6.0,
  regenRate: 9.0,
  spawnProtect: 1.4,
  respawnDelay: 4.5,       // tdm player respawn
  botRespawn: [2.6, 4.4],
  falloffStart: 32,        // damage falloff begins (m)
  falloffEnd: 90,
  falloffMin: 0.55,
};

export const RENDER = {
  pixelRatioCap: 1.25,
  shadowMap: 2048,
  fov: 78,
  adsFov: 54,
  scopeFov: 18,
  bloom: { strength: 0.42, radius: 0.6, threshold: 0.9 },
  ssao: { radius: 8, minDistance: 0.0025, maxDistance: 0.085 },
};

export const MINIMAP = { range: 42, size: 190 };

// ── scoreboard / scoring ──
export const SCORE = {
  kill: 1,
  headshotBonus: 0,
  assist: 0,
  waveClearBase: 500,
  comboWindow: 3.0,
};
