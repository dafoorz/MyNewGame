import { CONFIG } from '../config.js';
import { CLASSES } from '../classes/classes.js';
import { Stats } from '../stats.js';
import HealthBar from '../ui/HealthBar.js';

// Networked co-op scene. The server is authoritative — this scene sends input
// and renders snapshots. It deliberately reuses none of GameScene's local
// simulation so solo play stays untouched.

const INPUT_HZ = 20;

export default class OnlineScene extends Phaser.Scene {
  constructor() { super('OnlineScene'); }

  create(data) {
    this.net = data.net;
    this.classKey = data.classKey;
    this.classDef = CLASSES[this.classKey];
    this.skills = this.classDef.skills;
    this.isTouch = this.sys.game.device.input.touch || 'ontouchstart' in window;
    this.autoAim = false;

    const moveStats = new Stats(this.classDef.stats);
    this.moveSpeed = moveStats.moveSpeed;

    // World bounds come from the lair zone (server uses the same data).
    this.bounds = { w: 1100, h: 800 };
    this.cameras.main.setBounds(0, 0, this.bounds.w, this.bounds.h);
    this.drawBackground();

    this.entities = new Map();   // id -> render bundle
    this.localPos = null;        // predicted local position
    this.projGfx = this.add.graphics().setDepth(7);
    this.bossGfx = this.add.graphics().setDepth(9);
    this.telegraphGfx = this.add.graphics().setDepth(5);
    this.bossHpBar = new HealthBar(this, CONFIG.width / 2, 40, 620, 22, { depth: 60, fixed: true });
    this.bossNameText = this.add.text(CONFIG.width / 2, 18, '', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '15px', color: '#ffd24a', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(61).setScrollFactor(0);

    this.setupInput();
    this.buildHud();
    this.buildTouchControls();

    this.inputAcc = 0;
    this.move = { x: 0, y: 0 };
  }

  drawBackground() {
    const g = this.add.graphics().setDepth(-1);
    g.fillStyle(0x1c0f12, 1); g.fillRect(0, 0, this.bounds.w, this.bounds.h);
    g.lineStyle(6, 0x3a1a1f, 1); g.strokeRect(3, 3, this.bounds.w - 6, this.bounds.h - 6);
    g.lineStyle(1, 0x3a1a1f, 0.4);
    for (let x = 80; x < this.bounds.w; x += 80) g.lineBetween(x, 0, x, this.bounds.h);
    for (let y = 80; y < this.bounds.h; y += 80) g.lineBetween(0, y, this.bounds.w, y);
  }

  // ----------------------------------------------------------------- input ---
  setupInput() {
    this.keys = this.input.keyboard.addKeys('W,A,S,D');
    this.input.addPointer(2);
    this.joy = { active: false, id: -1, baseX: 0, baseY: 0 };

    this.input.on('pointerdown', (p) => {
      if (this.isOverUI(p)) return;
      if (this.isTouch) { if (p.x < CONFIG.width * 0.5) this.startJoystick(p); }
      else if (p.button === 0) this.net.sendBasic();
    });
    this.input.on('pointermove', (p) => { if (this.joy.active && p.id === this.joy.id) this.updateJoystick(p); });
    const release = (p) => { if (this.joy.active && p.id === this.joy.id) this.endJoystick(); };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    for (const n of ['ONE', 'TWO', 'THREE', 'FOUR']) {
      const slot = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4 }[n];
      this.input.keyboard.on('keydown-' + n, () => this.net.sendCast(slot));
    }
  }

  isOverUI(p) {
    if (this.skillBoxes) for (const sb of this.skillBoxes)
      if (Math.abs(p.x - sb.x) <= sb.boxW / 2 && Math.abs(p.y - sb.y) <= sb.boxW / 2) return true;
    if (this.attackBtn && Math.hypot(p.x - this.attackBtn.x, p.y - this.attackBtn.y) <= this.attackBtn.r) return true;
    if (this.aimBtn && Math.hypot(p.x - this.aimBtn.x, p.y - this.aimBtn.y) <= this.aimBtn.r) return true;
    return false;
  }

  startJoystick(p) {
    this.joy.active = true; this.joy.id = p.id; this.joy.baseX = p.x; this.joy.baseY = p.y;
    this.move.x = 0; this.move.y = 0;
    this.joyBase.setPosition(p.x, p.y).setVisible(true);
    this.joyThumb.setPosition(p.x, p.y).setVisible(true);
  }
  updateJoystick(p) {
    const max = 60; let dx = p.x - this.joy.baseX, dy = p.y - this.joy.baseY;
    const r = Math.hypot(dx, dy); if (r > max) { dx = (dx / r) * max; dy = (dy / r) * max; }
    this.joyThumb.setPosition(this.joy.baseX + dx, this.joy.baseY + dy);
    if (Math.hypot(dx, dy) > 8) { this.move.x = dx / max; this.move.y = dy / max; }
    else { this.move.x = 0; this.move.y = 0; }
  }
  endJoystick() {
    this.joy.active = false; this.joy.id = -1; this.move.x = 0; this.move.y = 0;
    this.joyBase.setVisible(false); this.joyThumb.setVisible(false);
  }

  // ---------------------------------------------------------------- update ---
  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    const snap = this.net.snapshot;
    if (!snap) return;

    const me = snap.players.find((p) => p.id === this.net.youId);
    if (me && !this.localPos) this.localPos = { x: me.x, y: me.y };

    // Movement intent (keyboard or joystick).
    let mx = 0, my = 0;
    if (this.joy.active) { mx = this.move.x; my = this.move.y; }
    else {
      if (this.keys.A.isDown) mx -= 1; if (this.keys.D.isDown) mx += 1;
      if (this.keys.W.isDown) my -= 1; if (this.keys.S.isDown) my += 1;
      const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    }

    // Local prediction + reconciliation so movement feels instant.
    if (this.localPos && me && me.alive) {
      this.localPos.x += mx * this.moveSpeed * dt;
      this.localPos.y += my * this.moveSpeed * dt;
      this.localPos.x = Phaser.Math.Clamp(this.localPos.x, 16, this.bounds.w - 16);
      this.localPos.y = Phaser.Math.Clamp(this.localPos.y, 16, this.bounds.h - 16);
      this.localPos.x += (me.x - this.localPos.x) * 0.12;
      this.localPos.y += (me.y - this.localPos.y) * 0.12;
    } else if (me) {
      this.localPos = { x: me.x, y: me.y };
    }

    // Facing.
    const px = this.localPos ? this.localPos.x : (me ? me.x : 0);
    const py = this.localPos ? this.localPos.y : (me ? me.y : 0);
    if (this.autoAim && snap.boss && snap.boss.alive) {
      this.facing = Math.atan2(snap.boss.y - py, snap.boss.x - px);
    } else if (this.isTouch) {
      if (this.joy.active && (mx !== 0 || my !== 0)) this.facing = Math.atan2(my, mx);
    } else {
      const ptr = this.input.activePointer;
      this.facing = Math.atan2(ptr.worldY - py, ptr.worldX - px);
    }
    if (this.facing == null) this.facing = -Math.PI / 2;

    // Throttled input send.
    this.inputAcc += dt;
    if (this.inputAcc >= 1 / INPUT_HZ) { this.inputAcc = 0; this.net.sendInput(mx, my, this.facing); }

    this.renderPlayers(snap, me);
    this.renderBoss(snap.boss);
    this.renderProjectiles(snap.projectiles);
    this.consumeFx(snap.fx);
    this.updateHud(snap, me);

    if (this.localPos) {
      const cam = this.cameras.main;
      cam.scrollX += (this.localPos.x - cam.width / 2 - cam.scrollX) * 0.15;
      cam.scrollY += (this.localPos.y - cam.height / 2 - cam.scrollY) * 0.15;
    }
  }

  // --------------------------------------------------------------- rendering -
  ensureEntity(id, classKey) {
    let e = this.entities.get(id);
    if (!e) {
      const color = CLASSES[classKey] ? CLASSES[classKey].color : 0xffffff;
      e = {
        color,
        gfx: this.add.graphics().setDepth(10),
        label: this.add.text(0, 0, '', { fontFamily: 'Segoe UI', fontSize: '12px', color: '#fff' }).setOrigin(0.5).setDepth(11),
        hpBar: new HealthBar(this, 0, 0, 46, 6, { depth: 11 }),
        rx: 0, ry: 0, init: false,
      };
      this.entities.set(id, e);
    }
    return e;
  }

  renderPlayers(snap, me) {
    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.id);
      const e = this.ensureEntity(p.id, p.classKey);
      const isMe = p.id === this.net.youId;
      const tx = isMe && this.localPos ? this.localPos.x : p.x;
      const ty = isMe && this.localPos ? this.localPos.y : p.y;
      if (!e.init) { e.rx = tx; e.ry = ty; e.init = true; }
      e.rx += (tx - e.rx) * (isMe ? 1 : 0.25);
      e.ry += (ty - e.ry) * (isMe ? 1 : 0.25);
      const facing = isMe ? this.facing : p.facing;

      const g = e.gfx; g.clear();
      if (!p.alive) {
        g.fillStyle(0x444a5e, 0.8); g.fillCircle(e.rx, e.ry, 16);
        e.label.setText(p.name + ' (down)');
      } else {
        g.fillStyle(isMe ? e.color : e.color, 1); g.fillCircle(e.rx, e.ry, 16);
        if (p.buff) { g.lineStyle(2, 0xffe066, 0.7); g.strokeCircle(e.rx, e.ry, 25); }
        g.lineStyle(2, isMe ? 0xffffff : 0xbfc8e0, 0.9); g.strokeCircle(e.rx, e.ry, 16);
        if (p.shield) { g.lineStyle(3, 0x66ccff, 0.9); g.strokeCircle(e.rx, e.ry, 22); }
        g.lineStyle(4, 0xffffff, 1);
        g.beginPath(); g.moveTo(e.rx, e.ry);
        g.lineTo(e.rx + Math.cos(facing) * 28, e.ry + Math.sin(facing) * 28); g.strokePath();
        e.label.setText(isMe ? p.name + ' (you)' : p.name);
      }
      e.label.setPosition(e.rx, e.ry - 42);
      e.hpBar.setPosition(e.rx, e.ry - 28);
      e.hpBar.setValue(p.hp / p.maxHp);
    }
    // Drop entities that left.
    for (const [id, e] of this.entities) {
      if (!seen.has(id)) { e.gfx.destroy(); e.label.destroy(); e.hpBar.destroy(); this.entities.delete(id); }
    }
  }

  renderBoss(b) {
    const g = this.bossGfx; g.clear();
    const tg = this.telegraphGfx; tg.clear();
    if (!b) { this.bossHpBar.setVisible(false); return; }
    this.bossHpBar.setVisible(true);
    this.bossNameText.setText(b.name);
    this.bossHpBar.setValue(b.hp / b.maxHp);

    if (b.alive) {
      g.fillStyle(CONFIG.colors.boss, 1); g.fillCircle(b.x, b.y, 46);
      g.lineStyle(3, 0x000000, 0.4); g.strokeCircle(b.x, b.y, 46);
      g.fillStyle(0xffd24a, 1);
      g.fillCircle(b.x + Math.cos(b.facing) * 50, b.y + Math.sin(b.facing) * 50, 8);
    }

    if (b.telegraph) {
      const t = b.telegraph;
      const alpha = 0.25 + t.progress * 0.4;
      tg.fillStyle(CONFIG.colors.telegraph, alpha);
      tg.lineStyle(3, CONFIG.colors.telegraph, 0.9);
      if (t.type === 'cleave') {
        const steps = 24, start = t.facing - t.halfAngle, end = t.facing + t.halfAngle;
        tg.beginPath(); tg.moveTo(t.x, t.y);
        for (let i = 0; i <= steps; i++) { const a = start + ((end - start) * i) / steps; tg.lineTo(t.x + Math.cos(a) * t.range, t.y + Math.sin(a) * t.range); }
        tg.closePath(); tg.fillPath(); tg.strokePath();
      } else {
        tg.fillCircle(t.x, t.y, t.radius); tg.strokeCircle(t.x, t.y, t.radius);
      }
    }
  }

  renderProjectiles(list) {
    const g = this.projGfx; g.clear();
    if (!list) return;
    for (const pr of list) { g.fillStyle(pr.color, 1); g.fillCircle(pr.x, pr.y, pr.r); }
  }

  consumeFx(fx) {
    if (!fx) return;
    for (const f of fx) {
      if (f.t === 'dmg') this.spawnText(f.x, f.y - 4, f.amount, f.enemy ? '#ff6b6b' : (f.crit ? '#ffe066' : '#ffffff'), f.crit);
      else if (f.t === 'heal') this.spawnText(f.x, f.y, '+' + f.amount, '#7CFC9A');
      else if (f.t === 'text') this.spawnText(f.x, f.y, f.msg, f.color, f.big);
      else if (f.t === 'arc') this.spawnArc(f.x, f.y, f.facing, f.range, f.half);
      else if (f.t === 'ring') this.spawnRing(f.x, f.y, f.radius, f.color);
      else if (f.t === 'blast') this.spawnBlast(f.x, f.y, f.radius, f.color);
    }
  }

  // -------------------------------------------------------------------- HUD --
  buildHud() {
    this.partyText = this.add.text(14, 14, '', {
      fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#cdd6ee', lineSpacing: 3, stroke: '#000', strokeThickness: 3,
    }).setDepth(60).setScrollFactor(0);

    this.skillBoxes = [];
    const boxW = 60, gap = 10;
    const totalW = this.skills.length * boxW + (this.skills.length - 1) * gap;
    const startX = CONFIG.width / 2 - totalW / 2;
    const y = CONFIG.height - 56;
    this.skills.forEach((def, i) => {
      const slot = i + 1;
      const x = startX + i * (boxW + gap) + boxW / 2;
      const box = this.add.rectangle(x, y, boxW, boxW, 0x1c2138, 0.95).setStrokeStyle(2, 0x3a4366).setDepth(60).setScrollFactor(0).setInteractive();
      box.on('pointerdown', () => this.net.sendCast(slot));
      this.add.text(x - boxW / 2 + 5, y - boxW / 2 + 3, def.key, { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#fff' }).setDepth(62).setScrollFactor(0);
      this.add.text(x, y + boxW / 2 - 11, def.name, { fontFamily: 'Segoe UI', fontSize: '8px', color: def.color, align: 'center', wordWrap: { width: boxW - 4 } }).setOrigin(0.5).setDepth(62).setScrollFactor(0);
      const overlay = this.add.rectangle(x, y + boxW / 2, boxW, boxW, 0x000000, 0.65).setOrigin(0.5, 1).setDepth(61).setScrollFactor(0);
      overlay.height = 0;
      this.skillBoxes.push({ slot, def, overlay, boxW, x, y });
    });
  }

  buildTouchControls() {
    this.joyBase = this.add.circle(0, 0, 60, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.25).setDepth(70).setScrollFactor(0).setVisible(false);
    this.joyThumb = this.add.circle(0, 0, 26, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.5).setDepth(71).setScrollFactor(0).setVisible(false);

    const aimX = CONFIG.width - 44, aimY = 30;
    const aimBg = this.add.circle(aimX, aimY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x6cd0ff, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.aimText = this.add.text(aimX, aimY, 'AIM', { fontFamily: 'Segoe UI', fontSize: '10px', fontStyle: 'bold', color: '#6cd0ff' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    aimBg.on('pointerdown', () => { this.autoAim = !this.autoAim; this.aimText.setText(this.autoAim ? 'AUTO' : 'AIM').setColor(this.autoAim ? '#ffe066' : '#6cd0ff'); });
    this.aimBtn = { x: aimX, y: aimY, r: 22 };

    if (!this.isTouch) return;
    const ax = CONFIG.width - 80, ay = CONFIG.height - 96;
    const btn = this.add.circle(ax, ay, 46, this.classDef.color, 0.9).setStrokeStyle(3, 0xffffff, 0.85).setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(ax, ay, 'ATK', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    btn.on('pointerdown', () => this.net.sendBasic());
    this.attackBtn = { x: ax, y: ay, r: 46 };
  }

  updateHud(snap, me) {
    const lines = [`Party ${this.net.code}   (${snap.players.length})`];
    for (const p of snap.players) {
      const cls = CLASSES[p.classKey] ? CLASSES[p.classKey].name : '?';
      lines.push(`${p.id === this.net.youId ? '>' : ' '} ${p.name} [${cls}]  ${Math.ceil(p.hp)}/${p.maxHp}`);
    }
    this.partyText.setText(lines.join('\n'));

    if (me) for (const sb of this.skillBoxes) sb.overlay.height = sb.boxW * Phaser.Math.Clamp((me.cd[sb.slot] || 0) / sb.def.cd, 0, 1);
  }

  // ------------------------------------------------------------------- fx ----
  spawnText(x, y, value, color = '#ffffff', big = false) {
    const txt = this.add.text(x, y, String(value), {
      fontFamily: 'Segoe UI', fontSize: big ? '20px' : '14px', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(80);
    this.tweens.add({ targets: txt, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
  }
  spawnArc(cx, cy, facing, range, half) {
    const gfx = this.add.graphics().setDepth(15); let t = 0;
    const ev = this.time.addEvent({ delay: 14, loop: true, callback: () => {
      t += 14; gfx.clear(); gfx.lineStyle(5, 0xffeedd, (1 - t / 170) * 0.9); gfx.beginPath();
      const steps = 12; for (let i = 0; i <= steps; i++) { const a = facing - half + (half * 2 * i) / steps; const px = cx + Math.cos(a) * range, py = cy + Math.sin(a) * range; i === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py); }
      gfx.strokePath(); if (t >= 170) { gfx.destroy(); ev.remove(); }
    } });
  }
  spawnRing(x, y, radius, colorHex) {
    const color = this.hexToInt(colorHex, 0xc89bff); const fx = this.add.graphics().setDepth(12); let t = 0;
    const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => { t += 16; fx.clear(); fx.lineStyle(4, color, Phaser.Math.Clamp(1 - t / 300, 0, 1)); fx.strokeCircle(x, y, radius * (t / 300)); if (t >= 300) { fx.destroy(); ev.remove(); } } });
  }
  spawnBlast(x, y, radius, colorHex) {
    const color = this.hexToInt(colorHex, 0xff7a3c); const fx = this.add.graphics().setDepth(12); let t = 0;
    const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => { t += 16; const p = t / 280; fx.clear(); fx.fillStyle(color, (1 - p) * 0.5); fx.fillCircle(x, y, radius * Math.min(1, p * 1.2)); fx.lineStyle(3, color, 1 - p); fx.strokeCircle(x, y, radius); if (t >= 280) { fx.destroy(); ev.remove(); } } });
  }
  hexToInt(hex, fallback) {
    if (typeof hex === 'number') return hex;
    if (typeof hex === 'string' && hex[0] === '#') return parseInt(hex.slice(1), 16);
    return fallback;
  }
}
