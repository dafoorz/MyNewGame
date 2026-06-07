import { CONFIG } from '../config.js';
import HealthBar from '../ui/HealthBar.js';
import BossCore from '../world/BossCore.js';
import { DEFAULT_BOSS } from '../world/bosses.js';

// Solo boss: a thin Phaser renderer around the shared, data-driven BossCore
// (src/world/BossCore.js + bosses.js). The core runs the whole state machine
// (cleave / aoe / charge / summon / safezone + enrage); this class only draws it
// and owns the HUD. GameScene feeds it a per-frame adapter via update().

export default class Boss {
  constructor(scene, x, y, opts = {}) {
    this.scene = scene;
    const bounds = opts.bounds ?? CONFIG.arena;
    this.core = new BossCore(opts.bossKey || DEFAULT_BOSS, bounds);
    if (typeof x === 'number') this.core.x = x;
    if (typeof y === 'number') this.core.y = y;

    // DPS meter: damage taken per source + when the fight started (first hit).
    this.dmgBySource = new Map();
    this.combatStart = 0;

    this.telegraphGfx = scene.add.graphics().setDepth(5);
    this.gfx = scene.add.graphics().setDepth(9);

    this.hpBar = new HealthBar(scene, CONFIG.width / 2, 40, 620, 22, { depth: 60, fixed: true });
    this.hpText = scene.add.text(CONFIG.width / 2, 40, '', { fontFamily: 'Segoe UI, sans-serif', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.nameText = scene.add.text(CONFIG.width / 2, 18, this.name, { fontFamily: 'Segoe UI, sans-serif', fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.dpsText = scene.add.text(CONFIG.width / 2, 56, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#ff9a5a', fontStyle: 'bold', align: 'center', lineSpacing: 2, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(61).setScrollFactor(0);
  }

  // --- expose core state so existing GameScene code (enemies(), aim, etc.) works ---
  get x() { return this.core.x; }
  get y() { return this.core.y; }
  get radius() { return this.core.radius; }
  get alive() { return this.core.alive; }
  get hp() { return this.core.hp; }
  get maxHp() { return this.core.maxHp; }
  get name() { return this.core.name; }
  get cfg() { return this.core.cfg; }
  get telegraph() { return this.core.telegraph; }

  takeDamage(amount, source = 'You') {
    if (!this.core.alive) return;
    if (this.combatStart === 0) this.combatStart = this.scene.time.now;
    this.dmgBySource.set(source, (this.dmgBySource.get(source) || 0) + amount);
    this.core.takeDamage(amount);
  }

  update(dt, adapter) {
    this.core.update(dt, adapter);
    this.draw();
    this.drawTelegraph();
    this.updateHud();
  }

  draw() {
    const g = this.gfx;
    g.clear();
    if (!this.core.alive) return;
    const c = this.core;
    g.fillStyle(c.color, 1);
    g.fillCircle(c.x, c.y, c.radius);
    g.lineStyle(c.enraged ? 4 : 3, c.enraged ? 0xff3a3a : 0x000000, c.enraged ? 0.9 : 0.4);
    g.strokeCircle(c.x, c.y, c.radius);
    // "Front" marker so players can read which way the cleave/charge will go.
    const fx = c.x + Math.cos(c.facing) * (c.radius + 4);
    const fy = c.y + Math.sin(c.facing) * (c.radius + 4);
    g.fillStyle(0xffd24a, 1);
    g.fillCircle(fx, fy, 8);
  }

  drawTelegraph() {
    const g = this.telegraphGfx;
    g.clear();
    const t = this.core.telegraph;
    if (!t || this.core.state !== 'windup') return;
    drawTelegraph(g, t, this.core.progress());
  }

  updateHud() {
    const c = this.core;
    this.hpBar.setValue(c.hp / c.maxHp);
    this.hpText.setText(`${Math.ceil(c.hp)} / ${c.maxHp}`);
    this.nameText.setText(c.enraged ? `${c.name}  [ENRAGED]` : c.name);
    if (this.combatStart > 0) {
      const elapsed = (this.scene.time.now - this.combatStart) / 1000;
      const rows = [...this.dmgBySource.entries()]
        .map(([name, dmg]) => ({ name, dps: elapsed > 0.5 ? Math.round(dmg / elapsed) : 0 }))
        .sort((a, b) => b.dps - a.dps);
      this.dpsText.setText(rows.map((r) => `${r.name}: ${r.dps.toLocaleString()} dps`).join('\n'));
    }
  }

  destroy() {
    this.telegraphGfx.destroy();
    this.gfx.destroy();
    this.hpBar.destroy();
    this.hpText.destroy();
    this.nameText.destroy();
    this.dpsText.destroy();
  }
}

// Shared telegraph renderer (Phaser graphics). Used by the solo boss; OnlineScene
// has an equivalent inline for snapshot-driven rendering.
export function drawTelegraph(g, t, progress) {
  const alpha = 0.25 + (progress || 0) * 0.4;
  const C = CONFIG.colors.telegraph;
  if (t.type === 'cleave') {
    const steps = 24, start = t.facing - t.halfAngle, end = t.facing + t.halfAngle;
    g.fillStyle(C, alpha); g.lineStyle(3, C, 0.9);
    g.beginPath(); g.moveTo(t.x, t.y);
    for (let i = 0; i <= steps; i++) { const a = start + ((end - start) * i) / steps; g.lineTo(t.x + Math.cos(a) * t.range, t.y + Math.sin(a) * t.range); }
    g.closePath(); g.fillPath(); g.strokePath();
  } else if (t.type === 'aoe') {
    g.fillStyle(C, alpha); g.lineStyle(3, C, 0.9);
    g.fillCircle(t.x, t.y, t.radius); g.strokeCircle(t.x, t.y, t.radius);
  } else if (t.type === 'charge') {
    const dx = Math.cos(t.facing), dy = Math.sin(t.facing), px = -dy, py = dx, hw = t.width / 2;
    const ex = t.x + dx * t.length, ey = t.y + dy * t.length;
    g.fillStyle(C, alpha); g.lineStyle(3, C, 0.9);
    g.beginPath();
    g.moveTo(t.x + px * hw, t.y + py * hw);
    g.lineTo(ex + px * hw, ey + py * hw);
    g.lineTo(ex - px * hw, ey - py * hw);
    g.lineTo(t.x - px * hw, t.y - py * hw);
    g.closePath(); g.fillPath(); g.strokePath();
  } else if (t.type === 'summon') {
    g.lineStyle(3, 0xc06cff, 0.9); g.fillStyle(0xc06cff, alpha * 0.6);
    g.fillCircle(t.x, t.y, t.radius); g.strokeCircle(t.x, t.y, t.radius);
  } else if (t.type === 'safezone') {
    // Whole room is dangerous except the green safe circle — get inside it!
    g.fillStyle(0xff4040, 0.18 + (progress || 0) * 0.22);
    g.fillRect(0, 0, t.bw, t.bh);
    g.fillStyle(0x4ad06a, 0.35); g.lineStyle(4, 0x7CFC9A, 0.95);
    g.fillCircle(t.x, t.y, t.radius); g.strokeCircle(t.x, t.y, t.radius);
  }
}
