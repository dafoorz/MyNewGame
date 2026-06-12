import { CONFIG } from '../config.js';

// Always-visible minimap — right side, below the last button.
// Adjust MM_SIZE to resize.
const MM_SIZE = 120;

const BTN_LAST_Y = 330; // center y of the last (B) button
const BTN_R      = 22;  // button radius

export default class MiniMap {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.size  = opts.size ?? MM_SIZE;
    const s    = this.size;

    // Position: right-aligned, 16 px below the last button.
    this.cx = opts.x ?? (CONFIG.width - s / 2 - 6);
    this.cy = opts.y ?? (BTN_LAST_Y + BTN_R + 16 + s / 2);

    const x0 = this.cx - s / 2, y0 = this.cy - s / 2;

    // Solid navy background — Rectangle is guaranteed to render.
    this.bg = scene.add.rectangle(this.cx, this.cy, s, s, 0x0d1f36, 1)
      .setStrokeStyle(2, 0x4499cc, 1)
      .setScrollFactor(0).setDepth(72);

    // "MAP" label above the box.
    this.label = scene.add.text(this.cx, y0 - 2, 'MAP', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '10px', fontStyle: 'bold',
      color: '#55bbee', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(73);

    // Graphics for dots — drawn on top of the background.
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(73);
  }

  // Call every frame.
  // data: { bounds, player, allies, mobs, boss, portals, waystones }
  update(data) {
    const g = this.gfx; g.clear();
    const s = this.size, cx = this.cx, cy = this.cy;
    const x0 = cx - s / 2, y0 = cy - s / 2;

    const bounds = data && data.bounds;
    if (!bounds || !bounds.w || !bounds.h) return;

    const margin = 6;
    const scale  = Math.min((s - margin * 2) / bounds.w, (s - margin * 2) / bounds.h);
    const drawW  = bounds.w * scale, drawH = bounds.h * scale;
    const ox     = x0 + margin + (s - margin * 2 - drawW) / 2;
    const oy     = y0 + margin + (s - margin * 2 - drawH) / 2;

    const wx = (worldX) => ox + worldX * scale;
    const wy = (worldY) => oy + worldY * scale;

    // Zone boundary.
    g.lineStyle(1, 0x335577, 0.8); g.strokeRect(ox, oy, drawW, drawH);

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

  destroy() { this.bg.destroy(); this.label.destroy(); this.gfx.destroy(); }
}
