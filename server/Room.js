import { ZONES } from '../src/world/zones.js';
import Boss from './sim/Boss.js';
import AggroTable from './sim/AggroTable.js';
import ServerPlayer from './sim/ServerPlayer.js';
import { resolveSkill } from './sim/skills.js';

const TICK_HZ = 30;
const TICK_DT = 1 / TICK_HZ;

// A Room is one party's shared, authoritative world. For this first online
// iteration every room is the co-op boss lair (the stated core goal). The Room
// owns the simulation; clients only send input and render snapshots.

export default class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    const z = ZONES.lair;
    this.bounds = { w: z.size.w, h: z.size.h };
    this.zoneName = z.name;

    this.players = new Map(); // socketId -> ServerPlayer
    this.boss = new Boss(this.bounds);
    this.aggro = new AggroTable();
    this.projectiles = [];
    this.dots = [];
    this.fx = [];
    this.nextProjId = 1;
    this.partyXp = 0;
    this.bossResetTimer = 0;

    this.interval = null;
  }

  get empty() { return this.players.size === 0; }

  addPlayer(id, name, classKey) {
    const p = new ServerPlayer(id, name, classKey, this.bounds);
    // Spread spawns along the entry side so players don't stack.
    p.x = 160 + this.players.size * 60;
    p.y = this.bounds.h / 2 + (this.players.size % 2 ? 40 : -40);
    this.players.set(id, p);
    if (!this.interval) this.start();
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.aggro.remove(id);
    if (this.empty) this.stop();
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, classKey: p.classKey, role: p.def.role }));
  }

  // --- client intents ---
  setInput(id, mx, my, facing) {
    const p = this.players.get(id);
    if (p) p.setInput(mx, my, facing);
  }

  doBasic(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.attackTimer > 0) return;
    p.attackTimer = p.stats.attackInterval;
    const b = p.def.basic;
    if (b.kind === 'melee') resolveSkill(this, p, { type: 'arc', stat: b.stat, mult: b.mult });
    else resolveSkill(this, p, { type: 'bolt', stat: b.stat, count: 1, mult: b.mult, speed: b.speed });
  }

  doCast(id, slot) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const def = p.def.skills[slot - 1];
    if (!def || p.cooldowns[slot] > 0) return;
    resolveSkill(this, p, def);
    p.cooldowns[slot] = def.cd;
  }

  // --- helpers used by skills.js ---
  addFx(fx) { if (this.fx.length < 80) this.fx.push(fx); }
  spawnProjectile(pr) { pr.id = this.nextProjId++; this.projectiles.push(pr); }

  // --- simulation ---
  tick() {
    const dt = TICK_DT;

    for (const p of this.players.values()) p.update(dt);

    const playerList = [...this.players.values()];
    if (this.boss.alive) {
      this.boss.update(dt, playerList, this.aggro, (pl, amount) => {
        const dealt = pl.takeDamage(amount);
        this.addFx({ t: 'dmg', x: pl.x, y: pl.y - pl.radius, amount: dealt, crit: false, enemy: true });
        if (!pl.alive) this.aggro.remove(pl.id);
      });
    } else if (this.bossResetTimer > 0) {
      this.bossResetTimer -= dt;
      if (this.bossResetTimer <= 0) this.resetBoss();
    }

    this.updateDots(dt);
    this.updateProjectiles(dt);

    // Downed players slowly revive once the boss is dead (between attempts).
    if (!this.boss.alive) for (const p of this.players.values()) { if (!p.alive) { p.alive = true; p.hp = p.maxHp; } }

    this.broadcast();
    this.fx = [];
  }

  updateDots(dt) {
    if (!this.boss.alive) { this.dots = []; return; }
    const keep = [];
    for (const d of this.dots) {
      d.remaining -= dt; d.acc += dt;
      if (d.acc >= 0.5) {
        const dmg = Math.max(1, Math.round(d.dps * d.acc));
        this.boss.takeDamage(dmg);
        this.aggro.add(d.owner, dmg);
        this.addFx({ t: 'dmg', x: this.boss.x, y: this.boss.y - this.boss.radius, amount: dmg, crit: false });
        d.acc = 0;
      }
      if (d.remaining > 0 && this.boss.alive) keep.push(d);
    }
    this.dots = keep;
  }

  updateProjectiles(dt) {
    const next = [];
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.ttl -= dt;
      const out = pr.x < 0 || pr.y < 0 || pr.x > this.bounds.w || pr.y > this.bounds.h;
      if (pr.ttl <= 0 || out) continue;

      if (pr.team === 'player' && this.boss.alive) {
        if (Math.hypot(pr.x - this.boss.x, pr.y - this.boss.y) <= this.boss.radius + pr.r) {
          this.boss.takeDamage(pr.amount);
          this.aggro.add(pr.owner, pr.amount * this.threatOf(pr.owner));
          this.addFx({ t: 'dmg', x: this.boss.x, y: this.boss.y - this.boss.radius, amount: pr.amount, crit: pr.crit });
          if (pr.lifesteal > 0) {
            const o = this.players.get(pr.owner);
            if (o) { const h = o.heal(Math.round(pr.amount * pr.lifesteal)); if (h > 0) this.addFx({ t: 'heal', x: o.x, y: o.y - 30, amount: h }); }
          }
          if (!pr.pierce) continue;
        }
      }
      next.push(pr);
    }
    this.projectiles = next;
  }

  threatOf(id) { const p = this.players.get(id); return p ? p.threatMultiplier : 1; }

  onBossDeath() {
    this.partyXp += 500;
    this.addFx({ t: 'text', x: this.bounds.w / 2, y: this.bounds.h / 2, msg: 'BOSS SLAIN!', color: '#7CFC9A', big: true });
    this.aggro = new AggroTable();
    this.bossResetTimer = 8;
  }

  resetBoss() {
    this.boss = new Boss(this.bounds);
    this.addFx({ t: 'text', x: this.bounds.w / 2, y: this.bounds.h / 2, msg: 'The Colossus rises again...', color: '#ffd24a', big: true });
  }

  broadcast() {
    // Detect the boss dying this tick to fire the reward once.
    if (this._bossWasAlive && !this.boss.alive) this.onBossDeath();
    this._bossWasAlive = this.boss.alive;

    this.io.to(this.code).emit('snapshot', {
      players: [...this.players.values()].map((p) => p.snapshot()),
      boss: this.boss.snapshot(),
      projectiles: this.projectiles.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), r: p.r, color: p.color, team: p.team })),
      fx: this.fx,
      partyXp: this.partyXp,
    });
  }

  start() {
    this._bossWasAlive = this.boss.alive;
    this.interval = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
