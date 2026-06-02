# MyNewGame

A 2D top-down co-op boss-fight game for the browser, inspired by *Blade & Soul*.
Built with [Phaser 3](https://phaser.io/) (HTML5 Canvas + JavaScript).

> **Status: Stage 2 — open world.** Roam connected zones (Town → Forest →
> Caves → Boss Lair), kill scaling mobs for XP, level up and spend stat points.
> The Stage 1 telegraphed boss + AI Mage ally now live in the Boss Lair zone.
> Press **C** (or the C button) to open the character/stat panel.
> Add zones & mob types in `src/world/zones.js`.

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

You need a tiny static web server (ES modules don't load from `file://`).
Pick whichever you have:

```bash
# Option A — npm (uses `serve`)
npm start
# then open http://localhost:8080

# Option B — Python 3
python3 -m http.server 8080
# then open http://localhost:8080

# Option C — VS Code
# Use the "Live Server" extension and open index.html
```

Phaser itself is loaded from a CDN, so there's **no build step**.

---

## Project structure

```
MyNewGame/
├── index.html              # entry: loads Phaser (CDN) + the game
├── package.json
├── README.md
└── src/
    ├── main.js             # Phaser config + boot
    ├── config.js           # tuning: arena, colors, threat values, stat presets
    ├── stats.js            # STR/DEX/INT/VIT/AGI -> derived combat stats
    ├── entities/
    │   ├── Player.js       # the Tank (movement, attacks, skills, HP)
    │   ├── Boss.js         # state machine + telegraphed cleave & ground AoE
    │   └── Ally.js         # AI Mage (ranged, stays behind boss, dodges)
    ├── systems/
    │   └── AggroTable.js   # threat tracking -> boss target selection
    ├── ui/
    │   └── HealthBar.js
    └── scenes/
        └── GameScene.js    # coordinator: input, combat, skills, HUD
```

---

## Roadmap

- **Stage 1 (done):** single-player Tank + AI Mage vs. one boss with two
  telegraphed mechanics and an aggro system.
- **Stage 2:** classes (Warrior, Mage, Rogue, Archer, Healer, Necromancer),
  skill trees, and loot.
- **Stage 3:** real multiplayer parties over **Node.js + Socket.io** — invite
  friends and fight together.

## Tuning

Most balance knobs live in `src/config.js` (threat multipliers, stat presets,
arena size) and at the top of `src/entities/Boss.js` (`ATTACKS` damage/timings,
boss HP). Tweak and reload.
