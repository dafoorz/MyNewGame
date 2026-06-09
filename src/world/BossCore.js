// Shared, Phaser-free boss state machine (Stage 6). ONE implementation drives
// both the solo client simulation (wrapped by src/entities/Boss.js, which adds
// rendering) and the authoritative server (wrapped by server/sim/Boss.js, which
// adds network snapshots). All boss behavior comes from the data in bosses.js.
//
//   IDLE (chase highest-threat target) -> WINDUP (telegraph) -> resolve -> RECOVER
//
// The caller passes an `adapter` into update() each tick so this stays decoupled
// from how players/threat/damage are stored on each side:
//   adapter = {
//     bounds: { w, h },
//     getCombatants(): [{ id, x, y, radius, alive, takeDamage(n) }]  // players + minions
//     getTarget(): entity | null            // current highest-threat combatant
//     hit(entity, amount)                    // apply boss damage to a combatant
//     spawnAdd(mobType, x, y, level)         // summon an add
//     addFx(fx)                              // floating text / effects
//   }

import { BOSSES, DEFAULT_BOSS } from './bosses.js';

const STATE = { IDLE: 'idle', WINDUP: 'windup', RECOVER: 'recover' };
const PI = Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function wrapAngle(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }

export default class BossCore {
  constructor(bossKey, bounds) {
    const cfg = BOSSES[bossKey] || BOSSES[DEFAULT_BOSS];
    this.key = BOSSES[bossKey] ? bossKey : DEFAULT_BOSS;
    this.cfg = cfg;
    this.bounds = bounds;

    this.name = cfg.name;
    this.color = cfg.color;
    this.radius = cfg.radius;
    this.maxHp = cfg.maxHp;
    this.hp = this.maxHp;
    this.alive = true;

    this.speed = cfg.speed;
    this.meleeBand = cfg.meleeBand;

    this.x = bounds.w / 2;
    this.y = bounds.h / 2 - 40;
    this.facing = PI / 2;

    this.state = STATE.IDLE;
    this.stateTimer = 0;
    this.windupDur = 1;
    this.globalCd = cfg.openingCd ?? 2.2;
    this.attack = null;
    this.telegraph = null;
    this.target = null;   // id of current target
    this.enraged = false;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }

  // Enrage multipliers (1 = no change while not enraged).
  get haste() { return this.enraged && this.cfg.enrage ? (this.cfg.enrage.hasteMult ?? 1) : 1; }
  get dmgMult() { return this.enraged && this.cfg.enrage ? (this.cfg.enrage.damageMult ?? 1) : 1; }
  get spdMult() { return this.enraged && this.cfg.enrage ? (this.cfg.enrage.speedMult ?? 1) : 1; }

  update(dt, adapter) {
    if (!this.alive) return;
    this.adapter = adapter;
    this.bounds = adapter.bounds || this.bounds;

    if (!this.enraged && this.cfg.enrage && this.hp <= this.maxHp * this.cfg.enrage.hpPct) {
      this.enraged = true;
      adapter.addFx({ t: 'text', x: this.x, y: this.y - this.radius - 22, msg: 'ENRAGED!', color: '#ff5a5a', big: true });
    }

    const target = adapter.getTarget();
    this.target = target ? target.id : null;

    if (this.state === STATE.IDLE) this.updateIdle(dt, target);
    else if (this.state === STATE.WINDUP) this.updateWindup(dt);
    else if (this.state === STATE.RECOVER) this.updateRecover(dt);

    this.faceTarget(target);
  }

  updateIdle(dt, target) {
    if (this.globalCd > 0) this.globalCd -= dt;
    if (!target) return;
    const d = dist(this.x, this.y, target.x, target.y);
    if (d > this.meleeBand) this.moveToward(target.x, target.y, dt);
    if (this.globalCd <= 0) {
      const valid = this.cfg.attacks.filter((a) => a.rangedOk || d <= this.meleeBand + 40);
      if (valid.length) this.beginAttack(this.pickAttack(valid), target);
    }
  }

  pickAttack(list) {
    const total = list.reduce((s, a) => s + (a.weight || 1), 0);
    let r = Math.random() * total;
    for (const a of list) { r -= (a.weight || 1); if (r <= 0) return a; }
    return list[list.length - 1];
  }

  beginAttack(atk, target) {
    this.attack = atk;
    this.state = STATE.WINDUP;
    this.windupDur = atk.windup * this.haste;
    this.stateTimer = this.windupDur;
    const b = this.bounds;

    if (atk.type === 'cleave') {
      this.faceTarget(target);
      this.telegraph = { type: 'cleave', x: this.x, y: this.y, facing: this.facing, range: atk.range, halfAngle: atk.halfAngle, blockable: atk.blockable !== false };
    } else if (atk.type === 'aoe') {
      const c = this.randomCombatant() || target;
      this.telegraph = { type: 'aoe', x: c ? c.x : this.x, y: c ? c.y : this.y, radius: atk.radius, blockable: atk.blockable !== false };
    } else if (atk.type === 'charge') {
      this.faceTarget(target);
      this.telegraph = { type: 'charge', x: this.x, y: this.y, facing: this.facing, length: atk.length, width: atk.width, blockable: atk.blockable !== false };
    } else if (atk.type === 'summon') {
      this.telegraph = { type: 'summon', x: this.x, y: this.y, radius: atk.radius || 80, blockable: atk.blockable !== false };
    } else if (atk.type === 'safezone') {
      const m = 120;
      this.telegraph = {
        type: 'safezone',
        x: m + Math.random() * (b.w - 2 * m),
        y: m + Math.random() * (b.h - 2 * m),
        radius: atk.safeRadius, bw: b.w, bh: b.h,
        blockable: atk.blockable !== false,
      };
    }
  }

  updateWindup(dt) {
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.resolveAttack();
      this.state = STATE.RECOVER;
      this.stateTimer = this.attack.recover * this.haste;
      this.telegraph = null;
    }
  }

  resolveAttack() {
    const tg = this.telegraph, atk = this.attack, a = this.adapter;
    if (!tg || !atk) return;
    const dmg = Math.round((atk.damage || 0) * this.dmgMult);
    const combs = a.getCombatants();

    if (atk.type === 'cleave') {
      for (const p of combs) {
        if (!p.alive) continue;
        const dx = p.x - tg.x, dy = p.y - tg.y;
        if (Math.hypot(dx, dy) <= tg.range + p.radius && Math.abs(wrapAngle(Math.atan2(dy, dx) - tg.facing)) <= tg.halfAngle) a.hit(p, dmg, atk.blockable !== false);
      }
    } else if (atk.type === 'aoe') {
      for (const p of combs) if (p.alive && dist(p.x, p.y, tg.x, tg.y) <= tg.radius + p.radius) a.hit(p, dmg, atk.blockable !== false);
    } else if (atk.type === 'charge') {
      const ex = tg.x + Math.cos(tg.facing) * tg.length;
      const ey = tg.y + Math.sin(tg.facing) * tg.length;
      for (const p of combs) if (p.alive && this.distToSegment(p.x, p.y, tg.x, tg.y, ex, ey) <= tg.width / 2 + p.radius) a.hit(p, dmg, atk.blockable !== false);
      this.x = clamp(ex, this.radius, this.bounds.w - this.radius);
      this.y = clamp(ey, this.radius, this.bounds.h - this.radius);
    } else if (atk.type === 'summon') {
      const n = atk.count || 3, r = atk.radius || 80;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const sx = clamp(this.x + Math.cos(ang) * r, 60, this.bounds.w - 60);
        const sy = clamp(this.y + Math.sin(ang) * r, 60, this.bounds.h - 60);
        a.spawnAdd(atk.mobType, sx, sy, atk.level || 1);
      }
      a.addFx({ t: 'text', x: this.x, y: this.y - this.radius - 22, msg: 'SUMMON!', color: '#c06cff' });
    } else if (atk.type === 'safezone') {
      for (const p of combs) if (p.alive && dist(p.x, p.y, tg.x, tg.y) > tg.radius + p.radius) a.hit(p, dmg, atk.blockable !== false);
    }
  }

  updateRecover(dt) {
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.state = STATE.IDLE;
      this.attack = null;
      this.globalCd = (0.6 + Math.random() * 0.6) * this.haste;
    }
  }

  moveToward(tx, ty, dt) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    const sp = this.speed * this.spdMult, b = this.bounds;
    this.x = clamp(this.x + Math.cos(ang) * sp * dt, this.radius, b.w - this.radius);
    this.y = clamp(this.y + Math.sin(ang) * sp * dt, this.radius, b.h - this.radius);
  }

  faceTarget(target) { if (target && target.alive) this.facing = Math.atan2(target.y - this.y, target.x - this.x); }

  randomCombatant() {
    const alive = this.adapter.getCombatants().filter((p) => p.alive);
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
  }

  distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  progress() { return this.attack ? 1 - this.stateTimer / this.windupDur : 0; }

  // Render/network form of the active telegraph (geometry for every type).
  telegraphData() {
    const tg = this.telegraph;
    if (!tg) return null;
    return {
      type: tg.type,
      x: Math.round(tg.x), y: Math.round(tg.y),
      facing: tg.facing != null ? +tg.facing.toFixed(3) : 0,
      range: tg.range || 0, halfAngle: tg.halfAngle || 0, radius: tg.radius || 0,
      length: tg.length || 0, width: tg.width || 0, bw: tg.bw || 0, bh: tg.bh || 0,
      blockable: tg.blockable !== false,
      progress: this.progress(),
    };
  }

  // Compact form for network snapshots.
  snapshot() {
    return {
      x: Math.round(this.x), y: Math.round(this.y), facing: +this.facing.toFixed(3),
      hp: Math.ceil(this.hp), maxHp: this.maxHp, alive: this.alive,
      name: this.name, state: this.state, enraged: this.enraged, color: this.color, radius: this.radius,
      telegraph: this.telegraphData(),
    };
  }
}
