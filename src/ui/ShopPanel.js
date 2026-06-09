import { CONFIG } from '../config.js';
import { EQUIP_SLOTS, STAT_KEYS, rarityColor } from '../items.js';
import { SHOP_TIERS, buyCost, upgradeCost } from '../shop.js';

// Town shop, shared by Solo (GameScene) and Online (OnlineScene). Like the other
// panels it's a pure view: the scene supplies a model via getModel() and performs
// purchases/upgrades through callbacks (locally in solo, over the network online
// where the server validates gold + town-only).
//
//   new ShopPanel(scene, {
//     getModel: () => ({ classKey, gold, gear }),
//     onBuy: (slot, tierKey) => {...}, onUpgrade: (slot) => {...},
//   })

const SLOT_LABEL = { weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', accessory: 'Accessory' };

export default class ShopPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.getModel = opts.getModel || (() => ({}));
    this.onBuy = opts.onBuy || (() => {});
    this.onUpgrade = opts.onUpgrade || (() => {});
    this.open = false;

    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    this.cx = cx; this.cy = cy; this.W = 720; this.H = 470;

    const panel = scene.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    this.panel = panel;
    const bg = scene.add.rectangle(cx, cy, this.W, this.H, 0x100f1a, 0.98).setStrokeStyle(2, 0x4a3a66).setScrollFactor(0).setInteractive();
    panel.add(bg);
    this.title = scene.add.text(cx, cy - this.H / 2 + 16, 'Riverwood Market', {
      fontFamily: 'Segoe UI', fontSize: '17px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5).setScrollFactor(0);
    panel.add(this.title);
    this.goldText = scene.add.text(cx, cy - this.H / 2 + 38, '', {
      fontFamily: 'Consolas, monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffe066',
    }).setOrigin(0.5).setScrollFactor(0);
    panel.add(this.goldText);
    panel.add(scene.add.text(cx, cy + this.H / 2 - 14, 'Buy class-appropriate gear · Upgrade equipped items · ✕ or B to close', {
      fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad',
    }).setOrigin(0.5).setScrollFactor(0));

    const closeBg = scene.add.rectangle(cx + this.W / 2 - 20, cy - this.H / 2 + 18, 28, 28, 0x3a2030, 0.95).setStrokeStyle(1, 0xff7a7a).setScrollFactor(0).setInteractive();
    closeBg.on('pointerdown', () => this.close());
    panel.add(closeBg);
    panel.add(scene.add.text(cx + this.W / 2 - 20, cy - this.H / 2 + 17, '✕', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#ff9a9a' }).setOrigin(0.5).setScrollFactor(0));

    const top = cy - this.H / 2 + 60;
    panel.add(scene.add.text(cx - this.W / 2 + 24, top, 'BUY GEAR', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));
    panel.add(scene.add.text(cx + 26, top, 'UPGRADE EQUIPPED', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));

    // Dynamic, rebuilt each refresh.
    this.dyn = scene.add.container(0, 0).setDepth(131).setScrollFactor(0).setVisible(false);
  }

  toggle() { this.open ? this.close() : this.show(); }
  show() { this.open = true; this.panel.setVisible(true); this.dyn.setVisible(true); this.refresh(); }
  close() { this.open = false; this.panel.setVisible(false); this.dyn.setVisible(false); }
  contains(x, y) { return this.open && Math.abs(x - this.cx) <= this.W / 2 && Math.abs(y - this.cy) <= this.H / 2; }

  refresh() {
    if (!this.open) return;
    const s = this.scene, cx = this.cx, cy = this.cy;
    this.dyn.removeAll(true);
    const m = this.getModel();
    const gold = m.gold | 0;
    const gear = m.gear || {};
    this.goldText.setText(`Gold: ${gold.toLocaleString()}`);

    const add = (o) => { this.dyn.add(o); return o; };
    const mkBtn = (x, y, w, label, color, enabled, fn) => {
      const r = add(s.add.rectangle(x, y, w, 26, enabled ? color : 0x23262f, 1).setStrokeStyle(1, enabled ? 0x6a7bbf : 0x33384a).setOrigin(0, 0.5).setScrollFactor(0));
      const t = add(s.add.text(x + w / 2, y, label, { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: enabled ? '#fff' : '#6b7188' }).setOrigin(0.5).setScrollFactor(0));
      if (enabled) { r.setInteractive({ useHandCursor: true }); r.on('pointerdown', () => { fn(); }); }
      return { r, t };
    };

    // --- Left column: buy gear (a row per slot, a button per tier) ---
    const lx = cx - this.W / 2 + 24;
    const top = cy - this.H / 2 + 80;
    const rowH = 56;
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = top + i * rowH;
      add(s.add.text(lx, y, SLOT_LABEL[slot], { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#cfe0ff' }).setOrigin(0, 0.5).setScrollFactor(0));
      SHOP_TIERS.forEach((tier, ti) => {
        const cost = buyCost(slot, tier.key);
        const bx = lx + 78 + ti * 86;
        const can = gold >= cost;
        mkBtn(bx, y, 80, `${tier.name}\n${cost}g`, 0x2a4a6e, can, () => { this.onBuy(slot, tier.key); this._after(); });
      });
    });

    // --- Right column: upgrade each equipped item ---
    const rx = cx + 26;
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = top + i * rowH;
      const it = gear[slot];
      add(s.add.text(rx, y - 9, SLOT_LABEL[slot], { fontFamily: 'Consolas, monospace', fontSize: '10px', color: '#7f8aa8' }).setOrigin(0, 0.5).setScrollFactor(0));
      if (it) {
        add(s.add.text(rx, y + 6, this._clip(it.name, 24), { fontFamily: 'Consolas, monospace', fontSize: '11px', color: rarityColor(it.rarity) }).setOrigin(0, 0.5).setScrollFactor(0));
        const cost = upgradeCost(it);
        const can = gold >= cost;
        mkBtn(rx + 250, y, 96, `Upgrade ${cost}g`, 0x2a6e3a, can, () => { this.onUpgrade(slot); this._after(); });
      } else {
        add(s.add.text(rx, y + 6, '— empty —', { fontFamily: 'Consolas, monospace', fontSize: '11px', color: '#5a6178' }).setOrigin(0, 0.5).setScrollFactor(0));
      }
    });
  }

  // Re-read the model shortly after an action so gold/gear reflect the change
  // (online updates arrive on the next snapshot).
  _after() { this.scene.time.delayedCall(60, () => this.refresh()); this.refresh(); }
  _clip(str, n) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }

  destroy() { this.panel.destroy(); this.dyn.destroy(); }
}
