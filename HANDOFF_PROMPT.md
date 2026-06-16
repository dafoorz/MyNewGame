# MyNewGame — AI Handoff Prompt

You are continuing development of **MyNewGame**, a 2D isometric co-op boss-fight browser game (Blade & Soul inspired) built with **Phaser 3** (CDN, no build step). Solo play is fully offline; online co-op uses an authoritative Node.js + Socket.io server.

## Quick Start

```bash
npm install     # one-time
npm start       # server + client → http://localhost:8080
npm test        # headless 2-client smoke test (must pass before pushing)
npm run static  # client only, offline dev
```

Pick a class → **Solo** (offline) or **Create/Join Party** (online). Open a second tab to test co-op.

---

## Repo

- GitHub: `https://github.com/dafoorz/mynewgame`
- Active branch: `claude/mynewgame-github-setup-pM4Rq` (all current work lives here)
- `main` is deployed on Render (free tier, sleeps after 15 min idle)
- To deploy: merge dev branch → main → Render auto-redeploys

---

## Architecture (CRITICAL — read before touching anything)

### Two completely separate play paths — DO NOT mix them:

| | Solo | Online |
|---|---|---|
| Scene | `src/scenes/GameScene.js` | `src/scenes/OnlineScene.js` |
| Simulation | Runs entirely in the browser | Server-authoritative (`server/`) |
| Works offline? | Yes | No |

### Shared modules (Phaser-free — imported by BOTH client and server):
- `src/config.js` — canvas size, colors, threat multipliers
- `src/stats.js` — STR/DEX/INT/VIT/AGI → derived stats (moveSpeed, HP, damage, etc.)
- `src/classes/classes.js` — 6 classes, data-driven skills
- `src/world/zones.js` — all zones, mob types, portals, waystones
- `src/world/bosses.js` — 4 boss definitions
- `src/world/BossCore.js` — shared boss state machine
- `src/items.js` — loot, gold formulas, upgrade system
- `src/shop.js` — shop tiers, buy/upgrade costs
- `src/skilltree.js` — per-class skill trees

**Rule:** Never import Phaser in any of these files. Never import them in `server/sim/`.

### Server (`server/`):
- `server/index.js` — Express static host + Socket.io events
- `server/RoomManager.js` — parties by 4-char invite code
- `server/Room.js` — per-party world: 30Hz tick, zone management, shop/travel logic
- `server/sim/Zone.js` — authoritative zone: mobs, boss, projectiles, aggro, DoTs, XP/gold
- `server/sim/ServerPlayer.js` — player state, combat timer, gold, waypoints
- `server/sim/Boss.js` — server-side boss wrapper (uses BossCore)
- `server/sim/Mob.js`, `AggroTable.js`, `skills.js`, `mathutil.js` — headless sim utilities

### Client (`src/`):
- `src/iso.js` — isometric projection (rotate 45° + squash Y 0.5×). Fall back with `?iso=0`
- `src/sprites.js` — placeholder vector art drawers (drawHumanoid, drawBoss, etc.)
- `src/entities/` — solo sim: Player, Boss, Mob, Ally, Minion
- `src/systems/` — solo sim: AggroTable, Progression
- `src/ui/` — all UI panels: HealthBar, InventoryPanel, MapPanel, MiniMap, SettingsPanel, ShopPanel, SkillTreePanel
- `src/scenes/` — ClassSelectScene, LobbyScene, GameScene, OnlineScene

---

## Key Systems

### Isometric Rendering
- The `world` Container gets `applyIso()` (rotate -45°, scale Y by 0.5) — floor/zone graphics inside it become iso diamonds automatically
- Characters/mobs/boss are **NOT** in the container — they're upright billboards drawn in scene space at `project(x, y)` each frame
- `project(x,y)` → screen position; `unproject(px,py)` → world position; `dirToWorld(ix,iy)` → uniform-speed world movement vector
- `isoSpeedScale(dx,dy)` — compensates mob movement so monsters move at equal screen speed in all directions
- Depth sorting: `bodyDepth(x,y)` for entities (band 10–53), depth 55 for labels/bars, world container at 0

### Zones & World Map
- 9 zones: town (safe hub) + 4 open-world zones + 4 dungeons/raid
- Zone sizes are large (7600×4900 etc.) — camera scrolls within them
- Random dungeon portals: seeded PRNG (hashStr + mulberry32), same seed = same positions on client AND server
- Waystones: discover on foot → can fast-travel via [M] world map
- Travel blocked: inside dungeons OR in combat (5-second combat timer)
- Travel heals player to full HP

### Combat Timer
- `combatTimer` > 0 means in combat; decays each frame; reset on hit/attack
- Solo: `Player.enterCombat()`, `Player.inCombat` getter
- Online: `ServerPlayer.enterCombat()`, `ServerPlayer.inCombat` getter

### Gold & Shop
- Mobs drop gold (`mobGold(level)` from `items.js`)
- Boss drops gold (`bossGold(xp)`)
- Town has a shop (B key or walk to market stall): 3 tiers of gear per slot
- Upgrade system: spend gold to improve equipped items (+stats, `plus` counter)
- Solo: `GameScene.buyGear()`, `GameScene.upgradeGear()`
- Online: `server/Room.js` `buyItem()`, `upgradeGear()`

### Progression
- XP curve: `Math.floor(100 * Math.pow(1.35, level - 1))` (gets steep fast)
- Level up → 3 stat points (spend in C panel) + 1 skill point (spend in K panel)
- Solo: `src/systems/Progression.js`; Online: `ServerPlayer.xpToNext()`

### Skill Trees
- `src/skilltree.js` — data + `buildFromTree()` / `effectiveSkills()` / validation
- Per-class nodes: stat passives, skill upgrades, capstone unlocks
- Solo saves to localStorage; online server validates every spend

### Loot / Inventory
- `src/items.js` — `rollDrop()`, `rollItem()`, `sanitizeItem()`, `rarityColor()`
- Equipment slots: weapon, head, chest, legs, boots, ring, amulet
- Class restrictions enforced on equip (e.g. mages can't use swords)
- Save/load via `src/progress.js` (localStorage, one slot per class)

### Multiplayer (Online)
- Client sends: `input`, `basic`, `cast`, `spend_stat`, `equip`, `unequip`, `discard`, `map_travel`, `spend_skill`, `respec_skill`, `shop_buy`, `shop_upgrade`
- Server broadcasts: 30Hz snapshots per zone (players, mobs, boss, projectiles, fx, me-state)
- Each player sees only party members in their current zone
- Server anti-cheat: `|input| > 1` is clamped in `ServerPlayer.setInput()`

---

## File Map

```
index.html                 CDN loads: Phaser 3.80.1 + Socket.io 4.7.5 → src/main.js?v=45
render.yaml                Render deploy config
package.json               start = node server/index.js
server/
  index.js                 Express static (no-cache for .js/.html) + socket.io
  RoomManager.js
  Room.js                  mapTravel, buyItem, upgradeGear, spendStat, etc.
  smoke-test.mjs           npm test — must pass
  sim/
    Zone.js                mobs, boss, projectiles, XP/gold awards
    ServerPlayer.js        gold, combatTimer, waypoints, skillTree
    Boss.js                server boss wrapper
    Mob.js, AggroTable.js, skills.js, mathutil.js
src/
  main.js                  Phaser config (FIT scale, 1024×700)
  config.js                width=1024, height=700
  stats.js                 moveSpeed = (170+AGI*5)*1.3 (1.3× for iso compensation)
  iso.js                   project, unproject, dirToWorld, isoSpeedScale, zoneBounds
  sprites.js               drawHumanoid, drawBoss, drawCreature, drawMinion
  classes/classes.js       6 classes + universal Dodge(E) + Block(R)
  world/zones.js           ZONES, MOB_TYPES, zonePortals, zoneWaystones, findWaystone
  world/bosses.js          4 bosses: colossus, bonelord, embermaw, sunderer
  world/BossCore.js        shared boss state machine
  items.js                 rollDrop, rollItem, mobGold, bossGold, upgradeItem, UPGRADE_STEP=2
  shop.js                  SHOP_TIERS, buyCost, rollShopItem, upgradeCost, upgradeItem
  skilltree.js             buildFromTree, effectiveSkills, sanitizeAllocation
  keybinds.js              DEFAULT_BINDS (move/attack/skills/aim/char/map/tree/shop)
  progress.js              localStorage save/load per class (gold, gear, waypoints, etc.)
  net/NetClient.js         socket.io client wrapper
  entities/
    Player.js              solo player (moveBy, combatTimer, cooldowns, gear)
    Boss.js                solo boss renderer (wraps BossCore)
    Mob.js                 solo mob (melee/ranged, isoSpeedScale applied)
    Ally.js                AI companion (solo)
    Minion.js              necromancer minions (solo)
  systems/
    AggroTable.js          threat table (solo)
    Progression.js         XP/leveling (solo)
  scenes/
    ClassSelectScene.js
    LobbyScene.js
    GameScene.js           solo simulation (~1500 lines)
    OnlineScene.js         online renderer (~630 lines)
  ui/
    HealthBar.js
    InventoryPanel.js      gear/inventory management
    MapPanel.js            world map (parchment style, clickable waystones)
    MiniMap.js             always-visible minimap (below B button, right side)
    SettingsPanel.js       keybind rebinding, fullscreen, reset
    ShopPanel.js           buy gear + upgrade equipped items
    SkillTreePanel.js      per-class skill trees
```

---

## UI Layout (right side, screen coords)

Buttons at x = `CONFIG.width - 44` = 980:
- y=30: **C** — Character panel (stat points)
- y=80: **AIM** — toggle auto-aim
- y=130: **⚙** — Settings
- y=180: **I** — Inventory
- y=230: **M** — World Map
- y=280: **K** — Skill Tree
- y=330: **B** — Shop (town only)

MiniMap: Container at `(cx=958, cy=428)`, 120×120, depth 130, below B button.
Skill boxes: centered bottom, y = `CONFIG.height - 56` = 644, 60×60 each.
XP bar: very bottom, y = `CONFIG.height - 8` = 692.

---

## Depth Layers

| Depth | Contents |
|---|---|
| 0 | `world` container (iso floor, zone grid, portals, waystones) |
| 10–53 | Entity graphics (bodyDepth — sorted by x+y) |
| 55 | Entity labels, HP bars |
| 60–62 | HUD text, XP bar, skill boxes |
| 70–71 | Touch buttons |
| 130 | MiniMap container, MapPanel, CharPanel, InventoryPanel, etc. |

---

## Conventions & Gotchas

- **No build step.** Plain ES modules. Do NOT add bundlers or TypeScript.
- **Cache-busting:** bump `?v=N` in `index.html` on every client JS change (currently v=45). Server now sends `Cache-Control: no-cache` for all .js/.html.
- **Iso vs top-down:** append `?iso=0` to URL for top-down rendering. All game logic is in flat world (x,y) regardless.
- **Server headless:** `server/sim/` must never import Phaser or client-only modules.
- **Shared modules Phaser-free:** `src/config.js`, `src/stats.js`, `src/classes/classes.js`, `src/world/*.js`, `src/items.js`, `src/shop.js`, `src/skilltree.js` must work in Node.js.
- **Solo/Online strict separation:** GameScene does not talk to the server; OnlineScene does not run its own simulation.
- **Mobile:** `touch-action: none` CSS keeps the canvas from being hijacked. Virtual joystick (left half), ATK button (bottom-right), AIM toggle.
- **moveSpeed 1.3× factor:** `stats.js` moveSpeed has a 1.3× multiplier to compensate for iso directional normalization. Don't remove it.
- **isoSpeedScale:** apply to any entity (Mob, projectile, etc.) that moves in world space so on-screen speed is equal in all directions.

---

## Current State (all working)

- ✅ 6 classes with data-driven skills, universal Dodge + Block
- ✅ Per-class skill trees (solo localStorage + online server-validated)
- ✅ 4 open-world zones + 4 dungeons/raid, all ~10× size
- ✅ Random-but-seeded dungeon portals (client + server agree)
- ✅ Waystones: discover on foot → fast-travel via [M] map
- ✅ Travel rules: blocked in dungeons or in combat; heals to full on travel
- ✅ Gold economy: mobs + bosses drop gold
- ✅ Town shop: buy 3 tiers of gear + upgrade equipped items
- ✅ Gear inventory with class restrictions + save/load
- ✅ 4 data-driven bosses with telegraphs, enrage, summons
- ✅ Parchment world map [M] with clickable waystones
- ✅ DPS meter (online: server-computed, ranked; solo: You vs Ally)
- ✅ Settings panel: rebindable keys, fullscreen, reset progress
- ✅ Authoritative multiplayer: all zones, shared XP/gold, per-zone party HP bars
- ✅ MiniMap (always visible, below B button, Container depth 130)
- ✅ Uniform isometric movement speed (all 8 directions equal on-screen)

---

## TODO / Known Issues

- **MiniMap visibility not confirmed** — user reported unable to see it. The Container approach (depth 130, scrollFactor 0) matches MapPanel etc. which work. Possible browser cache issue (hard refresh with Ctrl+Shift+R after server restart).
- **Merge dev branch to main** — all work is on `claude/mynewgame-github-setup-pM4Rq`. Main is still on v=36 (old). Merge to deploy to live Render instance.
- Party loot / shared drops
- "Leave party" button + return-to-lobby flow in OnlineScene
- Reconnect handling; spectate for downed players

---

## Boss Summary

| Boss | Zone | Pattern |
|---|---|---|
| Colossus | Colossus' Lair | Cleave, stomp AoE, charge |
| Bonelord | Hollow Crypt | Bone nova, skeleton summon, safezone |
| Embermaw | Ember Hollow | Fire breath arc, ember AoE, charge |
| Sunderer | Void Throne + Ancient Bastion (raid) | Void blast, summon adds, enrage |

Raid (Ancient Bastion): wave1 → boss1 → wave2 → boss2 → final boss. States in `GameScene.raidState`.

---

## Zones Summary

| Zone | Size | Mob Level | Mobs |
|---|---|---|---|
| Riverwood (Town) | 1500×1050 | safe | — |
| Whispering Forest | 7600×4900 | 2 | wolf, bandit |
| Colossus' Lair | 1900×1380 | — | dungeon |
| Gloom Caves | 7600×5500 | 6 | skeleton, skeleton_archer |
| Hollow Crypt | 2080×1490 | — | dungeon |
| Ember Wastes | 7900×5400 | 10 | ember_imp, cinder_archer |
| Ember Hollow | 2320×1590 | — | dungeon |
| Void Marches | 8500×5850 | 15 | wraith, void_seer |
| Void Throne | 2420×1660 | — | dungeon |
| Ancient Bastion | 3290×2250 | 16 | raid |

---

## Communication Preference

The repo owner prefers **short answers** — state only what changed, no long explanations.
