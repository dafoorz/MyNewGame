import Room from './Room.js';

// Tracks parties by invite code. Each party gets exactly one Room. Codes are
// short and human-shareable. Scales fine to many concurrent parties; swap the
// in-memory Map for Redis later if you go multi-process.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars

export default class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> Room
  }

  newCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    } while (this.rooms.has(code));
    return code;
  }

  create() {
    const code = this.newCode();
    const room = new Room(this.io, code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  dispose(code) {
    const room = this.rooms.get(code);
    if (room && room.empty) { room.stop(); this.rooms.delete(code); }
  }
}
