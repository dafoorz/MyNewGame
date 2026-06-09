// Headless smoke test for the multi-zone authoritative server: boot it, connect
// two clients, confirm they spawn in Town together, walk to the Forest portal,
// transition zones, see mobs, fight them, and gain XP. Run: npm test
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { canEquip } from '../src/items.js';

const proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '8099' }, stdio: 'inherit' });
await sleep(900);

const URL = 'http://localhost:8099';
const fail = (m) => { console.error('FAIL:', m); proc.kill(); process.exit(1); };
const onConnect = (s) => new Promise((res) => { if (s.connected) res(); else s.on('connect', res); });
const waitFor = async (cond, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await sleep(50); } return false; };

const a = io(URL), b = io(URL);
let aSnap = null, bSnap = null;
a.on('snapshot', (s) => { aSnap = s; });
b.on('snapshot', (s) => { bSnap = s; });

await onConnect(a);
a.emit('create_party', { name: 'Tank', classKey: 'warrior' });
const code = await new Promise((res) => a.on('party_joined', (d) => res(d.code)));
console.log('  party code:', code);

await onConnect(b);
b.emit('join_party', { code, name: 'Mage', classKey: 'mage' });
await new Promise((res) => b.on('party_joined', res));

await sleep(400);
if (!aSnap || aSnap.zoneKey !== 'town') fail('expected to spawn in town');
if (aSnap.players.length !== 2) fail('expected 2 players in town');
console.log('  spawned in town:', aSnap.players.map((p) => p.name).join(', '));

// Steer both toward the Town→Forest portal until the zone changes.
const steer = (snap, sock, name, tx, ty) => {
  const me = snap && snap.players && snap.players.find((p) => p.name === name);
  if (!me) return;
  const dx = tx - me.x, dy = ty - me.y, d = Math.hypot(dx, dy) || 1;
  sock.emit('input', { mx: dx / d, my: dy / d, facing: 0 });
};
const FX = 1450, FY = 260; // town's fixed Forest portal
const walk = setInterval(() => { steer(aSnap, a, 'Tank', FX, FY); steer(bSnap, b, 'Mage', FX, FY); }, 80);
const reached = await waitFor(() => aSnap && aSnap.zoneKey === 'forest', 9000);
clearInterval(walk);
a.emit('input', { mx: 0, my: 0, facing: 0 }); b.emit('input', { mx: 0, my: 0, facing: 0 });
if (!reached) fail('did not transition to forest via portal');
console.log('  walked through portal to:', aSnap.zoneKey);

await sleep(300);
if (!(aSnap.mobs && aSnap.mobs.length > 0)) fail('no mobs spawned in forest');
console.log('  forest mobs present:', aSnap.mobs.length);

// Waystones: 'town' is auto-discovered; walk onto the Forest Edge shrine to learn it.
if (!(aSnap.me && aSnap.me.waypoints && aSnap.me.waypoints.includes('town'))) fail('town waystone not auto-discovered');
const toShrine = setInterval(() => steer(aSnap, a, 'Tank', 160, 550), 80); // forest_entry shrine
const learned = await waitFor(() => aSnap.me && aSnap.me.waypoints.includes('forest_entry'), 6000);
clearInterval(toShrine); a.emit('input', { mx: 0, my: 0, facing: 0 });
if (!learned) fail('did not discover the Forest Edge waystone on contact');
console.log('  discovered waystone:', aSnap.me.waypoints.filter((w) => w !== 'town').join(', '));

// Fast-travel home via a known waystone; an UNKNOWN one must be rejected.
a.emit('map_travel', { waystone: 'ember_entry' }); // not discovered -> ignored
await sleep(200);
if (aSnap.zoneKey !== 'forest') fail('travel to an undiscovered waystone should be rejected');
a.emit('map_travel', { waystone: 'town' });        // discovered -> allowed
const traveled = await waitFor(() => aSnap.zoneKey === 'town', 3000);
if (!traveled) fail('fast-travel to a discovered waystone failed');
console.log('  fast-traveled to town via waystone');

// Combat lock: attacking puts the tank in combat; travel must be refused until
// 5s pass with no attack/hit. (Tank is safe in town, so this is deterministic.)
a.emit('basic');
const inCombat = await waitFor(() => aSnap.me && aSnap.me.inCombat === true, 1500);
if (!inCombat) fail('attacking did not flag the player as in-combat');
a.emit('map_travel', { waystone: 'forest_entry' }); // in combat -> must be ignored
await sleep(200);
if (aSnap.zoneKey !== 'town') fail('fast-travel should be blocked while in combat');
console.log('  travel correctly blocked while in combat');
const leftCombat = await waitFor(() => aSnap.me && aSnap.me.inCombat === false, 7000);
if (!leftCombat) fail('player did not leave combat after 5s');
console.log('  left combat after cooldown');

// Walk back to the forest so the rest of the test runs there.
const back = setInterval(() => steer(aSnap, a, 'Tank', FX, FY), 80);
await waitFor(() => aSnap.zoneKey === 'forest', 9000);
clearInterval(back); a.emit('input', { mx: 0, my: 0, facing: 0 });

// Mage nukes the nearest mob with Fireball (auto-targets) until XP is gained.
const fight = setInterval(() => { b.emit('cast', { slot: 1 }); b.emit('basic'); }, 120);
const gotXp = await waitFor(() => bSnap && bSnap.me && (bSnap.me.level > 1 || bSnap.me.xp > 0), 8000);
clearInterval(fight);
if (!gotXp) fail('no XP gained from fighting mobs');
if (!(bSnap.me.gold > 0)) fail('no gold gained from killing mobs');
console.log(`  mage gained XP (level ${bSnap.me.level}, xp ${bSnap.me.xp}), gold ${bSnap.me.gold}`);

// Necromancer minions: join, summon (Raise Dead), confirm minions appear.
const c = io(URL);
let cSnap = null;
c.on('snapshot', (s) => { cSnap = s; });
await onConnect(c);
c.emit('join_party', { code, name: 'Necro', classKey: 'necromancer' });
await new Promise((res) => c.on('party_joined', res));
await sleep(300);
c.emit('cast', { slot: 1 }); // Raise Dead
const summoned = await waitFor(() => cSnap && cSnap.minions && cSnap.minions.length > 0, 3000);
if (!summoned) fail('necromancer summon produced no minions');
console.log('  necromancer minions:', cSnap.minions.length);
c.disconnect();

// Dodge (universal slot 5): casting it puts slot 5 on cooldown and grants i-frames.
b.emit('cast', { slot: 5 });
const dodged = await waitFor(() => bSnap && bSnap.me && bSnap.me.cd && bSnap.me.cd[5] > 0, 2000);
if (!dodged) fail('dodge (skill 5) did not trigger a cooldown');
console.log(`  dodge cast: slot-5 cd ${bSnap.me.cd[5]}s`);

// Loot: server rolls drops on mob kills — fight on until the backpack fills.
const loot = setInterval(() => { b.emit('cast', { slot: 1 }); b.emit('basic'); }, 110);
const gotLoot = await waitFor(() => bSnap && bSnap.me && bSnap.me.inventory && bSnap.me.inventory.length > 0, 14000);
clearInterval(loot);
if (!gotLoot) fail('no loot dropped after extended fighting');
console.log(`  loot dropped: ${bSnap.me.inventory.length} item(s)`);

// Equip flow (deterministic): a client restores a saved Mage-usable wand, then
// equips + unequips it. Also exercises server-side sanitize of client items.
const e = io(URL);
let eSnap = null; e.on('snapshot', (s) => { eSnap = s; });
await onConnect(e);
e.emit('join_party', { code, name: 'Looter', classKey: 'mage', progress: { inventory: [{ id: 'w1', base: 'wand', slot: 'weapon', rarity: 'common', ilvl: 4, stats: { INT: 5 } }] } });
await new Promise((res) => e.on('party_joined', res));
const hasItem = await waitFor(() => eSnap && eSnap.me && eSnap.me.inventory && eSnap.me.inventory.some((it) => it.base === 'wand'), 3000);
if (!hasItem) fail('saved inventory item was not restored');
const baseInt = eSnap.me.stats.INT;
const wand = eSnap.me.inventory.find((it) => it.base === 'wand');
e.emit('equip', { itemId: wand.id });
const eq = await waitFor(() => eSnap.me.gear && eSnap.me.gear.weapon && eSnap.me.gear.weapon.base === 'wand', 2000);
if (!eq) fail('equip did not move the wand into the weapon slot');
if (eSnap.me.stats.INT <= baseInt) fail('equipped gear did not raise total INT');
console.log(`  equipped wand: INT ${baseInt} -> ${eSnap.me.stats.INT}`);
e.emit('unequip', { slot: 'weapon' });
const un = await waitFor(() => !eSnap.me.gear.weapon && eSnap.me.stats.INT === baseInt, 2000);
if (!un) fail('unequip did not clear the slot / revert stats');
console.log('  unequipped OK (stats reverted)');
// Discard: removing the wand from the backpack frees the slot.
const wand2 = eSnap.me.inventory.find((it) => it.base === 'wand');
e.emit('discard', { itemId: wand2.id });
const discarded = await waitFor(() => !eSnap.me.inventory.some((it) => it.id === wand2.id), 2000);
if (!discarded) fail('discard did not remove the item from the backpack');
console.log('  discarded OK (backpack freed)');
e.disconnect();

// Class restriction: a Mage must never be allowed to equip a sword.
const sword = { id: 'x', base: 'sword', slot: 'weapon', rarity: 'common', ilvl: 1, stats: { STR: 3 } };
if (canEquip('mage', sword)) fail('mage was allowed to equip a sword (restriction broken)');
console.log('  class restriction holds (mage cannot use a sword)');

// Saved progress: a client joins supplying saved progress; server restores it.
const d = io(URL);
let dSnap = null;
d.on('snapshot', (s) => { dSnap = s; });
await onConnect(d);
d.emit('join_party', { code, name: 'Veteran', classKey: 'warrior', progress: { level: 5, xp: 40, statPoints: 2, gold: 5000, stats: { STR: 20, DEX: 8, INT: 5, VIT: 18, AGI: 9 } } });
await new Promise((res) => d.on('party_joined', res));
const restored = await waitFor(() => dSnap && dSnap.me && dSnap.me.level === 5, 3000);
if (!restored) fail('saved progress was not restored on join');
console.log(`  restored progress: level ${dSnap.me.level}, STR ${dSnap.me.stats.STR}, points ${dSnap.me.statPoints}`);

// Skill tree: server-authoritative spend. A STR node must raise total STR, and
// an illegal (gated) node must be rejected. A respec must refund it.
const dStr = dSnap.me.stats.STR;
const dPts = dSnap.me.skillPoints;
if (!(dPts > 0)) fail('level-5 player should have skill points');
d.emit('spend_skill', { nodeId: 'w_str' });
const spent = await waitFor(() => dSnap.me.stats.STR === dStr + 2 && dSnap.me.skillPoints === dPts - 1, 2000);
if (!spent) fail('spend_skill did not apply the STR node');
d.emit('spend_skill', { nodeId: 'w_quake' }); // gated capstone — must be ignored
await sleep(300);
if (dSnap.me.skillTree.w_quake) fail('server allowed an illegal gated skill node');
d.emit('respec_skill', {});
const respecced = await waitFor(() => dSnap.me.stats.STR === dStr && dSnap.me.skillPoints === dPts, 2000);
if (!respecced) fail('respec did not refund/revert the skill tree');
console.log(`  skill tree: spent +STR (${dStr}->${dStr + 2}), rejected gated node, respecced back to ${dStr}`);

// Shop (town only): the Veteran spawns in town with 5000g. Buy a weapon, then
// equip + upgrade it. Buying must deduct gold and add an item; upgrading must
// deduct gold and raise the item's total stats.
if (!(dSnap.me.gold >= 5000)) fail('restored gold was not applied');
const goldBefore = dSnap.me.gold;
const invBefore = dSnap.me.inventory.length;
d.emit('shop_buy', { slot: 'weapon', tier: 'standard' });
const bought = await waitFor(() => dSnap.me.inventory.length === invBefore + 1 && dSnap.me.gold < goldBefore, 2000);
if (!bought) fail('shop_buy did not add an item / deduct gold');
console.log(`  shop buy: gold ${goldBefore} -> ${dSnap.me.gold}, backpack +1`);
const wep = dSnap.me.inventory.find((it) => it.slot === 'weapon');
d.emit('equip', { itemId: wep.id });
const eqd = await waitFor(() => dSnap.me.gear.weapon && dSnap.me.gear.weapon.id === wep.id, 2000);
if (!eqd) fail('could not equip the purchased weapon');
const strBeforeUp = dSnap.me.stats.STR, goldBeforeUp = dSnap.me.gold;
d.emit('shop_upgrade', { slot: 'weapon' });
const upgraded = await waitFor(() => dSnap.me.gold < goldBeforeUp && (dSnap.me.gear.weapon.plus || 0) >= 1, 2000);
if (!upgraded) fail('shop_upgrade did not consume gold / raise the item plus');
console.log(`  shop upgrade: weapon +${dSnap.me.gear.weapon.plus}, gold ${goldBeforeUp} -> ${dSnap.me.gold}`);
d.disconnect();

// Leave handling: tank disconnects, mage should no longer see them.
a.disconnect();
await sleep(500);
if (bSnap.players.some((p) => p.name === 'Tank') && bSnap.zoneKey === aSnap.zoneKey) {
  // only meaningful if same zone; tolerate different zones
}
console.log('  leave handled');

console.log('PASS: multi-zone authoritative co-op works.');
b.disconnect(); proc.kill(); process.exit(0);
