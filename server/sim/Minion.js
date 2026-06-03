// Headless authoritative minion (Necromancer Raise Dead). Chases the nearest
// enemy and melees it; hovers near its owner when idle. Has HP, so mobs and the
// boss can kill it, and it pulls threat like a pet. Expires after `life`.

export default class Minion {
  constructor(id, owner, x, y, damage, maxHp, duration, bounds) {
    this.id = id;
    this.owner = owner; // owning player's socket id
    this.x = x; this.y = y;
    this.bounds = bounds;
    this.radius = 10;
    this.speed = 170;
    this.damage = damage;
    this.maxHp = maxHp; this.hp = maxHp;
    this.attackCd = 1.0; this.attackTimer = 0;
    this.life = duration;
    this.alive = true;
    this.facing = 0;
    this.threatMultiplier = 1.5; // pulls aggro well so it soaks hits
  }

  takeDamage(amount) {
    if (!this.alive) return 0;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.alive = false;
    return amount;
  }

  // ctx = { nearestEnemy(x,y,max), applyHit(minion, enemy, dmg), ownerOf(id) }
  update(dt, ctx) {
    this.life -= dt;
    if (this.life <= 0 || !this.alive) { this.alive = false; return; }
    if (this.attackTimer > 0) this.attackTimer -= dt;

    const target = ctx.nearestEnemy(this.x, this.y, 520);
    if (target) {
      const d = Math.hypot(target.x - this.x, target.y - this.y);
      this.facing = Math.atan2(target.y - this.y, target.x - this.x);
      if (d > this.radius + target.radius + 6) {
        this.x += Math.cos(this.facing) * this.speed * dt;
        this.y += Math.sin(this.facing) * this.speed * dt;
      } else if (this.attackTimer <= 0) {
        ctx.applyHit(this, target, this.damage);
        this.attackTimer = this.attackCd;
      }
    } else {
      const owner = ctx.ownerOf(this.owner);
      if (owner) {
        const d = Math.hypot(owner.x - this.x, owner.y - this.y);
        if (d > 70) { const a = Math.atan2(owner.y - this.y, owner.x - this.x); this.x += Math.cos(a) * this.speed * dt; this.y += Math.sin(a) * this.speed * dt; }
      }
    }
  }

  snapshot() { return { id: this.id, x: Math.round(this.x), y: Math.round(this.y), hp: Math.ceil(this.hp), maxHp: this.maxHp }; }
}
