// Thin wrapper around the socket.io client (loaded globally from the CDN in
// index.html). Handles the lobby handshake and exposes the live snapshot stream
// to the OnlineScene. Single-player never touches this file.

export default class NetClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.code = null;
    this.youId = null;
    this.zoneName = '';
    this.roster = [];
    this.snapshot = null;
    this.handlers = {}; // event -> fn
  }

  // url: optional explicit server (defaults to same origin, i.e. the node server).
  connect(url) {
    if (typeof io === 'undefined') {
      this._emit('error', { message: 'Networking library failed to load.' });
      return;
    }
    // ?server=... or localStorage override lets you point at a remote host.
    const override = new URLSearchParams(location.search).get('server') || localStorage.getItem('mng_server');
    this.socket = url || override ? io(url || override) : io();

    this.socket.on('connect', () => { this.connected = true; this._emit('connect'); });
    this.socket.on('connect_error', () => this._emit('error', { message: 'Could not reach the server.' }));
    this.socket.on('disconnect', () => { this.connected = false; this._emit('disconnect'); });

    this.socket.on('party_joined', (d) => {
      this.code = d.code; this.youId = d.youId; this.zoneName = d.zoneName; this.roster = d.roster;
      this._emit('party_joined', d);
    });
    this.socket.on('join_error', (d) => this._emit('join_error', d));
    this.socket.on('roster', (r) => { this.roster = r; this._emit('roster', r); });
    this.socket.on('snapshot', (s) => { this.snapshot = s; });
  }

  on(event, fn) { this.handlers[event] = fn; }
  _emit(event, data) { if (this.handlers[event]) this.handlers[event](data); }

  createParty(name, classKey) { this.socket.emit('create_party', { name, classKey }); }
  joinParty(code, name, classKey) { this.socket.emit('join_party', { code, name, classKey }); }

  sendInput(mx, my, facing) { if (this.socket) this.socket.emit('input', { mx, my, facing }); }
  sendBasic() { if (this.socket) this.socket.emit('basic'); }
  sendCast(slot) { if (this.socket) this.socket.emit('cast', { slot }); }

  leave() { if (this.socket) this.socket.emit('leave_party'); }
}
