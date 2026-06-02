import { CONFIG } from '../config.js';

// Reusable health bar. Works both in world space (follows an entity) and as a
// fixed HUD element (the big boss bar). Color shifts green -> orange -> red.

export default class HealthBar {
  constructor(scene, x, y, width, height, opts = {}) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    const depth = opts.depth ?? 50;

    this.bg = scene.add
      .rectangle(x, y, width, height, 0x000000, 0.55)
      .setOrigin(0.5)
      .setDepth(depth);
    this.bg.setStrokeStyle(1, 0xffffff, 0.35);

    this.fill = scene.add
      .rectangle(x - width / 2, y, width, height, CONFIG.colors.hpGood)
      .setOrigin(0, 0.5)
      .setDepth(depth);

    if (opts.fixed) {
      this.bg.setScrollFactor(0);
      this.fill.setScrollFactor(0);
    }
  }

  setPosition(x, y) {
    this.bg.setPosition(x, y);
    this.fill.setPosition(x - this.width / 2, y);
  }

  setValue(ratio) {
    ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.fill.width = this.width * ratio;
    this.fill.fillColor =
      ratio > 0.5
        ? CONFIG.colors.hpGood
        : ratio > 0.25
        ? CONFIG.colors.hpMid
        : CONFIG.colors.hpLow;
  }

  setVisible(v) {
    this.bg.setVisible(v);
    this.fill.setVisible(v);
  }

  destroy() {
    this.bg.destroy();
    this.fill.destroy();
  }
}
