import { ZONES, zonePortals } from '../../src/world/zones.js';
import Mob from './Mob.js';
import Minion from './Minion.js';
import Boss from './Boss.js';
import AggroTable from './AggroTable.js';
import { rollDrop, rollItem } from '../../src/items.js';

// One zone instance in a party's world. Owns its mobs / boss / projectiles and
// runs them authoritatively. The Room feeds it the players currently standing in
// the zone each tick and collects the resulting snapshot.

export default class Zone {
  constructor(key, seed = 0) {
    this.key = key;
    this.def = ZONES[key];
    this.seed = seed;
    this.portals = zonePortals(key, seed); // resolved (random portals get fixed spots)
    this.bounds = { w: this.def.size.w, h: this.def.size.h };
    this.players = [];        // set by Room each tick
    this.mobs = [];
    this.minions = [];
    this.projectiles = [];
    this.dots = [];
    this.fx = [];
    this.clock = 0;
    this.respawnQueue = [];
    this.nextMobId = 1;
    this.nextProjId = 1;
    this.nextMinionId = 1;

    if (this.def.boss) {
      this.boss = new Boss(this.bounds, this.def.boss); this.aggro = new AggroTable();
      this._bossWasAlive = true; this.bossResetTimer = 0; this.bossDmg = new Map(); this.bossFightStart = 0;
    } else if (this.def.raid) {
      this.boss = null; this.aggro = null;
      this._bossWasAlive = false; this.bossDmg = new Map(); this.bossFightStart = 0;
      this.raidState = 'wave1';
      this._raidSpawnWave(12);
    } else {
      this.boss = null; this.aggro = null;
    }

    if (this.def.mobTypes) for (let i = 0; i < this.def.mobCount; i++) this.spawnMob();
  }

  spawnMob(typeKey, level) {
    typeKey = typeKey || this.def.mobTypes[Math.floor(Math.random() * this.def.mobTypes.length)];
    level = level || this.def.mobLevel;
    const pos = this.randomPos();
    this.mobs.push(new Mob(this.nextMobId++, typeKey, pos.x, pos.y, level, this.bounds));
  }

  randomPos() {
    const z = this.def;
    for (let i = 0; i < 20; i++) {
      const x = 120 + Math.random() * (z.size.w - 240);
      const y = 120 + Math.random() * (z.size.h - 240);
      if (!this.portals.some((p) => Math.hypot(p.x - x, p.y - y) < 220)) return { x, y };
    }
    return { x: z.size.w / 2, y: 120 };
  }

  addFx(fx) { if (this.fx.length < 100) this.fx.push(fx); }
  spawnProjectile(pr) { pr.id = this.nextProjId++; this.projectiles.push(pr); }
  spawnMinion(owner, x, y, damage, maxHp, duration) { this.minions.push(new Minion(this.nextMinionId++, owner, x, y, damage, maxHp, duration, this.bounds)); }

  // Boss-summoned add: spawns at a given spot, pre-engaged, and never respawns.
  spawnMobAt(typeKey, x, y, level) {
    if (this.mobs.length >= 40) return;
    const m = new Mob(this.nextMobId++, typeKey, x, y, level, this.bounds);
    m.summoned = true; m.engaged = true;
    this.mobs.push(m);
  }

  // Per-tick adapter the shared BossCore uses to read combatants/threat and to
  // apply damage, summon adds and emit effects (see src/world/BossCore.js).
  bossAdapter() {
    const combatants = () => [...this.players, ...this.minions.filter((m) => m.alive)];
    return {
      bounds: this.bounds,
      getCombatants: combatants,
      getTarget: () => this.aggro.getTarget(combatants()),
      hit: (e, amount, blockable) => {
        let finalAmount = amount;
        if (blockable && e.isBlocking) {
          finalAmount = Math.max(1, Math.round(amount * 0.25));
          this.addFx({ t: 'text', x: e.x, y: e.y - e.radius - 10, msg: 'BLOCKED!', color: '#4ad0ff' });
        }
        const dealt = e.takeDamage(finalAmount);
        this.addFx({ t: 'dmg', x: e.x, y: e.y - e.radius, amount: dealt, enemy: true });
        if (!e.alive) this.aggro.remove(e.id);
      },
      spawnAdd: (typeKey, x, y, level) => this.spawnMobAt(typeKey, x, y, level),
      addFx: (fx) => this.addFx(fx),
    };
  }


  // What a mob attacks: the nearest player-side entity. Minions are treated
  // identically to players — no taunt preference, just closest wins.
  mobTarget(mob) {
    let best = null, bd = Infinity;
    for (const p of this.players) { if (!p.alive) continue; const d = Math.hypot(p.x - mob.x, p.y - mob.y); if (d < bd) { bd = d; best = p; } }
    for (const mn of this.minions) { if (!mn.alive) continue; const d = Math.hypot(mn.x - mob.x, mn.y - mob.y); if (d < bd) { bd = d; best = mn; } }
    return best;
  }

  enemies() {
    const list = this.mobs.filter((m) => m.alive);
    if (this.boss && this.boss.alive) list.push(this.boss);
    return list;
  }
  nearestEnemy(x, y, max = 99999) {
    let best = null, bd = max;
    for (const e of this.enemies()) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  nearestPlayer(x, y, max = 99999) {
    let best = null, bd = max;
    for (const p of this.players) { if (!p.alive) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // Damage an enemy (mob or the boss) and credit threat to the attacker.
  damageEnemy(enemy, amount, crit, attacker, threatMult = 1) {
    if (enemy === this.boss) {
      this.boss.takeDamage(amount);
      if (attacker) {
        this.aggro.add(attacker.id, amount * attacker.threatMultiplier * threatMult);
        // Per-player DPS: credit the owning player (minions credit their owner).
        const owner = attacker.owner != null ? this.playerById(attacker.owner) : attacker;
        if (owner) { if (this.bossFightStart === 0) this.bossFightStart = this.clock; const rec = this.bossDmg.get(owner.id) || { name: owner.name, dmg: 0 }; rec.name = owner.name; rec.dmg += amount; this.bossDmg.set(owner.id, rec); }
      }
    } else {
      enemy.takeDamage(amount);
      // Remember who to credit a drop to (minions credit their owner).
      if (attacker) enemy.lastAttacker = attacker.owner != null ? attacker.owner : attacker.id;
    }
    this.addFx({ t: 'dmg', x: enemy.x, y: enemy.y - enemy.radius, amount, crit: !!crit });
  }

  update(dt) {
    this.clock += dt;

    // respawns
    if (this.respawnQueue.length) {
      const ready = this.respawnQueue.filter((r) => r.at <= this.clock);
      this.respawnQueue = this.respawnQueue.filter((r) => r.at > this.clock);
      for (const r of ready) this.spawnMob(r.typeKey, r.level);
    }

    // mobs
    const mobCtx = {
      target: null,
      onMelee: (mob, target) => { const dealt = target.takeDamage(mob.damage); this.addFx({ t: 'dmg', x: target.x, y: target.y - target.radius, amount: dealt, enemy: true }); },
      fireProjectile: (fx, fy, tx, ty, dmg, sp) => {
        const ang = Math.atan2(ty - fy, tx - fx);
        this.spawnProjectile({ team: 'enemy', x: fx, y: fy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, dmg, ttl: 3, r: 5, color: 0xff7b5a });
      },
    };
    for (const m of this.mobs) { mobCtx.target = this.mobTarget(m); m.update(dt, mobCtx); }

    // minions (Necromancer pets): chase + melee enemies, credit their own threat
    const minionCtx = {
      nearestEnemy: (x, y, max) => this.nearestEnemy(x, y, max),
      applyHit: (minion, enemy, dmg) => this.damageEnemy(enemy, dmg, false, minion),
      ownerOf: (id) => this.playerById(id),
    };
    for (const mn of this.minions) mn.update(dt, minionCtx);

    // boss — minions count as combatants so the boss can target/cleave them
    if (this.boss && this.boss.alive) {
      this.boss.update(dt, this.bossAdapter());
    } else if (this.boss && !this.def.raid) {
      if (this._bossWasAlive) { this._bossWasAlive = false; this.onBossDeath(); }
      if (this.bossResetTimer > 0) { this.bossResetTimer -= dt; if (this.bossResetTimer <= 0) this.resetBoss(); }
    }
    if (this.def.raid) this._checkRaidProgress();

    this.updateDots(dt);
    this.updateProjectiles(dt);
    this.sweepDeadMobs();

    // Drop expired/killed minions (and clear their threat).
    if (this.minions.some((m) => !m.alive)) {
      for (const m of this.minions) if (!m.alive && this.aggro) this.aggro.remove(m.id);
      this.minions = this.minions.filter((m) => m.alive);
    }
  }

  updateDots(dt) {
    const keep = [];
    for (const d of this.dots) {
      if (!d.target.alive) continue;
      d.remaining -= dt; d.acc += dt;
      if (d.acc >= 0.5) {
        const dmg = Math.max(1, Math.round(d.dps * d.acc));
        this.damageEnemy(d.target, dmg, false, this.playerById(d.owner));
        d.acc = 0;
      }
      if (d.remaining > 0 && d.target.alive) keep.push(d);
    }
    this.dots = keep;
  }

  updateProjectiles(dt) {
    const next = [];
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.ttl -= dt;
      if (pr.ttl <= 0 || pr.x < 0 || pr.y < 0 || pr.x > this.bounds.w || pr.y > this.bounds.h) continue;

      if (pr.team === 'player') {
        let consumed = false;
        for (const e of this.enemies()) {
          if (Math.hypot(pr.x - e.x, pr.y - e.y) <= e.radius + pr.r) {
            this.damageEnemy(e, pr.amount, pr.crit, this.playerById(pr.owner));
            if (pr.lifesteal > 0) { const o = this.playerById(pr.owner); if (o) { const h = o.heal(Math.round(pr.amount * pr.lifesteal)); if (h > 0) this.addFx({ t: 'heal', x: o.x, y: o.y - 30, amount: h }); } }
            if (!pr.pierce) { consumed = true; break; }
          }
        }
        if (consumed) continue;
      } else {
        let hit = false;
        for (const target of [...this.players, ...this.minions]) {
          if (target.alive && Math.hypot(pr.x - target.x, pr.y - target.y) <= target.radius + pr.r) {
            const dealt = target.takeDamage(pr.dmg);
            this.addFx({ t: 'dmg', x: target.x, y: target.y - target.radius, amount: dealt, enemy: true });
            hit = true; break;
          }
        }
        if (hit) continue;
      }
      next.push(pr);
    }
    this.projectiles = next;
  }

  sweepDeadMobs() {
    if (!this.mobs.some((m) => !m.alive)) return;
    const alive = [];
    for (const m of this.mobs) {
      if (m.alive) { alive.push(m); continue; }
      // Shared XP: every player in the zone gets the kill.
      for (const p of this.players) {
        const levels = p.addXp(m.xp);
        this.addFx({ t: 'xp', x: m.x, y: m.y - 20, amount: m.xp });
        if (levels > 0) { p.recalc(); p.hp = p.maxHp; this.addFx({ t: 'level', x: p.x, y: p.y - 46, level: p.level }); }
      }
      // Loot: roll a drop and award it to whoever landed the kill.
      const drop = rollDrop({ mobLevel: m.level });
      if (drop) {
        const killer = this.players.find((p) => p.id === m.lastAttacker) || this.players[0];
        if (killer && killer.addItem(drop)) this.addFx({ t: 'loot', x: m.x, y: m.y - 28, rarity: drop.rarity, name: drop.name });
        else if (killer) this.addFx({ t: 'text', x: killer.x, y: killer.y - 34, msg: 'Backpack full!', color: '#ff7a7a' });
      }
      this.respawnQueue.push({ typeKey: m.typeKey, level: m.level, at: this.clock + 8 });
    }
    this.mobs = alive;
  }

  onBossDeath() {
    for (const p of this.players) {
      const levels = p.addXp(500); this.addFx({ t: 'xp', x: p.x, y: p.y - 20, amount: 500 }); if (levels > 0) { p.recalc(); p.hp = p.maxHp; }
      // Boss loot: every participant gets 2 guaranteed, high-rarity drops.
      let full = false;
      for (let i = 0; i < 2; i++) {
        const drop = rollItem({ ilvl: 12, rarityBoost: 0.8 });
        if (p.addItem(drop)) this.addFx({ t: 'loot', x: p.x + (i ? 24 : -24), y: p.y - 34, rarity: drop.rarity, name: drop.name });
        else full = true;
      }
      if (full) this.addFx({ t: 'text', x: p.x, y: p.y - 54, msg: 'Backpack full — make room!', color: '#ff7a7a' });
    }
    this.addFx({ t: 'text', x: this.bounds.w / 2, y: this.bounds.h / 2, msg: 'BOSS SLAIN!', color: '#7CFC9A', big: true });
    this.aggro = new AggroTable();
    this.bossResetTimer = 10;
    this.bossDmg.clear(); this.bossFightStart = 0;
  }
  resetBoss() { this.boss = new Boss(this.bounds); this._bossWasAlive = true; this.addFx({ t: 'text', x: this.bounds.w / 2, y: this.bounds.h / 2, msg: 'The Colossus rises again...', color: '#ffd24a', big: true }); }

  _raidSpawnWave(count) {
    const z = this.def;
    if (!z.mobTypes) return;
    for (let i = 0; i < count; i++) {
      const typeKey = z.mobTypes[Math.floor(Math.random() * z.mobTypes.length)];
      const pos = this.randomPos();
      this.mobs.push(new Mob(this.nextMobId++, typeKey, pos.x, pos.y, z.mobLevel, this.bounds));
    }
  }

  _raidSpawnBoss(bossKey) {
    this.boss = new Boss(this.bounds, bossKey);
    this.aggro = new AggroTable();
    this.bossDmg = new Map(); this.bossFightStart = 0;
  }

  _onRaidMiniBossDeath() {
    if (!this.boss) return;
    const loot = this.boss.cfg.loot, xp = this.boss.cfg.xp;
    for (const p of this.players) {
      const levels = p.addXp(xp);
      if (levels > 0) { p.recalc(); p.hp = p.maxHp; this.addFx({ t: 'level', x: p.x, y: p.y - 46, level: p.level }); }
    }
    this.mobs = this.mobs.filter((m) => !m.summoned);
    this.boss = null; this.aggro = null;
  }

  _checkRaidProgress() {
    const liveMobs = this.mobs.filter((m) => !m.summoned);
    const bossAlive = this.boss && this.boss.alive;
    if (this.raidState === 'wave1' && liveMobs.length === 0) {
      this.raidState = 'boss1';
      this._raidSpawnBoss('guardian');
      this.addFx({ t: 'text', x: this.bounds.w/2, y: this.bounds.h/2 - 80, msg: 'BOSS: Guardian of the Bastion!', color: '#8ab8e0', big: true });
    } else if (this.raidState === 'boss1' && this.boss && !bossAlive) {
      this._awardRaidLoot();
      this.raidState = 'wave2';
      this._raidSpawnWave(8);
      this.addFx({ t: 'text', x: this.bounds.w/2, y: this.bounds.h/2 - 80, msg: 'More enemies incoming!', color: '#ffd24a', big: true });
    } else if (this.raidState === 'wave2' && liveMobs.length === 0) {
      this.raidState = 'boss2';
      this._raidSpawnBoss('warden');
      this.addFx({ t: 'text', x: this.bounds.w/2, y: this.bounds.h/2 - 80, msg: 'BOSS: Warden of Chains!', color: '#d4a020', big: true });
    } else if (this.raidState === 'boss2' && this.boss && !bossAlive) {
      this._awardRaidLoot();
      this.raidState = 'final';
      this._raidSpawnBoss('worldbreaker');
      this.addFx({ t: 'text', x: this.bounds.w/2, y: this.bounds.h/2 - 80, msg: 'THE WORLDBREAKER AWAKENS!', color: '#d020e0', big: true });
    } else if (this.raidState === 'final' && this.boss && !bossAlive) {
      this._awardRaidLoot();
      this.raidState = 'done';
      this.addFx({ t: 'text', x: this.bounds.w/2, y: this.bounds.h/2, msg: 'RAID COMPLETE!', color: '#7CFC9A', big: true });
    }
  }

  _awardRaidLoot() {
    if (!this.boss) return;
    const loot = this.boss.cfg.loot, xp = this.boss.cfg.xp;
    for (const p of this.players) {
      const levels = p.addXp(xp);
      if (levels > 0) { p.recalc(); p.hp = p.maxHp; this.addFx({ t: 'level', x: p.x, y: p.y - 46, level: p.level }); }
      this.addFx({ t: 'xp', x: p.x, y: p.y - 20, amount: xp });
      let full = false;
      for (let i = 0; i < loot.count; i++) {
        const drop = rollItem({ ilvl: loot.ilvl, rarityBoost: loot.rarityBoost });
        if (p.addItem(drop)) this.addFx({ t: 'loot', x: p.x + (i - (loot.count-1)/2)*24, y: p.y - 34, rarity: drop.rarity, name: drop.name });
        else full = true;
      }
      if (full) this.addFx({ t: 'text', x: p.x, y: p.y - 54, msg: 'Backpack full!', color: '#ff7a7a' });
    }
    this.mobs = this.mobs.filter((m) => !m.summoned);
    this.boss = null; this.aggro = null;
  }

  playerById(id) { return this.players.find((p) => p.id === id) || null; }

  bossDpsRows() {
    const elapsed = this.clock - this.bossFightStart;
    if (this.bossFightStart === 0 || elapsed < 0.5) return [];
    return [...this.bossDmg.values()].map((r) => ({ name: r.name, dps: Math.round(r.dmg / elapsed) })).sort((a, b) => b.dps - a.dps);
  }

  snapshot() {
    return {
      zoneKey: this.key,
      mobs: this.mobs.filter((m) => m.alive).map((m) => m.snapshot()),
      minions: this.minions.filter((m) => m.alive).map((m) => m.snapshot()),
      boss: this.boss ? { ...this.boss.snapshot(), dps: this.bossDpsRows() } : null,
      projectiles: this.projectiles.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), r: p.r, color: p.color })),
      fx: this.fx,
      raidState: this.raidState || null,
    };
  }
}
