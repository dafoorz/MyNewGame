import Player from './Player.js';
import { CONFIG } from '../config.js';

// AI-controlled ranged ally (Mage). Reuses Player for stats/HP/visuals, but
// replaces the update with simple behavior:
//   1. Survive: if standing in an active telegraph, sprint out of it.
//   2. Position: otherwise drift to a spot behind the boss, at casting range.
//   3. Damage: when the boss is in range and safe, fire bolts on cooldown.

export default class Ally extends Player {
  constructor(scene, x, y, stats, opts = {}) {
    super(scene, x, y, stats, {
      name: opts.name || 'Mage',
      color: CONFIG.colors.mage,
      role: 'mage',
      radius: 14,
      threatMultiplier: CONFIG.threat.mage,
      attackRange: 360,
    });

    this.preferredRange = 300; // likes to cast from here
    this.boltGfx = scene.add.graphics().setDepth(8);
    this.boltFlash = 0;
  }

  destroy() {
    super.destroy();
    this.boltGfx.destroy();
  }

  // ctx = { boss, telegraph, onCast(damage) }
  aiUpdate(dt, ctx) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.boltFlash > 0) this.boltFlash -= dt;
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this.damageReduction = 0;
    }

    if (this.alive && ctx.boss.alive) {
      const dodged = this.avoidDanger(dt, ctx.telegraph);
      if (!dodged) this.reposition(dt, ctx.boss);
      this.facing = Math.atan2(ctx.boss.y - this.y, ctx.boss.x - this.x);
      this.tryCast(ctx);
    }

    this.draw();
    this.drawBolt(ctx.boss);
  }

  // Returns true if it had to move to escape a telegraph this frame.
  avoidDanger(dt, telegraph) {
    if (!telegraph) return false;

    if (telegraph.type === 'aoe') {
      const dx = this.x - telegraph.x;
      const dy = this.y - telegraph.y;
      const dist = Math.hypot(dx, dy);
      const danger = telegraph.radius + this.radius + 14;
      if (dist < danger) {
        const ang = dist > 0.001 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
        this.moveBy(Math.cos(ang), Math.sin(ang), dt);
        return true;
      }
    } else if (telegraph.type === 'cleave') {
      const dx = this.x - telegraph.x;
      const dy = this.y - telegraph.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= telegraph.range + this.radius + 14) {
        const ang = Math.atan2(dy, dx);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(ang - telegraph.facing));
        if (diff <= telegraph.halfAngle + 0.25) {
          // Sidestep perpendicular to the cone to clear it fast.
          const side = telegraph.facing + Math.PI / 2;
          this.moveBy(Math.cos(side), Math.sin(side), dt);
          return true;
        }
      }
    }
    return false;
  }

  // Drift toward a point behind the boss (opposite the boss's facing) at range.
  reposition(dt, boss) {
    const behind = boss.facing + Math.PI;
    const targetX = boss.x + Math.cos(behind) * this.preferredRange;
    const targetY = boss.y + Math.sin(behind) * this.preferredRange;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 12) {
      // Move at a comfortable fraction of speed so it glides rather than jitters.
      const ang = Math.atan2(dy, dx);
      const ease = Math.min(1, dist / 120);
      this.x += Math.cos(ang) * this.stats.moveSpeed * 0.7 * ease * dt;
      this.y += Math.sin(ang) * this.stats.moveSpeed * 0.7 * ease * dt;
      const a = this.bounds;
      this.x = Phaser.Math.Clamp(this.x, a.x + this.radius, a.x + a.w - this.radius);
      this.y = Phaser.Math.Clamp(this.y, a.y + this.radius, a.y + a.h - this.radius);
    }
  }

  tryCast(ctx) {
    if (this.attackTimer > 0) return;
    const dist = Math.hypot(ctx.boss.x - this.x, ctx.boss.y - this.y);
    if (dist <= this.attackRange) {
      const { amount, crit } = this.stats.roll(this.stats.magPower);
      ctx.onCast(amount, crit);
      this.attackTimer = this.stats.attackInterval;
      this.boltFlash = 0.12;
    }
  }

  drawBolt(boss) {
    const g = this.boltGfx;
    g.clear();
    if (this.boltFlash > 0 && this.alive && boss.alive) {
      g.lineStyle(3, 0x9be8ff, this.boltFlash / 0.12);
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.lineTo(boss.x, boss.y);
      g.strokePath();
    }
  }
}
