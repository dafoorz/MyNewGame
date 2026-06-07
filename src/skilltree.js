// Per-class skill trees (Stage 7). Shared + Phaser-free: imported by the solo
// client, the online client UI, AND the authoritative server (which validates
// every spend — saves are never trusted). Pure data + pure functions.
//
// Currency: 1 SKILL POINT per level (separate from the 3 stat points/level).
// A node has ranks (max), a cost/rank, prerequisites, and an effect:
//   { kind:'stat',  stat, perRank }                       passive attribute boost
//   { kind:'skill', slot, power?, cd?, count?, radius?,   upgrade an existing skill
//                   dur?, reduction?, lifesteal?, pierce? }  (per-rank values)
//   { kind:'unlock', slot, skill:{...full def...} }       replace a slot with a new skill
// `requires`: node ids that need >=1 rank first. `reqPoints`: min points already
// spent in this tree (gates capstones). col/row drive the UI layout.

import { CLASSES } from './classes/classes.js';

export const STAT_KEYS = ['STR', 'DEX', 'INT', 'VIT', 'AGI'];

// --- node helpers (keep the tree tables terse) ------------------------------
const stat = (id, s, perRank, col, row, max = 3) =>
  ({ id, name: `+${s}`, desc: `+${perRank} ${s} per rank`, max, cost: 1, col, row, requires: [], effect: { kind: 'stat', stat: s, perRank } });
const node = (id, name, desc, col, row, requires, effect, opts = {}) =>
  ({ id, name, desc, max: opts.max || 2, cost: opts.cost || 1, reqPoints: opts.reqPoints || 0, col, row, requires, effect });
const cap = (id, name, desc, slot, skill, requires) =>
  ({ id, name, desc, max: 1, cost: 1, reqPoints: 5, col: 1, row: 3, requires, effect: { kind: 'unlock', slot, skill } });

// Reuse the base slot's key/color when defining an unlock so the HUD stays consistent.
const K = (cls, slot) => CLASSES[cls].skills[slot].key;
const COL = (cls, slot) => CLASSES[cls].skills[slot].color;

export const SKILL_TREES = {
  warrior: [
    stat('w_str', 'STR', 2, 0, 0), stat('w_vit', 'VIT', 2, 2, 0),
    node('w_hs', 'Crushing Blows', 'Heavy Strike +15% damage / rank', 0, 1, ['w_str'], { kind: 'skill', slot: 0, power: 0.15 }),
    node('w_sw', 'Bulwark', 'Shield Wall +6% reduction & +1s / rank', 2, 1, ['w_vit'], { kind: 'skill', slot: 2, reduction: 0.06, dur: 1 }),
    node('w_ww', 'Cyclone', 'Whirlwind +12% damage & +10% radius / rank', 0, 2, ['w_hs'], { kind: 'skill', slot: 3, power: 0.12, radius: 0.1 }),
    node('w_taunt', 'Roar', 'Taunt -12% cooldown / rank', 2, 2, ['w_sw'], { kind: 'skill', slot: 1, cd: 0.12 }),
    cap('w_quake', 'Earthquake', 'Replaces Whirlwind with a huge crit nova', 3,
      { key: K('warrior', 3), name: 'Earthquake', color: COL('warrior', 3), type: 'nova', stat: 'phys', radius: 155, mult: 2.7, crit: true, cd: 9 }, ['w_ww']),
  ],
  mage: [
    stat('m_int', 'INT', 2, 0, 0), stat('m_agi', 'AGI', 2, 2, 0),
    node('m_fb', 'Pyromancy', 'Fireball +15% damage & +8% radius / rank', 0, 1, ['m_int'], { kind: 'skill', slot: 0, power: 0.15, radius: 0.08 }),
    node('m_ab', 'Arcane Surge', 'Arcane Barrage +1 bolt, +10% damage', 2, 1, ['m_agi'], { kind: 'skill', slot: 2, count: 1, power: 0.1, max: 1 }),
    node('m_fn', 'Deep Freeze', 'Frost Nova +12% damage & +10% radius / rank', 0, 2, ['m_fb'], { kind: 'skill', slot: 1, power: 0.12, radius: 0.1 }),
    node('m_meteor', 'Cataclysm', 'Meteor +12% damage & -8% cooldown / rank', 2, 2, ['m_ab'], { kind: 'skill', slot: 3, power: 0.12, cd: 0.08 }),
    cap('m_inferno', 'Inferno', 'Replaces Meteor with a massive firestorm', 3,
      { key: K('mage', 3), name: 'Inferno', color: COL('mage', 3), type: 'blast', stat: 'mag', radius: 175, mult: 4.2, cd: 13 }, ['m_meteor']),
  ],
  rogue: [
    stat('r_dex', 'DEX', 2, 0, 0), stat('r_agi', 'AGI', 2, 2, 0),
    node('r_bs', 'Lethality', 'Backstab +18% damage / rank', 0, 1, ['r_dex'], { kind: 'skill', slot: 0, power: 0.18 }),
    node('r_dash', 'Shadowstep', 'Dash Strike +12% damage & -10% cooldown / rank', 2, 1, ['r_agi'], { kind: 'skill', slot: 2, power: 0.12, cd: 0.1 }),
    node('r_fan', 'Bladestorm', 'Fan of Knives +12% damage & +10% radius / rank', 0, 2, ['r_bs'], { kind: 'skill', slot: 3, power: 0.12, radius: 0.1 }),
    node('r_stealth', 'Shadow Cloak', 'Stealth +1s & -8% cooldown / rank', 2, 2, ['r_dash'], { kind: 'skill', slot: 1, dur: 1, cd: 0.08 }),
    cap('r_assassinate', 'Assassinate', 'Replaces Backstab with a lethal strike', 0,
      { key: K('rogue', 0), name: 'Assassinate', color: COL('rogue', 0), type: 'arc', mult: 5.2, crit: true, half: 0.5, cd: 5 }, ['r_fan']),
  ],
  archer: [
    stat('a_dex', 'DEX', 2, 0, 0), stat('a_agi', 'AGI', 2, 2, 0),
    node('a_ps', 'Deadeye', 'Power Shot +15% damage / rank', 0, 1, ['a_dex'], { kind: 'skill', slot: 0, power: 0.15 }),
    node('a_ms', 'Barrage', 'Multishot +1 arrow, +10% damage', 2, 1, ['a_agi'], { kind: 'skill', slot: 1, count: 1, power: 0.1, max: 1 }),
    node('a_rain', 'Stormfall', 'Rain of Arrows +12% damage & +10% radius / rank', 0, 2, ['a_ps'], { kind: 'skill', slot: 3, power: 0.12, radius: 0.1 }),
    node('a_evasion', 'Fleetfoot', 'Evasion Roll +1s & -8% cooldown / rank', 2, 2, ['a_ms'], { kind: 'skill', slot: 2, dur: 1, cd: 0.08 }),
    cap('a_storm', 'Arrow Storm', 'Replaces Multishot with a wide volley', 1,
      { key: K('archer', 1), name: 'Arrow Storm', color: COL('archer', 1), type: 'bolt', stat: 'phys', count: 7, spread: 0.5, mult: 1.4, speed: 500, cd: 9 }, ['a_rain']),
  ],
  healer: [
    stat('h_int', 'INT', 2, 0, 0), stat('h_vit', 'VIT', 2, 2, 0),
    node('h_heal', 'Devotion', 'Holy Light +15% healing / rank', 0, 1, ['h_int'], { kind: 'skill', slot: 0, power: 0.15 }),
    node('h_smite', 'Wrath', 'Smite +15% damage / rank', 2, 1, ['h_vit'], { kind: 'skill', slot: 1, power: 0.15 }),
    node('h_sanct', 'Aegis', 'Sanctuary +5% reduction & +1s / rank', 0, 2, ['h_heal'], { kind: 'skill', slot: 3, reduction: 0.05, dur: 1 }),
    node('h_bless', 'Exaltation', 'Blessing +1s & -8% cooldown / rank', 2, 2, ['h_smite'], { kind: 'skill', slot: 2, dur: 1, cd: 0.08 }),
    cap('h_divine', 'Divine Light', 'Replaces Holy Light with a powerful group heal', 0,
      { key: K('healer', 0), name: 'Divine Light', color: COL('healer', 0), type: 'heal', intMult: 4.2, allies: true, cd: 5 }, ['h_sanct']),
  ],
  necromancer: [
    stat('n_int', 'INT', 2, 0, 0), stat('n_vit', 'VIT', 2, 2, 0),
    node('n_drain', 'Soul Siphon', 'Life Drain +15% damage & +10% lifesteal / rank', 0, 1, ['n_int'], { kind: 'skill', slot: 2, power: 0.15, lifesteal: 0.1 }),
    node('n_curse', 'Withering', 'Curse +12% damage & +1s / rank', 2, 1, ['n_vit'], { kind: 'skill', slot: 1, power: 0.12, dur: 1 }),
    node('n_nova', 'Bone Storm', 'Bone Nova +12% damage & +10% radius / rank', 0, 2, ['n_drain'], { kind: 'skill', slot: 3, power: 0.12, radius: 0.1 }),
    node('n_raise', 'Mass Grave', 'Raise Dead +1 minion & -10% cooldown', 2, 2, ['n_curse'], { kind: 'skill', slot: 0, count: 1, cd: 0.1, max: 1 }),
    cap('n_army', 'Army of the Dead', 'Replaces Raise Dead with a larger, longer horde', 0,
      { key: K('necromancer', 0), name: 'Army of the Dead', color: COL('necromancer', 0), type: 'summon', count: 4, duration: 22, cd: 16 }, ['n_raise']),
  ],
};

export const treeFor = (classKey) => SKILL_TREES[classKey] || [];
const nodeById = (classKey, id) => treeFor(classKey).find((n) => n.id === id) || null;

// Skill points earned by a given level (1 per level after level 1).
export function skillPointsForLevel(level) { return Math.max(0, (level | 0) - 1); }

// Points already committed in an allocation { nodeId: rank }.
export function spentPoints(classKey, alloc) {
  let total = 0;
  for (const n of treeFor(classKey)) total += (alloc[n.id] || 0) * (n.cost || 1);
  return total;
}
export function availablePoints(classKey, level, alloc) { return skillPointsForLevel(level) - spentPoints(classKey, alloc); }

// Why a node can / can't take another rank right now (UI + server share this).
export function nodeStatus(classKey, alloc, level, nodeId) {
  const n = nodeById(classKey, nodeId);
  if (!n) return { ok: false, reason: 'unknown' };
  const rank = alloc[n.id] || 0;
  if (rank >= n.max) return { ok: false, reason: 'maxed' };
  if (!n.requires.every((r) => (alloc[r] || 0) >= 1)) return { ok: false, reason: 'locked' };
  if (n.reqPoints && spentPoints(classKey, alloc) < n.reqPoints) return { ok: false, reason: `needs ${n.reqPoints} pts` };
  if (availablePoints(classKey, level, alloc) < (n.cost || 1)) return { ok: false, reason: 'no points' };
  return { ok: true };
}
export function canSpend(classKey, alloc, level, nodeId) { return nodeStatus(classKey, alloc, level, nodeId).ok; }

// Rebuild a fully-legal allocation from possibly-tampered data (server trust
// boundary). Greedily grants requested ranks only where prereqs + budget allow.
export function sanitizeAllocation(classKey, requested, level) {
  const out = {};
  const tree = treeFor(classKey);
  const budget = skillPointsForLevel(level);
  let spent = 0, changed = true;
  const want = (id) => Math.max(0, Math.min((requested && requested[id]) | 0, (nodeById(classKey, id) || { max: 0 }).max));
  while (changed) {
    changed = false;
    for (const n of tree) {
      while ((out[n.id] || 0) < want(n.id)) {
        if (!n.requires.every((r) => (out[r] || 0) >= 1)) break;
        if (n.reqPoints && spent < n.reqPoints) break;
        if (spent + (n.cost || 1) > budget) break;
        out[n.id] = (out[n.id] || 0) + 1; spent += (n.cost || 1); changed = true;
      }
    }
  }
  return out;
}

// Aggregate an allocation into a flat "build": stat bonuses + per-slot skill mods
// + slot unlocks.
export function buildFromTree(classKey, alloc) {
  const build = { stat: { STR: 0, DEX: 0, INT: 0, VIT: 0, AGI: 0 }, skill: {}, unlock: {} };
  for (const n of treeFor(classKey)) {
    const rank = alloc[n.id] || 0;
    if (rank <= 0) continue;
    const e = n.effect;
    if (e.kind === 'stat') build.stat[e.stat] += (e.perRank || 0) * rank;
    else if (e.kind === 'unlock') build.unlock[e.slot] = e.skill;
    else if (e.kind === 'skill') {
      const m = build.skill[e.slot] || (build.skill[e.slot] = { powerMult: 1, cdMult: 1, countAdd: 0, radiusMult: 1, durAdd: 0, reductionAdd: 0, lifestealAdd: 0, pierce: false });
      if (e.power) m.powerMult += e.power * rank;
      if (e.cd) m.cdMult -= e.cd * rank;
      if (e.count) m.countAdd += e.count * rank;
      if (e.radius) m.radiusMult += e.radius * rank;
      if (e.dur) m.durAdd += e.dur * rank;
      if (e.reduction) m.reductionAdd += e.reduction * rank;
      if (e.lifesteal) m.lifestealAdd += e.lifesteal * rank;
      if (e.pierce) m.pierce = true;
    }
  }
  for (const slot in build.skill) build.skill[slot].cdMult = Math.max(0.4, build.skill[slot].cdMult);
  return build;
}

// The effective skill def for a slot, given a build (unlock overrides the base,
// then per-slot mods apply). Returns a NEW object — never mutates class data.
export function effectiveSkill(classDef, slotIndex, build) {
  const base = (build && build.unlock && build.unlock[slotIndex]) || classDef.skills[slotIndex];
  const m = build && build.skill && build.skill[slotIndex];
  if (!m) return base;
  const out = { ...base };
  if (base.mult != null) out.mult = +(base.mult * m.powerMult).toFixed(3);
  if (base.intMult != null) out.intMult = +(base.intMult * m.powerMult).toFixed(3);
  if (base.cd != null) out.cd = +(base.cd * m.cdMult).toFixed(2);
  if (m.countAdd) out.count = (base.count || 1) + m.countAdd;
  if (base.radius != null) out.radius = Math.round(base.radius * m.radiusMult);
  if (base.duration != null && m.durAdd) out.duration = +(base.duration + m.durAdd).toFixed(2);
  if (base.reduction != null && m.reductionAdd) out.reduction = Math.min(0.85, +(base.reduction + m.reductionAdd).toFixed(3));
  if (m.lifestealAdd) out.lifesteal = +((base.lifesteal || 0) + m.lifestealAdd).toFixed(3);
  if (m.pierce) out.pierce = true;
  return out;
}

// Convenience: all 5 effective skill defs for a class given an allocation.
export function effectiveSkills(classDef, build) {
  return classDef.skills.map((_, i) => effectiveSkill(classDef, i, build));
}
