// Shared loot & equipment system (Stage 5). Phaser-free and server-safe: this
// is imported by BOTH the browser client and the authoritative Node server, so
// drop rolls, stat rolls and equip rules are ONE source of truth. Add new
// rarities / item bases here and the rest of the game picks them up.

import { CLASSES } from './classes/classes.js';

export const STAT_KEYS = ['STR', 'DEX', 'INT', 'VIT', 'AGI'];
export const EQUIP_SLOTS = ['weapon', 'helmet', 'chest', 'gloves', 'boots', 'accessory'];
export const INV_CAP = 30; // backpack size (per class)

// Rarity tiers. `mult` scales an item's total stat budget; `weight` is the base
// drop weight (higher tiers are rarer). Colors are used by the UI + floaters.
export const RARITIES = [
  { key: 'common', name: 'Common', color: '#b8c0d0', mult: 1.0, weight: 100 },
  { key: 'uncommon', name: 'Uncommon', color: '#5fd96b', mult: 1.7, weight: 52 },
  { key: 'rare', name: 'Rare', color: '#4aa8ff', mult: 2.6, weight: 24 },
  { key: 'epic', name: 'Epic', color: '#c06cff', mult: 3.8, weight: 8 },
  { key: 'legendary', name: 'Legendary', color: '#ff9a3c', mult: 5.4, weight: 2 },
];
export const RARITY_BY_KEY = Object.fromEntries(RARITIES.map((r) => [r.key, r]));
export function rarityColor(key) { return (RARITY_BY_KEY[key] || RARITIES[0]).color; }
export function rarityIndex(key) { return RARITIES.findIndex((r) => r.key === key); }

// Item bases: each defines a slot, an armor weight class (armor) or a weapon
// kind (weapon), and which attributes it favors (`main` gets the stat budget's
// bulk — a sword leans STR, a wand leans INT, etc.). Add new bases freely.
export const ITEM_BASES = {
  // weapons
  sword: { name: 'Sword', slot: 'weapon', weapon: 'sword', main: ['STR'] },
  axe: { name: 'Axe', slot: 'weapon', weapon: 'axe', main: ['STR', 'VIT'] },
  dagger: { name: 'Dagger', slot: 'weapon', weapon: 'dagger', main: ['DEX'] },
  bow: { name: 'Bow', slot: 'weapon', weapon: 'bow', main: ['DEX'] },
  staff: { name: 'Staff', slot: 'weapon', weapon: 'staff', main: ['INT'] },
  wand: { name: 'Wand', slot: 'weapon', weapon: 'wand', main: ['INT'] },
  // helmets
  heavy_helm: { name: 'Heavy Helm', slot: 'helmet', armor: 'heavy', main: ['VIT', 'STR'] },
  medium_helm: { name: 'Hood', slot: 'helmet', armor: 'medium', main: ['DEX', 'VIT'] },
  light_helm: { name: 'Circlet', slot: 'helmet', armor: 'light', main: ['INT', 'VIT'] },
  // chest
  heavy_chest: { name: 'Plate Armor', slot: 'chest', armor: 'heavy', main: ['VIT', 'STR'] },
  medium_chest: { name: 'Leather Vest', slot: 'chest', armor: 'medium', main: ['DEX', 'VIT'] },
  light_chest: { name: 'Robe', slot: 'chest', armor: 'light', main: ['INT', 'VIT'] },
  // gloves
  heavy_gloves: { name: 'Gauntlets', slot: 'gloves', armor: 'heavy', main: ['STR'] },
  medium_gloves: { name: 'Grips', slot: 'gloves', armor: 'medium', main: ['DEX'] },
  light_gloves: { name: 'Silk Gloves', slot: 'gloves', armor: 'light', main: ['INT'] },
  // boots
  heavy_boots: { name: 'Greaves', slot: 'boots', armor: 'heavy', main: ['VIT', 'AGI'] },
  medium_boots: { name: 'Swift Boots', slot: 'boots', armor: 'medium', main: ['AGI', 'DEX'] },
  light_boots: { name: 'Slippers', slot: 'boots', armor: 'light', main: ['AGI', 'INT'] },
  // accessories (no weight class — any class may wear them)
  ring: { name: 'Ring', slot: 'accessory', accessory: true, main: ['DEX', 'INT', 'STR'] },
  amulet: { name: 'Amulet', slot: 'accessory', accessory: true, main: ['INT', 'VIT'] },
};

const BASES_BY_SLOT = {};
for (const [id, b] of Object.entries(ITEM_BASES)) (BASES_BY_SLOT[b.slot] = BASES_BY_SLOT[b.slot] || []).push(id);

// Drop tuning. mobChance is per-mob; mob level drives item level + a rarity
// boost (tougher zones spawn higher-level mobs → better loot).
export const LOOT = { mobChance: 0.22, levelToBoost: 0.05 };

let _seq = 1;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const newId = () => `it${Date.now().toString(36)}${(_seq++).toString(36)}`;

// Weighted rarity roll. `boost` (>=0) shifts the odds toward higher tiers.
function rollRarity(boost = 0) {
  const weights = RARITIES.map((r, i) => r.weight * Math.pow(1 + boost, i));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < RARITIES.length; i++) { roll -= weights[i]; if (roll <= 0) return RARITIES[i]; }
  return RARITIES[0];
}

// Build a concrete item. ilvl ~ mob level; rarityBoost from zone/boss difficulty.
export function rollItem({ ilvl = 1, rarityBoost = 0, baseId = null, rarityKey = null } = {}) {
  const id = baseId && ITEM_BASES[baseId] ? baseId : pick(Object.keys(ITEM_BASES));
  const base = ITEM_BASES[id];
  const rarity = (rarityKey && RARITY_BY_KEY[rarityKey]) || rollRarity(rarityBoost);
  const budget = Math.max(1, Math.round((2 + ilvl * 0.7) * rarity.mult));
  const stats = {};
  const mainPts = Math.round(budget * 0.7); // 70% to the base's favored stats
  for (let i = 0; i < mainPts; i++) { const k = pick(base.main); stats[k] = (stats[k] || 0) + 1; }
  for (let i = 0; i < budget - mainPts; i++) { const k = pick(STAT_KEYS); stats[k] = (stats[k] || 0) + 1; }
  return { id: newId(), base: id, slot: base.slot, rarity: rarity.key, ilvl, plus: 0, name: `${rarity.name} ${base.name}`, stats };
}

// Roll whether a mob drops, and what.
export function rollDrop({ mobLevel = 1, chance = LOOT.mobChance, rarityBoost = 0 } = {}) {
  if (Math.random() > chance) return null;
  return rollItem({ ilvl: mobLevel, rarityBoost: rarityBoost || mobLevel * LOOT.levelToBoost });
}

// Gold rewards. Every mob drops some gold (scaled by level); bosses pay out a
// chunk scaled by their XP value. Shared so solo and server stay in step.
export function mobGold(level = 1) {
  return Math.max(1, Math.round((4 + level * 2.5) * (0.7 + Math.random() * 0.6)));
}
export function bossGold(xp = 0) {
  return Math.round(xp * 0.6);
}

// Re-derive a clean item from possibly-untrusted data (saved progress sent by a
// client). Validates the base/rarity, caps item level, and clamps the total
// stat budget so a tampered save can't inject an absurdly powerful item.
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = ITEM_BASES[raw.base];
  const rarity = RARITY_BY_KEY[raw.rarity];
  if (!base || !rarity) return null;
  const ilvl = Math.max(1, Math.min(99, (raw.ilvl | 0) || 1));
  const plus = Math.max(0, Math.min(50, (raw.plus | 0) || 0)); // shop upgrade level
  // Each upgrade (+1) grants UPGRADE_STEP stat points on top of the rolled budget.
  const maxBudget = Math.round((2 + ilvl * 0.7) * rarity.mult) + 2 + plus * UPGRADE_STEP; // small slack
  const stats = {};
  let used = 0;
  if (raw.stats && typeof raw.stats === 'object') for (const k of STAT_KEYS) {
    let v = Math.max(0, Math.min(maxBudget, raw.stats[k] | 0));
    if (used + v > maxBudget) v = Math.max(0, maxBudget - used);
    if (v) { stats[k] = v; used += v; }
  }
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 24) : newId();
  const name = `${rarity.name} ${base.name}${plus > 0 ? ` +${plus}` : ''}`;
  return { id, base: raw.base, slot: base.slot, rarity: rarity.key, ilvl, plus, name, stats };
}

// Stat points granted per shop upgrade (+1). Kept here so sanitizeItem and the
// shop agree on how much budget an upgraded item is allowed to carry.
export const UPGRADE_STEP = 2;

// Can a class equip this item? Uses the class's `equip` rules (armor weight
// classes + weapon kinds it's trained in). Accessories are universal.
export function canEquip(classKey, item) {
  if (!item) return false;
  const base = ITEM_BASES[item.base];
  if (!base) return false;
  const rules = CLASSES[classKey] && CLASSES[classKey].equip;
  if (!rules) return true;
  if (base.weapon) return (rules.weapons || []).includes(base.weapon);
  if (base.armor) return (rules.armor || []).includes(base.armor);
  return true; // accessory
}

export function emptyGear() { return { weapon: null, helmet: null, chest: null, gloves: null, boots: null, accessory: null }; }

// Sum of all stat bonuses from equipped gear.
export function gearBonus(gear) {
  const out = { STR: 0, DEX: 0, INT: 0, VIT: 0, AGI: 0 };
  if (!gear) return out;
  for (const slot of EQUIP_SLOTS) { const it = gear[slot]; if (it && it.stats) for (const k of STAT_KEYS) out[k] += it.stats[k] || 0; }
  return out;
}

// Base/leveled attributes + gear bonuses = the attributes derived Stats use.
export function totalAttrs(baseAttrs, gear) {
  const g = gearBonus(gear);
  const out = {};
  for (const k of STAT_KEYS) out[k] = (baseAttrs[k] || 0) + g[k];
  return out;
}

export function itemPower(item) {
  if (!item || !item.stats) return 0;
  return STAT_KEYS.reduce((s, k) => s + (item.stats[k] || 0), 0);
}
