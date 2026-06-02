import { clamp, dist, wrapAngle } from './mathutil.js';

// Headless authoritative boss. Mirrors the client Boss state machine, but holds
// no rendering — it only mutates state and reports hits. The client renders it
// from snapshots.
//
//   IDLE (chase highest-threat target) -> WINDUP (telegraph) -> resolve -> RECOVER

const STATE = { IDLE: 'idle', WINDUP: 'windup', RECOVER: 'recover' };

const ATTACKS = {
  cleave: { name: 'cleave', windup: 0.75, recover: 0.6, range: 190, halfAngle: (60 * Math.PI) / 180, damage: 130 },
  aoe: { name: 'aoe', windup: 1.1, recover: 0.7, radius: 105, damage: 160 },
};

export default class Boss {
  constructor(bounds, opts = {}) {
    this.name = opts.name || 'Stone Colossus';
    this.radius = 46;
    this.x = bounds.w / 2;
    this.y = bounds.h / 2 - 40;
    this.facing = Math.PI / 2;
    this.bounds = bounds;

    this.maxHp = opts.maxHp ?? 7000; // tuned up for a real party
    this.hp = this.maxHp;
    this.alive = true;

    this.speed = 95;
    this.meleeBand = 130;

    this.state = STATE.IDLE;
    this.stateTimer = 0;
    this.globalCd = 2.2;
    this.attack = null;
    this.telegraph = null;
    this.target = null; // socket id of current target
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }

  // players: array of ServerPlayer; aggro: AggroTable; onHit(player, amount).
  update(dt, players, aggro, onHit) {
    if (!this.alive) return;

    const targetEntity = aggro.getTarget(players);
    this.target = targetEntity ? targetEntity.id : null;

    if (this.state === STATE.IDLE) this.updateIdle(dt, players, targetEntity);
    else if (this.state === STATE.WINDUP) this.updateWindup(dt, players, onHit);
    else if (this.state === STATE.RECOVER) this.updateRecover(dt);

    this.faceTarget(targetEntity);
  }

  updateIdle(dt, players, target) {
    if (this.globalCd > 0) this.globalCd -= dt;
    if (!target) return;
    const d = dist(this.x, this.y, target.x, target.y);
    if (d > this.meleeBand) this.moveToward(target.x, target.y, dt);
    if (this.globalCd <= 0 && d <= this.meleeBand + 40) this.beginAttack(players, target);
  }

  beginAttack(players, target) {
    const which = Math.random() < 0.55 ? 'cleave' : 'aoe';
    this.attack = ATTACKS[which];
    this.state = STATE.WINDUP;
    this.stateTimer = this.attack.windup;

    if (which === 'cleave') {
      this.faceTarget(target);
      this.telegraph = { type: 'cleave', x: this.x, y: this.y, facing: this.facing, range: this.attack.range, halfAngle: this.attack.halfAngle };
    } else {
      const alive = players.filter((p) => p.alive);
      const focus = alive.length ? alive[Math.floor(Math.random() * alive.length)] : target;
      this.telegraph = { type: 'aoe', x: focus ? focus.x : this.x, y: focus ? focus.y : this.y, radius: this.attack.radius };
    }
  }

  updateWindup(dt, players, onHit) {
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.resolveAttack(players, onHit);
      this.state = STATE.RECOVER;
      this.stateTimer = this.attack.recover;
      this.telegraph = null;
    }
  }

  resolveAttack(players, onHit) {
    const tg = this.telegraph;
    if (!tg) return;
    for (const p of players) {
      if (!p.alive) continue;
      let hit = false;
      if (tg.type === 'cleave') {
        const dx = p.x - tg.x, dy = p.y - tg.y;
        if (Math.hypot(dx, dy) <= tg.range + p.radius) {
          const diff = Math.abs(wrapAngle(Math.atan2(dy, dx) - tg.facing));
          if (diff <= tg.halfAngle) hit = true;
        }
      } else if (dist(p.x, p.y, tg.x, tg.y) <= tg.radius + p.radius) {
        hit = true;
      }
      if (hit) onHit(p, this.attack.damage);
    }
  }

  updateRecover(dt) {
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.state = STATE.IDLE;
      this.attack = null;
      this.globalCd = 0.6 + Math.random() * 0.6;
    }
  }

  moveToward(tx, ty, dt) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    const b = this.bounds;
    this.x = clamp(this.x + Math.cos(ang) * this.speed * dt, this.radius, b.w - this.radius);
    this.y = clamp(this.y + Math.sin(ang) * this.speed * dt, this.radius, b.h - this.radius);
  }

  faceTarget(target) {
    if (target && target.alive) this.facing = Math.atan2(target.y - this.y, target.x - this.x);
  }

  // Compact form for network snapshots.
  snapshot() {
    return {
      x: Math.round(this.x), y: Math.round(this.y), facing: +this.facing.toFixed(3),
      hp: Math.ceil(this.hp), maxHp: this.maxHp, alive: this.alive,
      name: this.name, state: this.state,
      telegraph: this.telegraph
        ? { type: this.telegraph.type, x: Math.round(this.telegraph.x), y: Math.round(this.telegraph.y),
            facing: this.telegraph.facing != null ? +this.telegraph.facing.toFixed(3) : 0,
            range: this.telegraph.range || 0, halfAngle: this.telegraph.halfAngle || 0, radius: this.telegraph.radius || 0,
            progress: this.attack ? 1 - this.stateTimer / this.attack.windup : 0 }
        : null,
    };
  }
}
