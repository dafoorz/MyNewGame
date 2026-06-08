import { CONFIG } from '../config.js';
import { ZONES } from '../world/zones.js';

// Fixed screen positions for each zone node in the map panel.
// Absolute canvas coordinates (scroll-independent).
const _PX = CONFIG.width / 2 - 400;  // panel left edge
const _PY = CONFIG.height / 2 - 210; // panel top edge

const NODE_POS = {
  town:            { x: _PX +  80, y: _PY + 120 },
  forest:          { x: _PX + 225, y: _PY + 120 },
  caves:           { x: _PX + 370, y: _PY + 120 },
  lair:            { x: _PX + 300, y: _PY + 235 },
  crypt:           { x: _PX + 400, y: _PY + 300 },
  ember:           { x: _PX + 500, y: _PY + 235 },
  voidthrone:      { x: _PX + 600, y: _PY + 300 },
  ancient_bastion: { x: _PX + 700, y: _PY + 210 },
};

const CONNECTIONS = [
  ['town', 'forest'], ['forest', 'caves'],
  ['caves', 'lair'],
  ['lair', 'crypt'], ['crypt', 'ember'], ['ember', 'voidthrone'],
  ['voidthrone', 'ancient_bastion'],
];

// Map panel — shows all zones as nodes. Open-world zones (no dungeon/raid flag)
// can be clicked to fast-travel. Dungeon/raid zones are shown but locked.
export default class MapPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.onTravel = opts.onTravel || null;
    this.getZoneKey = opts.getZoneKey || (() => 'town');
    this.open = false;
    this._build();
  }

  _build() {
    const s = this.scene;
    const W = CONFIG.width, H = CONFIG.height;
    const panW = 800, panH = 420;
    const panX = W / 2 - panW / 2, panY = H / 2 - panH / 2;

    this.container = s.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);

    // Dark background
    this.container.add(s.add.rectangle(W / 2, H / 2, panW, panH, 0x07091a, 0.97)
      .setStrokeStyle(2, 0x334477).setScrollFactor(0));

    // Title
    this.container.add(s.add.text(W / 2, panY + 18, 'WORLD MAP   [M to close]', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5, 0).setScrollFactor(0));

    // Legend
    this.container.add(s.add.text(panX + 14, panY + panH - 14, '● Open world (click to travel)   ⬡ Dungeon / Raid (enter via portal)', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '10px', color: '#6688aa',
    }).setOrigin(0, 1).setScrollFactor(0));

    // Connection lines (drawn first, below nodes)
    const lineG = s.add.graphics().setScrollFactor(0);
    this.container.add(lineG);
    for (const [a, b] of CONNECTIONS) {
      const na = NODE_POS[a], nb = NODE_POS[b];
      if (!na || !nb) continue;
      const isDungeonLink = ZONES[b] && (ZONES[b].dungeon || ZONES[b].raid);
      lineG.lineStyle(2, isDungeonLink ? 0x443366 : 0x2a3a6a, 1);
      lineG.lineBetween(na.x, na.y, nb.x, nb.y);
    }

    // Current-zone highlight gfx (updated on show)
    this.curGfx = s.add.graphics().setScrollFactor(0);
    this.container.add(this.curGfx);

    // Zone nodes
    for (const [key, pos] of Object.entries(NODE_POS)) {
      const def = ZONES[key];
      if (!def) continue;
      const isDungeon = !!(def.dungeon || def.raid);
      const isRaid = !!def.raid;

      if (!isDungeon) {
        // Clickable open-world node
        const btn = s.add.circle(pos.x, pos.y, 18, 0x1a2c6a, 1)
          .setStrokeStyle(2, 0x4466cc).setScrollFactor(0).setInteractive();
        btn.on('pointerdown', () => { if (this.onTravel) this.onTravel(key); this.close(); });
        btn.on('pointerover', () => { btn.setFillStyle(0x2a3c8a, 1); btn.setStrokeStyle(3, 0x88aaff); });
        btn.on('pointerout',  () => { btn.setFillStyle(0x1a2c6a, 1); btn.setStrokeStyle(2, 0x4466cc); });
        this.container.add(btn);
        this.container.add(s.add.circle(pos.x, pos.y, 7, 0x88aaff, 1).setScrollFactor(0));
      } else {
        // Non-interactive dungeon node
        const col = isRaid ? 0x3d1050 : 0x221840;
        const edgeCol = isRaid ? 0x9940cc : 0x5a4090;
        this.container.add(s.add.polygon(pos.x, pos.y, [
          0,-16, 14,-8, 14,8, 0,16, -14,8, -14,-8
        ], col, 1).setStrokeStyle(2, edgeCol).setScrollFactor(0));
        // Lock icon
        this.container.add(s.add.text(pos.x, pos.y, isRaid ? '★' : '⚔', {
          fontSize: '11px', color: isRaid ? '#bb66ff' : '#8877bb',
        }).setOrigin(0.5).setScrollFactor(0));
      }

      // Zone name label below node
      const shortName = (def.name || key).replace(' (Town)', '').replace('Whispering ', '').replace('Gloom ', '').replace(' Lair', '').replace('Hollow ', '');
      this.container.add(s.add.text(pos.x, pos.y + 24, shortName, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '9px',
        color: isDungeon ? (isRaid ? '#bb66ff' : '#8877bb') : '#aaccff',
        align: 'center', wordWrap: { width: 90 },
      }).setOrigin(0.5, 0).setScrollFactor(0));
    }
  }

  toggle(currentKey) { this.open ? this.close() : this.show(currentKey); }

  show(currentKey) {
    this.open = true;
    this.container.setVisible(true);
    this._highlight(currentKey || this.getZoneKey());
  }

  close() {
    this.open = false;
    this.container.setVisible(false);
  }

  _highlight(key) {
    const g = this.curGfx; g.clear();
    const pos = NODE_POS[key];
    if (!pos) return;
    g.lineStyle(3, 0xffe066, 1);
    g.strokeCircle(pos.x, pos.y, 24);
  }

  contains(px, py) {
    if (!this.open) return false;
    return Math.abs(px - CONFIG.width / 2) < 410 && Math.abs(py - CONFIG.height / 2) < 220;
  }

  destroy() { this.container.destroy(); }
}
