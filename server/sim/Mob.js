import { MOB_TYPES } from '../../src/world/zones.js';
import { clamp } from './mathutil.js';

// Headless authoritative mob. Idle until a player is close, then chases (melee)
// or kites and shoots (ranged). Leashes back to spawn if players run far away.
// Mirrors the client Mob, minus all rendering.

export default class Mob {
  constructor(id, typeKey, x, y, level, bounds) {
    const t = MOB_TYPES[typeKey];
    this.id = id;
    this.typeKey = typeKey;
    this.kind = t.kind;
    this.radius = t.radius;
    this.level = level;
    this.bounds = bounds;

    this.spawnX = x; this.spawnY = y;
    this.x = x; this.y = y;
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
    this.engaged = false;

    this.attackRange = t.attackRange ?? 0;
    this.preferred = t.preferred ?? 230;
    this.projSpeed = t.projSpeed ?? 320;
    this.attackReach = t.attackReach ?? 16;
  }

  takeDamage(amount) {
    if (!this.alive) return 0;
    this.hp -= amount;
    this.engaged = true;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return amount;
  }

  clampToBounds() {
    const b = this.bounds;
    this.x = clamp(this.x, this.radius, b.w - this.radius);
    this.y = clamp(this.y, this.radius, b.h - this.radius);
  }

  moveToward(tx, ty, dt, mult = 1) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    this.x += Math.cos(ang) * this.speed * mult * dt;
    this.y += Math.sin(ang) * this.speed * mult * dt;
    this.clampToBounds();
  }

  // ctx = { target (nearest alive player or null), onMelee(mob,target), fireProjectile(...) }
  update(dt, ctx) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    const target = ctx.target;

    if (!target) { this.returnHome(dt); return; }
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    this.facing = Math.atan2(target.y - this.y, target.x - this.x);

    if (dist <= this.aggroRange) this.engaged = true;
    if (dist > this.leashRange) this.engaged = false;

    if (this.engaged) {
      if (this.kind === 'ranged') this.rangedBehavior(dt, ctx, dist, target);
      else this.meleeBehavior(dt, ctx, dist, target);
    } else {
      this.returnHome(dt);
    }
  }

  returnHome(dt) {
    if (Math.hypot(this.spawnX - this.x, this.spawnY - this.y) > 6) this.moveToward(this.spawnX, this.spawnY, dt, 0.7);
  }

  meleeBehavior(dt, ctx, dist, target) {
    const reach = this.attackReach + this.radius + target.radius;
    if (dist > reach) this.moveToward(target.x, target.y, dt);
    else if (this.attackTimer <= 0) { ctx.onMelee(this, target); this.attackTimer = this.attackCd; }
  }

  rangedBehavior(dt, ctx, dist, target) {
    if (dist < this.preferred - 30) this.moveToward(target.x, target.y, dt, -1);
    else if (dist > this.preferred + 50) this.moveToward(target.x, target.y, dt);
    if (dist <= this.attackRange && this.attackTimer <= 0) {
      ctx.fireProjectile(this.x, this.y, target.x, target.y, this.damage, this.projSpeed);
      this.attackTimer = this.attackCd;
    }
  }

  snapshot() {
    return { id: this.id, typeKey: this.typeKey, x: Math.round(this.x), y: Math.round(this.y), hp: Math.ceil(this.hp), maxHp: this.maxHp, level: this.level };
  }
}
