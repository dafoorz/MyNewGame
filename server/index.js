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
app.use(express.static(ROOT));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  let currentCode = null;

  const joinRoom = (room, name, classKey) => {
    currentCode = room.code;
    socket.join(room.code);
    const you = room.addPlayer(socket.id, name, classKey);
    socket.emit('party_joined', { code: room.code, youId: socket.id, zoneName: room.zoneName, roster: room.roster() });
    io.to(room.code).emit('roster', room.roster());
    return you;
  };

  socket.on('create_party', ({ name, classKey } = {}) => {
    const room = rooms.create();
    joinRoom(room, name, classKey);
  });

  socket.on('join_party', ({ code, name, classKey } = {}) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('join_error', { message: 'No party with that code.' }); return; }
    joinRoom(room, name, classKey);
  });

  socket.on('input', ({ mx, my, facing } = {}) => {
    const room = rooms.get(currentCode);
    if (room) room.setInput(socket.id, mx || 0, my || 0, facing);
  });

  socket.on('basic', () => {
    const room = rooms.get(currentCode);
    if (room) room.doBasic(socket.id);
  });

  socket.on('cast', ({ slot } = {}) => {
    const room = rooms.get(currentCode);
    if (room && slot >= 1 && slot <= 4) room.doCast(socket.id, slot);
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
