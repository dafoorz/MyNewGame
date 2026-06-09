import { Stats } from '../../src/stats.js';
import { CLASSES, DEFAULT_CLASS } from '../../src/classes/classes.js';
import { START_ZONE } from '../../src/world/zones.js';
import { clamp } from './mathutil.js';
import { STAT_KEYS, EQUIP_SLOTS, INV_CAP, emptyGear, totalAttrs, canEquip, sanitizeItem } from '../../src/items.js';
import { buildFromTree, effectiveSkill, sanitizeAllocation, availablePoints, canSpend } from '../../src/skilltree.js';

// Authoritative player state. The client sends movement intent + cast requests;
// everything that affects combat, position, XP and leveling is decided here.

export default class ServerPlayer {
  constructor(id, name, classKey) {
    this.id = id;
    this.name = (name || 'Player').slice(0, 16);
    this.classKey = CLASSES[classKey] ? classKey : DEFAULT_CLASS;
    this.def = CLASSES[this.classKey];
    this.baseAttrs = { ...this.def.stats }; // leveled attributes (no gear)
    this.gear = emptyGear();                // equipped items per slot
    this.inventory = [];                    // backpack
    this.skillTree = {};                    // skill-tree allocation { nodeId: rank }
    this.skillBuild = buildFromTree(this.classKey, this.skillTree);
    this.stats = new Stats(this.totalAttrsWithBuild()); // base + gear + tree
    this.threatMultiplier = this.def.threat;

    this.radius = 16;
    this.x = 200; this.y = 400;
    this.facing = -Math.PI / 2;
    this.aimX = null; this.aimY = null; // last cast's cursor world target (placed skills)
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
    this.cooldowns = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    this.damageReduction = 0; this.shieldTimer = 0;
    this.damageMult = 1; this.speedMult = 1; this.buffTimer = 0;
    this.invulnTimer = 0; // i-frames during Dodge
    this.isBlocking = false;
    this.blockTimer = 0;

    this.waypoints = new Set(['town']); // discovered fast-travel shrines
    this.portalLockId = null;           // suppress re-triggering the waystone we arrived on
    this.combatTimer = 0;               // >0 = in combat (set on hit/attack, decays over 5s)

    this.input = { mx: 0, my: 0, facing: this.facing };
  }

  // Mark the player as "in combat" for the next 5s (attacking or being hit).
  enterCombat() { this.combatTimer = 5; }
  get inCombat() { return this.combatTimer > 0; }

  setInput(mx, my, facing) {
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.input.mx = mx; this.input.my = my;
    if (typeof facing === 'number' && isFinite(facing)) this.input.facing = facing;
  }

  takeDamage(raw) {
    if (!this.alive || this.invulnTimer > 0) return 0; // i-frames: dodge negates the hit
    const amount = Math.max(0, Math.round(raw * (1 - this.damageReduction)));
    if (amount > 0) this.enterCombat();
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
  applyBlock(duration) { this.isBlocking = true; this.blockTimer = duration; }
  applyBuff(damageMult, speedMult, duration) { this.damageMult = damageMult; this.speedMult = speedMult; this.buffTimer = duration; }

  // Restore saved progress supplied by the client on join (per-device save).
  // Items are re-derived through sanitizeItem — saves come from the client and
  // are NOT trusted (a tampered save can't inject overpowered gear).
  applyProgress(p) {
    if (!p) return;
    this.level = Math.max(1, p.level | 0);
    this.xp = Math.max(0, p.xp | 0);
    this.statPoints = Math.max(0, p.statPoints | 0);
    if (p.stats) for (const k of STAT_KEYS) {
      if (typeof p.stats[k] === 'number') this.baseAttrs[k] = Math.max(this.def.stats[k] || 0, p.stats[k] | 0);
    }
    if (Array.isArray(p.inventory)) this.inventory = p.inventory.map(sanitizeItem).filter(Boolean).slice(0, INV_CAP);
    if (p.gear) for (const slot of EQUIP_SLOTS) {
      const it = sanitizeItem(p.gear[slot]);
      if (it && it.slot === slot && canEquip(this.classKey, it)) this.gear[slot] = it;
    }
    if (Array.isArray(p.waypoints)) for (const w of p.waypoints) if (typeof w === 'string') this.waypoints.add(w);
    // Skill tree: re-derive a legal allocation (saves are not trusted).
    this.skillTree = sanitizeAllocation(this.classKey, p.skillTree, this.level);
    this.recomputeSkillBuild();
    this.recomputeStats();
    this.hp = this.maxHp;
  }

  // Base/leveled attributes + gear + skill-tree stat nodes.
  totalAttrsWithBuild() {
    const a = totalAttrs(this.baseAttrs, this.gear);
    const b = this.skillBuild.stat;
    for (const k of STAT_KEYS) a[k] += b[k] || 0;
    return a;
  }

  recomputeSkillBuild() { this.skillBuild = buildFromTree(this.classKey, this.skillTree); }

  // The effective skill def for a slot (1-based), with tree upgrades/unlocks.
  effSkill(slot) { return effectiveSkill(this.def, slot - 1, this.skillBuild); }

  // Rebuild derived stats from base attributes + gear + skill tree, preserving
  // the current HP fraction. Call after spending a point or changing equipment.
  recomputeStats() {
    const ratio = this.maxHp ? this.hp / this.maxHp : 1;
    this.stats = new Stats(this.totalAttrsWithBuild());
    this.maxHp = this.stats.maxHp;
    this.hp = Math.min(this.maxHp, Math.max(1, Math.round(this.maxHp * ratio)));
  }

  // --- skill tree (server-authoritative; client requests, server validates) ---
  spendSkill(nodeId) {
    if (!canSpend(this.classKey, this.skillTree, this.level, nodeId)) return false;
    this.skillTree[nodeId] = (this.skillTree[nodeId] || 0) + 1;
    this.recomputeSkillBuild();
    this.recomputeStats();
    return true;
  }
  respecSkills() {
    this.skillTree = {};
    this.recomputeSkillBuild();
    this.recomputeStats();
    return true;
  }

  // --- inventory / equipment (server-authoritative) ---
  addItem(item) { if (item && this.inventory.length < INV_CAP) { this.inventory.push(item); return true; } return false; }

  equip(itemId) {
    const idx = this.inventory.findIndex((it) => it.id === itemId);
    if (idx < 0) return false;
    const item = this.inventory[idx];
    if (!canEquip(this.classKey, item)) return false; // validate — don't trust client
    const prev = this.gear[item.slot];
    this.gear[item.slot] = item;
    this.inventory.splice(idx, 1);
    if (prev) this.inventory.push(prev);
    this.recomputeStats();
    return true;
  }

  unequip(slot) {
    if (!EQUIP_SLOTS.includes(slot) || !this.gear[slot]) return false;
    if (this.inventory.length >= INV_CAP) return false;
    this.inventory.push(this.gear[slot]);
    this.gear[slot] = null;
    this.recomputeStats();
    return true;
  }

  discard(itemId) {
    const idx = this.inventory.findIndex((it) => it.id === itemId);
    if (idx < 0) return false;
    this.inventory.splice(idx, 1);
    return true;
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
    if (this.statPoints <= 0 || !STAT_KEYS.includes(attr)) return false;
    this.statPoints -= 1;
    this.baseAttrs[attr] += 1;
    this.recomputeStats();
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
    for (const k of [1, 2, 3, 4, 5, 6]) if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    if (this.shieldTimer > 0) { this.shieldTimer -= dt; if (this.shieldTimer <= 0) this.damageReduction = 0; }
    if (this.buffTimer > 0) { this.buffTimer -= dt; if (this.buffTimer <= 0) { this.damageMult = 1; this.speedMult = 1; } }
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.blockTimer > 0) { this.blockTimer -= dt; if (this.blockTimer <= 0) this.isBlocking = false; }
    if (this.combatTimer > 0) this.combatTimer -= dt;

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
      blocking: this.isBlocking || false,
    };
  }

  // Private data only the owning client needs (HUD: cooldowns, stats, XP).
  privateState() {
    const s = this.stats;
    return {
      classKey: this.classKey, // so the inventory UI can gate equip by class
      level: this.level, xp: this.xp, xpToNext: this.xpToNext(), statPoints: this.statPoints,
      cd: { 1: +this.cooldowns[1].toFixed(2), 2: +this.cooldowns[2].toFixed(2), 3: +this.cooldowns[3].toFixed(2), 4: +this.cooldowns[4].toFixed(2), 5: +this.cooldowns[5].toFixed(2), 6: +this.cooldowns[6].toFixed(2) },
      stats: { STR: s.STR, DEX: s.DEX, INT: s.INT, VIT: s.VIT, AGI: s.AGI }, // total (base + gear)
      baseStats: { ...this.baseAttrs },
      inventory: this.inventory,
      gear: this.gear,
      waypoints: [...this.waypoints],
      inCombat: this.inCombat,
      skillTree: { ...this.skillTree },
      skillPoints: availablePoints(this.classKey, this.level, this.skillTree),
    };
  }
}
