import { CONFIG } from '../config.js';

// Always-visible minimap — top-right, beside the button stack.
// Adjust MM_SIZE to resize.
const MM_SIZE = 120;

const BTN_TOP_Y  = 30;  // center y of the first (C) button
const BTN_R      = 22;

export default class MiniMap {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.size  = opts.size ?? MM_SIZE;
    const s    = this.size;

    // Centre of the minimap square, in screen (game) coords.
    this.cx = opts.x ?? (CONFIG.width - 44 - 22 - 12 - s / 2);
    this.cy = opts.y ?? (BTN_TOP_Y + s / 2);

    // A Container with scrollFactor(0) keeps everything fixed on screen —
    // the same pattern used by MapPanel, SettingsPanel, etc.
    this.container = scene.add.container(this.cx, this.cy)
      .setDepth(130)      // same tier as MapPanel so it's always on top
      .setScrollFactor(0);

    // Solid background + border.
    const bg = scene.add.rectangle(0, 0, s, s, 0x0d1f36, 0.95)
      .setStrokeStyle(2, 0x4499cc, 1);
    this.container.add(bg);

    // "MAP" label above the box (in container-local y: top edge = -s/2).
    const label = scene.add.text(0, -s / 2 - 2, 'MAP', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '10px', fontStyle: 'bold',
      color: '#55bbee', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setScrollFactor(0);
    this.container.add(label);

    // Graphics for dots, drawn relative to the container origin.
    this.gfx = scene.add.graphics().setScrollFactor(0);
    this.container.add(this.gfx);
  }

  // Call every frame.
  // data: { bounds, player, allies, mobs, boss, portals, waystones }
  update(data) {
    const g = this.gfx; g.clear();
    const s = this.size;

    const bounds = data && data.bounds;
    if (!bounds || !bounds.w || !bounds.h) return;

    // Scale the zone to fill the minimap with a small margin.
    const margin = 6;
    const scale  = Math.min((s - margin * 2) / bounds.w, (s - margin * 2) / bounds.h);
    const drawW  = bounds.w * scale;
    const drawH  = bounds.h * scale;

    // In container-local coordinates, the centre of the zone maps to (0, 0).
    // Top-left of the zone drawing area:
    const ox = -drawW / 2;
    const oy = -drawH / 2;

    const wx = (worldX) => ox + worldX * scale;
    const wy = (worldY) => oy + worldY * scale;

    // Zone boundary.
    g.lineStyle(1, 0x335577, 0.8);
    g.strokeRect(ox, oy, drawW, drawH);

    // Portals — cyan.
    if (data.portals) {
      for (const p of data.portals) {
        g.fillStyle(0x44ddff, 1); g.fillCircle(wx(p.x), wy(p.y), 3);
      }
    }
    // Waystones — green.
    if (data.waystones) {
      for (const w of data.waystones) {
        g.fillStyle(0x44ff99, 1); g.fillCircle(wx(w.x), wy(w.y), 2.5);
      }
    }
    // Mobs — red.
    if (data.mobs) {
      g.fillStyle(0xff4444, 1);
      for (const m of data.mobs) { if (m.alive === false) continue; g.fillCircle(wx(m.x), wy(m.y), 2); }
    }
    // Boss — orange.
    if (data.boss && data.boss.alive) {
      g.fillStyle(0xff8800, 1); g.fillCircle(wx(data.boss.x), wy(data.boss.y), 5);
    }
    // Allies — blue.
    if (data.allies) {
      g.fillStyle(0x6699ff, 1);
      for (const a of data.allies) g.fillCircle(wx(a.x), wy(a.y), 3);
    }
    // Player — bright yellow, always on top.
    if (data.player) {
      g.fillStyle(0xffff00, 1); g.fillCircle(wx(data.player.x), wy(data.player.y), 4);
    }
  }

  destroy() { this.container.destroy(true); }
}
