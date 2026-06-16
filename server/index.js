import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server } from 'socket.io';
import RoomManager from './RoomManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8080;

const app = express();
// Serve the static client (index.html + src/) so one command runs everything.
// no-cache on source/HTML so the browser always revalidates ES modules — the
// `?v=N` on index.html only busts main.js, not its imported submodules.
app.use(express.static(ROOT, {
  setHeaders: (res, filePath) => {
    if (/\.(js|mjs|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  let currentCode = null;

  const joinRoom = (room, name, classKey, progress) => {
    currentCode = room.code;
    socket.join(room.code);
    const you = room.addPlayer(socket.id, name, classKey, progress);
    socket.emit('party_joined', { code: room.code, youId: socket.id, zoneName: room.zoneName, roster: room.roster(), seed: room.seed });
    io.to(room.code).emit('roster', room.roster());
    return you;
  };

  socket.on('create_party', ({ name, classKey, progress } = {}) => {
    const room = rooms.create();
    joinRoom(room, name, classKey, progress);
  });

  socket.on('join_party', ({ code, name, classKey, progress } = {}) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('join_error', { message: 'No party with that code.' }); return; }
    joinRoom(room, name, classKey, progress);
  });

  socket.on('input', ({ mx, my, facing } = {}) => {
    const room = rooms.get(currentCode);
    if (room) room.setInput(socket.id, mx || 0, my || 0, facing);
  });

  socket.on('basic', () => {
    const room = rooms.get(currentCode);
    if (room) room.doBasic(socket.id);
  });

  socket.on('cast', ({ slot, aimX, aimY } = {}) => {
    const room = rooms.get(currentCode);
    if (room && slot >= 1 && slot <= 6) room.doCast(socket.id, slot, aimX, aimY);
  });

  socket.on('spend_stat', ({ attr } = {}) => {
    const room = rooms.get(currentCode);
    if (room) room.spendStat(socket.id, attr);
  });

  socket.on('equip', ({ itemId } = {}) => {
    const room = rooms.get(currentCode);
    if (room) room.equipItem(socket.id, itemId);
  });

  socket.on('unequip', ({ slot } = {}) => {
    const room = rooms.get(currentCode);
    if (room) room.unequipItem(socket.id, slot);
  });

  socket.on('discard', ({ itemId } = {}) => {
    const room = rooms.get(currentCode);
    if (room) room.discardItem(socket.id, itemId);
  });

  socket.on('map_travel', ({ waystone } = {}) => {
    const room = rooms.get(currentCode);
    if (room && typeof waystone === 'string') room.mapTravel(socket.id, waystone);
  });

  socket.on('spend_skill', ({ nodeId } = {}) => {
    const room = rooms.get(currentCode);
    if (room && typeof nodeId === 'string') room.spendSkill(socket.id, nodeId);
  });

  socket.on('respec_skill', () => {
    const room = rooms.get(currentCode);
    if (room) room.respecSkill(socket.id);
  });

  socket.on('shop_buy', ({ slot, tier } = {}) => {
    const room = rooms.get(currentCode);
    if (room && typeof slot === 'string' && typeof tier === 'string') room.buyItem(socket.id, slot, tier);
  });

  socket.on('shop_upgrade', ({ slot } = {}) => {
    const room = rooms.get(currentCode);
    if (room && typeof slot === 'string') room.upgradeGear(socket.id, slot);
  });

  const leave = () => {
    const room = rooms.get(currentCode);
    if (!room) return;
    room.removePlayer(socket.id);
    io.to(room.code).emit('roster', room.roster());
    rooms.dispose(room.code);
    currentCode = null;
  };

  socket.on('leave_party', leave);
  socket.on('disconnect', leave);
});

server.listen(PORT, () => {
  console.log(`MyNewGame server + client on http://localhost:${PORT}`);
});
