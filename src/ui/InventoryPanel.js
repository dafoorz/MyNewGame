import { CONFIG } from '../config.js';
import {
  EQUIP_SLOTS, STAT_KEYS, ITEM_BASES, rarityColor, gearBonus, canEquip,
} from '../items.js';

// Inventory + Equipment page, shared by Solo (GameScene) and Online (OnlineScene).
// It's purely a view: the owning scene supplies a data model via getModel() and
// handles equip/unequip through callbacks (locally in solo, over the network in
// online — where the server validates). Toggle with the inventory key or button.
//
// Desktop: hover an item for details, click to equip/unequip.
// Touch:   tap an item to see details + an Equip/Unequip button (no hover).

const SLOT_LABEL = { weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', accessory: 'Accessory' };
const STAT_DESC = { STR: 'phys', DEX: 'crit/spd', INT: 'magic', VIT: 'health', AGI: 'move' };

export default class InventoryPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.getModel = opts.getModel || (() => ({}));
    this.onEquip = opts.onEquip || (() => {});
    this.onUnequip = opts.onUnequip || (() => {});
    this.open = false;
    this.isTouch = scene.sys.game.device.input.touch || ('ontouchstart' in window);

    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    this.cx = cx; this.cy = cy;
    this.W = 680; this.H = 452;

    const panel = scene.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    this.panel = panel;
    // Background also swallows stray taps and dismisses any open tooltip.
    const bg = scene.add.rectangle(cx, cy, this.W, this.H, 0x10131f, 0.98).setStrokeStyle(2, 0x3a4366).setScrollFactor(0).setInteractive();
    bg.on('pointerdown', () => this.hideTip());
    panel.add(bg);
    panel.add(scene.add.text(cx, cy - this.H / 2 + 18, 'Inventory & Equipment', {
      fontFamily: 'Segoe UI', fontSize: '17px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5).setScrollFactor(0));
    const hint = this.isTouch ? 'Tap an item for details · tap again or use the button to equip' : 'Hover for details · click an item to equip, a slot to unequip';
    panel.add(scene.add.text(cx, cy + this.H / 2 - 16, hint, {
      fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad',
    }).setOrigin(0.5).setScrollFactor(0));

    // Close (✕) button — important on touch where there's no Esc key.
    const closeBg = scene.add.rectangle(cx + this.W / 2 - 20, cy - this.H / 2 + 18, 28, 28, 0x3a2030, 0.95).setStrokeStyle(1, 0xff7a7a).setScrollFactor(0).setInteractive();
    closeBg.on('pointerdown', () => this.close());
    panel.add(closeBg);
    panel.add(scene.add.text(cx + this.W / 2 - 20, cy - this.H / 2 + 17, '✕', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#ff9a9a' }).setOrigin(0.5).setScrollFactor(0));

    // Column headers.
    const top = cy - this.H / 2 + 44;
    panel.add(scene.add.text(cx - 318, top, 'EQUIPPED', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));
    panel.add(scene.add.text(cx - 128, top, 'BACKPACK', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));
    panel.add(scene.add.text(cx + 168, top, 'STATS', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));

    // Dynamic content lives in its own container we wipe on each refresh.
    this.dyn = scene.add.container(0, 0).setDepth(131).setScrollFactor(0).setVisible(false);

    // Reusable tooltip with an optional action button (Equip / Unequip).
    this.tip = scene.add.container(0, 0).setDepth(133).setScrollFactor(0).setVisible(false);
    this.tipBg = scene.add.rectangle(0, 0, 10, 10, 0x05070d, 0.98).setStrokeStyle(1, 0x4a5680).setOrigin(0, 0).setScrollFactor(0);
    this.tipText = scene.add.text(0, 0, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#e6e9f2', lineSpacing: 2 }).setOrigin(0, 0).setScrollFactor(0);
    this.tipBtn = scene.add.rectangle(0, 0, 150, 26, 0x2a6e3a, 1).setStrokeStyle(1, 0x4ad06a).setScrollFactor(0).setInteractive().setVisible(false);
    this.tipBtnText = scene.add.text(0, 0, '', { fontFamily: 'Segoe UI', fontSize: '13px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setScrollFactor(0).setVisible(false);
    this.tipBtn.on('pointerdown', () => { const fn = this._tipAction; this.hideTip(); if (fn) { fn(); this.refresh(); } });
    this.tip.add(this.tipBg); this.tip.add(this.tipText); this.tip.add(this.tipBtn); this.tip.add(this.tipBtnText);
    this._tipAction = null;
  }

  toggle() { this.open ? this.close() : this.show(); }
  show() { this.open = true; this.panel.setVisible(true); this.dyn.setVisible(true); this.refresh(); }
  close() { this.open = false; this.panel.setVisible(false); this.dyn.setVisible(false); this.hideTip(); }

  // True if a screen point is over the panel (so the scene can swallow the click).
  contains(x, y) {
    return this.open && Math.abs(x - this.cx) <= this.W / 2 && Math.abs(y - this.cy) <= this.H / 2;
  }

  // Show item details near (x,y). `action` (optional) = { label, fn } renders a
  // tappable Equip/Unequip button inside the tooltip (used on touch).
  showTip(item, x, y, action = null) {
    if (!item) return;
    const model = this.getModel();
    const lines = [item.name, `${SLOT_LABEL[item.slot] || item.slot} · ilvl ${item.ilvl}`, ''];
    for (const k of STAT_KEYS) if (item.stats[k]) lines.push(`+${item.stats[k]} ${k}`);
    const equipped = model.gear ? model.gear[item.slot] : null;
    if (equipped && equipped.id !== item.id) {
      lines.push('', `vs equipped (${equipped.name}):`);
      for (const k of STAT_KEYS) {
        const d = (item.stats[k] || 0) - (equipped.stats[k] || 0);
        if (d) lines.push(`  ${d > 0 ? '+' : ''}${d} ${k}`);
      }
    }
    if (model.classKey && !canEquip(model.classKey, item)) lines.push('', "Can't be used by this class");
    this.tipText.setText(lines.join('\n'));

    const w = Math.max(this.tipText.width, action ? 150 : 0) + 16;
    let h = this.tipText.height + 12;
    if (action) { h += 34; this._tipAction = action.fn; } else this._tipAction = null;
    this.tipBg.width = w; this.tipBg.height = h;

    let px = x + 14, py = y + 10;
    if (px + w > CONFIG.width) px = x - w - 14;
    if (px < 0) px = 4;
    if (py + h > CONFIG.height) py = CONFIG.height - h - 6;
    if (py < 0) py = 4;
    this.tipBg.setPosition(px, py);
    this.tipText.setPosition(px + 8, py + 6);
    if (action) {
      this.tipBtn.setPosition(px + w / 2, py + h - 18).setVisible(true);
      this.tipBtnText.setText(action.label).setPosition(px + w / 2, py + h - 18).setVisible(true);
    } else { this.tipBtn.setVisible(false); this.tipBtnText.setVisible(false); }
    this.tip.setVisible(true);
  }
  hideTip() { this.tip.setVisible(false); this.tipBtn.setVisible(false); this.tipBtnText.setVisible(false); this._tipAction = null; }

  // Rebuild all dynamic rows from the current model.
  refresh() {
    if (!this.open) return;
    const s = this.scene, cx = this.cx, cy = this.cy;
    this.dyn.removeAll(true);
    const m = this.getModel();
    const gear = m.gear || {};
    const inv = m.inventory || [];
    const base = m.baseStats || {};
    const gb = gearBonus(gear);
    const top = cy - this.H / 2 + 64;

    const add = (o) => { this.dyn.add(o); return o; };
    const mkText = (x, y, str, color, size = 13, origin = 0) => add(s.add.text(x, y, str, { fontFamily: 'Consolas, monospace', fontSize: size + 'px', color }).setOrigin(origin, 0.5).setScrollFactor(0));

    // --- Equipped slots (tap/click to unequip) ---
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = top + 12 + i * 38;
      add(s.add.rectangle(cx - 230, y, 196, 32, 0x191d2e, 0.95).setStrokeStyle(1, 0x333a52).setScrollFactor(0));
      mkText(cx - 322, y - 7, SLOT_LABEL[slot], '#7f8aa8', 10);
      const it = gear[slot];
      if (it) {
        const t = mkText(cx - 322, y + 7, this._clip(it.name, 22), rarityColor(it.rarity), 12);
        t.setInteractive({ useHandCursor: true });
        if (!this.isTouch) {
          t.on('pointerover', (p) => this.showTip(it, p.x, p.y));
          t.on('pointerout', () => this.hideTip());
          t.on('pointerdown', () => { this.onUnequip(slot); this.hideTip(); });
        } else {
          t.on('pointerdown', (p) => this.showTip(it, p.x, p.y, { label: 'Unequip', fn: () => this.onUnequip(slot) }));
        }
      } else {
        mkText(cx - 322, y + 7, '— empty —', '#5a6178', 12);
      }
    });

    // --- Backpack (two columns; tap/click to equip) ---
    const colX = [cx - 128, cx + 18];
    const rows = 11, rowH = 30;
    inv.slice(0, rows * 2).forEach((it, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const x = colX[col], y = top + 6 + row * rowH;
      const usable = !m.classKey || canEquip(m.classKey, it);
      add(s.add.rectangle(x + 64, y, 134, rowH - 4, 0x161a29, 0.9).setStrokeStyle(1, 0x2a3047).setScrollFactor(0));
      const t = mkText(x + 4, y, `${this._clip(it.name, 16)}`, usable ? rarityColor(it.rarity) : '#6b7188', 11);
      t.setAlpha(usable ? 1 : 0.6);
      t.setInteractive({ useHandCursor: true });
      if (!this.isTouch) {
        t.on('pointerover', (p) => this.showTip(it, p.x, p.y));
        t.on('pointerout', () => this.hideTip());
        t.on('pointerdown', () => { if (usable) { this.onEquip(it.id); this.hideTip(); } });
      } else {
        t.on('pointerdown', (p) => this.showTip(it, p.x, p.y, usable ? { label: 'Equip', fn: () => this.onEquip(it.id) } : null));
      }
    });
    if (inv.length === 0) mkText(cx - 124, top + 6, 'Backpack is empty. Kill mobs for loot.', '#5a6178', 11);
    mkText(cx - 128, cy + this.H / 2 - 36, `${inv.length} item(s)`, '#7f8aa8', 11);

    // --- Stats (base + gear = total) ---
    STAT_KEYS.forEach((k, i) => {
      const y = top + 12 + i * 34;
      const b = base[k] || 0, g = gb[k] || 0;
      mkText(cx + 168, y, k, '#c9d2e6', 13);
      mkText(cx + 318, y, `${b}${g > 0 ? ' +' + g : ''} = ${b + g}`, g > 0 ? '#7CFC9A' : '#9aa3bd', 12, 1);
      mkText(cx + 168, y + 13, STAT_DESC[k], '#5a6178', 9);
    });
    if (m.statPoints > 0) mkText(cx + 168, top + 12 + 5 * 34 + 6, `${m.statPoints} unspent point(s) — press C`, '#ffd24a', 11);
  }

  _clip(str, n) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }

  destroy() { this.panel.destroy(); this.dyn.destroy(); this.tip.destroy(); }
}
