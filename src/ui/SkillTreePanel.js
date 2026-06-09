import { CONFIG } from '../config.js';
import { treeFor, nodeStatus, availablePoints, buildFromTree, effectiveSkill } from '../skilltree.js';
import { CLASSES } from '../classes/classes.js';

// Skill-tree page, shared by Solo (GameScene) and Online (OnlineScene). Pure
// view: the scene supplies a model via getModel() and performs spend/respec
// through callbacks (locally in solo; over the network in online, where the
// server validates). Toggle with the skills key or button.
//
//   new SkillTreePanel(scene, {
//     getModel: () => ({ classKey, level, alloc }),   // alloc = { nodeId: rank }
//     onSpend:  (nodeId) => {...},
//     onRespec: () => {...},
//   })
//
// Click an unlocked node to spend a point. Maxed = gold, allocated = green,
// available = blue, locked = grey. Works the same on mouse and touch.

const NODE_W = 150, NODE_H = 50;
const COLORS = { maxed: 0x7a5a1e, alloc: 0x2a6e3a, avail: 0x2a4a7e, locked: 0x24283a };
const STROKE = { maxed: 0xffd24a, alloc: 0x4ad06a, avail: 0x5a9bff, locked: 0x3a4156 };

export default class SkillTreePanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.getModel = opts.getModel || (() => ({}));
    this.onSpend = opts.onSpend || (() => {});
    this.onRespec = opts.onRespec || (() => {});
    this.open = false;

    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    this.cx = cx; this.cy = cy;
    this.W = 760; this.H = 540;

    const panel = scene.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    this.panel = panel;
    const bg = scene.add.rectangle(cx, cy, this.W, this.H, 0x10131f, 0.98).setStrokeStyle(2, 0x3a4366).setScrollFactor(0).setInteractive();
    bg.on('pointerdown', () => this.hideTip());
    panel.add(bg);
    this.title = scene.add.text(cx, cy - this.H / 2 + 18, 'Skill Tree', { fontFamily: 'Segoe UI', fontSize: '17px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5).setScrollFactor(0);
    panel.add(this.title);
    panel.add(scene.add.text(cx, cy + this.H / 2 - 16, 'Tap an unlocked node to spend a point · gold=maxed green=ranked blue=ready grey=locked', { fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad' }).setOrigin(0.5).setScrollFactor(0));

    // Close (✕) button.
    const closeBg = scene.add.rectangle(cx + this.W / 2 - 20, cy - this.H / 2 + 18, 28, 28, 0x3a2030, 0.95).setStrokeStyle(1, 0xff7a7a).setScrollFactor(0).setInteractive();
    closeBg.on('pointerdown', () => this.close());
    panel.add(closeBg);
    panel.add(scene.add.text(cx + this.W / 2 - 20, cy - this.H / 2 + 17, '✕', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#ff9a9a' }).setOrigin(0.5).setScrollFactor(0));

    // Respec button.
    const rsBg = scene.add.rectangle(cx - this.W / 2 + 70, cy - this.H / 2 + 18, 110, 26, 0x3a2a4e, 0.95).setStrokeStyle(1, 0xb07cff).setScrollFactor(0).setInteractive();
    rsBg.on('pointerdown', () => { this.onRespec(); this.hideTip(); this.refresh(); });
    panel.add(rsBg);
    panel.add(scene.add.text(cx - this.W / 2 + 70, cy - this.H / 2 + 17, '↺ Respec', { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#e2cfff' }).setOrigin(0.5).setScrollFactor(0));

    this.lineGfx = scene.add.graphics().setDepth(130).setScrollFactor(0).setVisible(false);
    this.dyn = scene.add.container(0, 0).setDepth(131).setScrollFactor(0).setVisible(false);

    // Details popup.
    this.tip = scene.add.container(0, 0).setDepth(133).setScrollFactor(0).setVisible(false);
    this.tipBg = scene.add.rectangle(0, 0, 10, 10, 0x05070d, 0.98).setStrokeStyle(1, 0x4a5680).setOrigin(0, 0).setScrollFactor(0);
    this.tipText = scene.add.text(0, 0, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#e6e9f2', lineSpacing: 2 }).setOrigin(0, 0).setScrollFactor(0);
    this.tip.add(this.tipBg); this.tip.add(this.tipText);
  }

  toggle() { this.open ? this.close() : this.show(); }
  show() { this.open = true; this.panel.setVisible(true); this.dyn.setVisible(true); this.lineGfx.setVisible(true); this.refresh(); }
  close() { this.open = false; this.panel.setVisible(false); this.dyn.setVisible(false); this.lineGfx.setVisible(false); this.hideTip(); }
  contains(x, y) { return this.open && Math.abs(x - this.cx) <= this.W / 2 && Math.abs(y - this.cy) <= this.H / 2; }

  // Layout: a 3-column x 4-row grid centered in the panel.
  nodePos(col, row) {
    const x = this.cx + (col - 1) * 230;
    const y = this.cy - 150 + row * 95;
    return { x, y };
  }

  refresh() {
    if (!this.open) return;
    const s = this.scene, m = this.getModel();
    const classKey = m.classKey, level = m.level || 1, alloc = m.alloc || {};
    const tree = treeFor(classKey);
    const classDef = CLASSES[classKey];
    const build = buildFromTree(classKey, alloc);
    this.dyn.removeAll(true);
    const g = this.lineGfx; g.clear();

    const avail = availablePoints(classKey, level, alloc);
    this.title.setText(`Skill Tree — ${classDef ? classDef.name : ''}   ·   ${avail} point(s) available`);

    // Prereq connector lines first (under the nodes).
    for (const n of tree) {
      const a = this.nodePos(n.col, n.row);
      for (const reqId of n.requires) {
        const rn = tree.find((x) => x.id === reqId); if (!rn) continue;
        const b = this.nodePos(rn.col, rn.row);
        const on = (alloc[reqId] || 0) >= 1;
        g.lineStyle(3, on ? 0x4ad06a : 0x3a4156, on ? 0.8 : 0.5);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }

    const add = (o) => { this.dyn.add(o); return o; };
    for (const n of tree) {
      const { x, y } = this.nodePos(n.col, n.row);
      const rank = alloc[n.id] || 0;
      const st = nodeStatus(classKey, alloc, level, n.id);
      const state = rank >= n.max ? 'maxed' : rank > 0 ? 'alloc' : st.ok ? 'avail' : 'locked';
      const rect = add(s.add.rectangle(x, y, NODE_W, NODE_H, COLORS[state], 0.96).setStrokeStyle(2, STROKE[state]).setScrollFactor(0).setInteractive({ useHandCursor: true }));
      add(s.add.text(x, y - 9, n.name, { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#fff', align: 'center', wordWrap: { width: NODE_W - 10 } }).setOrigin(0.5).setScrollFactor(0));
      add(s.add.text(x, y + 13, `${rank}/${n.max}`, { fontFamily: 'Consolas, monospace', fontSize: '11px', color: state === 'maxed' ? '#ffd24a' : '#bcc6e0' }).setOrigin(0.5).setScrollFactor(0));
      rect.on('pointerdown', (p) => {
        if (nodeStatus(classKey, alloc, level, n.id).ok) { this.onSpend(n.id); this.hideTip(); this.refresh(); }
        else this.showTip(n, build, classDef, p.x, p.y, nodeStatus(classKey, alloc, level, n.id).reason);
      });
      rect.on('pointerover', (p) => this.showTip(n, build, classDef, x + NODE_W / 2, y, st.ok ? '' : st.reason));
    }
  }

  showTip(n, build, classDef, x, y, reason) {
    const lines = [n.name, n.desc];
    if (n.effect && n.effect.kind === 'unlock') {
      const eff = effectiveSkill(classDef, n.effect.slot, build);
      lines.push('', `Unlocks: ${eff.name}`);
    }
    if (reason) lines.push('', `(${reason})`);
    this.tipText.setText(lines.join('\n'));
    const w = this.tipText.width + 16, h = this.tipText.height + 12;
    let px = x + 12, py = y + 8;
    if (px + w > CONFIG.width) px = x - w - 12;
    if (px < 0) px = 4;
    if (py + h > CONFIG.height) py = CONFIG.height - h - 6;
    this.tipBg.width = w; this.tipBg.height = h; this.tipBg.setPosition(px, py);
    this.tipText.setPosition(px + 8, py + 6);
    this.tip.setVisible(true);
  }
  hideTip() { this.tip.setVisible(false); }

  destroy() { this.panel.destroy(); this.dyn.destroy(); this.lineGfx.destroy(); this.tip.destroy(); }
}
