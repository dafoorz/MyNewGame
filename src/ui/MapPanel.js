import { CONFIG } from '../config.js';
import { ZONES, zoneWaystones } from '../world/zones.js';

// World map / fast-travel panel. Travel targets are WAYSTONES — shrines you must
// physically discover first. Discovered ones are clickable; undiscovered ones are
// shown locked so you know roughly where to look. Dungeons/raids have no waystone
// (you always enter them on foot via their hidden portal).
//
// Areas are listed top→bottom in difficulty order. Each row shows the area's
// waystones plus a hint of which dungeon/raid it hides.

const AREA_ORDER = ['town', 'forest', 'caves', 'emberwastes', 'voidmarches'];

export default class MapPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.onTravel = opts.onTravel || null;
    this.getZoneKey = opts.getZoneKey || (() => 'town');
    this.getDiscovered = opts.getDiscovered || (() => new Set());
    this.getSeed = opts.getSeed || (() => 0);
    this.open = false;
    this.rowItems = []; // rebuilt each show()
    this._buildFrame();
  }

  _buildFrame() {
    const s = this.scene;
    const W = CONFIG.width, H = CONFIG.height;
    this.panW = 860; this.panH = 540;
    const panX = W / 2 - this.panW / 2, panY = H / 2 - this.panH / 2;
    this.panX = panX; this.panY = panY;

    this.container = s.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    this.container.add(s.add.rectangle(W / 2, H / 2, this.panW, this.panH, 0x07091a, 0.98)
      .setStrokeStyle(2, 0x334477).setScrollFactor(0));
    this.container.add(s.add.text(W / 2, panY + 16, 'WORLD MAP — select a waystone to travel', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '17px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5, 0).setScrollFactor(0));
    this.container.add(s.add.text(W / 2, panY + 40, '[M] to close', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '11px', color: '#6688aa',
    }).setOrigin(0.5, 0).setScrollFactor(0));
    this.container.add(s.add.text(panX + 18, panY + this.panH - 14,
      'Bright = discovered (click to travel)   ·   Grey = undiscovered (walk onto the shrine to unlock)', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '10px', color: '#6688aa',
    }).setOrigin(0, 1).setScrollFactor(0));
  }

  toggle(currentKey) { this.open ? this.close() : this.show(currentKey); }

  show(currentKey) {
    this.open = true;
    this._rebuild(currentKey || this.getZoneKey());
    this.container.setVisible(true);
  }

  close() {
    this.open = false;
    this.container.setVisible(false);
  }

  _clearRows() {
    for (const o of this.rowItems) o.destroy();
    this.rowItems = [];
  }

  _rebuild(currentKey) {
    const s = this.scene;
    this._clearRows();
    const discovered = this.getDiscovered() || new Set();
    const has = (id) => (discovered.has ? discovered.has(id) : (discovered.indexOf?.(id) >= 0));
    const seed = this.getSeed();

    let y = this.panY + 72;
    const rowH = 88;
    const leftX = this.panX + 24;

    for (const key of AREA_ORDER) {
      const z = ZONES[key];
      if (!z) continue;
      const isCurrent = key === currentKey;

      // Row background (highlight the area you're currently in)
      const bg = s.add.rectangle(CONFIG.width / 2, y + rowH / 2 - 8, this.panW - 40, rowH - 10,
        isCurrent ? 0x16244a : 0x0e1430, isCurrent ? 0.9 : 0.6)
        .setStrokeStyle(1, isCurrent ? 0xffe066 : 0x263158).setScrollFactor(0);
      this.container.add(bg); this.rowItems.push(bg);

      // Area name + difficulty
      const lvl = z.mobLevel ? `  Lv ${z.mobLevel}` : (z.safe ? '  Safe' : '');
      const nameT = s.add.text(leftX, y, z.name + lvl, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', fontStyle: 'bold',
        color: isCurrent ? '#ffe79a' : '#cfe0ff',
      }).setScrollFactor(0);
      this.container.add(nameT); this.rowItems.push(nameT);

      // Dungeon/raid hint (entered on foot, not via map)
      const dungeons = (z.portals || []).filter((p) => p.to && ZONES[p.to] && (ZONES[p.to].dungeon || ZONES[p.to].raid))
        .map((p) => ZONES[p.to].name + (ZONES[p.to].raid ? ' ★' : ''));
      if (dungeons.length) {
        const hint = s.add.text(this.panX + this.panW - 24, y + 2, '⚔ ' + dungeons.join('   ⚔ '), {
          fontFamily: 'Segoe UI, sans-serif', fontSize: '11px', color: '#9b7fd0',
        }).setOrigin(1, 0).setScrollFactor(0);
        this.container.add(hint); this.rowItems.push(hint);
      }

      // Waystone buttons
      const ways = zoneWaystones(key, seed);
      let bx = leftX;
      const by = y + 36;
      for (const w of ways) {
        const discoveredHere = has(w.id);
        const label = discoveredHere ? w.name : '🔒 ' + w.name;
        const padX = 12;
        const t = s.add.text(0, 0, label, {
          fontFamily: 'Segoe UI, sans-serif', fontSize: '13px', fontStyle: discoveredHere ? 'bold' : 'normal',
          color: discoveredHere ? '#bfe9ff' : '#5a6385',
        }).setOrigin(0, 0.5).setScrollFactor(0);
        const bw = t.width + padX * 2;
        const btn = s.add.rectangle(bx + bw / 2, by, bw, 26,
          discoveredHere ? 0x1a2c6a : 0x141826, 1)
          .setStrokeStyle(2, discoveredHere ? 0x4466cc : 0x2a3044).setScrollFactor(0);
        t.setPosition(bx + padX, by);
        this.container.add(btn); this.container.add(t);
        this.rowItems.push(btn); this.rowItems.push(t);

        if (discoveredHere) {
          btn.setInteractive();
          btn.on('pointerover', () => { btn.setFillStyle(0x2a3c8a, 1); btn.setStrokeStyle(3, 0x88aaff); });
          btn.on('pointerout', () => { btn.setFillStyle(0x1a2c6a, 1); btn.setStrokeStyle(2, 0x4466cc); });
          btn.on('pointerdown', () => { if (this.onTravel) this.onTravel(w.id); this.close(); });
        }
        bx += bw + 12;
      }

      y += rowH;
    }
  }

  contains(px, py) {
    if (!this.open) return false;
    return Math.abs(px - CONFIG.width / 2) < this.panW / 2 + 4 &&
           Math.abs(py - CONFIG.height / 2) < this.panH / 2 + 4;
  }

  destroy() { this._clearRows(); this.container.destroy(); }
}
