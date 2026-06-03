import { CONFIG } from '../config.js';
import {
  EQUIP_SLOTS, STAT_KEYS, ITEM_BASES, rarityColor, gearBonus, itemPower, canEquip,
} from '../items.js';

// Inventory + Equipment page, shared by Solo (GameScene) and Online (OnlineScene).
// It's purely a view: the owning scene supplies a data model via getModel() and
// handles equip/unequip through callbacks (locally in solo, over the network in
// online — where the server validates). Toggle with the inventory key or button.
//
//   new InventoryPanel(scene, {
//     getModel: () => ({ classKey, statPoints, baseStats, stats, inventory, gear }),
//     onEquip:  (itemId) => {...},
//     onUnequip:(slot)   => {...},
//   })

const SLOT_LABEL = { weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', accessory: 'Accessory' };
const STAT_DESC = { STR: 'phys', DEX: 'crit/spd', INT: 'magic', VIT: 'health', AGI: 'move' };

export default class InventoryPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.getModel = opts.getModel || (() => ({}));
    this.onEquip = opts.onEquip || (() => {});
    this.onUnequip = opts.onUnequip || (() => {});
    this.open = false;

    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    this.cx = cx; this.cy = cy;
    this.W = 680; this.H = 452;

    const panel = scene.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    this.panel = panel;
    panel.add(scene.add.rectangle(cx, cy, this.W, this.H, 0x10131f, 0.97).setStrokeStyle(2, 0x3a4366).setScrollFactor(0));
    panel.add(scene.add.text(cx, cy - this.H / 2 + 18, 'Inventory & Equipment', {
      fontFamily: 'Segoe UI', fontSize: '17px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5).setScrollFactor(0));
    panel.add(scene.add.text(cx, cy + this.H / 2 - 16, 'Click a backpack item to equip · click a slot to unequip · I / button to close', {
      fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad',
    }).setOrigin(0.5).setScrollFactor(0));

    // Column headers.
    const top = cy - this.H / 2 + 44;
    panel.add(scene.add.text(cx - 318, top, 'EQUIPPED', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));
    panel.add(scene.add.text(cx - 128, top, 'BACKPACK', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));
    panel.add(scene.add.text(cx + 168, top, 'STATS', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#9fb0d0' }).setScrollFactor(0));

    // Dynamic content lives in its own container we wipe on each refresh.
    this.dyn = scene.add.container(0, 0).setDepth(131).setScrollFactor(0).setVisible(false);

    // Reusable tooltip.
    this.tip = scene.add.container(0, 0).setDepth(133).setScrollFactor(0).setVisible(false);
    this.tipBg = scene.add.rectangle(0, 0, 10, 10, 0x05070d, 0.97).setStrokeStyle(1, 0x4a5680).setOrigin(0, 0).setScrollFactor(0);
    this.tipText = scene.add.text(0, 0, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#e6e9f2', lineSpacing: 2 }).setOrigin(0, 0).setScrollFactor(0);
    this.tip.add(this.tipBg); this.tip.add(this.tipText);
  }

  toggle() { this.open ? this.close() : this.show(); }
  show() { this.open = true; this.panel.setVisible(true); this.dyn.setVisible(true); this.refresh(); }
  close() { this.open = false; this.panel.setVisible(false); this.dyn.setVisible(false); this.tip.setVisible(false); }

  // True if a screen point is over the panel (so the scene can swallow the click).
  contains(x, y) {
    return this.open && Math.abs(x - this.cx) <= this.W / 2 && Math.abs(y - this.cy) <= this.H / 2;
  }

  showTip(item, x, y) {
    if (!item) return;
    const base = ITEM_BASES[item.base] || {};
    const model = this.getModel();
    const lines = [item.name, `${SLOT_LABEL[item.slot] || item.slot} · ilvl ${item.ilvl}`, ''];
    for (const k of STAT_KEYS) if (item.stats[k]) lines.push(`+${item.stats[k]} ${k}`);
    // Compare against whatever is equipped in that slot.
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
    this.tipText.setColor('#e6e9f2');
    this.tipBg.width = this.tipText.width + 16;
    this.tipBg.height = this.tipText.height + 12;
    let px = x + 14, py = y + 10;
    if (px + this.tipBg.width > CONFIG.width) px = x - this.tipBg.width - 14;
    if (py + this.tipBg.height > CONFIG.height) py = CONFIG.height - this.tipBg.height - 6;
    this.tipBg.setPosition(px, py); this.tipText.setPosition(px + 8, py + 6);
    this.tip.setVisible(true);
  }
  hideTip() { this.tip.setVisible(false); }

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

    // --- Equipped slots (click to unequip) ---
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = top + 12 + i * 38;
      add(s.add.rectangle(cx - 230, y, 196, 32, 0x191d2e, 0.95).setStrokeStyle(1, 0x333a52).setScrollFactor(0));
      mkText(cx - 322, y - 7, SLOT_LABEL[slot], '#7f8aa8', 10);
      const it = gear[slot];
      if (it) {
        const t = mkText(cx - 322, y + 7, this._clip(it.name, 22), rarityColor(it.rarity), 12);
        t.setInteractive({ useHandCursor: true });
        t.on('pointerover', (p) => this.showTip(it, p.x, p.y));
        t.on('pointerout', () => this.hideTip());
        t.on('pointerdown', () => { this.onUnequip(slot); this.hideTip(); });
      } else {
        mkText(cx - 322, y + 7, '— empty —', '#5a6178', 12);
      }
    });

    // --- Backpack (two columns; click to equip) ---
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
      t.on('pointerover', (p) => this.showTip(it, p.x, p.y));
      t.on('pointerout', () => this.hideTip());
      t.on('pointerdown', () => { if (usable) { this.onEquip(it.id); this.hideTip(); } });
    });
    if (inv.length === 0) mkText(cx - 124, top + 6, 'Backpack is empty. Kill mobs for loot.', '#5a6178', 11);
    mkText(cx - 128, cy + this.H / 2 - 36, `${inv.length} item(s)`, '#7f8aa8', 11);

    // --- Stats (base + gear = total) ---
    STAT_KEYS.forEach((k, i) => {
      const y = top + 12 + i * 34;
      const b = base[k] || 0, g = gb[k] || 0;
      mkText(cx + 168, y, k, '#c9d2e6', 13);
      const gearStr = g > 0 ? `+${g}` : '0';
      mkText(cx + 318, y, `${b} ${g > 0 ? '+' + g : ''} = ${b + g}`, g > 0 ? '#7CFC9A' : '#9aa3bd', 12, 1);
      mkText(cx + 168, y + 13, STAT_DESC[k], '#5a6178', 9);
    });
    if (m.statPoints > 0) mkText(cx + 168, top + 12 + 5 * 34 + 6, `${m.statPoints} unspent point(s) — press C`, '#ffd24a', 11);
  }

  _clip(str, n) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }

  destroy() { this.panel.destroy(); this.dyn.destroy(); this.tip.destroy(); }
}
