// Boss definitions (Stage 6). Each boss lives in a zone — see the `boss:` key in
// zones.js — and is fully data-driven: its stats, telegraphed attacks, enrage
// rule and loot are read by the shared, Phaser-free BossCore state machine used
// by BOTH the solo client sim and the headless authoritative server. Add a new
// boss here, point a zone's `boss:` at it, and it just works.
//
// Attack types (all telegraphed — the tank holds threat and faces the boss away
// from the group; everyone dodges the marked danger):
//   cleave   — frontal cone in front of the boss   (range, halfAngle)
//   aoe      — circle dropped on a random target    (radius)
//   charge   — boss dashes in a straight line, hitting a rectangle (length, width)
//   summon   — spawns adds around the boss           (mobType, count, level, radius)
//   safezone — room-wide blast; only a small safe circle survives (safeRadius)
// `weight` sets how often an attack is chosen. `rangedOk: true` lets an attack
// start from any distance (otherwise the boss must be in melee range first).
// `enrage`: once HP drops below hpPct the boss permanently hits harder, moves
// faster, and winds up/recovers quicker (hasteMult < 1 = faster).

const D = Math.PI / 180;

export const BOSSES = {
  // Tier 1 — the original Colossus, now with a low-HP enrage.
  colossus: {
    name: 'Stone Colossus', color: 0x9a6b4a, radius: 46,
    maxHp: 4800, speed: 95, meleeBand: 130, openingCd: 2.2,
    xp: 500, loot: { count: 2, ilvl: 12, rarityBoost: 0.8 },
    attacks: [
      { type: 'cleave', weight: 55, windup: 0.75, recover: 0.6, range: 190, halfAngle: 60 * D, damage: 130 },
      { type: 'aoe',    weight: 45, windup: 1.1,  recover: 0.7, radius: 105, damage: 160 },
    ],
    enrage: { hpPct: 0.25, damageMult: 1.4, speedMult: 1.3, hasteMult: 0.7 },
  },

  // Tier 2 — summons skeleton adds; the party must control the room.
  bonelord: {
    name: 'Bonelord Maxen', color: 0xcfc9a6, radius: 44,
    maxHp: 6800, speed: 92, meleeBand: 130, openingCd: 2.0,
    xp: 900, loot: { count: 2, ilvl: 18, rarityBoost: 1.0 },
    attacks: [
      { type: 'cleave', weight: 42, windup: 0.7, recover: 0.55, range: 185, halfAngle: 55 * D, damage: 150 },
      { type: 'aoe',    weight: 30, windup: 1.0, recover: 0.65, radius: 110, damage: 175 },
      { type: 'summon', weight: 28, windup: 1.2, recover: 0.8, rangedOk: true, mobType: 'skeleton', count: 3, level: 6, radius: 95 },
    ],
  },

  // Tier 3 — line charges + a room-wide blast you must hide from. Enrages.
  embermaw: {
    name: 'Embermaw', color: 0xe06b3a, radius: 48,
    maxHp: 9000, speed: 100, meleeBand: 135, openingCd: 2.0,
    xp: 1500, loot: { count: 3, ilvl: 26, rarityBoost: 1.3 },
    attacks: [
      { type: 'cleave',   weight: 38, windup: 0.7, recover: 0.5, range: 200, halfAngle: 60 * D, damage: 175 },
      { type: 'charge',   weight: 30, windup: 0.9, recover: 0.7, rangedOk: true, length: 720, width: 120, damage: 210 },
      { type: 'safezone', weight: 32, windup: 1.7, recover: 0.9, rangedOk: true, safeRadius: 135, damage: 320 },
    ],
    enrage: { hpPct: 0.3, damageMult: 1.35, speedMult: 1.25, hasteMult: 0.75 },
  },

  // Tier 4 — the finale: every mechanic at once, plus a brutal enrage.
  sunderer: {
    name: 'The Sunderer', color: 0x7a4ad0, radius: 52,
    maxHp: 13000, speed: 105, meleeBand: 140, openingCd: 1.8,
    xp: 2600, loot: { count: 3, ilvl: 36, rarityBoost: 1.8 },
    attacks: [
      { type: 'cleave',   weight: 30, windup: 0.65, recover: 0.5,  range: 210, halfAngle: 65 * D, damage: 200 },
      { type: 'charge',   weight: 22, windup: 0.85, recover: 0.6,  rangedOk: true, length: 820, width: 140, damage: 240 },
      { type: 'summon',   weight: 22, windup: 1.1,  recover: 0.7,  rangedOk: true, mobType: 'skeleton_archer', count: 3, level: 9, radius: 105 },
      { type: 'safezone', weight: 26, windup: 1.6,  recover: 0.85, rangedOk: true, safeRadius: 125, damage: 380 },
    ],
    enrage: { hpPct: 0.35, damageMult: 1.5, speedMult: 1.35, hasteMult: 0.65 },
  },
};

export const DEFAULT_BOSS = 'colossus';
