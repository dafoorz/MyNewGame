import { CONFIG } from '../config.js';
import HealthBar from '../ui/HealthBar.js';
import { project, projectDir, bodyDepth } from '../iso.js';
import { drawHumanoid, drawShadow } from '../sprites.js';

// Player-controlled (or, for the ally, base) combatant.
// Stage 1: the Tank. WASD to move, mouse to face, click to attack, 1-4 for skills.

export default class Player {
  constructor(scene, x, y, stats, opts = {}) {
    this.scene = scene;
    this.stats = stats;
    this.name = opts.name || 'Tank';
    this.color = opts.color ?? CONFIG.colors.tank;
    this.role = opts.role || 'tank';
    this.threatMultiplier = opts.threatMultiplier ?? CONFIG.threat.tank;

    this.radius = opts.radius ?? 16;
    this.x = x;
    this.y = y;
    this.facing = -Math.PI / 2; // pointing "up" initially
    this.bounds = opts.bounds ?? CONFIG.arena; // movement clamp (set per zone)

    this.maxHp = stats.maxHp;
    this.hp = this.maxHp;
    this.alive = true;

    this.attackRange = opts.attackRange ?? 78;
    this.attackTimer = 0; // counts down to next allowed basic attack

    this.damageReduction = 0; // set by Shield Wall
    this.shieldTimer = 0;
    this.hitFlash = 0;

    // Class buffs / states.
    this.damageMult = 1;     // temporary outgoing-damage buff
    this.speedMult = 1;      // temporary move-speed buff
    this.buffTimer = 0;
    this.stealth = false;    // mobs won't aggro while stealthed
    this.stealthTimer = 0;
    this.nextHitCrit = 0;    // if >0, next damaging hit is a guaranteed crit at this multiplier
    this.invulnTimer = 0;    // i-frames during a Dodge roll: takes no damage while > 0

    // Skill cooldowns (seconds remaining), keyed by slot 1-5.
    this.cooldowns = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    // --- visuals ---
    this.gfx = scene.add.graphics().setDepth(10);
    this.label = scene.add
      .text(x, y - this.radius - 26, this.name, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(55);
    this.hpBar = new HealthBar(scene, x, y - this.radius - 12, 46, 6, { depth: 55 });
  }

  // --- combat ---

  takeDamage(rawAmount) {
    if (!this.alive || this.invulnTimer > 0) return 0; // i-frames: dodge negates the hit
    const amount = Math.max(0, Math.round(rawAmount * (1 - this.damageReduction)));
    this.hp -= amount;
    this.hitFlash = 0.15;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return amount;
  }

  canBasicAttack() {
    return this.alive && this.attackTimer <= 0;
  }

  startBasicCooldown() {
    this.attackTimer = this.stats.attackInterval;
  }

  isOnCooldown(slot) {
    return this.cooldowns[slot] > 0;
  }

  startCooldown(slot, seconds) {
    this.cooldowns[slot] = seconds;
  }

  applyShield(reduction, seconds) {
    this.damageReduction = reduction;
    this.shieldTimer = seconds;
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return Math.round(this.hp - before);
  }

  applyBuff({ damageMult = 1, speedMult = 1, duration }) {
    this.damageMult = damageMult;
    this.speedMult = speedMult;
    this.buffTimer = duration;
  }

  applyStealth(duration, critMult) {
    this.stealth = true;
    this.stealthTimer = duration;
    this.nextHitCrit = critMult;
  }

  // --- per-frame ---

  moveBy(dx, dy, dt) {
    if (!this.alive) return;
    const speed = this.stats.moveSpeed * this.speedMult;
    let nx = this.x + dx * speed * dt;
    let ny = this.y + dy * speed * dt;
    const a = this.bounds;
    nx = Phaser.Math.Clamp(nx, a.x + this.radius, a.x + a.w - this.radius);
    ny = Phaser.Math.Clamp(ny, a.y + this.radius, a.y + a.h - this.radius);
    this.x = nx;
    this.y = ny;
  }

  // Recompute derived stats after spending points (e.g. VIT raises max HP).
  recalc() {
    const newMax = this.stats.maxHp;
    const delta = newMax - this.maxHp;
    this.maxHp = newMax;
    if (delta > 0) this.hp += delta;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  destroy() {
    this.gfx.destroy();
    this.label.destroy();
    this.hpBar.destroy();
  }

  update(dt) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    }
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this.damageReduction = 0;
    }
    if (this.buffTimer > 0) {
      this.buffTimer -= dt;
      if (this.buffTimer <= 0) { this.damageMult = 1; this.speedMult = 1; }
    }
    if (this.stealthTimer > 0) {
      this.stealthTimer -= dt;
      if (this.stealthTimer <= 0) this.stealth = false;
    }
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    this.draw();
  }

  draw() {
    const g = this.gfx;
    g.clear();
    g.depth = bodyDepth(this.x, this.y); // upright billboard, sorted by ground pos
    const sp = project(this.x, this.y);  // projected ground point (the feet)
    const r = this.radius;
    const headTop = sp.y - r * 2.9;       // where the label/bar float

    if (!this.alive) {
      drawShadow(g, sp.x, sp.y, r, 0.4);
      g.fillStyle(0x444a5e, 0.85); g.fillCircle(sp.x, sp.y - r * 0.4, r * 0.9);
      this.label.setPosition(sp.x, headTop - 8).setText(this.name + ' (down)');
      this.hpBar.setPosition(sp.x, headTop + 8); this.hpBar.setValue(0);
      return;
    }

    const rings = [];
    if (this.buffTimer > 0) rings.push({ color: 0xffe066, alpha: 0.7, pad: 8 });
    if (this.shieldTimer > 0) rings.push({ color: 0x66ccff, alpha: 0.9, w: 3, pad: 11 });
    if (this.invulnTimer > 0) rings.push({ color: 0x5dd9ff, alpha: 0.9, w: 3, pad: 14 });
    const fd = projectDir(Math.cos(this.facing), Math.sin(this.facing));
    drawHumanoid(g, sp.x, sp.y, r, this.hitFlash > 0 ? 0xffffff : this.color, {
      alpha: this.stealth ? 0.4 : 1, faceDx: fd.x, faceDy: fd.y, rings,
    });

    this.label.setPosition(sp.x, headTop - 8);
    this.hpBar.setPosition(sp.x, headTop + 8);
    this.hpBar.setValue(this.hp / this.maxHp);
  }
}
