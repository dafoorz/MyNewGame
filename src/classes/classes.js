// Class definitions. Each class is pure data: a base stat spread, a basic-attack
// config, and four data-driven skills. The scene's skill engine interprets the
// `type` field, so adding a class or skill is just editing this file.
//
// Skill `type`s the engine understands:
//   arc     melee cone in front     { stat?, mult, threat?, crit?, half?, rangeBonus? }
//   nova    point-blank circle      { stat?, radius, mult, crit? }
//   blast   circle at nearest enemy { stat, radius, mult }
//   bolt    projectile(s)           { stat, count?, spread?, mult, speed?, pierce?, crit?, lifesteal? }
//   taunt   force aggro + light hit { arcMult? }
//   shield  self damage reduction   { reduction, duration, heal?, intMult? }
//   heal    restore HP (self/ally)  { intMult, allies? }
//   buff    temp damage/speed boost { damageMult?, speedMult?, duration, allies? }
//   stealth vanish + crit next hit  { duration, critMult }
//   dash    lunge forward + arc     { distance, mult }
//   dodge   i-frame roll (no damage) { distance, iframe }  — universal slot 5
//   dot     damage-over-time on foe { intMult, duration }
//   summon  raise minions           { count, duration }

export const CLASSES = {
  warrior: {
    name: 'Warrior', role: 'Tank · Melee', color: 0x4a90d9,
    desc: 'Sturdy frontline. Holds aggro, cleaves, and shields.',
    stats: { STR: 15, DEX: 11, INT: 5, VIT: 20, AGI: 9 },
    threat: 4.0,
    basic: { kind: 'melee', stat: 'phys', range: 78, mult: 1 },
    skills: [
      { key: '1', name: 'Heavy Strike', cd: 5, color: '#ffcf6b', type: 'arc', mult: 2.6, threat: 2, crit: true },
      { key: '2', name: 'Taunt', cd: 11, color: '#ff8c5a', type: 'taunt', arcMult: 0.8 },
      { key: '3', name: 'Shield Wall', cd: 16, color: '#66ccff', type: 'shield', reduction: 0.55, duration: 4 },
      { key: '4', name: 'Whirlwind', cd: 8, color: '#c89bff', type: 'nova', stat: 'phys', radius: 105, mult: 1.7, crit: true },
    ],
  },

  mage: {
    name: 'Mage', role: 'Caster · Ranged', color: 0x46c46e,
    desc: 'Glass cannon. Heavy AoE nukes, very low health.',
    stats: { STR: 5, DEX: 11, INT: 20, VIT: 8, AGI: 12 },
    threat: 1.0,
    basic: { kind: 'ranged', stat: 'mag', range: 360, mult: 1, speed: 430 },
    skills: [
      { key: '1', name: 'Fireball', cd: 4, color: '#ff7a3c', type: 'blast', stat: 'mag', radius: 95, mult: 2.2 },
      { key: '2', name: 'Frost Nova', cd: 9, color: '#7fd9ff', type: 'nova', stat: 'mag', radius: 115, mult: 1.5 },
      { key: '3', name: 'Arcane Barrage', cd: 6, color: '#c89bff', type: 'bolt', stat: 'mag', count: 3, spread: 0.22, mult: 1.0, speed: 430 },
      { key: '4', name: 'Meteor', cd: 14, color: '#ff5a5a', type: 'blast', stat: 'mag', radius: 135, mult: 3.2 },
    ],
  },

  rogue: {
    name: 'Rogue', role: 'Assassin · Melee', color: 0xd6c34a,
    desc: 'Burst damage and crits. Stealth and gap-closing dash.',
    stats: { STR: 11, DEX: 18, INT: 6, VIT: 11, AGI: 18 },
    threat: 1.0,
    basic: { kind: 'melee', stat: 'phys', range: 70, mult: 1 },
    skills: [
      { key: '1', name: 'Backstab', cd: 4, color: '#ffcf6b', type: 'arc', mult: 3.0, crit: true, half: 0.5 },
      { key: '2', name: 'Stealth', cd: 12, color: '#9aa6c4', type: 'stealth', duration: 4, critMult: 2.5 },
      { key: '3', name: 'Dash Strike', cd: 7, color: '#7fd9ff', type: 'dash', distance: 170, mult: 2.0 },
      { key: '4', name: 'Fan of Knives', cd: 8, color: '#c89bff', type: 'nova', stat: 'phys', radius: 95, mult: 1.3, crit: true },
    ],
  },

  archer: {
    name: 'Archer', role: 'Marksman · Ranged', color: 0x8bd96a,
    desc: 'Physical ranged. Strong single-target and kiting.',
    stats: { STR: 9, DEX: 20, INT: 6, VIT: 10, AGI: 15 },
    threat: 1.0,
    basic: { kind: 'ranged', stat: 'phys', range: 380, mult: 1, speed: 480 },
    skills: [
      { key: '1', name: 'Power Shot', cd: 4, color: '#ffcf6b', type: 'bolt', stat: 'phys', count: 1, mult: 3.0, speed: 560, pierce: true, crit: true },
      { key: '2', name: 'Multishot', cd: 7, color: '#7fd9ff', type: 'bolt', stat: 'phys', count: 3, spread: 0.26, mult: 1.2, speed: 480 },
      { key: '3', name: 'Evasion Roll', cd: 9, color: '#9be8ff', type: 'buff', speedMult: 1.7, duration: 3 },
      { key: '4', name: 'Rain of Arrows', cd: 12, color: '#c89bff', type: 'blast', stat: 'phys', radius: 115, mult: 1.8 },
    ],
  },

  healer: {
    name: 'Healer', role: 'Support', color: 0xf2e27a,
    desc: 'Heals and buffs allies. Weak solo damage.',
    stats: { STR: 7, DEX: 11, INT: 17, VIT: 13, AGI: 10 },
    threat: 1.0,
    basic: { kind: 'ranged', stat: 'mag', range: 340, mult: 0.8, speed: 400 },
    skills: [
      { key: '1', name: 'Holy Light', cd: 5, color: '#ffe066', type: 'heal', intMult: 2.5, allies: true },
      { key: '2', name: 'Smite', cd: 4, color: '#fff1a8', type: 'bolt', stat: 'mag', count: 1, mult: 1.8, speed: 430 },
      { key: '3', name: 'Blessing', cd: 14, color: '#9be8ff', type: 'buff', damageMult: 1.35, duration: 8, allies: true },
      { key: '4', name: 'Sanctuary', cd: 16, color: '#66ccff', type: 'shield', reduction: 0.6, duration: 5, heal: true, intMult: 1.5 },
    ],
  },

  necromancer: {
    name: 'Necromancer', role: 'Summoner · Ranged', color: 0xa46cd6,
    desc: 'Raises minions, curses with decay, drains life.',
    stats: { STR: 6, DEX: 10, INT: 19, VIT: 12, AGI: 9 },
    threat: 1.0,
    basic: { kind: 'ranged', stat: 'mag', range: 320, mult: 0.9, speed: 380 },
    skills: [
      { key: '1', name: 'Raise Dead', cd: 14, color: '#a4f06c', type: 'summon', count: 2, duration: 16 },
      { key: '2', name: 'Curse', cd: 7, color: '#c06cff', type: 'dot', intMult: 0.8, duration: 6 },
      { key: '3', name: 'Life Drain', cd: 5, color: '#ff6cae', type: 'bolt', stat: 'mag', count: 1, mult: 1.6, speed: 360, lifesteal: 0.6 },
      { key: '4', name: 'Bone Nova', cd: 9, color: '#e0e0d0', type: 'nova', stat: 'mag', radius: 100, mult: 1.6 },
    ],
  },
};

// Universal Dodge: every class gets a 5th skill — a quick roll that grants brief
// invulnerability (i-frames) and no damage. Ranged classes roll farther so they
// can reposition out of melee. 10s cooldown.
for (const cls of Object.values(CLASSES)) {
  cls.skills.push({ key: 'E', name: 'Dodge', cd: 10, color: '#5dd9ff', type: 'dodge', distance: 150, iframe: 0.45 });
}

export const CLASS_ORDER = ['warrior', 'mage', 'rogue', 'archer', 'healer', 'necromancer'];
export const DEFAULT_CLASS = 'warrior';
