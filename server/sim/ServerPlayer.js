import { Stats } from '../../src/stats.js';
import { CLASSES, DEFAULT_CLASS } from '../../src/classes/classes.js';
import { clamp } from './mathutil.js';

// Authoritative player state. The client sends movement intent + cast requests;
// everything that affects combat is decided here.

export default class ServerPlayer {
  constructor(id, name, classKey, bounds) {
    this.id = id;
    this.name = (name || 'Player').slice(0, 16);
    this.classKey = CLASSES[classKey] ? classKey : DEFAULT_CLASS;
    this.def = CLASSES[this.classKey];
    this.stats = new Stats(this.def.stats);
    this.threatMultiplier = this.def.threat;
    this.bounds = bounds;

    this.radius = 16;
    this.x = 200;
    this.y = bounds.h / 2;
    this.facing = -Math.PI / 2;

    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.alive = true;

    this.attackTimer = 0;
    this.cooldowns = { 1: 0, 2: 0, 3: 0, 4: 0 };

    this.damageReduction = 0;
    this.shieldTimer = 0;
    this.damageMult = 1;
    this.speedMult = 1;
    this.buffTimer = 0;

    // Latest input from the client.
    this.input = { mx: 0, my: 0, facing: this.facing };
  }

  setInput(mx, my, facing) {
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.input.mx = mx;
    this.input.my = my;
    if (typeof facing === 'number' && isFinite(facing)) this.input.facing = facing;
  }

  takeDamage(raw) {
    if (!this.alive) return 0;
    const amount = Math.max(0, Math.round(raw * (1 - this.damageReduction)));
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
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

  update(dt) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    for (const k of [1, 2, 3, 4]) if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    if (this.shieldTimer > 0) { this.shieldTimer -= dt; if (this.shieldTimer <= 0) this.damageReduction = 0; }
    if (this.buffTimer > 0) { this.buffTimer -= dt; if (this.buffTimer <= 0) { this.damageMult = 1; this.speedMult = 1; } }

    if (this.alive && (this.input.mx !== 0 || this.input.my !== 0)) {
      const speed = this.stats.moveSpeed * this.speedMult;
      const b = this.bounds;
      this.x = clamp(this.x + this.input.mx * speed * dt, this.radius, b.w - this.radius);
      this.y = clamp(this.y + this.input.my * speed * dt, this.radius, b.h - this.radius);
    }
    this.facing = this.input.facing;
  }

  // Roll outgoing damage with crit + buffs (server-authoritative).
  roll(stat, mult, forceCrit = false) {
    const base = (stat === 'mag' ? this.stats.magPower : this.stats.physPower) * mult;
    const variance = 0.9 + Math.random() * 0.2;
    const crit = forceCrit || Math.random() < this.stats.critChance;
    const amount = Math.max(1, Math.round(base * variance * (crit ? this.stats.critMultiplier : 1) * this.damageMult));
    return { amount, crit };
  }

  snapshot() {
    return {
      id: this.id, name: this.name, classKey: this.classKey,
      x: Math.round(this.x), y: Math.round(this.y), facing: +this.facing.toFixed(3),
      hp: Math.ceil(this.hp), maxHp: this.maxHp, alive: this.alive,
      shield: this.shieldTimer > 0, buff: this.buffTimer > 0,
      cd: { 1: +this.cooldowns[1].toFixed(2), 2: +this.cooldowns[2].toFixed(2), 3: +this.cooldowns[3].toFixed(2), 4: +this.cooldowns[4].toFixed(2) },
    };
  }
}
