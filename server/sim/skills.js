import { wrapAngle } from './mathutil.js';

// Authoritative skill resolution. Mirrors the client's castSkill engine, but
// runs server-side against a Zone's enemies (its mobs and, in the lair, the
// boss). `zone` exposes: enemies(), nearestEnemy(), players, boss, aggro,
// damageEnemy(enemy, amount, crit, attacker, threatMult), addFx, spawnProjectile.

const PROJ_COLOR = { phys: 0xffe2a8, mag: 0x9be8ff };

function inArc(player, e, range, half) {
  const dx = e.x - player.x, dy = e.y - player.y;
  if (Math.hypot(dx, dy) > range + e.radius) return false;
  return Math.abs(wrapAngle(Math.atan2(dy, dx) - player.facing)) <= half;
}

function applyArc(zone, player, def) {
  const half = def.half != null ? def.half : 1.3;
  const range = (player.def.basic.range || 78) + (def.rangeBonus || 0);
  for (const e of zone.enemies()) if (inArc(player, e, range, half)) {
    const { amount, crit } = player.roll(def.stat || 'phys', def.mult, def.crit);
    zone.damageEnemy(e, amount, crit, player, def.threat || 1);
  }
}

function applyNova(zone, player, def, threatMult) {
  for (const e of zone.enemies()) if (Math.hypot(e.x - player.x, e.y - player.y) <= def.radius + e.radius) {
    const { amount, crit } = player.roll(def.stat || 'phys', def.mult, def.crit);
    zone.damageEnemy(e, amount, crit, player, threatMult);
  }
}

function applyBlast(zone, player, def) {
  const t = zone.nearestEnemy(player.x, player.y);
  const tx = t ? t.x : player.x + Math.cos(player.facing) * 200;
  const ty = t ? t.y : player.y + Math.sin(player.facing) * 200;
  zone.addFx({ t: 'blast', x: tx, y: ty, radius: def.radius, color: def.color });
  for (const e of zone.enemies()) if (Math.hypot(e.x - tx, e.y - ty) <= def.radius + e.radius) {
    const { amount, crit } = player.roll(def.stat, def.mult, def.crit);
    zone.damageEnemy(e, amount, crit, player, 1.2);
  }
}

function fireBolt(zone, player, def) {
  const count = def.count || 1, spread = def.spread || 0, speed = def.speed || 430;
  for (let i = 0; i < count; i++) {
    const ang = player.facing + (count > 1 ? (i - (count - 1) / 2) * spread : 0);
    const { amount, crit } = player.roll(def.stat, def.mult, def.crit);
    zone.spawnProjectile({ team: 'player', owner: player.id, x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, amount, crit, ttl: 2.2, r: 5, pierce: !!def.pierce, lifesteal: def.lifesteal || 0, color: PROJ_COLOR[def.stat] || 0xffffff });
  }
}

function doHeal(zone, player, def) {
  const amount = Math.round(player.stats.magPower * def.intMult);
  const healed = player.heal(amount);
  if (healed > 0) zone.addFx({ t: 'heal', x: player.x, y: player.y - 30, amount: healed });
  if (def.allies) for (const a of zone.players) { if (a === player || !a.alive) continue; const h = a.heal(amount); if (h > 0) zone.addFx({ t: 'heal', x: a.x, y: a.y - 30, amount: h }); }
}

export function resolveSkill(zone, player, def) {
  switch (def.type) {
    case 'arc':
      zone.addFx({ t: 'arc', x: player.x, y: player.y, facing: player.facing, range: (player.def.basic.range || 78) + (def.rangeBonus || 0), half: def.half != null ? def.half : 1.3 });
      applyArc(zone, player, def);
      break;
    case 'nova':
      zone.addFx({ t: 'ring', x: player.x, y: player.y, radius: def.radius, color: def.color });
      applyNova(zone, player, def, 1.3);
      break;
    case 'blast':
      applyBlast(zone, player, def);
      break;
    case 'bolt':
      fireBolt(zone, player, def);
      break;
    case 'taunt':
      if (zone.boss) zone.aggro.forceTop(player.id, 600);
      for (const m of zone.mobs) if (Math.hypot(m.x - player.x, m.y - player.y) < 280) m.engaged = true;
      zone.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'TAUNT!', color: '#ff8c5a' });
      if (def.arcMult) applyArc(zone, player, { stat: 'phys', mult: def.arcMult, threat: 2 });
      break;
    case 'shield':
      player.applyShield(def.reduction, def.duration);
      zone.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'SHIELD', color: '#66ccff' });
      if (def.heal) doHeal(zone, player, { intMult: def.intMult || 1, allies: true });
      break;
    case 'heal':
      doHeal(zone, player, def);
      break;
    case 'buff':
      player.applyBuff(def.damageMult || 1, def.speedMult || 1, def.duration);
      if (def.allies) for (const a of zone.players) if (a.alive) a.applyBuff(def.damageMult || 1, def.speedMult || 1, def.duration);
      zone.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: def.speedMult > 1 ? 'HASTE' : 'BLESSED', color: '#9be8ff' });
      break;
    case 'stealth':
      player.applyBuff(1, 1.3, def.duration);
      zone.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'STEALTH', color: '#9aa6c4' });
      break;
    case 'dash': {
      const b = player.bounds;
      player.x = Math.max(player.radius, Math.min(b.w - player.radius, player.x + Math.cos(player.facing) * def.distance));
      player.y = Math.max(player.radius, Math.min(b.h - player.radius, player.y + Math.sin(player.facing) * def.distance));
      zone.addFx({ t: 'arc', x: player.x, y: player.y, facing: player.facing, range: player.def.basic.range || 78, half: 1.3 });
      applyArc(zone, player, { stat: 'phys', mult: def.mult, crit: true });
      break;
    }
    case 'dodge': {
      const dist = def.distance * (player.def.basic.kind === 'ranged' ? 1.5 : 1); // ranged roll farther
      const b = player.bounds;
      player.x = Math.max(player.radius, Math.min(b.w - player.radius, player.x + Math.cos(player.facing) * dist));
      player.y = Math.max(player.radius, Math.min(b.h - player.radius, player.y + Math.sin(player.facing) * dist));
      player.invulnTimer = def.iframe;
      zone.addFx({ t: 'ring', x: player.x, y: player.y, radius: player.radius + 16, color: def.color });
      zone.addFx({ t: 'text', x: player.x, y: player.y - 34, msg: 'DODGE', color: def.color });
      break;
    }
    case 'dot': {
      const t = zone.nearestEnemy(player.x, player.y, 420);
      if (t) { zone.dots.push({ owner: player.id, target: t, dps: player.stats.magPower * def.intMult, remaining: def.duration, acc: 0 }); zone.addFx({ t: 'text', x: t.x, y: t.y - t.radius - 16, msg: 'CURSED', color: '#c06cff' }); }
      break;
    }
    case 'summon': {
      const dmg = Math.round(6 + player.level * 3 + player.stats.INT * 0.5);
      const hp = Math.round(30 + player.level * 8 + player.stats.INT * 2);
      for (let i = 0; i < def.count; i++) {
        const ang = Math.random() * Math.PI * 2;
        zone.spawnMinion(player.id, player.x + Math.cos(ang) * 30, player.y + Math.sin(ang) * 30, dmg, hp, def.duration);
      }
      zone.addFx({ t: 'text', x: player.x, y: player.y - 30, msg: 'RISE!', color: '#a4f06c' });
      break;
    }
  }
}
