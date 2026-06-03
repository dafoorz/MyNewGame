import { START_ZONE } from '../src/world/zones.js';
import Zone from './sim/Zone.js';
import ServerPlayer from './sim/ServerPlayer.js';
import { resolveSkill } from './sim/skills.js';

const TICK_HZ = 30;
const TICK_DT = 1 / TICK_HZ;

// A Room is one party's shared, authoritative world spanning ALL zones. Each
// player roams independently (Town → Forest → Caves → Boss Lair); the server
// simulates every zone that currently has players in it and sends each client a
// snapshot of just their zone. Players only see party members in the same zone.

export default class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map();   // socketId -> ServerPlayer
    this.zones = new Map();     // zoneKey -> Zone (created on demand)
    this.zoneName = 'Riverwood (Town)';
    this.interval = null;
  }

  get empty() { return this.players.size === 0; }

  getZone(key) {
    let z = this.zones.get(key);
    if (!z) { z = new Zone(key); this.zones.set(key, z); }
    return z;
  }

  addPlayer(id, name, classKey) {
    const p = new ServerPlayer(id, name, classKey);
    this.movePlayerToZone(p, START_ZONE, null);
    p.x += (this.players.size % 3) * 50 - 50; // fan out a little
    this.players.set(id, p);
    if (!this.interval) this.start();
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    for (const z of this.zones.values()) if (z.aggro) z.aggro.remove(id);
    if (this.empty) this.stop();
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, classKey: p.classKey, role: p.def.role }));
  }

  playersInZone(key) { return [...this.players.values()].filter((p) => p.zoneKey === key); }

  movePlayerToZone(player, toKey, fromKey) {
    const zone = this.getZone(toKey);
    player.zoneKey = toKey;
    player.bounds = zone.bounds;
    const z = zone.def;
    const entry = z.portals.find((p) => p.to === fromKey);
    if (entry) {
      const dx = entry.x < z.size.w / 2 ? 70 : entry.x > z.size.w - 80 ? -70 : 0;
      const dy = entry.y < z.size.h / 2 ? 70 : entry.y > z.size.h - 80 ? -70 : 0;
      player.x = entry.x + dx; player.y = entry.y + dy;
    } else { player.x = z.size.w / 2; player.y = z.size.h / 2; }
    player.portalLock = true;
  }

  checkPortal(player) {
    const z = this.getZone(player.zoneKey).def;
    let on = false;
    for (const p of z.portals) {
      if (Math.hypot(p.x - player.x, p.y - player.y) <= 42) {
        on = true;
        if (!player.portalLock) { this.movePlayerToZone(player, p.to, player.zoneKey); return; }
      }
    }
    if (!on) player.portalLock = false;
  }

  // --- client intents ---
  setInput(id, mx, my, facing) { const p = this.players.get(id); if (p) p.setInput(mx, my, facing); }
  spendStat(id, attr) { const p = this.players.get(id); if (p) p.spendStat(attr); }

  doBasic(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.attackTimer > 0) return;
    p.attackTimer = p.stats.attackInterval;
    const zone = this.getZone(p.zoneKey);
    zone.players = this.playersInZone(p.zoneKey);
    const b = p.def.basic;
    if (b.kind === 'melee') resolveSkill(zone, p, { type: 'arc', stat: b.stat, mult: b.mult });
    else resolveSkill(zone, p, { type: 'bolt', stat: b.stat, count: 1, mult: b.mult, speed: b.speed });
  }

  doCast(id, slot) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const def = p.def.skills[slot - 1];
    if (!def || p.cooldowns[slot] > 0) return;
    const zone = this.getZone(p.zoneKey);
    zone.players = this.playersInZone(p.zoneKey);
    resolveSkill(zone, p, def);
    p.cooldowns[slot] = def.cd;
  }

  // --- simulation ---
  tick() {
    const dt = TICK_DT;

    for (const p of this.players.values()) {
      p.update(dt);
      if (!p.alive) { p.deadTimer -= dt; if (p.deadTimer <= 0) { p.alive = true; p.hp = p.maxHp; p.damageReduction = 0; this.movePlayerToZone(p, START_ZONE, null); } }
      else this.checkPortal(p);
    }

    // Group players by zone and simulate only active zones.
    const active = new Map();
    for (const p of this.players.values()) {
      if (!active.has(p.zoneKey)) active.set(p.zoneKey, []);
      active.get(p.zoneKey).push(p);
    }

    for (const [key, players] of active) {
      const zone = this.getZone(key);
      zone.players = players;
      zone.update(dt);
    }

    this.broadcast(active);
  }

  broadcast(active) {
    for (const [key, players] of active) {
      const zone = this.getZone(key);
      const zoneSnap = zone.snapshot();
      const roster = players.map((p) => p.snapshot());
      for (const p of players) {
        this.io.to(p.id).emit('snapshot', { ...zoneSnap, players: roster, me: p.privateState() });
      }
      zone.fx = [];
    }
  }

  start() { this.interval = setInterval(() => this.tick(), 1000 / TICK_HZ); }
  stop() { if (this.interval) clearInterval(this.interval); this.interval = null; }
}
