import { CONFIG } from '../config.js';
import { ZONES, zoneWaystones } from '../world/zones.js';

// World map / fast-travel panel, drawn to look like a real parchment map: the
// regions sit around Riverwood like a compass (forest NE, caves SE, ember SW,
// void NW), linked by roads, with a compass rose and ink labels. Travel targets
// are WAYSTONES — shrines you must physically discover first; discovered ones
// are clickable pins, undiscovered ones show locked. Dungeons/raids appear as
// crossed-swords markers (entered on foot via their hidden portal, never by map).
//
//   new MapPanel(scene, { onTravel:(id)=>{}, getZoneKey, getDiscovered, getSeed })

// Spatial layout (unit offsets from Riverwood) — matches the town's corner portals.
const LAYOUT = {
  town:        [0, 0],
  forest:      [1, -1],
  caves:       [1, 1],
  emberwastes: [-1, 1],
  voidmarches: [-1, -1],
};
const DUNGEON_OF = { forest: ['lair'], caves: ['crypt'], emberwastes: ['ember'], voidmarches: ['voidthrone', 'ancient_bastion'] };
// If you're standing in a dungeon, the "you are here" marker shows its open zone.
const PARENT = { lair: 'forest', crypt: 'caves', ember: 'emberwastes', voidthrone: 'voidmarches', ancient_bastion: 'voidmarches' };

export default class MapPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.onTravel = opts.onTravel || null;
    this.getZoneKey = opts.getZoneKey || (() => 'town');
    this.getDiscovered = opts.getDiscovered || (() => new Set());
    this.getSeed = opts.getSeed || (() => 0);
    this.open = false;
    this.items = []; // dynamic text/interactive objects, rebuilt each show()
    this._buildFrame();
  }

  _buildFrame() {
    const s = this.scene;
    const W = CONFIG.width, H = CONFIG.height;
    this.panW = 900; this.panH = 580;
    this.panX = W / 2 - this.panW / 2; this.panY = H / 2 - this.panH / 2;

    this.container = s.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    // Outer frame (dark wood) + the parchment sheet are drawn with graphics.
    this.container.add(s.add.rectangle(W / 2, H / 2, this.panW, this.panH, 0x1a1408, 0.99)
      .setStrokeStyle(3, 0x6b5836).setScrollFactor(0));
    this.art = s.add.graphics().setScrollFactor(0);
    this.container.add(this.art);

    // Title banner.
    this.container.add(s.add.text(W / 2, this.panY + 16, 'W O R L D   M A P', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '20px', fontStyle: 'bold',
      color: '#3a2e18',
    }).setOrigin(0.5, 0).setScrollFactor(0));

    // Close (✕) for touch.
    const cb = s.add.rectangle(this.panX + this.panW - 24, this.panY + 22, 28, 28, 0x3a2030, 0.95)
      .setStrokeStyle(1, 0xff7a7a).setScrollFactor(0).setInteractive();
    cb.on('pointerdown', () => this.close());
    this.container.add(cb);
    this.container.add(s.add.text(this.panX + this.panW - 24, this.panY + 21, '✕', {
      fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#ff9a9a',
    }).setOrigin(0.5).setScrollFactor(0));

    // Legend (footer).
    this.container.add(s.add.text(this.panX + 22, this.panY + this.panH - 16,
      '◆ discovered — click to travel    🔒 undiscovered — walk onto the shrine    ⚔ dungeon (enter on foot)    [M] close', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '11px', color: '#b9a06a',
    }).setOrigin(0, 1).setScrollFactor(0));
  }

  toggle(currentKey) { this.open ? this.close() : this.show(currentKey); }
  show(currentKey) { this.open = true; this._rebuild(currentKey || this.getZoneKey()); this.container.setVisible(true); }
  close() { this.open = false; this.container.setVisible(false); }

  _clear() { for (const o of this.items) o.destroy(); this.items = []; }
  _add(o) { this.container.add(o); this.items.push(o); return o; }

  _rebuild(currentKey) {
    const s = this.scene;
    this._clear();
    const disc = this.getDiscovered() || new Set();
    const has = (id) => (disc.has ? disc.has(id) : (disc.indexOf?.(id) >= 0));
    const seed = this.getSeed();
    const g = this.art; g.clear();

    // Parchment sheet.
    const sx = this.panX + 18, sy = this.panY + 48, sw = this.panW - 36, sh = this.panH - 78;
    g.fillStyle(0xcdb98a, 1); g.fillRoundedRect(sx, sy, sw, sh, 12);
    g.fillStyle(0xc3ad7a, 0.5); g.fillRoundedRect(sx + 6, sy + 6, sw - 12, sh - 12, 10);
    g.lineStyle(3, 0x8a7448, 1); g.strokeRoundedRect(sx, sy, sw, sh, 12);

    const center = { x: CONFIG.width / 2, y: sy + sh / 2 + 6 };
    const SPx = 250, SPy = 150;
    const pos = (k) => ({ x: center.x + LAYOUT[k][0] * SPx, y: center.y + LAYOUT[k][1] * SPy });

    // Roads from Riverwood out to each region.
    g.lineStyle(7, 0x9c7c44, 0.85);
    for (const k of ['forest', 'caves', 'emberwastes', 'voidmarches']) { const a = pos('town'), b = pos(k); g.lineBetween(a.x, a.y, b.x, b.y); }
    // Dungeon spurs (dashed feel: thin darker line outward).
    g.lineStyle(3, 0x7a5a2a, 0.7);
    for (const k of ['forest', 'caves', 'emberwastes', 'voidmarches']) {
      const b = pos(k); const out = { x: b.x + LAYOUT[k][0] * 70, y: b.y + LAYOUT[k][1] * 50 };
      g.lineBetween(b.x, b.y, out.x, out.y);
    }

    // Region cards.
    const ORDER = ['town', 'forest', 'caves', 'emberwastes', 'voidmarches'];
    const RW = 168, RH = 86;
    for (const k of ORDER) {
      const z = ZONES[k]; if (!z) continue;
      const p = pos(k);
      const isHere = (k === currentKey) || (PARENT[currentKey] === k);
      g.fillStyle(k === 'town' ? 0x9c8a5a : 0xb6a070, 1);
      g.fillRoundedRect(p.x - RW / 2, p.y - RH / 2, RW, RH, 8);
      g.lineStyle(isHere ? 4 : 2, isHere ? 0xb13a2a : 0x5a4a2a, 1);
      g.strokeRoundedRect(p.x - RW / 2, p.y - RH / 2, RW, RH, 8);

      const lvl = z.mobLevel ? `Lv ${z.mobLevel}` : (z.safe ? 'Safe Haven' : '');
      this._add(s.add.text(p.x, p.y - RH / 2 + 12, z.name, {
        fontFamily: 'Georgia, serif', fontSize: '14px', fontStyle: 'bold', color: '#2e2410',
      }).setOrigin(0.5, 0).setScrollFactor(0));
      if (lvl) this._add(s.add.text(p.x, p.y - RH / 2 + 30, lvl, {
        fontFamily: 'Segoe UI', fontSize: '10px', color: '#6a4a2a',
      }).setOrigin(0.5, 0).setScrollFactor(0));

      // Dungeon marker(s).
      const dungeons = DUNGEON_OF[k] || [];
      if (dungeons.length) {
        const names = dungeons.map((d) => (ZONES[d] ? ZONES[d].name + (ZONES[d].raid ? ' ★' : '') : d)).join(' · ');
        this._add(s.add.text(p.x, p.y - RH / 2 + 46, '⚔ ' + names, {
          fontFamily: 'Segoe UI', fontSize: '9px', color: '#7a2f22', align: 'center',
          wordWrap: { width: RW - 12 },
        }).setOrigin(0.5, 0).setScrollFactor(0));
      }

      // Waystone pins, laid out in a row across the bottom of the card.
      const ways = zoneWaystones(k, seed);
      const n = ways.length;
      ways.forEach((w, i) => {
        const px = p.x + (n > 1 ? (i - (n - 1) / 2) * Math.min(54, (RW - 20) / n) : 0);
        const py = p.y + RH / 2 - 10;
        this._pin(w, px, py, has(w.id));
      });

      if (isHere) this._add(s.add.text(p.x, p.y - RH / 2 - 12, '◉ You are here', {
        fontFamily: 'Segoe UI', fontSize: '11px', fontStyle: 'bold', color: '#b13a2a',
      }).setOrigin(0.5).setScrollFactor(0));
    }

    // Compass rose (top-left of the sheet).
    this._compass(g, sx + 46, sy + 46);
  }

  // A clickable waystone pin (diamond + short label).
  _pin(w, x, y, discovered) {
    const s = this.scene;
    const size = 9;
    const hit = this._add(s.add.rectangle(x, y, 22, 18, 0x000000, 0.001).setScrollFactor(0));
    const dia = this._add(s.add.text(x, y, '◆', {
      fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold',
      color: discovered ? '#2a6ea0' : '#7a7058',
    }).setOrigin(0.5).setScrollFactor(0));
    const label = this._add(s.add.text(x, y + 11, (discovered ? '' : '🔒') + this._clip(w.name, 12), {
      fontFamily: 'Segoe UI', fontSize: '9px', fontStyle: discovered ? 'bold' : 'normal',
      color: discovered ? '#1e3a52' : '#6b5a3a',
    }).setOrigin(0.5, 0).setScrollFactor(0));
    if (discovered) {
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => dia.setColor('#3a9ad8'));
      hit.on('pointerout', () => dia.setColor('#2a6ea0'));
      hit.on('pointerdown', () => { if (this.onTravel) this.onTravel(w.id); this.close(); });
    }
    return dia;
  }

  _compass(g, x, y) {
    const s = this.scene, r = 22;
    g.fillStyle(0xb6a070, 1); g.fillCircle(x, y, r + 4);
    g.lineStyle(2, 0x5a4a2a, 1); g.strokeCircle(x, y, r + 4);
    g.fillStyle(0x7a2f22, 1);
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x - 6, y); g.lineTo(x + 6, y); g.closePath(); g.fillPath();
    g.fillStyle(0x2e2410, 1);
    g.beginPath(); g.moveTo(x, y + r); g.lineTo(x - 6, y); g.lineTo(x + 6, y); g.closePath(); g.fillPath();
    this._add(this.scene.add.text(x, y - r - 10, 'N', { fontFamily: 'Georgia, serif', fontSize: '11px', fontStyle: 'bold', color: '#2e2410' }).setOrigin(0.5).setScrollFactor(0));
  }

  _clip(str, n) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }

  contains(px, py) {
    if (!this.open) return false;
    return Math.abs(px - CONFIG.width / 2) < this.panW / 2 + 4 &&
           Math.abs(py - CONFIG.height / 2) < this.panH / 2 + 4;
  }

  destroy() { this._clear(); this.container.destroy(); }
}
