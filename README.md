# MyNewGame

A 2D top-down co-op boss-fight game for the browser, inspired by *Blade & Soul*.
Built with [Phaser 3](https://phaser.io/) (HTML5 Canvas + JavaScript).

> **Status: Stage 3 — classes.** Pick one of six classes at character creation
> (Warrior / Mage / Rogue / Archer / Healer / Necromancer), each with its own
> stat spread and four data-driven skills. Roam connected zones (Town → Forest
> → Caves → Boss Lair), kill scaling mobs for XP, level up and spend stat points.
> The Stage 1 telegraphed boss + AI Mage ally live in the Boss Lair zone.
> Press **C** (or the C button) for the character/stat panel.
> Add classes/skills in `src/classes/classes.js`, zones in `src/world/zones.js`.

---

## How to play

| Input            | Action                                  |
| ---------------- | --------------------------------------- |
| **W A S D**      | Move                                    |
| **Mouse**        | Aim / face direction                    |
| **Left click**   | Basic melee attack                      |
| **1**            | Heavy Strike — big hit + threat         |
| **2**            | Taunt — force the boss to target you    |
| **3**            | Shield Wall — reduce damage for 4s      |
| **4**            | Whirlwind — AoE if the boss is close    |
| **R**            | Restart (after victory/defeat)          |

### The fight (mechanics)

- **Aggro / threat:** the boss attacks whoever has the most threat. As the Tank
  you generate ~4× threat, so you naturally hold the boss — top it up with
  **Taunt** if the Mage starts pulling aggro.
- **Frontal Cleave (red cone):** swings in front of the boss. The boss always
  faces its target (you), so **keep the boss's back turned toward the Mage** to
  keep her safe.
- **Ground AoE (red circle):** drops on a player's position. **Walk out of the
  circle** before it detonates. The Mage dodges these on her own.

Beat the boss before it wipes the party.

---

## Run it locally

```bash
npm install      # one-time: installs express + socket.io for online mode
npm start        # runs the server AND serves the client
# then open http://localhost:8080
```

`npm start` launches the Node server (`server/index.js`), which both serves the
static client **and** hosts the real-time multiplayer. Phaser and Socket.io are
loaded from CDNs, so there's still **no build step**.

Solo play needs no server at all — any static host works (`npm run static`,
`python3 -m http.server 8080`, VS Code Live Server, or GitHub Pages).

Smoke-test the server (boots it, connects two clients, fights the boss):

```bash
npm test
```

---

## Multiplayer (online co-op)

- Pick a class, then on the mode screen choose **Create Party** (you get a
  4-letter code) or **Join Party** (enter a friend's code).
- Party members drop into the **Boss Lair** together and fight the Colossus in
  real time. The **server is authoritative** for all combat — movement, damage,
  aggro, and telegraphs are decided server-side, so state stays in sync and
  clients can't fake damage. The client runs light prediction so your own
  movement still feels instant.
- **Solo still works fully offline** (all zones, mobs, leveling, classes) on a
  completely separate code path.

### Play with friends over the internet (deploy to Render)

The Node server serves the client **and** the multiplayer on one port, so a
single deploy gives you one URL everyone opens — no GitHub Pages needed.

This repo includes a `render.yaml` blueprint, so setup is near one-click:

1. Push to GitHub (already connected).
2. Go to [render.com](https://render.com) → **New +** → **Blueprint** → pick
   `dafoorz/mynewgame`. Render reads `render.yaml` (build `npm install`, start
   `npm start`, free plan, health check `/health`).
3. Click **Apply**. You get a URL like `https://mynewgame.onrender.com`.
4. Share it. Everyone picks a class → **Create/Join Party**.

> Render's **free** tier sleeps after ~15 min idle, so the first visit after a
> break takes ~30s to wake — normal, just wait. Upgrade the plan to keep it warm.

**Quick one-off session (no deploy):** run `npm start` locally and expose it with
a tunnel — `npx cloudflared tunnel --url http://localhost:8080` prints a public
URL. Your PC must stay on and the URL changes each run.

**Any other Node host** (Railway, Fly.io, a VPS) works too — it just needs
`npm install` + `npm start`; the server reads `PORT` from the environment. If
you host the client separately from the server, point it at the server with
`?server=https://your-host` on the page URL (or `localStorage.mng_server`).

---

## Project structure

```
MyNewGame/
├── index.html              # entry: loads Phaser + Socket.io (CDN) + the game
├── package.json
├── server/                 # authoritative Node.js + Socket.io backend
│   ├── index.js            # express static host + socket.io wiring
│   ├── RoomManager.js      # parties by invite code -> one Room each
│   ├── Room.js             # per-party world: 30Hz tick, broadcasts snapshots
│   ├── smoke-test.mjs      # headless 2-client integration test (npm test)
│   └── sim/                # headless (no-Phaser) authoritative simulation
│       ├── Boss.js         # boss state machine (cleave + ground AoE)
│       ├── ServerPlayer.js # player state, movement, damage rolls
│       ├── AggroTable.js   # threat -> boss target
│       ├── skills.js       # server-side skill engine (mirrors the client)
│       └── mathutil.js
└── src/                    # client (Phaser). Shared data is imported by server.
    ├── main.js             # Phaser config + boot
    ├── config.js           # tuning: arena, colors, threat values, stat presets
    ├── stats.js            # STR/DEX/INT/VIT/AGI -> derived combat stats  (shared)
    ├── classes/classes.js  # 6 classes + data-driven skills              (shared)
    ├── world/zones.js      # zones + mob archetypes                       (shared)
    ├── net/NetClient.js    # socket.io client wrapper (online mode only)
    ├── entities/           # Player, Boss, Ally, Mob, Minion (solo sim)
    ├── systems/            # AggroTable, Progression (solo sim)
    ├── ui/HealthBar.js
    └── scenes/
        ├── ClassSelectScene.js
        ├── LobbyScene.js   # solo vs online; create/join party
        ├── GameScene.js    # solo: zones, mobs, leveling, boss
        └── OnlineScene.js  # online: renders authoritative server snapshots
```

The four **shared** data modules (`config`, `stats`, `classes`, `zones`) are
plain data/math with no Phaser dependency, so the headless server imports them
directly — one source of truth for both sides.

---

## Roadmap

- **Stage 1 (done):** single-player Tank + AI Mage vs. one boss with two
  telegraphed mechanics and an aggro system.
- **Stage 2 (done):** zone-based open world, mobs, XP/leveling, stat points.
- **Stage 3 (done):** six-class system with data-driven skills.
- **Stage 4 (in progress):** real-time multiplayer parties over
  **Node.js + Socket.io** — authoritative server, invite codes, co-op boss.
  Next: extend the authoritative model to all zones + mobs, party loot, and
  client-side hosting on the cloud.

## Tuning

Most balance knobs live in `src/config.js` (threat multipliers, stat presets,
arena size) and in `src/world/bosses.js` (per-boss HP, attacks, enrage, loot).
Bosses are data-driven: the shared `src/world/BossCore.js` state machine runs
every boss for both solo and online, so adding a boss = a new entry in
`bosses.js` + a zone in `src/world/zones.js` that points its `boss:` at it.
Tweak and reload.
