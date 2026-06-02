# MyNewGame — Project Guide for Claude Code

A 2D top-down co-op boss-fight browser game (Blade & Soul inspired), built with
**Phaser 3** (loaded from CDN — **no build step**). Solo play is fully offline;
online co-op runs on an authoritative **Node.js + Socket.io** server.

## How to run

```bash
npm install     # one-time (express, socket.io)
npm start       # runs server + serves client -> http://localhost:8080
npm test        # headless 2-client server smoke test
npm run static  # client only, no server (solo offline dev)
```

Pick a class → **Solo** (offline) or **Create/Join Party** (online). Open a
second tab/phone and Join with the 4-letter code to test co-op.

## Architecture

- **Client** (`src/`): Phaser. Two play paths that DO NOT share combat code:
  - **Solo** = `GameScene.js` — runs the whole simulation locally (zones, mobs,
    leveling, classes, boss + AI ally). Works offline / on GitHub Pages.
  - **Online** = `OnlineScene.js` — a thin renderer. Server is authoritative;
    client sends input, renders snapshots, does light movement prediction.
- **Server** (`server/`): authoritative. `RoomManager` maps 4-char invite codes
  to `Room`s. Each `Room` runs a 30Hz tick (boss AI, mobs/projectiles, aggro,
  damage, skills) and broadcasts compact snapshots. `sim/` is headless (no
  Phaser).
- **Shared data** (`src/config.js`, `src/stats.js`, `src/classes/classes.js`,
  `src/world/zones.js`): plain data/math, imported by BOTH client and server —
  one source of truth for balance. Keep these Phaser-free.

## File map

```
index.html                 loads Phaser + Socket.io (CDN), then src/main.js?v=N
render.yaml                 one-click Render deploy blueprint
package.json               start = node server/index.js
server/
  index.js                 express static host + socket.io events
  RoomManager.js           parties by invite code
  Room.js                  per-party world: 30Hz tick + snapshot broadcast
  smoke-test.mjs           npm test
  sim/ Boss, ServerPlayer, AggroTable, skills, mathutil   (headless)
src/
  main.js                  Phaser config (scenes + dom container)
  config.js stats.js       (shared) tuning + derived stats
  classes/classes.js       (shared) 6 classes, data-driven skills
  world/zones.js           (shared) zones + mob archetypes
  net/NetClient.js         socket.io client wrapper (online only)
  entities/ Player Boss Ally Mob Minion     (solo sim)
  systems/ AggroTable Progression           (solo sim)
  ui/HealthBar.js
  scenes/ ClassSelectScene LobbyScene GameScene OnlineScene
```

## Conventions / gotchas

- **No build step.** Plain ES modules in the browser. Don't add bundlers.
- **Cache-busting:** the script tag in `index.html` is `src/main.js?v=N`. Bump
  `N` whenever client JS changes, or mobile browsers serve stale code.
- **Mobile:** `touch-action: none` CSS is required so the canvas gets touch
  events. There's a virtual joystick (left half), ATK button, and an AIM toggle
  (manual aim vs auto-face-nearest-enemy).
- **Keep solo and online separate.** Don't make `OnlineScene` depend on
  `GameScene`'s local simulation, and vice-versa.
- **Server must stay headless** — anything in `server/sim/` must not import
  Phaser. Use `server/sim/mathutil.js` for clamp/dist/wrapAngle.
- **Shared modules stay Phaser-free** so the server can import them.

## Current state (Stage 4)

- Stage 1–3 done: telegraphed boss + AI ally; zones/mobs/XP/leveling/stat
  points; 6 classes with data-driven skills; Necromancer minions have HP, are
  killable, and draw enemy aggro.
- Stage 4 in progress: authoritative multiplayer + party (invite codes, party
  HP bars, shared XP). Online drops the party into the **Boss Lair** only.

## Next / TODO ideas

- Extend the authoritative server model to ALL zones + mobs + leveling (online
  currently = boss lair only). The `Room` is generic enough to grow.
- Party loot / shared drops.
- "Leave party" button + return-to-lobby flow in `OnlineScene`.
- Reconnect handling; spectate for downed players.

## Deploy (play with friends online)

Server serves client + multiplayer on one port → one shareable URL.
- **Render (recommended):** render.com → New + → Blueprint → pick the repo →
  Apply (uses `render.yaml`). Free tier sleeps after ~15 min idle (~30s wake).
- **Quick tunnel:** `npm start` then `npx cloudflared tunnel --url http://localhost:8080`.
- Client hosted separately from server? point it with `?server=https://host`.
- GitHub Pages can host the client (solo) but NOT the server.

## Communication preference

The repo owner prefers **short answers** — state only the changes made or
actions needed, no long explanations.
