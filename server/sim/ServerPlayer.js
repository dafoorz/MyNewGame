import { Stats } from '../../src/stats.js';
import { CLASSES, DEFAULT_CLASS } from '../../src/classes/classes.js';
import { START_ZONE } from '../../src/world/zones.js';
import { clamp } from './mathutil.js';

// Authoritative player state. The client sends movement intent + cast requests;
// everything that affects combat, position, XP and leveling is decided here.

export default class ServerPlayer {
  constructor(id, name, classKey) {
    this.id = id;
    this.name = (name || 'Player').slice(0, 16);
    this.classKey = CLASSES[classKey] ? classKey : DEFAULT_CLASS;
    this.def = CLASSES[this.classKey];
    this.stats = new Stats(this.def.stats);
    this.threatMultiplier = this.def.threat;

    this.radius = 16;
    this.x = 200; this.y = 400;
    this.facing = -Math.PI / 2;
    this.zoneKey = START_ZONE;
    this.bounds = { w: 1200, h: 820 }; // set properly on zone entry
    this.portalLock = true;

    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.alive = true;
    this.deadTimer = 0;

    // progression
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;

    this.attackTimer = 0;
    this.cooldowns = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    this.damageReduction = 0; this.shieldTimer = 0;
    this.damageMult = 1; this.speedMult = 1; this.buffTimer = 0;
    this.invulnTimer = 0; // i-frames during Dodge

    this.input = { mx: 0, my: 0, facing: this.facing };
  }

  setInput(mx, my, facing) {
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.input.mx = mx; this.input.my = my;
    if (typeof facing === 'number' && isFinite(facing)) this.input.facing = facing;
  }

  takeDamage(raw) {
    if (!this.alive || this.invulnTimer > 0) return 0; // i-frames: dodge negates the hit
    const amount = Math.max(0, Math.round(raw * (1 - this.damageReduction)));
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deadTimer = 5; }
    return amount;
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return Math.round(this.hp - before);
  }

  applyShield(reduction, duration) { this.damageReduction = reduction; this.shieldTimer = duration; }
  applyBuff(damageMult, speedMult, duration) { this.damageMult = damageMult; this.speedMult = speedMult; this.buffTimer = duration; }

  // Restore saved progress supplied by the client on join (per-device save).
  applyProgress(p) {
    if (!p) return;
    this.level = Math.max(1, p.level | 0);
    this.xp = Math.max(0, p.xp | 0);
    this.statPoints = Math.max(0, p.statPoints | 0);
    if (p.stats) for (const k of ['STR', 'DEX', 'INT', 'VIT', 'AGI']) {
      if (typeof p.stats[k] === 'number') this.stats[k] = Math.max(this.def.stats[k] || 0, p.stats[k] | 0);
    }
    this.recalc();
    this.hp = this.maxHp;
  }

  // --- progression ---
  xpToNext() { return Math.floor(60 * Math.pow(1.25, this.level - 1)); }
  addXp(amount) {
    this.xp += amount;
    let gained = 0;
    while (this.xp >= this.xpToNext()) { this.xp -= this.xpToNext(); this.level += 1; this.statPoints += 3; gained += 1; }
    return gained;
  }
  spendStat(attr) {
    if (this.statPoints <= 0 || !(attr in this.stats)) return false;
    this.statPoints -= 1;
    this.stats[attr] += 1;
    if (attr === 'VIT') this.recalc();
    return true;
  }
  recalc() {
    const newMax = this.stats.maxHp;
    const delta = newMax - this.maxHp;
    this.maxHp = newMax;
    if (delta > 0) this.hp += delta;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  update(dt) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    for (const k of [1, 2, 3, 4, 5]) if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    if (this.shieldTimer > 0) { this.shieldTimer -= dt; if (this.shieldTimer <= 0) this.damageReduction = 0; }
    if (this.buffTimer > 0) { this.buffTimer -= dt; if (this.buffTimer <= 0) { this.damageMult = 1; this.speedMult = 1; } }
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    if (this.alive && (this.input.mx !== 0 || this.input.my !== 0)) {
      const speed = this.stats.moveSpeed * this.speedMult;
      const b = this.bounds;
      this.x = clamp(this.x + this.input.mx * speed * dt, this.radius, b.w - this.radius);
      this.y = clamp(this.y + this.input.my * speed * dt, this.radius, b.h - this.radius);
    }
    this.facing = this.input.facing;
  }

  roll(stat, mult, forceCrit = false) {
    const base = (stat === 'mag' ? this.stats.magPower : this.stats.physPower) * mult;
    const variance = 0.9 + Math.random() * 0.2;
    const crit = forceCrit || Math.random() < this.stats.critChance;
    const amount = Math.max(1, Math.round(base * variance * (crit ? this.stats.critMultiplier : 1) * this.damageMult));
    return { amount, crit };
  }

  // Per-entity render data (visible to everyone in the zone).
  snapshot() {
    return {
      id: this.id, name: this.name, classKey: this.classKey,
      x: Math.round(this.x), y: Math.round(this.y), facing: +this.facing.toFixed(3),
      hp: Math.ceil(this.hp), maxHp: this.maxHp, alive: this.alive,
      shield: this.shieldTimer > 0, buff: this.buffTimer > 0, invuln: this.invulnTimer > 0, level: this.level,
    };
  }

  // Private data only the owning client needs (HUD: cooldowns, stats, XP).
  privateState() {
    const s = this.stats;
    return {
      level: this.level, xp: this.xp, xpToNext: this.xpToNext(), statPoints: this.statPoints,
      cd: { 1: +this.cooldowns[1].toFixed(2), 2: +this.cooldowns[2].toFixed(2), 3: +this.cooldowns[3].toFixed(2), 4: +this.cooldowns[4].toFixed(2), 5: +this.cooldowns[5].toFixed(2) },
      stats: { STR: s.STR, DEX: s.DEX, INT: s.INT, VIT: s.VIT, AGI: s.AGI },
    };
  }
}
