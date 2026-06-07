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
  - **Online** = `OnlineScene.js` — a thin renderer for ALL zones. Server is
    authoritative; client sends input, renders per-zone snapshots, does light
    movement prediction.
- **Server** (`server/`): authoritative across the whole world. `RoomManager`
  maps 4-char invite codes to `Room`s. Each `Room` runs a 30Hz tick and
  simulates every zone that has players (`sim/Zone.js`: mobs, boss, projectiles,
  aggro, DoTs, shared-XP kills, respawns). Players roam zones independently and
  only see party members in the same zone. `sim/` is headless (no Phaser).
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

- **Isometric rendering is client-only (`src/iso.js` + `src/sprites.js`).** The
  whole simulation stays in flat world (x, y) space — server authoritative, all
  logic/multiplayer unchanged. Only the FLOOR + ground decals (zone grid,
  portals, boss telegraphs, AoE FX) live in the transformed `this.world`
  container so they distort into the iso diamond. Characters/mobs/boss/minions
  and projectiles are UPRIGHT billboards drawn in scene space at `project(x,y)`
  (placeholder vector art in `src/sprites.js`) — never in the container, so they
  don't get squashed. Depth: bodies use `bodyDepth(x,y)` (scene depth band
  10–~53, sorted by ground x+y); labels/bars sit at depth 55; the container
  (floor) renders below all of them. Input is rotated to world via `dirToWorld`;
  the cursor is `unproject`ed for aim/facing; facing markers use `projectDir`.
  **Fall back to top-down anytime with `?iso=0`** (projection becomes identity).
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
- Stage 4: authoritative multiplayer + party (invite codes, per-zone party
  HP bars, shared XP). Online now covers ALL zones — roam, fight mobs, level
  up, spend stat points, and fight the co-op boss, all server-authoritative.
- Boss combat shows a per-player ranked DPS meter (server-computed online,
  visible to all; solo shows You vs Ally).
- Per-device, per-class progress saving via `src/progress.js` (localStorage,
  one slot per class). Solo loads/saves directly; online sends saved progress
  on join (server `applyProgress`) and saves snapshots back. Phaser-free,
  browser-only — not imported by the server.
- In-game Settings (gear button / Esc) via `src/ui/SettingsPanel.js` +
  `src/keybinds.js` (localStorage). Rebindable keys (move/attack/skills/aim/
  char), Main Menu, Reset Keybinds, Fullscreen, and (solo) Reset Class
  Progress. Both scenes read `this.settings.binds` + a `held` Set for input.
- Bosses are data-driven: `src/world/bosses.js` (per-boss stats/attacks/enrage/
  loot) run by one shared, Phaser-free state machine `src/world/BossCore.js`
  (solo `entities/Boss.js` renders it; server `sim/Boss.js` snapshots it). 4
  bosses (Colossus → Bonelord → Embermaw → Sunderer) with cleave/aoe/charge/
  summon/safezone + enrage. Add a boss = a `bosses.js` entry + a zone `boss:`.
- Per-class skill trees: `src/skilltree.js` (Phaser-free; data + buildFromTree/
  effectiveSkill/validation, imported by client AND server) + `src/ui/
  SkillTreePanel.js` (shared UI, 'K' key/button). 1 skill point/level (separate
  from the 3 stat points). Nodes = stat passives, skill upgrades, or capstone
  unlocks. Solo saves the allocation to localStorage; online the server
  validates every spend (`spend_skill`/`respec_skill`) and re-derives saved
  allocations via `sanitizeAllocation` — no client trust. Stats fold the tree's
  stat nodes into `recomputeStats`; casts use the effective skill def.

## Next / TODO ideas

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
