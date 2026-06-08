// Boss definitions. Each boss lives in a zone (see `boss:` key in zones.js).
// Data-driven: stats, attacks, enrage rule, and loot are read by the shared
// BossCore state machine used by BOTH the solo client and the authoritative server.
//
// Attack `blockable` flag:
//   true  = YELLOW telegraph — can be partially blocked (reduce 75% damage)
//           more frequent; melee/frontal attacks
//   false = RED telegraph   — unblockable; must dodge or get in safe zone
//           less frequent; deal more damage
//
// Attack types:
//   cleave   — frontal cone                           (blockable)
//   aoe      — circle on a random target              (unblockable)
//   charge   — straight-line dash                     (unblockable)
//   summon   — spawns adds (no direct damage)         (blockable — just telegraphs spawn)
//   safezone — room-wide blast with one safe circle   (unblockable)

const D = Math.PI / 180;

export const BOSSES = {
  // Tier 1: the Stone Colossus. Two attacks — blockable cleave (yellow) and
  // unblockable ground slam (red). Enrages at 25% HP.
  colossus: {
    name: 'Stone Colossus', color: 0x9a6b4a, radius: 46,
    maxHp: 4800, speed: 95, meleeBand: 130, openingCd: 2.2,
    xp: 500, loot: { count: 2, ilvl: 12, rarityBoost: 0.8 },
    attacks: [
      { type: 'cleave', weight: 60, blockable: true,  windup: 0.75, recover: 0.6, range: 190, halfAngle: 60 * D, damage: 120 },
      { type: 'aoe',    weight: 40, blockable: false, windup: 1.1,  recover: 0.7, radius: 105, damage: 200 },
    ],
    enrage: { hpPct: 0.25, damageMult: 1.4, speedMult: 1.3, hasteMult: 0.7 },
  },

  // Tier 2: Bonelord Maxen. Adds skeleton summoning. No enrage.
  bonelord: {
    name: 'Bonelord Maxen', color: 0xcfc9a6, radius: 44,
    maxHp: 6800, speed: 92, meleeBand: 130, openingCd: 2.0,
    xp: 900, loot: { count: 2, ilvl: 18, rarityBoost: 1.0 },
    attacks: [
      { type: 'cleave', weight: 48, blockable: true,  windup: 0.7,  recover: 0.55, range: 185, halfAngle: 55 * D, damage: 145 },
      { type: 'aoe',    weight: 28, blockable: false, windup: 1.0,  recover: 0.65, radius: 110, damage: 230 },
      { type: 'summon', weight: 24, blockable: true,  windup: 1.2,  recover: 0.8,  rangedOk: true, mobType: 'skeleton', count: 3, level: 6, radius: 95 },
    ],
  },

  // Tier 3: Embermaw. Line charges + room-wide safezone. Enrages at 30%.
  embermaw: {
    name: 'Embermaw', color: 0xe06b3a, radius: 48,
    maxHp: 9000, speed: 100, meleeBand: 135, openingCd: 2.0,
    xp: 1500, loot: { count: 3, ilvl: 26, rarityBoost: 1.3 },
    attacks: [
      { type: 'cleave',   weight: 42, blockable: true,  windup: 0.7,  recover: 0.5, range: 200, halfAngle: 60 * D, damage: 170 },
      { type: 'charge',   weight: 26, blockable: false, windup: 0.9,  recover: 0.7, rangedOk: true, length: 720, width: 120, damage: 290 },
      { type: 'safezone', weight: 32, blockable: false, windup: 1.7,  recover: 0.9, rangedOk: true, safeRadius: 135, damage: 380 },
    ],
    enrage: { hpPct: 0.3, damageMult: 1.35, speedMult: 1.25, hasteMult: 0.75 },
  },

  // Tier 4: The Sunderer. All mechanics. Brutal enrage at 35%.
  sunderer: {
    name: 'The Sunderer', color: 0x7a4ad0, radius: 52,
    maxHp: 13000, speed: 105, meleeBand: 140, openingCd: 1.8,
    xp: 2600, loot: { count: 3, ilvl: 36, rarityBoost: 1.8 },
    attacks: [
      { type: 'cleave',   weight: 32, blockable: true,  windup: 0.65, recover: 0.5,  range: 210, halfAngle: 65 * D, damage: 195 },
      { type: 'charge',   weight: 20, blockable: false, windup: 0.85, recover: 0.6,  rangedOk: true, length: 820, width: 140, damage: 330 },
      { type: 'summon',   weight: 22, blockable: true,  windup: 1.1,  recover: 0.7,  rangedOk: true, mobType: 'skeleton_archer', count: 3, level: 9, radius: 105 },
      { type: 'safezone', weight: 26, blockable: false, windup: 1.6,  recover: 0.85, rangedOk: true, safeRadius: 125, damage: 450 },
    ],
    enrage: { hpPct: 0.35, damageMult: 1.5, speedMult: 1.35, hasteMult: 0.65 },
  },

  // --- Raid bosses (Ancient Bastion) ---

  // Raid Phase 1 mini-boss: the Guardian
  guardian: {
    name: 'Guardian of the Bastion', color: 0x8ab8e0, radius: 44,
    maxHp: 7500, speed: 88, meleeBand: 125, openingCd: 2.0,
    xp: 1200, loot: { count: 2, ilvl: 28, rarityBoost: 1.1 },
    attacks: [
      { type: 'cleave', weight: 58, blockable: true,  windup: 0.7,  recover: 0.6, range: 190, halfAngle: 58 * D, damage: 175 },
      { type: 'aoe',    weight: 42, blockable: false, windup: 1.1,  recover: 0.7, radius: 115, damage: 260 },
    ],
  },

  // Raid Phase 3 mini-boss: the Warden
  warden: {
    name: 'Warden of Chains', color: 0xd4a020, radius: 50,
    maxHp: 11000, speed: 96, meleeBand: 130, openingCd: 1.9,
    xp: 2000, loot: { count: 3, ilvl: 34, rarityBoost: 1.4 },
    attacks: [
      { type: 'cleave',  weight: 40, blockable: true,  windup: 0.65, recover: 0.55, range: 195, halfAngle: 60 * D, damage: 205 },
      { type: 'charge',  weight: 28, blockable: false, windup: 0.9,  recover: 0.65, rangedOk: true, length: 680, width: 130, damage: 295 },
      { type: 'summon',  weight: 32, blockable: true,  windup: 1.1,  recover: 0.7,  rangedOk: true, mobType: 'skeleton', count: 4, level: 12, radius: 100 },
    ],
    enrage: { hpPct: 0.3, damageMult: 1.3, speedMult: 1.2, hasteMult: 0.8 },
  },

  // Raid Final Boss: The Worldbreaker
  worldbreaker: {
    name: 'The Worldbreaker', color: 0xd020e0, radius: 60,
    maxHp: 28000, speed: 98, meleeBand: 150, openingCd: 1.5,
    xp: 8000, loot: { count: 5, ilvl: 48, rarityBoost: 2.8 },
    attacks: [
      { type: 'cleave',   weight: 28, blockable: true,  windup: 0.6,  recover: 0.5,  range: 230, halfAngle: 70 * D, damage: 250 },
      { type: 'aoe',      weight: 20, blockable: false, windup: 1.0,  recover: 0.65, radius: 140, damage: 380 },
      { type: 'charge',   weight: 18, blockable: false, windup: 0.8,  recover: 0.55, rangedOk: true, length: 900, width: 150, damage: 420 },
      { type: 'summon',   weight: 20, blockable: true,  windup: 1.0,  recover: 0.6,  rangedOk: true, mobType: 'skeleton_archer', count: 5, level: 14, radius: 120 },
      { type: 'safezone', weight: 14, blockable: false, windup: 1.5,  recover: 0.8,  rangedOk: true, safeRadius: 110, damage: 600 },
    ],
    enrage: { hpPct: 0.4, damageMult: 1.6, speedMult: 1.4, hasteMult: 0.6 },
  },
};

export const DEFAULT_BOSS = 'colossus';
