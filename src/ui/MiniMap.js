import { CONFIG } from '../config.js';

// Persistent minimap — always visible top-right, left of the button column.
// Change MM_SIZE to resize; buttons sit at x = CONFIG.width - 44, r = 22,
// so the minimap is placed just to their left with a small gap.
const MM_SIZE = 120; // pixels (square)

export default class MiniMap {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.size = opts.size ?? MM_SIZE;
    const s = this.size;
    // Center: to the left of the button column (buttons at CONFIG.width - 44).
    this.cx = opts.x ?? (CONFIG.width - 44 - 22 - 8 - s / 2);
    this.cy = opts.y ?? (8 + s / 2);
    this.gfx = scene.add.graphics().setDepth(68).setScrollFactor(0);
    this._drawEmpty();
  }

  // Call every frame from updateHud / end of update().
  // data: { bounds, player, allies, mobs, boss, portals, waystones }
  update(data) {
    const g = this.gfx;
    const s = this.size;
    const cx = this.cx, cy = this.cy;
    const x0 = cx - s / 2, y0 = cy - s / 2;

    g.clear();

    // Background + border.
    g.fillStyle(0x060a14, 0.88);
    g.fillRect(x0, y0, s, s);
    g.lineStyle(1, 0x3a4a6e, 1);
    g.strokeRect(x0, y0, s, s);

    const bounds = data && data.bounds;
    if (!bounds || !bounds.w || !bounds.h) return;

    // Uniform scale that fits the zone inside the minimap with a small margin.
    const margin = 4;
    const scale = Math.min((s - margin * 2) / bounds.w, (s - margin * 2) / bounds.h);
    // Offset so the zone is centred inside the minimap square.
    const drawW = bounds.w * scale, drawH = bounds.h * scale;
    const ox = x0 + margin + (s - margin * 2 - drawW) / 2;
    const oy = y0 + margin + (s - margin * 2 - drawH) / 2;

    const wx = (worldX) => ox + worldX * scale;
    const wy = (worldY) => oy + worldY * scale;

    // Zone boundary.
    g.lineStyle(1, 0x2a3a5e, 0.7);
    g.strokeRect(ox, oy, drawW, drawH);

    // Portals — cyan / orange / purple by zone type (we just show position).
    if (data.portals) {
      for (const p of data.portals) {
        g.fillStyle(0x40ccff, 0.95);
        g.fillCircle(wx(p.x), wy(p.y), 3);
      }
    }

    // Waystones — teal.
    if (data.waystones) {
      for (const w of data.waystones) {
        g.fillStyle(0x30e8a0, 0.9);
        g.fillCircle(wx(w.x), wy(w.y), 2.5);
      }
    }

    // Mobs — red dots.
    if (data.mobs) {
      g.fillStyle(0xff4444, 0.75);
      for (const m of data.mobs) {
        if (m.alive === false) continue;
        g.fillCircle(wx(m.x), wy(m.y), 1.8);
      }
    }

    // Boss — orange, slightly larger.
    if (data.boss && data.boss.alive) {
      g.fillStyle(0xff8800, 1);
      g.fillCircle(wx(data.boss.x), wy(data.boss.y), 4);
    }

    // Allies / other party members — dim blue.
    if (data.allies) {
      g.fillStyle(0x6699ff, 0.85);
      for (const a of data.allies) {
        g.fillCircle(wx(a.x), wy(a.y), 3);
      }
    }

    // Player — bright yellow, on top.
    if (data.player) {
      g.fillStyle(0xfff060, 1);
      g.fillCircle(wx(data.player.x), wy(data.player.y), 4);
    }
  }

  _drawEmpty() {
    const g = this.gfx, s = this.size;
    const x0 = this.cx - s / 2, y0 = this.cy - s / 2;
    g.fillStyle(0x060a14, 0.88);
    g.fillRect(x0, y0, s, s);
    g.lineStyle(1, 0x3a4a6e, 1);
    g.strokeRect(x0, y0, s, s);
  }

  destroy() { this.gfx.destroy(); }
}
