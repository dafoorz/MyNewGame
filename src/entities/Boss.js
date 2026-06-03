import { CONFIG } from '../config.js';
import HealthBar from '../ui/HealthBar.js';

// The boss. Drives a simple state machine:
//   IDLE (chase target) -> WINDUP (telegraph) -> resolve damage -> RECOVER -> IDLE
//
// Two telegraphed attacks:
//   - CLEAVE: a cone in front of the boss (boss faces its highest-threat target,
//             so the tank must keep the boss's back turned away from allies).
//   - AOE:    a circle dropped on a target's current position; everyone must dodge out.

const STATE = { IDLE: 'idle', WINDUP: 'windup', RECOVER: 'recover' };

const ATTACKS = {
  cleave: {
    name: 'cleave',
    windup: 0.75,
    recover: 0.6,
    range: 190,
    halfAngle: Phaser.Math.DegToRad(60),
    damage: 130,
  },
  aoe: {
    name: 'aoe',
    windup: 1.1,
    recover: 0.7,
    radius: 105,
    damage: 160,
  },
};

export default class Boss {
  constructor(scene, x, y, opts = {}) {
    this.scene = scene;
    this.name = opts.name || 'Stone Colossus';
    this.x = x;
    this.y = y;
    this.radius = 46;
    this.facing = Math.PI / 2;

    this.maxHp = opts.maxHp ?? 5000;
    this.hp = this.maxHp;
    this.alive = true;

    // DPS meter: total damage taken + when the fight started (first hit).
    this.dmgTaken = 0;
    this.combatStart = 0;

    this.speed = 95;
    this.meleeBand = 130;
    this.bounds = opts.bounds ?? CONFIG.arena; // movement clamp (set per zone)

    this.target = null;
    this.state = STATE.IDLE;
    this.stateTimer = 0;
    this.globalCd = 2.2; // delay before the first attack
    this.attack = null; // the ATTACKS entry currently being cast
    this.telegraph = null; // { type, ... geometry captured at windup start }

    // visuals
    this.telegraphGfx = scene.add.graphics().setDepth(5);
    this.gfx = scene.add.graphics().setDepth(9);

    // big fixed HUD bar
    this.hpBar = new HealthBar(scene, CONFIG.width / 2, 40, 620, 22, {
      depth: 60,
      fixed: true,
    });
    this.hpText = scene.add
      .text(CONFIG.width / 2, 40, '', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(61)
      .setScrollFactor(0);
    this.nameText = scene.add
      .text(CONFIG.width / 2, 18, this.name, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '15px',
        color: '#ffd24a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(61)
      .setScrollFactor(0);
    this.dpsText = scene.add
      .text(CONFIG.width / 2 + 310, 40, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '12px',
        color: '#ff9a5a',
        fontStyle: 'bold',
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(1, 0.5)
      .setDepth(61)
      .setScrollFactor(0);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    if (this.combatStart === 0) this.combatStart = this.scene.time.now;
    this.dmgTaken += amount;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  // ctx = { players: [...], aggro, onHit(player, amount) }
  update(dt, ctx) {
    if (!this.alive) {
      this.telegraphGfx.clear();
      this.draw();
      this.updateHud();
      return;
    }

    this.target = ctx.aggro.getTarget();

    if (this.state === STATE.IDLE) this.updateIdle(dt, ctx);
    else if (this.state === STATE.WINDUP) this.updateWindup(dt, ctx);
    else if (this.state === STATE.RECOVER) this.updateRecover(dt);

    this.faceTarget();
    this.draw();
    this.drawTelegraph();
    this.updateHud();
  }

  updateIdle(dt, ctx) {
    if (this.globalCd > 0) this.globalCd -= dt;
    if (!this.target) return;

    const dist = this.distanceTo(this.target);

    // Close the gap toward the highest-threat target.
    if (dist > this.meleeBand) {
      this.moveToward(this.target.x, this.target.y, dt);
    }

    // Once settled and off cooldown, begin an attack.
    if (this.globalCd <= 0 && dist <= this.meleeBand + 40) {
      this.beginAttack(ctx);
    }
  }

  beginAttack(ctx) {
    // Mix it up: mostly cleave when stacked on the tank, but regularly force a
    // dodge with the ground AoE (which can target the squishy ranged ally).
    const roll = Math.random();
    const which = roll < 0.55 ? 'cleave' : 'aoe';
    this.attack = ATTACKS[which];
    this.state = STATE.WINDUP;
    this.stateTimer = this.attack.windup;

    if (which === 'cleave') {
      this.faceTarget();
      this.telegraph = {
        type: 'cleave',
        x: this.x,
        y: this.y,
        facing: this.facing,
        range: this.attack.range,
        halfAngle: this.attack.halfAngle,
      };
    } else {
      // Drop the circle on a (preferably random alive) player's current spot.
      const alive = ctx.players.filter((p) => p.alive);
      const focus = alive.length
        ? Phaser.Utils.Array.GetRandom(alive)
        : this.target;
      this.telegraph = {
        type: 'aoe',
        x: focus ? focus.x : this.x,
        y: focus ? focus.y : this.y,
        radius: this.attack.radius,
      };
    }
  }

  updateWindup(dt, ctx) {
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.resolveAttack(ctx);
      this.state = STATE.RECOVER;
      this.stateTimer = this.attack.recover;
      this.telegraph = null;
    }
  }

  resolveAttack(ctx) {
    const tg = this.telegraph;
    if (!tg) return;

    for (const p of ctx.players) {
      if (!p.alive) continue;
      let hit = false;

      if (tg.type === 'cleave') {
        const dx = p.x - tg.x;
        const dy = p.y - tg.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= tg.range + p.radius) {
          const ang = Math.atan2(dy, dx);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(ang - tg.facing));
          if (diff <= tg.halfAngle) hit = true;
        }
      } else if (tg.type === 'aoe') {
        const dist = Math.hypot(p.x - tg.x, p.y - tg.y);
        if (dist <= tg.radius + p.radius) hit = true;
      }

      if (hit) ctx.onHit(p, this.attack.damage);
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

  // --- helpers ---

  distanceTo(e) {
    return Math.hypot(e.x - this.x, e.y - this.y);
  }

  moveToward(tx, ty, dt) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    let nx = this.x + Math.cos(ang) * this.speed * dt;
    let ny = this.y + Math.sin(ang) * this.speed * dt;
    const a = this.bounds;
    nx = Phaser.Math.Clamp(nx, a.x + this.radius, a.x + a.w - this.radius);
    ny = Phaser.Math.Clamp(ny, a.y + this.radius, a.y + a.h - this.radius);
    this.x = nx;
    this.y = ny;
  }

  faceTarget() {
    if (this.target && this.target.alive) {
      this.facing = Math.atan2(this.target.y - this.y, this.target.x - this.x);
    }
  }

  // --- drawing ---

  draw() {
    const g = this.gfx;
    g.clear();
    if (!this.alive) return;

    g.fillStyle(CONFIG.colors.boss, 1);
    g.fillCircle(this.x, this.y, this.radius);
    g.lineStyle(3, 0x000000, 0.4);
    g.strokeCircle(this.x, this.y, this.radius);

    // "Front" marker so players can read which way the cleave will swing.
    const fx = this.x + Math.cos(this.facing) * (this.radius + 4);
    const fy = this.y + Math.sin(this.facing) * (this.radius + 4);
    g.fillStyle(0xffd24a, 1);
    g.fillCircle(fx, fy, 8);
  }

  drawTelegraph() {
    const g = this.telegraphGfx;
    g.clear();
    if (!this.telegraph || this.state !== STATE.WINDUP) return;

    // Pulse the fill so urgency ramps as the hit lands.
    const progress = 1 - this.stateTimer / this.attack.windup; // 0 -> 1
    const alpha = 0.25 + progress * 0.4;
    const tg = this.telegraph;

    g.fillStyle(CONFIG.colors.telegraph, alpha);
    g.lineStyle(3, CONFIG.colors.telegraph, 0.9);

    if (tg.type === 'cleave') {
      const steps = 24;
      const start = tg.facing - tg.halfAngle;
      const end = tg.facing + tg.halfAngle;
      g.beginPath();
      g.moveTo(tg.x, tg.y);
      for (let i = 0; i <= steps; i++) {
        const a = start + ((end - start) * i) / steps;
        g.lineTo(tg.x + Math.cos(a) * tg.range, tg.y + Math.sin(a) * tg.range);
      }
      g.closePath();
      g.fillPath();
      g.strokePath();
    } else if (tg.type === 'aoe') {
      g.fillCircle(tg.x, tg.y, tg.radius);
      g.strokeCircle(tg.x, tg.y, tg.radius);
    }
  }

  updateHud() {
    this.hpBar.setValue(this.hp / this.maxHp);
    this.hpText.setText(`${Math.ceil(this.hp)} / ${this.maxHp}`);
    if (this.combatStart > 0) {
      const elapsed = (this.scene.time.now - this.combatStart) / 1000;
      const dps = elapsed > 0.5 ? Math.round(this.dmgTaken / elapsed) : 0;
      this.dpsText.setText(`DPS ${dps.toLocaleString()}`);
    }
  }

  destroy() {
    this.telegraphGfx.destroy();
    this.gfx.destroy();
    this.hpBar.destroy();
    this.hpText.destroy();
    this.nameText.destroy();
    this.dpsText.destroy();
  }
}
