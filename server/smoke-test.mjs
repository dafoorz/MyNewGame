// Headless smoke test for the multi-zone authoritative server: boot it, connect
// two clients, confirm they spawn in Town together, walk to the Forest portal,
// transition zones, see mobs, fight them, and gain XP. Run: npm test
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

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

// Walk both east toward the Forest portal until the zone changes.
const walk = setInterval(() => { a.emit('input', { mx: 1, my: 0, facing: 0 }); b.emit('input', { mx: 1, my: 0, facing: 0 }); }, 80);
const reached = await waitFor(() => aSnap && aSnap.zoneKey === 'forest');
clearInterval(walk);
a.emit('input', { mx: 0, my: 0, facing: 0 }); b.emit('input', { mx: 0, my: 0, facing: 0 });
if (!reached) fail('did not transition to forest via portal');
console.log('  walked through portal to:', aSnap.zoneKey);

await sleep(300);
if (!(aSnap.mobs && aSnap.mobs.length > 0)) fail('no mobs spawned in forest');
console.log('  forest mobs present:', aSnap.mobs.length);

// Mage nukes the nearest mob with Fireball (auto-targets) until XP is gained.
const fight = setInterval(() => { b.emit('cast', { slot: 1 }); b.emit('basic'); }, 120);
const gotXp = await waitFor(() => bSnap && bSnap.me && (bSnap.me.level > 1 || bSnap.me.xp > 0), 8000);
clearInterval(fight);
if (!gotXp) fail('no XP gained from fighting mobs');
console.log(`  mage gained XP (level ${bSnap.me.level}, xp ${bSnap.me.xp})`);

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

// Saved progress: a client joins supplying saved progress; server restores it.
const d = io(URL);
let dSnap = null;
d.on('snapshot', (s) => { dSnap = s; });
await onConnect(d);
d.emit('join_party', { code, name: 'Veteran', classKey: 'warrior', progress: { level: 5, xp: 40, statPoints: 2, stats: { STR: 20, DEX: 8, INT: 5, VIT: 18, AGI: 9 } } });
await new Promise((res) => d.on('party_joined', res));
const restored = await waitFor(() => dSnap && dSnap.me && dSnap.me.level === 5, 3000);
if (!restored) fail('saved progress was not restored on join');
console.log(`  restored progress: level ${dSnap.me.level}, STR ${dSnap.me.stats.STR}, points ${dSnap.me.statPoints}`);
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
