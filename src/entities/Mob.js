import { MOB_TYPES } from '../world/zones.js';
import HealthBar from '../ui/HealthBar.js';
import { project, depth } from '../iso.js';

// A zone mob. Idle until the player gets close, then chases (melee) or kites
// and shoots (ranged). Leashes back to its spawn if the player runs far away.

export default class Mob {
  constructor(scene, typeKey, x, y, level, bounds) {
    const t = MOB_TYPES[typeKey];
    this.scene = scene;
    this.typeKey = typeKey;
    this.def = t;
    this.kind = t.kind;
    this.name = t.name;
    this.level = level;
    this.color = t.color;
    this.radius = t.radius;
    this.bounds = bounds;

    this.spawnX = x;
    this.spawnY = y;
    this.x = x;
    this.y = y;
    this.facing = 0;

    const scale = 1 + 0.28 * (level - 1);
    this.maxHp = Math.round(t.baseHp * scale);
    this.hp = this.maxHp;
    this.damage = Math.round(t.baseDmg * scale);
    this.xp = Math.round(t.xp * (1 + 0.5 * (level - 1)));
    this.alive = true;

    this.speed = t.speed;
    this.aggroRange = t.aggroRange ?? 240;
    this.leashRange = 640;
    this.attackCd = t.attackCd;
    this.attackTimer = Math.random() * this.attackCd;
    this.hitFlash = 0;
    this.engaged = false;

    // ranged
    this.attackRange = t.attackRange ?? 0;
    this.preferred = t.preferred ?? 230;
    this.projSpeed = t.projSpeed ?? 320;
    // melee
    this.attackReach = t.attackReach ?? 16;

    this.gfx = scene.add.graphics().setDepth(8);
    this.hpBar = new HealthBar(scene, x, y - this.radius - 9, 34, 5, { depth: 9 });
    this.label = scene.add
      .text(x, y - this.radius - 20, `Lv${level} ${this.name}`, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '10px',
        color: '#d8dcea',
      })
      .setOrigin(0.5)
      .setDepth(9);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.12;
    this.engaged = true; // hitting it pulls it
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  clampToBounds() {
    const b = this.bounds;
    this.x = Phaser.Math.Clamp(this.x, b.x + this.radius, b.x + b.w - this.radius);
    this.y = Phaser.Math.Clamp(this.y, b.y + this.radius, b.y + b.h - this.radius);
  }

  moveToward(tx, ty, dt, mult = 1) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    this.x += Math.cos(ang) * this.speed * mult * dt;
    this.y += Math.sin(ang) * this.speed * mult * dt;
    this.clampToBounds();
  }

  // ctx = { player, getTarget(mob), fireProjectile(fromX, fromY, tx, ty, dmg, speed), onMelee(mob, target) }
  update(dt, ctx) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // Pick whatever's nearest and attackable: the player, or a summoned minion
    // standing in for them (so minions soak aggro / draw mobs off the player).
    const target = ctx.getTarget(this);
    const p = ctx.player;
    const pdist = Math.hypot(p.x - this.x, p.y - this.y);
    const playerVisible = p.alive && !p.stealth;

    if (playerVisible && pdist <= this.aggroRange) this.engaged = true;
    if (target && Math.hypot(target.x - this.x, target.y - this.y) <= this.aggroRange) this.engaged = true;
    if (pdist > this.leashRange && !target) this.engaged = false;

    if (this.engaged && target) {
      this.facing = Math.atan2(target.y - this.y, target.x - this.x);
      const dist = Math.hypot(target.x - this.x, target.y - this.y);
      if (this.kind === 'ranged') this.rangedBehavior(dt, ctx, dist, target);
      else this.meleeBehavior(dt, ctx, dist, target);
    } else {
      // Return home.
      const dHome = Math.hypot(this.spawnX - this.x, this.spawnY - this.y);
      if (dHome > 6) this.moveToward(this.spawnX, this.spawnY, dt, 0.7);
    }

    this.draw();
  }

  meleeBehavior(dt, ctx, dist, target) {
    const reach = this.attackReach + this.radius + target.radius;
    if (dist > reach) {
      this.moveToward(target.x, target.y, dt);
    } else if (this.attackTimer <= 0) {
      ctx.onMelee(this, target);
      this.attackTimer = this.attackCd;
    }
  }

  rangedBehavior(dt, ctx, dist, target) {
    if (dist < this.preferred - 30) {
      this.moveToward(target.x, target.y, dt, -1); // back away
    } else if (dist > this.preferred + 50) {
      this.moveToward(target.x, target.y, dt); // close in
    }
    if (dist <= this.attackRange && this.attackTimer <= 0) {
      ctx.fireProjectile(this.x, this.y, target.x, target.y, this.damage, this.projSpeed);
      this.attackTimer = this.attackCd;
    }
  }

  draw() {
    const g = this.gfx;
    g.clear();
    if (!this.alive) return;

    const col = this.hitFlash > 0 ? 0xffffff : this.color;
    g.fillStyle(col, 1);
    if (this.kind === 'ranged') {
      // diamond for ranged
      g.beginPath();
      g.moveTo(this.x, this.y - this.radius);
      g.lineTo(this.x + this.radius, this.y);
      g.lineTo(this.x, this.y + this.radius);
      g.lineTo(this.x - this.radius, this.y);
      g.closePath();
      g.fillPath();
    } else {
      g.fillCircle(this.x, this.y, this.radius);
    }
    g.lineStyle(2, 0x000000, 0.35);
    g.strokeCircle(this.x, this.y, this.radius);
    g.depth = depth(this.x, this.y);

    const sp = project(this.x, this.y);
    this.label.setPosition(sp.x, sp.y - this.radius - 20);
    this.hpBar.setPosition(sp.x, sp.y - this.radius - 9);
    this.hpBar.setValue(this.hp / this.maxHp);
  }

  destroy() {
    this.gfx.destroy();
    this.hpBar.destroy();
    this.label.destroy();
  }
}
