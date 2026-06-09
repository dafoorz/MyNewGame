// Town shop economy (Phaser-free, server-safe): imported by BOTH the browser
// client and the authoritative Node server so prices, item rolls and upgrade
// math are ONE source of truth. Solo applies these locally; online the server
// validates every purchase/upgrade (gold + town-only) before applying.

import { ITEM_BASES, EQUIP_SLOTS, STAT_KEYS, rollItem, itemPower, canEquip, UPGRADE_STEP } from './items.js';

// Gear tiers you can buy. Higher tiers roll a higher item level + a rarity boost
// (better odds of uncommon/rare/epic), and cost proportionally more.
export const SHOP_TIERS = [
  { key: 'standard', name: 'Standard', ilvl: 8,  rarityBoost: 0.5, baseCost: 150 },
  { key: 'fine',     name: 'Fine',     ilvl: 18, rarityBoost: 1.2, baseCost: 480 },
  { key: 'superior', name: 'Superior', ilvl: 30, rarityBoost: 2.2, baseCost: 1400 },
];
export const SHOP_TIER_BY_KEY = Object.fromEntries(SHOP_TIERS.map((t) => [t.key, t]));

// Weapons/accessories cost a touch more than armor pieces.
function slotMult(slot) { return slot === 'weapon' ? 1.4 : slot === 'accessory' ? 1.2 : 1.0; }

export function buyCost(slot, tierKey) {
  const tier = SHOP_TIER_BY_KEY[tierKey];
  if (!tier || !EQUIP_SLOTS.includes(slot)) return null;
  return Math.round(tier.baseCost * slotMult(slot));
}

// Pick a base for this slot the class can actually equip (falls back to any base
// of the slot for accessories / universal items).
function usableBaseForSlot(classKey, slot) {
  const bases = Object.keys(ITEM_BASES).filter((id) => ITEM_BASES[id].slot === slot);
  const ok = bases.filter((id) => canEquip(classKey, { base: id, slot }));
  const pool = ok.length ? ok : bases;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Roll a class-appropriate item for a shop purchase. Authority (server in online,
// client in solo) calls this AFTER confirming the buyer can afford buyCost().
export function rollShopItem(classKey, slot, tierKey) {
  const tier = SHOP_TIER_BY_KEY[tierKey];
  if (!tier || !EQUIP_SLOTS.includes(slot)) return null;
  const baseId = usableBaseForSlot(classKey, slot);
  return rollItem({ ilvl: tier.ilvl, rarityBoost: tier.rarityBoost, baseId });
}

// Cost to upgrade an item by +1 — rises with the item's current power and how
// many times it's already been upgraded.
export function upgradeCost(item) {
  if (!item) return null;
  const power = itemPower(item);
  const plus = item.plus || 0;
  return Math.round(60 + power * 12 + plus * plus * 40);
}

// Return a NEW item that's one upgrade higher: +UPGRADE_STEP stat points poured
// into the base's favored stats, plus bumped name. Stats stay within the budget
// sanitizeItem allows for that plus level, so it survives save/reload.
export function upgradeItem(item) {
  if (!item) return null;
  const base = ITEM_BASES[item.base];
  const mains = (base && base.main) || STAT_KEYS;
  const stats = { ...item.stats };
  for (let i = 0; i < UPGRADE_STEP; i++) { const k = mains[Math.floor(Math.random() * mains.length)]; stats[k] = (stats[k] || 0) + 1; }
  const plus = (item.plus || 0) + 1;
  const baseName = item.name.replace(/\s*\+\d+$/, '');
  return { ...item, stats, plus, name: `${baseName} +${plus}` };
}
