// World data. Add new zones / mob types here — the rest of the game reads from
// these tables, so extending the world is mostly a matter of editing this file.
//
// World shape (hub & spokes):
//   Town is a safe hub. Four open-world zones branch off it, each harder than
//   the last with its own theme, monsters and loot. Every open-world zone hides
//   a portal to its own dungeon at a RANDOM-but-fixed spot (seeded per world, so
//   client & server agree and it never moves). The hardest zone (Void Marches)
//   also hides the raid portal.
//
//   Town ──┬─ Whispering Forest ── (portal) ─→ Colossus' Lair      [dungeon]
//          ├─ Gloom Caves       ── (portal) ─→ Hollow Crypt        [dungeon]
//          ├─ Ember Wastes      ── (portal) ─→ Ember Hollow        [dungeon]
//          └─ Void Marches      ── (portal) ─→ Void Throne         [dungeon]
//                               └─ (portal) ─→ Ancient Bastion     [raid]
//
// Waystones: fast-travel shrines. You must physically walk onto one to discover
// it; afterwards you can travel to it from the World Map (M). They sit at each
// zone entrance and beside each dungeon/raid portal — never inside a dungeon.

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
  // Ember Wastes
  ember_imp: {
    name: 'Ember Imp', kind: 'melee', color: 0xff7a3a,
    radius: 14, baseHp: 72, baseDmg: 15, speed: 152,
    xp: 34, attackReach: 16, attackCd: 0.9, aggroRange: 260,
  },
  cinder_archer: {
    name: 'Cinder Caster', kind: 'ranged', color: 0xffae5a,
    radius: 14, baseHp: 60, baseDmg: 14, speed: 110,
    xp: 38, attackRange: 320, preferred: 240, projSpeed: 360,
    attackCd: 1.5, aggroRange: 340,
  },
  // Void Marches
  wraith: {
    name: 'Void Wraith', kind: 'melee', color: 0x9a6cff,
    radius: 15, baseHp: 96, baseDmg: 20, speed: 160,
    xp: 50, attackReach: 18, attackCd: 0.95, aggroRange: 280,
  },
  void_seer: {
    name: 'Void Seer', kind: 'ranged', color: 0xc89aff,
    radius: 15, baseHp: 78, baseDmg: 18, speed: 105,
    xp: 56, attackRange: 340, preferred: 260, projSpeed: 380,
    attackCd: 1.4, aggroRange: 360,
  },
};

// --- Zones ------------------------------------------------------------------
// size: world dimensions (camera scrolls within this).
// portals: travel pads -> { x, y, to: zoneKey, label }.
//   A portal with `random: true` has no fixed x/y — its position is rolled from
//   the world seed (see zonePortals) so it's hidden somewhere in the zone but
//   never moves for that world. `pad` is the edge margin for the roll.
// waystones: fast-travel shrines -> { id, name, x, y } OR
//   { id, name, nearPortalTo: dungeonKey } to sit beside that (random) portal.
// safe zones spawn no mobs. mobLevel/mobTypes/mobCount drive spawning.
export const ZONES = {
  town: {
    name: 'Riverwood (Town)',
    safe: true,
    size: { w: 1500, h: 1050 },
    bg: 0x1d2a1f, accent: 0x32492f,
    shop: { x: 750, y: 360 }, // market stall — walk up to it (or press B) to trade
    portals: [
      { x: 1450, y: 260, to: 'forest',      label: 'Whispering Forest →' },
      { x: 1450, y: 800, to: 'caves',       label: 'Gloom Caves →' },
      { x: 60,   y: 800, to: 'emberwastes', label: '← Ember Wastes' },
      { x: 60,   y: 260, to: 'voidmarches', label: '← Void Marches' },
    ],
    waystones: [
      { id: 'town', name: 'Riverwood', x: 750, y: 560 },
    ],
  },

  // --- Tier 1: Whispering Forest -> Colossus' Lair ---
  forest: {
    name: 'Whispering Forest',
    size: { w: 2400, h: 1550 },
    bg: 0x14241a, accent: 0x24402a,
    mobLevel: 2, mobTypes: ['wolf', 'bandit'], mobCount: 15,
    portals: [
      { x: 40, y: 550, to: 'town', label: '← Riverwood' },
      { to: 'lair', random: true, pad: 220, label: "Colossus' Lair →" },
    ],
    waystones: [
      { id: 'forest_entry', name: 'Forest Edge', x: 160, y: 550 },
      { id: 'forest_lair',  name: "Colossus' Gate", nearPortalTo: 'lair' },
    ],
  },
  lair: {
    name: "Colossus' Lair",
    size: { w: 1100, h: 800 },
    bg: 0x1c0f12, accent: 0x3a1a1f,
    dungeon: true,
    boss: 'colossus',
    portals: [{ x: 40, y: 400, to: 'forest', label: '← Whispering Forest' }],
  },

  // --- Tier 2: Gloom Caves -> Hollow Crypt ---
  caves: {
    name: 'Gloom Caves',
    size: { w: 2400, h: 1750 },
    bg: 0x111119, accent: 0x222232,
    mobLevel: 6, mobTypes: ['skeleton', 'skeleton_archer'], mobCount: 18,
    portals: [
      { x: 40, y: 620, to: 'town', label: '← Riverwood' },
      { to: 'crypt', random: true, pad: 240, label: 'Hollow Crypt →' },
    ],
    waystones: [
      { id: 'caves_entry', name: 'Cave Mouth', x: 160, y: 620 },
      { id: 'caves_crypt', name: 'Crypt Gate', nearPortalTo: 'crypt' },
    ],
  },
  crypt: {
    name: 'Hollow Crypt',
    size: { w: 1200, h: 860 },
    bg: 0x12131c, accent: 0x2a2c40,
    dungeon: true,
    boss: 'bonelord',
    portals: [{ x: 40, y: 430, to: 'caves', label: '← Gloom Caves' }],
  },

  // --- Tier 3: Ember Wastes -> Ember Hollow ---
  emberwastes: {
    name: 'Ember Wastes',
    size: { w: 2500, h: 1700 },
    bg: 0x2a1207, accent: 0x5e2a12,
    mobLevel: 10, mobTypes: ['ember_imp', 'cinder_archer'], mobCount: 20,
    portals: [
      { x: 40, y: 600, to: 'town', label: '← Riverwood' },
      { to: 'ember', random: true, pad: 240, label: 'Ember Hollow →' },
    ],
    waystones: [
      { id: 'ember_entry',  name: 'Scorched Path', x: 160, y: 600 },
      { id: 'ember_hollow', name: 'Hollow Gate', nearPortalTo: 'ember' },
    ],
  },
  ember: {
    name: 'Ember Hollow',
    size: { w: 1340, h: 920 },
    bg: 0x241009, accent: 0x4a2012,
    dungeon: true,
    boss: 'embermaw',
    portals: [{ x: 40, y: 460, to: 'emberwastes', label: '← Ember Wastes' }],
  },

  // --- Tier 4 (hardest): Void Marches -> Void Throne + Ancient Bastion (raid) ---
  voidmarches: {
    name: 'Void Marches',
    size: { w: 2700, h: 1850 },
    bg: 0x140b22, accent: 0x301a52,
    mobLevel: 15, mobTypes: ['wraith', 'void_seer'], mobCount: 24,
    portals: [
      { x: 40, y: 650, to: 'town', label: '← Riverwood' },
      { to: 'voidthrone',     random: true, pad: 260, label: 'Void Throne →' },
      { to: 'ancient_bastion', random: true, pad: 260, label: 'Ancient Bastion ★' },
    ],
    waystones: [
      { id: 'void_entry',   name: 'Marches Edge',  x: 170, y: 650 },
      { id: 'void_throne',  name: 'Throne Gate',   nearPortalTo: 'voidthrone' },
      { id: 'void_bastion', name: 'Bastion Gate',  nearPortalTo: 'ancient_bastion' },
    ],
  },
  voidthrone: {
    name: 'Void Throne',
    size: { w: 1400, h: 960 },
    bg: 0x130c20, accent: 0x2c1a48,
    dungeon: true,
    boss: 'sunderer',
    portals: [{ x: 40, y: 480, to: 'voidmarches', label: '← Void Marches' }],
  },
  ancient_bastion: {
    name: 'Ancient Bastion',
    size: { w: 1900, h: 1300 },
    bg: 0x1a1420, accent: 0x3d2a5c,
    dungeon: true,
    raid: true,
    mobLevel: 16,
    mobTypes: ['wraith', 'void_seer'],
    mobCount: 0,
    portals: [{ x: 40, y: 650, to: 'voidmarches', label: '← Void Marches' }],
  },
};

export const START_ZONE = 'town';

// --- Seeded world layout ----------------------------------------------------
// A small string-hash + mulberry32 PRNG. Given the same world seed, both the
// client and the authoritative server compute identical random portal spots, so
// the hidden dungeon portals line up everywhere and never move.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Resolve a zone's portals to concrete {x,y}. Fixed portals pass through; random
// ones are rolled from (seed, zoneKey, target) and kept clear of already-placed
// portals so two random portals in the same zone don't stack.
export function zonePortals(zoneKey, seed = 0) {
  const z = ZONES[zoneKey];
  if (!z) return [];
  const out = [];
  const placed = [];
  for (const p of z.portals) if (!p.random) { out.push({ ...p }); placed.push({ x: p.x, y: p.y }); }
  for (const p of z.portals) {
    if (!p.random) continue;
    const pad = p.pad || 220;
    let pos = null;
    for (let i = 0; i < 16; i++) {
      const r = rng(hashStr(`${seed}|${zoneKey}|${p.to}|${i}`));
      const x = Math.round(pad + r() * (z.size.w - 2 * pad));
      const y = Math.round(pad + r() * (z.size.h - 2 * pad));
      if (placed.every((q) => Math.hypot(q.x - x, q.y - y) > 340)) { pos = { x, y }; break; }
    }
    if (!pos) {
      const r = rng(hashStr(`${seed}|${zoneKey}|${p.to}|fallback`));
      pos = { x: Math.round(pad + r() * (z.size.w - 2 * pad)), y: Math.round(pad + r() * (z.size.h - 2 * pad)) };
    }
    out.push({ ...p, x: pos.x, y: pos.y });
    placed.push(pos);
  }
  return out;
}

// Resolve a zone's waystones to concrete {id,name,x,y,zoneKey}. Waystones tied to
// a (random) portal sit just beside it, toward the zone interior.
export function zoneWaystones(zoneKey, seed = 0) {
  const z = ZONES[zoneKey];
  if (!z || !z.waystones) return [];
  const portals = zonePortals(zoneKey, seed);
  return z.waystones.map((w) => {
    if (w.nearPortalTo) {
      const pt = portals.find((p) => p.to === w.nearPortalTo);
      if (pt) {
        const ox = pt.x < z.size.w / 2 ? 100 : -100;
        const x = Math.max(60, Math.min(z.size.w - 60, pt.x + ox));
        const y = Math.max(60, Math.min(z.size.h - 60, pt.y - 60));
        return { id: w.id, name: w.name, x, y, zoneKey };
      }
    }
    return { id: w.id, name: w.name, x: w.x, y: w.y, zoneKey };
  });
}

// Flat list of every waystone in the world (for the map + travel lookup).
export function allWaystones(seed = 0) {
  const list = [];
  for (const key of Object.keys(ZONES)) {
    const z = ZONES[key];
    for (const w of zoneWaystones(key, seed)) list.push({ ...w, zoneName: z.name });
  }
  return list;
}

export function findWaystone(id, seed = 0) {
  return allWaystones(seed).find((w) => w.id === id) || null;
}
