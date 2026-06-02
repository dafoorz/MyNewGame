// Stats system. Raw attributes (STR/DEX/INT/VIT/AGI) map to derived combat values.
// Stage 2 will layer class modifiers and gear on top of this same model.

export class Stats {
  constructor({ STR = 10, DEX = 10, INT = 10, VIT = 10, AGI = 10 } = {}) {
    this.STR = STR; // physical power
    this.DEX = DEX; // attack speed + crit
    this.INT = INT; // magic power
    this.VIT = VIT; // health
    this.AGI = AGI; // movement speed
  }

  get maxHp() {
    return 200 + this.VIT * 25;
  }

  // Per-hit physical damage (melee).
  get physPower() {
    return 6 + this.STR * 2.2;
  }

  // Per-hit magic damage (ranged).
  get magPower() {
    return 6 + this.INT * 2.0;
  }

  // Pixels per second.
  get moveSpeed() {
    return 170 + this.AGI * 5;
  }

  // Seconds between basic attacks (lower = faster). DEX shortens the gap.
  get attackInterval() {
    return Math.max(0.35, 0.9 - this.DEX * 0.02);
  }

  get critChance() {
    return Math.min(0.5, this.DEX * 0.012);
  }

  get critMultiplier() {
    return 1.6;
  }

  // Roll a damage value from a base power, applying crit. Returns { amount, crit }.
  roll(power) {
    const variance = 0.9 + Math.random() * 0.2; // +/-10%
    let amount = power * variance;
    const crit = Math.random() < this.critChance;
    if (crit) amount *= this.critMultiplier;
    return { amount: Math.round(amount), crit };
  }
}
