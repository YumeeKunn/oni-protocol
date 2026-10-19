// ═══════════════ WEAPON DEFINITIONS ═══════════════
// Everything the gunplay needs: ballistics, recoil, reload timings, audio class,
// viewmodel rig (iron sight / scope) and per-class handling.

export const CLASSES = {
  assault: {
    id: 'assault', name: 'ASSAULT', sub: 'RIFLEMAN',
    desc: 'M4A1 carbine + M9 sidearm. Balanced, forgiving, good at every range.',
    primary: 'm4a1', secondary: 'm9', icon: '⌖',
  },
  cleaner: {
    id: 'cleaner', name: 'CLEANER', sub: 'CLOSE QUARTERS',
    desc: 'MP5 SMG + M9. Fast handling, tight hipfire, shreds inside the alleys.',
    primary: 'mp5', secondary: 'm9', icon: '≡',
  },
  sniper: {
    id: 'sniper', name: 'SNIPER', sub: 'RECON',
    desc: 'L96A1 bolt-action + M9. One shot, one kill. Hold breath to steady.',
    primary: 'l96a1', secondary: 'm9', icon: '◎',
  },
  breacher: {
    id: 'breacher', name: 'BREACHER', sub: 'SHOTGUN',
    desc: 'M1014 semi-auto shotgun + M9. Brutal in rooms, poor past 20 m.',
    primary: 'm1014', secondary: 'm9', icon: '✶',
  },
};

export const WEAPONS = {
  m4a1: {
    id: 'm4a1', name: 'M4A1', full: 'M4A1 CARBINE', slot: 1, cls: 'rifle', auto: true,
    rpm: 740, dmg: 26, headMult: 2.0, legMult: 0.86, pellets: 1,
    mag: 30, reserve: 150, reload: 2.25, reloadTac: 1.85, draw: 0.55,
    spread: { base: 0.10, move: 1.35, air: 2.4, crouch: 0.62, perShot: 0.13, max: 2.4, decay: 5.2 },
    recoil: { v: 0.46, h: 0.24, kick: 0.028, rise: 2.2 },
    adsFov: 52, adsTime: 0.19, adsSpread: 0.30, adsSens: 0.62, moveMul: 0.66,
    falloff: [30, 78, 0.66], audio: 'rifle', tracer: 1, barrel: 0.5,
  },
  mp5: {
    id: 'mp5', name: 'MP5', full: 'MP5 SUBMACHINE GUN', slot: 1, cls: 'smg', auto: true,
    rpm: 820, dmg: 21, headMult: 1.9, legMult: 0.9, pellets: 1,
    mag: 30, reserve: 180, reload: 2.05, reloadTac: 1.7, draw: 0.45,
    spread: { base: 0.14, move: 0.95, air: 2.2, crouch: 0.6, perShot: 0.10, max: 2.1, decay: 6.4 },
    recoil: { v: 0.34, h: 0.22, kick: 0.022, rise: 1.8 },
    adsFov: 55, adsTime: 0.15, adsSpread: 0.36, adsSens: 0.7, moveMul: 0.76,
    falloff: [18, 52, 0.5], audio: 'smg', tracer: 1, barrel: 0.32,
  },
  m1014: {
    id: 'm1014', name: 'M1014', full: 'M1014 SHOTGUN', slot: 1, cls: 'shotgun', auto: false,
    rpm: 230, dmg: 15, headMult: 1.5, legMult: 0.9, pellets: 9,
    mag: 6, reserve: 42, reload: 3.1, reloadTac: 2.7, draw: 0.6,
    spread: { base: 3.4, move: 3.9, air: 4.6, crouch: 2.9, perShot: 0.3, max: 4.6, decay: 5 },
    recoil: { v: 1.5, h: 0.4, kick: 0.075, rise: 4.2 },
    adsFov: 60, adsTime: 0.24, adsSpread: 2.5, adsSens: 0.78, moveMul: 0.72,
    falloff: [8, 26, 0.22], audio: 'shotgun', tracer: 0.4, barrel: 0.44,
  },
  l96a1: {
    id: 'l96a1', name: 'L96A1', full: 'L96A1 SNIPER SYSTEM', slot: 1, cls: 'sniper', auto: false,
    rpm: 46, dmg: 105, headMult: 2.4, legMult: 0.92, pellets: 1, bolt: 1.15,
    mag: 5, reserve: 25, reload: 3.3, reloadTac: 2.9, draw: 0.75,
    spread: { base: 0.9, move: 8.0, air: 9.0, crouch: 0.22, perShot: 1.6, max: 9, decay: 3.4 },
    recoil: { v: 2.4, h: 0.3, kick: 0.16, rise: 6.5 },
    adsFov: 20, adsTime: 0.34, adsSpread: 0.02, adsSens: 0.36, moveMul: 0.52, scope: true,
    falloff: [120, 200, 1], audio: 'sniper', tracer: 1.6, barrel: 0.68,
  },
  m9: {
    id: 'm9', name: 'M9', full: 'M9 SIDEARM', slot: 2, cls: 'pistol', auto: false,
    rpm: 430, dmg: 25, headMult: 2.0, legMult: 0.88, pellets: 1,
    mag: 15, reserve: 75, reload: 1.75, reloadTac: 1.35, draw: 0.35,
    spread: { base: 0.16, move: 1.1, air: 2.2, crouch: 0.7, perShot: 0.22, max: 2.6, decay: 6 },
    recoil: { v: 0.62, h: 0.28, kick: 0.03, rise: 2.6 },
    adsFov: 58, adsTime: 0.14, adsSpread: 0.22, adsSens: 0.78, moveMul: 0.86,
    falloff: [16, 46, 0.5], audio: 'pistol', tracer: 1, barrel: 0.16,
  },
  knife: {
    id: 'knife', name: 'KNIFE', full: 'COMBAT KNIFE', slot: 3, cls: 'melee', auto: false,
    rpm: 150, dmg: 55, headMult: 2, backStab: 130, range: 2.4,
    mag: Infinity, reserve: Infinity, reload: 0, draw: 0.3, melee: true,
    spread: { base: 0, move: 0, air: 0, crouch: 0, perShot: 0, max: 0, decay: 1 },
    recoil: { v: 0, h: 0, kick: 0 },
    adsFov: 70, adsTime: 0.1, adsSpread: 0, adsSens: 1, moveMul: 1,
    falloff: [4, 4, 1], audio: 'melee', tracer: 0,
  },
};

export const GRENADE = {
  id: 'grenade', name: 'FRAG', full: 'M67 FRAG GRENADE',
  count: 2, fuse: 2.4, radius: 7.5, dmg: 118, throwSpeed: 17, cook: 0.5,
};

/** loadout for a class id */
export function loadoutFor(classId) {
  const c = CLASSES[classId] || CLASSES.assault;
  return {
    classId: c.id,
    primary: c.primary,
    secondary: c.secondary,
    melee: 'knife',
    grenades: GRENADE.count,
  };
}

export const PICKUP = { ammo: 0.5, grenadeEvery: 45 };
