import { CONFIG } from '../config.js';

// Persistent minimap drawn below the right-side button column.
// Change MM_SIZE here to resize (it's a square).
const MM_SIZE = 120; // px — adjust freely

const BTN_X = CONFIG.width - 44; // button column center x
const BTN_LAST_Y = 330;          // last button (B) center y
const BTN_R = 22;                // button radius

export default class MiniMap {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.size = opts.size ?? MM_SIZE;
    const s = this.size;
    // Below the button column, right-aligned with a small margin.
    this.cx = opts.x ?? (CONFIG.width - s / 2 - 6);
    this.cy = opts.y ?? (BTN_LAST_Y + BTN_R + 14 + s / 2);

    // Depth 72 — above HUD (60) and touch buttons (70/71), below modals (120+).
    this.gfx   = scene.add.graphics().setDepth(72).setScrollFactor(0);
    this.label = scene.add.text(this.cx, this.cy - s / 2 - 1, 'MAP', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '9px', fontStyle: 'bold',
      color: '#7ab4d8', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(72).setScrollFactor(0);

    this._drawBg();
  }

  // Call every frame.
  // data: { bounds:{w,h}, player:{x,y}, allies:[{x,y}], mobs:[{x,y,alive?}],
  //         boss:{x,y,alive}, portals:[{x,y}], waystones:[{x,y}] }
  update(data) {
    const g = this.gfx;
    const s = this.size;
    const cx = this.cx, cy = this.cy;
    const x0 = cx - s / 2, y0 = cy - s / 2;

    g.clear();
    this._bg(g, x0, y0, s);

    const bounds = data && data.bounds;
    if (!bounds || !bounds.w || !bounds.h) return;

    const margin = 5;
    const scale = Math.min((s - margin * 2) / bounds.w, (s - margin * 2) / bounds.h);
    const drawW = bounds.w * scale, drawH = bounds.h * scale;
    const ox = x0 + margin + (s - margin * 2 - drawW) / 2;
    const oy = y0 + margin + (s - margin * 2 - drawH) / 2;

    const wx = (worldX) => ox + worldX * scale;
    const wy = (worldY) => oy + worldY * scale;

    // Zone boundary outline.
    g.lineStyle(1, 0x4466aa, 0.6);
    g.strokeRect(ox, oy, drawW, drawH);

    // Portals — cyan.
    if (data.portals) {
      for (const p of data.portals) {
        g.fillStyle(0x40d4ff, 1); g.fillCircle(wx(p.x), wy(p.y), 3);
      }
    }

    // Waystones — teal.
    if (data.waystones) {
      for (const w of data.waystones) {
        g.fillStyle(0x30f0a0, 1); g.fillCircle(wx(w.x), wy(w.y), 2.5);
      }
    }

    // Mobs — red.
    if (data.mobs) {
      g.fillStyle(0xff4444, 0.9);
      for (const m of data.mobs) {
        if (m.alive === false) continue;
        g.fillCircle(wx(m.x), wy(m.y), 2);
      }
    }

    // Boss — orange, larger.
    if (data.boss && data.boss.alive) {
      g.fillStyle(0xff8800, 1); g.fillCircle(wx(data.boss.x), wy(data.boss.y), 4.5);
    }

    // Allies — blue.
    if (data.allies) {
      g.fillStyle(0x6699ff, 1);
      for (const a of data.allies) g.fillCircle(wx(a.x), wy(a.y), 3);
    }

    // Player — bright yellow, always on top.
    if (data.player) {
      g.fillStyle(0xffee44, 1); g.fillCircle(wx(data.player.x), wy(data.player.y), 4);
    }
  }

  _drawBg() {
    const g = this.gfx, s = this.size;
    this._bg(g, this.cx - s / 2, this.cy - s / 2, s);
  }

  _bg(g, x0, y0, s) {
    g.fillStyle(0x0c1824, 0.92);
    g.fillRect(x0, y0, s, s);
    g.lineStyle(2, 0x4488bb, 1);
    g.strokeRect(x0, y0, s, s);
  }

  destroy() { this.gfx.destroy(); this.label.destroy(); }
}
