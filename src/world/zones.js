// World data. Add new zones / mob types here — the rest of the game reads from
// these tables, so extending the world is mostly a matter of editing this file.

// --- Mob archetypes ---------------------------------------------------------
// kind: 'melee' rushes you; 'ranged' keeps distance and fires projectiles.
// Base values are for level 1 and scale up with mob level.
export const MOB_TYPES = {
  wolf: {
    name: 'Wolf', kind: 'melee', color: 0x9a7b5a,
    radius: 13, baseHp: 38, baseDmg: 7, speed: 165,
    xp: 12, attackReach: 14, attackCd: 0.9, aggroRange: 240,
  },
  bandit: {
    name: 'Bandit', kind: 'melee', color: 0xb0584f,
    radius: 15, baseHp: 60, baseDmg: 10, speed: 125,
    xp: 18, attackReach: 16, attackCd: 1.1, aggroRange: 230,
  },
  skeleton: {
    name: 'Skeleton', kind: 'melee', color: 0xdad6c6,
    radius: 14, baseHp: 75, baseDmg: 13, speed: 130,
    xp: 24, attackReach: 16, attackCd: 1.0, aggroRange: 250,
  },
  skeleton_archer: {
    name: 'Skeleton Archer', kind: 'ranged', color: 0xc7b98a,
    radius: 14, baseHp: 55, baseDmg: 11, speed: 110,
    xp: 28, attackRange: 300, preferred: 230, projSpeed: 330,
    attackCd: 1.6, aggroRange: 320,
  },
};

// --- Zones ------------------------------------------------------------------
// size: world dimensions (camera scrolls within this).
// portals: travel pads -> { x, y, to: zoneKey, label }.
// safe zones spawn no mobs. mobLevel/mobTypes/mobCount drive spawning.
export const ZONES = {
  town: {
    name: 'Riverwood (Town)',
    safe: true,
    size: { w: 1200, h: 820 },
    bg: 0x1d2a1f, accent: 0x32492f,
    portals: [{ x: 1160, y: 410, to: 'forest', label: 'Whispering Forest →' }],
  },
  forest: {
    name: 'Whispering Forest',
    size: { w: 1700, h: 1100 },
    bg: 0x14241a, accent: 0x24402a,
    mobLevel: 2, mobTypes: ['wolf', 'bandit'], mobCount: 8,
    portals: [
      { x: 40, y: 550, to: 'town', label: '← Riverwood' },
      { x: 1660, y: 560, to: 'caves', label: 'Gloom Caves →' },
    ],
  },
  caves: {
    name: 'Gloom Caves',
    size: { w: 1700, h: 1250 },
    bg: 0x111119, accent: 0x222232,
    mobLevel: 5, mobTypes: ['skeleton', 'skeleton_archer'], mobCount: 11,
    portals: [
      { x: 40, y: 620, to: 'forest', label: '← Forest' },
      { x: 1660, y: 640, to: 'lair', label: "Colossus' Lair →" },
    ],
  },
  lair: {
    name: "Colossus' Lair",
    size: { w: 1100, h: 800 },
    bg: 0x1c0f12, accent: 0x3a1a1f,
    boss: 'colossus',
    portals: [
      { x: 40, y: 400, to: 'caves', label: '← Caves' },
      { x: 1060, y: 400, to: 'crypt', label: 'Hollow Crypt →' },
    ],
  },
  crypt: {
    name: 'Hollow Crypt',
    size: { w: 1200, h: 860 },
    bg: 0x12131c, accent: 0x2a2c40,
    boss: 'bonelord',
    portals: [
      { x: 40, y: 430, to: 'lair', label: "← Colossus' Lair" },
      { x: 1160, y: 430, to: 'ember', label: 'Ember Hollow →' },
    ],
  },
  ember: {
    name: 'Ember Hollow',
    size: { w: 1340, h: 920 },
    bg: 0x241009, accent: 0x4a2012,
    boss: 'embermaw',
    portals: [
      { x: 40, y: 460, to: 'crypt', label: '← Hollow Crypt' },
      { x: 1300, y: 460, to: 'voidthrone', label: 'Void Throne →' },
    ],
  },
  voidthrone: {
    name: 'Void Throne',
    size: { w: 1400, h: 960 },
    bg: 0x130c20, accent: 0x2c1a48,
    boss: 'sunderer',
    portals: [
      { x: 40, y: 480, to: 'ember', label: '← Ember Hollow' },
    ],
  },
};

export const START_ZONE = 'town';
