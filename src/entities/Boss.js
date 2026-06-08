import { CONFIG } from '../config.js';
import HealthBar from '../ui/HealthBar.js';
import BossCore from '../world/BossCore.js';

// Rendering wrapper around the shared BossCore state machine.
// Keeps all Phaser visuals; delegates state/AI entirely to BossCore.

export default class Boss {
  constructor(scene, x, y, opts = {}) {
    this.scene = scene;
    const bossKey = opts.bossKey || 'colossus';
    const b = opts.bounds ?? CONFIG.arena;
    this.core = new BossCore(bossKey, { w: b.w, h: b.h });
    this.core.x = x;
    this.core.y = y;

    // DPS meter: damage taken per source + when the fight started (first hit).
    this.dmgBySource = new Map();
    this.combatStart = 0;

    // visuals
    this.telegraphGfx = scene.add.graphics().setDepth(5);
    this.gfx = scene.add.graphics().setDepth(9);

    // big fixed HUD bar
    this.hpBar = new HealthBar(scene, CONFIG.width / 2, 40, 620, 22, { depth: 60, fixed: true });
    this.hpText = scene.add
      .text(CONFIG.width / 2, 40, '', {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.nameText = scene.add
      .text(CONFIG.width / 2, 18, this.core.name, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '15px', color: '#ffd24a', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.dpsText = scene.add
      .text(CONFIG.width / 2, 56, '', {
        fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#ff9a5a', fontStyle: 'bold',
        align: 'center', lineSpacing: 2, stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 0).setDepth(61).setScrollFactor(0);
  }

  // --- proxy properties ---
  get x() { return this.core.x; }
  get y() { return this.core.y; }
  get alive() { return this.core.alive; }
  get name() { return this.core.name; }
  get radius() { return this.core.radius; }
  get maxHp() { return this.core.maxHp; }
  get hp() { return this.core.hp; }
  get facing() { return this.core.facing; }
  get telegraph() { return this.core.telegraph; }
  get state() { return this.core.state; }
  get cfg() { return this.core.cfg; }

  takeDamage(amount, source = 'You') {
    if (!this.core.alive) return;
    if (this.combatStart === 0) this.combatStart = this.scene.time.now;
    this.dmgBySource.set(source, (this.dmgBySource.get(source) || 0) + amount);
    this.core.takeDamage(amount);
  }

  update(dt, adapter) {
    if (!this.alive) {
      this.telegraphGfx.clear();
      this.draw();
      this.updateHud();
      return;
    }
    this.core.update(dt, adapter);
    this.draw();
    this.drawTelegraph();
    this.updateHud();
  }

  draw() {
    const g = this.gfx;
    g.clear();
    if (!this.alive) return;
    g.fillStyle(this.core.color, 1);
    g.fillCircle(this.core.x, this.core.y, this.core.radius);
    g.lineStyle(3, 0x000000, 0.4);
    g.strokeCircle(this.core.x, this.core.y, this.core.radius);
    if (this.core.enraged) {
      g.lineStyle(3, 0xff5a5a, 0.8);
      g.strokeCircle(this.core.x, this.core.y, this.core.radius + 6);
    }
    const fx = this.core.x + Math.cos(this.core.facing) * (this.core.radius + 4);
    const fy = this.core.y + Math.sin(this.core.facing) * (this.core.radius + 4);
    g.fillStyle(0xffd24a, 1);
    g.fillCircle(fx, fy, 8);
  }

  drawTelegraph() {
    const g = this.telegraphGfx;
    g.clear();
    const tg = this.core.telegraph;
    if (!tg || this.core.state !== 'windup') return;
    drawTelegraph(g, tg, this.core.progress());
  }

  updateHud() {
    this.hpBar.setValue(this.core.hp / this.core.maxHp);
    this.hpText.setText(`${Math.ceil(this.core.hp)} / ${this.core.maxHp}`);
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
  // Yellow = blockable (can be partially blocked), Red = unblockable (must dodge)
  const isBlockable = t.blockable !== false && t.type !== 'safezone';
  const C = t.type === 'summon' ? 0xc06cff : (isBlockable ? 0xffe066 : 0xff3b3b);
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
    g.fillStyle(0xff4040, 0.18 + (progress || 0) * 0.22);
    g.fillRect(0, 0, t.bw, t.bh);
    g.fillStyle(0x4ad06a, 0.35); g.lineStyle(4, 0x7CFC9A, 0.95);
    g.fillCircle(t.x, t.y, t.radius); g.strokeCircle(t.x, t.y, t.radius);
  }
}
