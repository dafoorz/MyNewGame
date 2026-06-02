// Friendly summoned minion (Necromancer). Chases the nearest enemy and melees
// it; follows the player when nothing is in range. Expires after `duration`.

export default class Minion {
  constructor(scene, x, y, damage, maxHp, duration, bounds) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.bounds = bounds;
    this.radius = 10;
    this.speed = 170;
    this.damage = damage;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.attackCd = 1.0;
    this.attackTimer = 0;
    this.life = duration;
    this.alive = true;
    this.facing = 0;
    this.gfx = scene.add.graphics().setDepth(8);
  }

  takeDamage(amount) {
    if (!this.alive) return 0;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.alive = false;
    return amount;
  }

  // ctx = { player, nearestEnemyTo(x, y, max), applyHit(enemy, amount, crit) }
  update(dt, ctx) {
    this.life -= dt;
    if (this.life <= 0 || !this.alive) { this.alive = false; return; }
    if (this.attackTimer > 0) this.attackTimer -= dt;

    const target = ctx.nearestEnemyTo(this.x, this.y, 520);
    if (target) {
      const d = Math.hypot(target.x - this.x, target.y - this.y);
      this.facing = Math.atan2(target.y - this.y, target.x - this.x);
      if (d > this.radius + target.radius + 6) {
        this.x += Math.cos(this.facing) * this.speed * dt;
        this.y += Math.sin(this.facing) * this.speed * dt;
      } else if (this.attackTimer <= 0) {
        ctx.applyHit(this, target, this.damage, false);
        this.attackTimer = this.attackCd;
      }
    } else {
      // Idle: hover near the player.
      const d = Math.hypot(ctx.player.x - this.x, ctx.player.y - this.y);
      if (d > 70) {
        const a = Math.atan2(ctx.player.y - this.y, ctx.player.x - this.x);
        this.x += Math.cos(a) * this.speed * dt;
        this.y += Math.sin(a) * this.speed * dt;
      }
    }
    this.draw();
  }

  draw() {
    const g = this.gfx;
    g.clear();
    if (!this.alive) return;
    const fade = this.life < 2 ? 0.4 + 0.6 * (this.life / 2) : 1;
    g.fillStyle(0x9ad17a, fade);
    g.fillCircle(this.x, this.y, this.radius);
    g.lineStyle(2, 0x3a5a2a, fade);
    g.strokeCircle(this.x, this.y, this.radius);

    // health bar
    const barW = this.radius * 2.4;
    const barH = 4;
    const barX = this.x - barW / 2;
    const barY = this.y - this.radius - 8;
    g.fillStyle(0x220000, fade);
    g.fillRect(barX, barY, barW, barH);
    g.fillStyle(0x66ff44, fade);
    g.fillRect(barX, barY, barW * (this.hp / this.maxHp), barH);
  }

  destroy() {
    this.gfx.destroy();
  }
}
