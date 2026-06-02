import { wrapAngle } from './mathutil.js';

// Authoritative skill resolution. Mirrors the client's castSkill engine, but
// runs on the server so combat can't be faked. The lair room has a single enemy
// (the boss), which keeps targeting simple: "nearest enemy" is always the boss.
//
// `room` exposes: boss, players (Map), aggro, addFx(fx), spawnProjectile(p).

const PROJ_COLOR = { phys: 0xffe2a8, mag: 0x9be8ff };

function damageBoss(room, player, amount, crit, threatMult = 1) {
  if (!room.boss || !room.boss.alive) return;
  room.boss.takeDamage(amount);
  room.aggro.add(player.id, amount * player.threatMultiplier * threatMult);
  room.addFx({ t: 'dmg', x: room.boss.x, y: room.boss.y - room.boss.radius, amount, crit: !!crit });
}

function applyArc(room, player, def) {
  const boss = room.boss;
  if (!boss || !boss.alive) return;
  const half = def.half != null ? def.half : 1.3;
  const range = (player.def.basic.range || 78) + (def.rangeBonus || 0);
  const dx = boss.x - player.x, dy = boss.y - player.y;
  if (Math.hypot(dx, dy) > range + boss.radius) return;
  if (Math.abs(wrapAngle(Math.atan2(dy, dx) - player.facing)) > half) return;
  const { amount, crit } = player.roll(def.stat || 'phys', def.mult, def.crit);
  damageBoss(room, player, amount, crit, def.threat || 1);
}

function applyRadial(room, player, def, threatMult) {
  const boss = room.boss;
  if (!boss || !boss.alive) return;
  if (Math.hypot(boss.x - player.x, boss.y - player.y) > def.radius + boss.radius) return;
  const { amount, crit } = player.roll(def.stat || 'phys', def.mult, def.crit);
  damageBoss(room, player, amount, crit, threatMult);
}

function fireBolt(room, player, def) {
  const count = def.count || 1;
  const spread = def.spread || 0;
  const speed = def.speed || 430;
  for (let i = 0; i < count; i++) {
    const offset = count > 1 ? (i - (count - 1) / 2) * spread : 0;
    const ang = player.facing + offset;
    const { amount, crit } = player.roll(def.stat, def.mult, def.crit);
    room.spawnProjectile({
      team: 'player', owner: player.id,
      x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      amount, crit, ttl: 2.2, r: 5, pierce: !!def.pierce, lifesteal: def.lifesteal || 0,
      color: PROJ_COLOR[def.stat] || 0xffffff,
    });
  }
}

function doHeal(room, player, def) {
  const amount = Math.round(player.stats.magPower * def.intMult);
  const healed = player.heal(amount);
  if (healed > 0) room.addFx({ t: 'heal', x: player.x, y: player.y - 30, amount: healed });
  if (def.allies) {
    for (const ally of room.players.values()) {
      if (ally === player || !ally.alive) continue;
      const h = ally.heal(amount);
      if (h > 0) room.addFx({ t: 'heal', x: ally.x, y: ally.y - 30, amount: h });
    }
  }
}

export function resolveSkill(room, player, def) {
  switch (def.type) {
    case 'arc':
      room.addFx({ t: 'arc', x: player.x, y: player.y, facing: player.facing, range: (player.def.basic.range || 78) + (def.rangeBonus || 0), half: def.half != null ? def.half : 1.3 });
      applyArc(room, player, def);
      break;
    case 'nova':
      room.addFx({ t: 'ring', x: player.x, y: player.y, radius: def.radius, color: def.color });
      applyRadial(room, player, def, 1.3);
      break;
    case 'blast': {
      // The blast is centered on the nearest enemy (the boss), so it always
      // connects — unlike nova, which is point-blank around the caster.
      const boss = room.boss;
      const tx = boss ? boss.x : player.x + Math.cos(player.facing) * 200;
      const ty = boss ? boss.y : player.y + Math.sin(player.facing) * 200;
      room.addFx({ t: 'blast', x: tx, y: ty, radius: def.radius, color: def.color });
      if (boss && boss.alive) {
        const { amount, crit } = player.roll(def.stat || 'mag', def.mult, def.crit);
        damageBoss(room, player, amount, crit, 1.2);
      }
      break;
    }
    case 'bolt':
      fireBolt(room, player, def);
      break;
    case 'taunt':
      room.aggro.forceTop(player.id, 600);
      room.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'TAUNT!', color: '#ff8c5a' });
      if (def.arcMult) applyArc(room, player, { stat: 'phys', mult: def.arcMult, threat: 2 });
      break;
    case 'shield':
      player.applyShield(def.reduction, def.duration);
      room.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'SHIELD', color: '#66ccff' });
      if (def.heal) doHeal(room, player, { intMult: def.intMult || 1, allies: true });
      break;
    case 'heal':
      doHeal(room, player, def);
      break;
    case 'buff':
      player.applyBuff(def.damageMult || 1, def.speedMult || 1, def.duration);
      if (def.allies) for (const a of room.players.values()) if (a.alive) a.applyBuff(def.damageMult || 1, def.speedMult || 1, def.duration);
      room.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: def.speedMult > 1 ? 'HASTE' : 'BLESSED', color: '#9be8ff' });
      break;
    case 'stealth':
      // No mobs to break aggro from in the boss room; treat as a burst buff.
      player.applyBuff(1, 1.3, def.duration);
      room.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'STEALTH', color: '#9aa6c4' });
      break;
    case 'dash': {
      const b = player.bounds;
      player.x = Math.max(player.radius, Math.min(b.w - player.radius, player.x + Math.cos(player.facing) * def.distance));
      player.y = Math.max(player.radius, Math.min(b.h - player.radius, player.y + Math.sin(player.facing) * def.distance));
      room.addFx({ t: 'arc', x: player.x, y: player.y, facing: player.facing, range: player.def.basic.range || 78, half: 1.3 });
      applyArc(room, player, { stat: 'phys', mult: def.mult, crit: true });
      break;
    }
    case 'dot':
      if (room.boss && room.boss.alive) {
        room.dots.push({ owner: player.id, dps: player.stats.magPower * def.intMult, remaining: def.duration, acc: 0 });
        room.addFx({ t: 'text', x: room.boss.x, y: room.boss.y - room.boss.radius - 16, msg: 'CURSED', color: '#c06cff' });
      }
      break;
    case 'summon':
      // Minions vs a single boss: model as a short damage buff for now.
      player.applyBuff(1.25, 1, def.duration);
      room.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'RISE!', color: '#a4f06c' });
      break;
  }
}
