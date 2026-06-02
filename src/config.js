// Central tuning + constants. Tweak numbers here to balance the fight.

export const CONFIG = {
  width: 1024,
  height: 700,

  // Playable arena rectangle (inside the canvas margins).
  arena: { x: 40, y: 130, w: 944, h: 520 },

  colors: {
    bg: 0x0d0d18,
    arenaFill: 0x161a2e,
    arenaEdge: 0x2c3358,
    tank: 0x4a90d9,
    mage: 0x46c46e,
    boss: 0xd9534f,
    telegraph: 0xff3b3b,
    telegraphSafe: 0xffd24a,
    hpGood: 0x33cc55,
    hpMid: 0xe0a020,
    hpLow: 0xcc3333,
    text: 0xe6e9f2,
  },

  // Threat multipliers — how much "aggro" each role generates per point of damage.
  // The Tank generates far more so it reliably holds the boss.
  threat: {
    tank: 4.0,
    mage: 1.0,
    tauntBonus: 600, // flat threat added on top of current max when taunting
  },
};

// Default attribute spreads for Stage 1 characters.
export const STAT_PRESETS = {
  tank: { STR: 14, DEX: 12, INT: 6, VIT: 18, AGI: 10 },
  mage: { STR: 6, DEX: 12, INT: 20, VIT: 8, AGI: 12 },
};
