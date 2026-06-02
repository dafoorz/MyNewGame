// Headless smoke test: boot the server, connect two socket clients, create +
// join a party, drive input, cast skills, and confirm authoritative snapshots
// (players move, boss takes damage). Run: node server/smoke-test.mjs
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '8099' }, stdio: 'inherit' });
await sleep(800);

const URL = 'http://localhost:8099';
let fail = (m) => { console.error('FAIL:', m); proc.kill(); process.exit(1); };

const a = io(URL), b = io(URL);
let code = null, aSnap = null, bSnap = null, bossStart = null;

a.on('snapshot', (s) => { aSnap = s; if (bossStart == null) bossStart = s.boss.hp; });
b.on('snapshot', (s) => { bSnap = s; });

const onConnect = (sock) => new Promise((res) => { if (sock.connected) res(); else sock.on('connect', res); });

await onConnect(a);
a.emit('create_party', { name: 'Tank', classKey: 'warrior' });
code = await new Promise((res) => a.on('party_joined', (d) => res(d.code)));
console.log('  party code:', code);

await onConnect(b);
b.emit('join_party', { code, name: 'Mage', classKey: 'mage' });
await new Promise((res) => b.on('party_joined', res));

await sleep(400);
if (!aSnap || aSnap.players.length !== 2) fail('expected 2 players in snapshot');
console.log('  players synced:', aSnap.players.map((p) => p.name).join(', '));

// Drive tank toward the boss and attack; mage fires bolts.
const moveAndFight = setInterval(() => {
  a.emit('input', { mx: 1, my: 0, facing: 0 });
  a.emit('basic');
  a.emit('cast', { slot: 1 });
  b.emit('input', { mx: 0, my: 0, facing: 0 });
  b.emit('cast', { slot: 1 });
}, 100);

await sleep(2500);
clearInterval(moveAndFight);

const tank = aSnap.players.find((p) => p.name === 'Tank');
if (!(tank.x > 200)) fail('tank did not move (x=' + tank.x + ')');
console.log('  tank moved to x=' + tank.x);
if (!(aSnap.boss.hp < bossStart)) fail('boss took no damage');
console.log(`  boss hp ${bossStart} -> ${aSnap.boss.hp} (took damage)`);

// Leave/disconnect handling.
b.disconnect();
await sleep(400);
if (aSnap.players.length !== 1) fail('roster did not shrink after leave');
console.log('  player leave handled, roster=' + aSnap.players.length);

console.log('PASS: server authoritative co-op loop works.');
a.disconnect();
proc.kill();
process.exit(0);
