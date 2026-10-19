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
export const DIFFICULTIES = {
  recruit: {
    id: 'recruit', name: 'RECRUIT',
    dmg: 0.65, hp: 0.85, spread: 2.1, reaction: 0.42, fireRate: 0.75, speed: 0.9, accuracyRange: 0.75,
  },
  regular: {
    id: 'regular', name: 'REGULAR',
    dmg: 1.0, hp: 1.0, spread: 1.0, reaction: 0.24, fireRate: 1.0, speed: 1.0, accuracyRange: 1.0,
  },
  veteran: {
    id: 'veteran', name: 'VETERAN',
    dmg: 1.3, hp: 1.15, spread: 0.68, reaction: 0.15, fireRate: 1.2, speed: 1.06, accuracyRange: 1.2,
  },
  elite: {
    id: 'elite', name: 'ELITE',
    dmg: 1.6, hp: 1.3, spread: 0.45, reaction: 0.08, fireRate: 1.45, speed: 1.12, accuracyRange: 1.45,
  },
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

export const MOVE = {
  walk: 4.9,
  sprint: 6.9,
  crouch: 2.55,
  adsMul: 0.62,
  accel: 12,            // ground accelerate() factor  (Quake/CS style)
  airAccel: 30,         // air accelerate() factor — enables air-strafing
  airWishCap: 1.5,      // m/s wish-speed cap in air (airstrafe)
  friction: 6.6,
  stopSpeed: 3.0,
  gravity: 21,
  jumpVel: 6.2,
  jumpBuffer: 0.12,
  coyote: 0.10,
  slideBoost: 9.5,
  slideTime: 0.75,
  slideFriction: 2.4,
  stepHeight: 0.52,
  eyeStand: 1.62,
  eyeCrouch: 1.05,
  radius: 0.42,
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
