import { CONFIG } from '../config.js';
import { CLASSES } from '../classes/classes.js';
import { Stats } from '../stats.js';
import { ZONES } from '../world/zones.js';
import { MOB_TYPES } from '../world/zones.js';
import HealthBar from '../ui/HealthBar.js';
import { saveProgress } from '../progress.js';
import SettingsPanel from '../ui/SettingsPanel.js';
import InventoryPanel from '../ui/InventoryPanel.js';
import { rarityColor } from '../items.js';

// Networked co-op scene. The server is authoritative across ALL zones — this
// scene sends input and renders the snapshot of whatever zone the player is in.
// It reuses none of GameScene's local simulation, so solo play stays untouched.

const INPUT_HZ = 20;
const STAT_INFO = [['STR', 'melee dmg'], ['DEX', 'crit/atk spd'], ['INT', 'magic dmg'], ['VIT', 'max health'], ['AGI', 'move speed']];

export default class OnlineScene extends Phaser.Scene {
  constructor() { super('OnlineScene'); }

  create(data) {
    this.net = data.net;
    this.classKey = data.classKey;
    this.classDef = CLASSES[this.classKey];
    this.skills = this.classDef.skills;
    this.isTouch = this.sys.game.device.input.touch || 'ontouchstart' in window;
    this.autoAim = false;
    this.moveSpeed = new Stats(this.classDef.stats).moveSpeed;

    this.curZone = null;
    this.bounds = { w: 1200, h: 820 };
    this.localPos = null;
    this.me = null;

    this.zoneGfx = this.add.graphics().setDepth(-1);
    this.portalGfx = this.add.graphics().setDepth(1);
    this.projGfx = this.add.graphics().setDepth(7);
    this.bossGfx = this.add.graphics().setDepth(9);
    this.telegraphGfx = this.add.graphics().setDepth(5);
    this.portalLabels = [];

    this.players = new Map();  // id -> render bundle
    this.mobsR = new Map();    // id -> render bundle
    this.minionsR = new Map(); // id -> render bundle

    this.bossHpBar = new HealthBar(this, CONFIG.width / 2, 40, 620, 22, { depth: 60, fixed: true });
    this.bossNameText = this.add.text(CONFIG.width / 2, 18, '', { fontFamily: 'Segoe UI', fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.bossDpsText = this.add.text(CONFIG.width / 2, 56, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#ff9a5a', fontStyle: 'bold', align: 'center', lineSpacing: 2, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(61).setScrollFactor(0);

    this.setupInput();
    this.buildHud();
    this.buildTouchControls();
    this.buildCharPanel();
    this.inventory = new InventoryPanel(this, {
      getModel: () => this.me || {},
      onEquip: (itemId) => this.net.sendEquip(itemId),
      onUnequip: (slot) => this.net.sendUnequip(slot),
      onDiscard: (itemId) => this.net.sendDiscard(itemId),
    });
    this.settings = new SettingsPanel(this, {
      onMainMenu: () => { if (this.net) this.net.close(); this.scene.start('LobbyScene'); },
    });

    this.inputAcc = 0;
    this.move = { x: 0, y: 0 };
  }

  // ----------------------------------------------------------------- zones ---
  onZoneChange(key) {
    this.curZone = key;
    const z = ZONES[key];
    this.bounds = { w: z.size.w, h: z.size.h };
    this.cameras.main.setBounds(0, 0, z.size.w, z.size.h);

    const g = this.zoneGfx; g.clear();
    g.fillStyle(z.bg, 1); g.fillRect(0, 0, z.size.w, z.size.h);
    g.lineStyle(6, z.accent, 1); g.strokeRect(3, 3, z.size.w - 6, z.size.h - 6);
    g.lineStyle(1, z.accent, 0.4);
    for (let x = 80; x < z.size.w; x += 80) g.lineBetween(x, 0, x, z.size.h);
    for (let y = 80; y < z.size.h; y += 80) g.lineBetween(0, y, z.size.w, y);

    const pg = this.portalGfx; pg.clear();
    this.portalLabels.forEach((l) => l.destroy()); this.portalLabels = [];
    for (const p of z.portals) {
      pg.fillStyle(0x6cd0ff, 0.25); pg.fillCircle(p.x, p.y, 40);
      pg.lineStyle(3, 0x6cd0ff, 0.9); pg.strokeCircle(p.x, p.y, 40);
      this.portalLabels.push(this.add.text(p.x, p.y - 56, p.label, { fontFamily: 'Segoe UI', fontSize: '14px', fontStyle: 'bold', color: '#bfe9ff', stroke: '#06121c', strokeThickness: 4 }).setOrigin(0.5).setDepth(2));
    }

    // Banner.
    const t = this.add.text(CONFIG.width / 2, CONFIG.height / 2 - 120, z.name, { fontFamily: 'Segoe UI', fontSize: '34px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(110).setScrollFactor(0).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 300, yoyo: true, hold: 1100, onComplete: () => t.destroy() });

    this.localPos = null; // re-anchor to server pos after teleport
  }

  // ----------------------------------------------------------------- input ---
  setupInput() {
    this.input.addPointer(2);
    this.joy = { active: false, id: -1, baseX: 0, baseY: 0 };
    this.held = new Set();
    this.input.keyboard.addCapture('SPACE,ONE,TWO,THREE,FOUR,Q,E,C');

    this.input.on('pointerdown', (p) => {
      if (this.isOverUI(p)) return;
      if (this.isTouch) { if (p.x < CONFIG.width * 0.5) this.startJoystick(p); }
      else if (p.button === 0) this.net.sendBasic();
    });
    this.input.on('pointermove', (p) => { if (this.joy.active && p.id === this.joy.id) this.updateJoystick(p); });
    const release = (p) => { if (this.joy.active && p.id === this.joy.id) this.endJoystick(); };
    this.input.on('pointerup', release); this.input.on('pointerupoutside', release);

    this.input.keyboard.on('keydown', (e) => {
      if (this.settings && this.settings.captureKey(e)) return;
      this.held.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Escape') { if (this.settings) this.settings.toggle(); return; }
      if (this.settings && this.settings.open) return;
      switch (this.settings.actionFor(e.code)) {
        case 'attack': this.net.sendBasic(); break;
        case 'skill1': this.castSlot(1); break;
        case 'skill2': this.castSlot(2); break;
        case 'skill3': this.castSlot(3); break;
        case 'skill4': this.castSlot(4); break;
        case 'skill5': this.castSlot(5); break;
        case 'aim': this.toggleAutoAim(); break;
        case 'char': this.toggleCharPanel(); break;
        case 'inv': this.inventory.toggle(); break;
      }
    });
    this.input.keyboard.on('keyup', (e) => this.held.delete(e.code));
  }

  isOverUI(p) {
    if (this.settings && this.settings.open) return true;
    if (this.inventory && this.inventory.contains(p.x, p.y)) return true;
    if (this.charPanelOpen && Math.abs(p.x - CONFIG.width / 2) < 200) return true;
    if (this.skillBoxes) for (const sb of this.skillBoxes) if (Math.abs(p.x - sb.x) <= sb.boxW / 2 && Math.abs(p.y - sb.y) <= sb.boxW / 2) return true;
    if (this.attackBtn && Math.hypot(p.x - this.attackBtn.x, p.y - this.attackBtn.y) <= this.attackBtn.r) return true;
    if (this.charBtn && Math.hypot(p.x - this.charBtn.x, p.y - this.charBtn.y) <= this.charBtn.r) return true;
    if (this.aimBtn && Math.hypot(p.x - this.aimBtn.x, p.y - this.aimBtn.y) <= this.aimBtn.r) return true;
    if (this.settingsBtn && Math.hypot(p.x - this.settingsBtn.x, p.y - this.settingsBtn.y) <= this.settingsBtn.r) return true;
    if (this.invBtn && Math.hypot(p.x - this.invBtn.x, p.y - this.invBtn.y) <= this.invBtn.r) return true;
    return false;
  }

  startJoystick(p) { this.joy.active = true; this.joy.id = p.id; this.joy.baseX = p.x; this.joy.baseY = p.y; this.move.x = 0; this.move.y = 0; this.joyBase.setPosition(p.x, p.y).setVisible(true); this.joyThumb.setPosition(p.x, p.y).setVisible(true); }
  updateJoystick(p) { const max = 60; let dx = p.x - this.joy.baseX, dy = p.y - this.joy.baseY; const r = Math.hypot(dx, dy); if (r > max) { dx = (dx / r) * max; dy = (dy / r) * max; } this.joyThumb.setPosition(this.joy.baseX + dx, this.joy.baseY + dy); if (Math.hypot(dx, dy) > 8) { this.move.x = dx / max; this.move.y = dy / max; } else { this.move.x = 0; this.move.y = 0; } }
  endJoystick() { this.joy.active = false; this.joy.id = -1; this.move.x = 0; this.move.y = 0; this.joyBase.setVisible(false); this.joyThumb.setVisible(false); }

  // ---------------------------------------------------------------- update ---
  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    const snap = this.net.snapshot;
    if (!snap) return;
    if (snap.zoneKey !== this.curZone) this.onZoneChange(snap.zoneKey);
    this.me = snap.me;

    // Persist this class's progress on this device (throttled).
    this._saveAcc = (this._saveAcc || 0) + dt;
    if (this._saveAcc >= 2 && this.me && this.me.stats) {
      this._saveAcc = 0;
      saveProgress(this.classKey, { level: this.me.level, xp: this.me.xp, statPoints: this.me.statPoints, stats: this.me.baseStats || this.me.stats, inventory: this.me.inventory, gear: this.me.gear });
    }
    // Refresh the inventory only when its data actually changes — rebuilding the
    // rows every frame would destroy the interactive elements before a click
    // could register (clicks worked in solo, which only refreshes on change).
    if (this.inventory && this.inventory.open && this.me) {
      const sig = JSON.stringify([this.me.inventory, this.me.gear, this.me.baseStats, this.me.statPoints]);
      if (sig !== this._invSig) { this._invSig = sig; this.inventory.refresh(); }
    }

    const meEnt = snap.players.find((p) => p.id === this.net.youId);
    if (meEnt && !this.localPos) this.localPos = { x: meEnt.x, y: meEnt.y };

    let mx = 0, my = 0;
    if (this.joy.active) { mx = this.move.x; my = this.move.y; }
    else if (!this.settings.open) { const b = this.settings.binds; if (this.held.has(b.left)) mx -= 1; if (this.held.has(b.right)) mx += 1; if (this.held.has(b.up)) my -= 1; if (this.held.has(b.down)) my += 1; const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; } }

    if (this.localPos && meEnt && meEnt.alive) {
      this.localPos.x = Phaser.Math.Clamp(this.localPos.x + mx * this.moveSpeed * dt, 16, this.bounds.w - 16);
      this.localPos.y = Phaser.Math.Clamp(this.localPos.y + my * this.moveSpeed * dt, 16, this.bounds.h - 16);
      this.localPos.x += (meEnt.x - this.localPos.x) * 0.12;
      this.localPos.y += (meEnt.y - this.localPos.y) * 0.12;
    } else if (meEnt) { this.localPos = { x: meEnt.x, y: meEnt.y }; }

    const px = this.localPos ? this.localPos.x : (meEnt ? meEnt.x : 0);
    const py = this.localPos ? this.localPos.y : (meEnt ? meEnt.y : 0);
    if (this.autoAim) { const e = this.nearestEnemy(snap, px, py); if (e) this.facing = Math.atan2(e.y - py, e.x - px); }
    else if (this.isTouch) { if (this.joy.active && (mx !== 0 || my !== 0)) this.facing = Math.atan2(my, mx); }
    else { const ptr = this.input.activePointer; this.facing = Math.atan2(ptr.worldY - py, ptr.worldX - px); }
    if (this.facing == null) this.facing = -Math.PI / 2;

    this.inputAcc += dt;
    if (this.inputAcc >= 1 / INPUT_HZ) { this.inputAcc = 0; this.net.sendInput(mx, my, this.facing); }

    this.renderPlayers(snap);
    this.renderMobs(snap.mobs);
    this.renderMinions(snap.minions);
    this.renderBoss(snap.boss);
    this.renderProjectiles(snap.projectiles);
    this.consumeFx(snap.fx);
    this.updateHud(snap);

    if (this.localPos) { const cam = this.cameras.main; cam.scrollX += (this.localPos.x - cam.width / 2 - cam.scrollX) * 0.15; cam.scrollY += (this.localPos.y - cam.height / 2 - cam.scrollY) * 0.15; }
  }

  nearestEnemy(snap, x, y) {
    let best = null, bd = 700;
    for (const m of snap.mobs) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; } }
    if (snap.boss && snap.boss.alive) { const d = Math.hypot(snap.boss.x - x, snap.boss.y - y); if (d < bd) best = snap.boss; }
    return best;
  }

  // World target for placed skills (blast/dot): the cursor in manual AIM, the
  // nearest enemy in AUTO, or the aimed direction on touch. Sent with the cast;
  // the server clamps it. Clamped to castRange here too for predictable feel.
  aimPoint(castRange = 360) {
    const px = this.localPos ? this.localPos.x : 0, py = this.localPos ? this.localPos.y : 0;
    const snap = this.net.snapshot;
    if (this.autoAim && snap) { const e = this.nearestEnemy(snap, px, py); if (e) return { x: e.x, y: e.y }; }
    else if (!this.isTouch) {
      const ptr = this.input.activePointer;
      let dx = ptr.worldX - px, dy = ptr.worldY - py;
      const d = Math.hypot(dx, dy) || 1;
      if (d > castRange) { dx = (dx / d) * castRange; dy = (dy / d) * castRange; }
      return { x: px + dx, y: py + dy };
    }
    return { x: px + Math.cos(this.facing) * castRange, y: py + Math.sin(this.facing) * castRange };
  }

  castSlot(slot) { const a = this.aimPoint(); this.net.sendCast(slot, a.x, a.y); }

  // --------------------------------------------------------------- entities --
  renderPlayers(snap) {
    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.id);
      let e = this.players.get(p.id);
      if (!e) { e = { color: CLASSES[p.classKey] ? CLASSES[p.classKey].color : 0xffffff, gfx: this.add.graphics().setDepth(10), label: this.add.text(0, 0, '', { fontFamily: 'Segoe UI', fontSize: '12px', color: '#fff' }).setOrigin(0.5).setDepth(11), hpBar: new HealthBar(this, 0, 0, 46, 6, { depth: 11 }), rx: p.x, ry: p.y }; this.players.set(p.id, e); }
      const isMe = p.id === this.net.youId;
      const tx = isMe && this.localPos ? this.localPos.x : p.x;
      const ty = isMe && this.localPos ? this.localPos.y : p.y;
      e.rx += (tx - e.rx) * (isMe ? 1 : 0.25); e.ry += (ty - e.ry) * (isMe ? 1 : 0.25);
      const facing = isMe ? this.facing : p.facing;

      const g = e.gfx; g.clear();
      if (!p.alive) { g.fillStyle(0x444a5e, 0.8); g.fillCircle(e.rx, e.ry, 16); e.label.setText(p.name + ' (down)'); }
      else {
        g.fillStyle(e.color, 1); g.fillCircle(e.rx, e.ry, 16);
        if (p.buff) { g.lineStyle(2, 0xffe066, 0.7); g.strokeCircle(e.rx, e.ry, 25); }
        g.lineStyle(2, isMe ? 0xffffff : 0xbfc8e0, 0.9); g.strokeCircle(e.rx, e.ry, 16);
        if (p.shield) { g.lineStyle(3, 0x66ccff, 0.9); g.strokeCircle(e.rx, e.ry, 22); }
        if (p.invuln) { g.lineStyle(3, 0x5dd9ff, 0.9); g.strokeCircle(e.rx, e.ry, 27); }
        g.lineStyle(4, 0xffffff, 1); g.beginPath(); g.moveTo(e.rx, e.ry); g.lineTo(e.rx + Math.cos(facing) * 28, e.ry + Math.sin(facing) * 28); g.strokePath();
        e.label.setText(`${isMe ? p.name + ' (you)' : p.name}  Lv${p.level}`);
      }
      e.label.setPosition(e.rx, e.ry - 42); e.hpBar.setPosition(e.rx, e.ry - 28); e.hpBar.setValue(p.hp / p.maxHp);
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { e.gfx.destroy(); e.label.destroy(); e.hpBar.destroy(); this.players.delete(id); }
  }

  renderMobs(mobs) {
    const seen = new Set();
    for (const m of mobs) {
      seen.add(m.id);
      const t = MOB_TYPES[m.typeKey];
      let e = this.mobsR.get(m.id);
      if (!e) { e = { gfx: this.add.graphics().setDepth(8), label: this.add.text(0, 0, `Lv${m.level} ${t.name}`, { fontFamily: 'Segoe UI', fontSize: '10px', color: '#d8dcea' }).setOrigin(0.5).setDepth(9), hpBar: new HealthBar(this, 0, 0, 34, 5, { depth: 9 }), rx: m.x, ry: m.y }; this.mobsR.set(m.id, e); }
      e.rx += (m.x - e.rx) * 0.3; e.ry += (m.y - e.ry) * 0.3;
      const g = e.gfx; g.clear(); g.fillStyle(t.color, 1);
      if (t.kind === 'ranged') { g.beginPath(); g.moveTo(e.rx, e.ry - t.radius); g.lineTo(e.rx + t.radius, e.ry); g.lineTo(e.rx, e.ry + t.radius); g.lineTo(e.rx - t.radius, e.ry); g.closePath(); g.fillPath(); }
      else g.fillCircle(e.rx, e.ry, t.radius);
      g.lineStyle(2, 0x000000, 0.35); g.strokeCircle(e.rx, e.ry, t.radius);
      e.label.setPosition(e.rx, e.ry - t.radius - 20); e.hpBar.setPosition(e.rx, e.ry - t.radius - 9); e.hpBar.setValue(m.hp / m.maxHp);
    }
    for (const [id, e] of this.mobsR) if (!seen.has(id)) { e.gfx.destroy(); e.label.destroy(); e.hpBar.destroy(); this.mobsR.delete(id); }
  }

  renderMinions(list) {
    const seen = new Set();
    for (const m of list || []) {
      seen.add(m.id);
      let e = this.minionsR.get(m.id);
      if (!e) { e = { gfx: this.add.graphics().setDepth(8), rx: m.x, ry: m.y }; this.minionsR.set(m.id, e); }
      e.rx += (m.x - e.rx) * 0.3; e.ry += (m.y - e.ry) * 0.3;
      const g = e.gfx; g.clear();
      g.fillStyle(0x9ad17a, 1); g.fillCircle(e.rx, e.ry, 10);
      g.lineStyle(2, 0x3a5a2a, 1); g.strokeCircle(e.rx, e.ry, 10);
      const bw = 24;
      g.fillStyle(0x220000, 1); g.fillRect(e.rx - bw / 2, e.ry - 18, bw, 4);
      g.fillStyle(0x66ff44, 1); g.fillRect(e.rx - bw / 2, e.ry - 18, bw * (m.hp / m.maxHp), 4);
    }
    for (const [id, e] of this.minionsR) if (!seen.has(id)) { e.gfx.destroy(); this.minionsR.delete(id); }
  }

  renderBoss(b) {
    const g = this.bossGfx; g.clear(); const tg = this.telegraphGfx; tg.clear();
    if (!b) { this.bossHpBar.setVisible(false); this.bossNameText.setVisible(false); this.bossDpsText.setVisible(false); return; }
    this.bossHpBar.setVisible(true); this.bossNameText.setVisible(true).setText(b.name); this.bossHpBar.setValue(b.hp / b.maxHp);
    // Per-player DPS meter (server-authoritative, ranked). Visible to everyone.
    const rows = b.dps || [];
    this.bossDpsText.setVisible(rows.length > 0).setText(rows.map((r) => `${r.name}: ${r.dps.toLocaleString()} dps`).join('\n'));
    this.bossNameText.setText(b.enraged ? `${b.name}  [ENRAGED]` : b.name);
    const radius = b.radius || 46;
    if (b.alive) {
      g.fillStyle(b.color != null ? b.color : CONFIG.colors.boss, 1); g.fillCircle(b.x, b.y, radius);
      g.lineStyle(b.enraged ? 4 : 3, b.enraged ? 0xff3a3a : 0x000000, b.enraged ? 0.9 : 0.4); g.strokeCircle(b.x, b.y, radius);
      g.fillStyle(0xffd24a, 1); g.fillCircle(b.x + Math.cos(b.facing) * (radius + 4), b.y + Math.sin(b.facing) * (radius + 4), 8);
    }
    if (b.telegraph) this.drawBossTelegraph(tg, b.telegraph);
  }

  // Snapshot-driven telegraph rendering (mirrors the solo drawTelegraph helper).
  drawBossTelegraph(tg, t) {
    const alpha = 0.25 + (t.progress || 0) * 0.4;
    const C = CONFIG.colors.telegraph;
    if (t.type === 'cleave') {
      const steps = 24, start = t.facing - t.halfAngle, end = t.facing + t.halfAngle;
      tg.fillStyle(C, alpha); tg.lineStyle(3, C, 0.9);
      tg.beginPath(); tg.moveTo(t.x, t.y);
      for (let i = 0; i <= steps; i++) { const a = start + ((end - start) * i) / steps; tg.lineTo(t.x + Math.cos(a) * t.range, t.y + Math.sin(a) * t.range); }
      tg.closePath(); tg.fillPath(); tg.strokePath();
    } else if (t.type === 'aoe') {
      tg.fillStyle(C, alpha); tg.lineStyle(3, C, 0.9);
      tg.fillCircle(t.x, t.y, t.radius); tg.strokeCircle(t.x, t.y, t.radius);
    } else if (t.type === 'charge') {
      const dx = Math.cos(t.facing), dy = Math.sin(t.facing), px = -dy, py = dx, hw = t.width / 2;
      const ex = t.x + dx * t.length, ey = t.y + dy * t.length;
      tg.fillStyle(C, alpha); tg.lineStyle(3, C, 0.9);
      tg.beginPath();
      tg.moveTo(t.x + px * hw, t.y + py * hw); tg.lineTo(ex + px * hw, ey + py * hw);
      tg.lineTo(ex - px * hw, ey - py * hw); tg.lineTo(t.x - px * hw, t.y - py * hw);
      tg.closePath(); tg.fillPath(); tg.strokePath();
    } else if (t.type === 'summon') {
      tg.lineStyle(3, 0xc06cff, 0.9); tg.fillStyle(0xc06cff, alpha * 0.6);
      tg.fillCircle(t.x, t.y, t.radius); tg.strokeCircle(t.x, t.y, t.radius);
    } else if (t.type === 'safezone') {
      tg.fillStyle(0xff4040, 0.18 + (t.progress || 0) * 0.22); tg.fillRect(0, 0, t.bw, t.bh);
      tg.fillStyle(0x4ad06a, 0.35); tg.lineStyle(4, 0x7CFC9A, 0.95);
      tg.fillCircle(t.x, t.y, t.radius); tg.strokeCircle(t.x, t.y, t.radius);
    }
  }

  renderProjectiles(list) { const g = this.projGfx; g.clear(); if (!list) return; for (const pr of list) { g.fillStyle(pr.color, 1); g.fillCircle(pr.x, pr.y, pr.r); } }

  consumeFx(fx) {
    if (!fx) return;
    for (const f of fx) {
      if (f.t === 'dmg') this.spawnText(f.x, f.y - 4, f.amount, f.enemy ? '#ff6b6b' : (f.crit ? '#ffe066' : '#ffffff'), f.crit);
      else if (f.t === 'heal') this.spawnText(f.x, f.y, '+' + f.amount, '#7CFC9A');
      else if (f.t === 'xp') this.spawnText(f.x, f.y, '+' + f.amount + ' XP', '#9be8ff');
      else if (f.t === 'level') this.spawnText(f.x, f.y, 'LEVEL UP! Lv' + f.level, '#ffe066', true);
      else if (f.t === 'loot') this.spawnText(f.x, f.y, '✦ ' + f.name, rarityColor(f.rarity));
      else if (f.t === 'text') this.spawnText(f.x, f.y, f.msg, f.color, f.big);
      else if (f.t === 'arc') this.spawnArc(f.x, f.y, f.facing, f.range, f.half);
      else if (f.t === 'ring') this.spawnRing(f.x, f.y, f.radius, f.color);
      else if (f.t === 'blast') this.spawnBlast(f.x, f.y, f.radius, f.color);
    }
  }

  // -------------------------------------------------------------------- HUD --
  buildHud() {
    this.statsText = this.add.text(14, 14, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#cdd6ee', lineSpacing: 3, stroke: '#000', strokeThickness: 3 }).setDepth(60).setScrollFactor(0);
    this.zoneText = this.add.text(CONFIG.width / 2, 64, '', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(60).setScrollFactor(0);
    this.partyText = this.add.text(CONFIG.width - 14, 100, '', { fontFamily: 'Consolas, monospace', fontSize: '11px', color: '#cdd6ee', align: 'right', lineSpacing: 2, stroke: '#000', strokeThickness: 3 }).setOrigin(1, 0).setDepth(60).setScrollFactor(0);

    const xpY = CONFIG.height - 8;
    this.add.rectangle(CONFIG.width / 2, xpY, CONFIG.width, 10, 0x000000, 0.6).setDepth(59).setScrollFactor(0);
    this.xpFill = this.add.rectangle(0, xpY, 0, 10, 0x9be8ff, 0.9).setOrigin(0, 0.5).setDepth(60).setScrollFactor(0);

    this.skillBoxes = [];
    const boxW = 60, gap = 10;
    const totalW = this.skills.length * boxW + (this.skills.length - 1) * gap;
    const startX = CONFIG.width / 2 - totalW / 2, y = CONFIG.height - 56;
    this.skills.forEach((def, i) => {
      const slot = i + 1, x = startX + i * (boxW + gap) + boxW / 2;
      const box = this.add.rectangle(x, y, boxW, boxW, 0x1c2138, 0.95).setStrokeStyle(2, 0x3a4366).setDepth(60).setScrollFactor(0).setInteractive();
      box.on('pointerdown', () => this.castSlot(slot));
      this.add.text(x - boxW / 2 + 5, y - boxW / 2 + 3, def.key, { fontFamily: 'Segoe UI', fontSize: '12px', fontStyle: 'bold', color: '#fff' }).setDepth(62).setScrollFactor(0);
      this.add.text(x, y + boxW / 2 - 11, def.name, { fontFamily: 'Segoe UI', fontSize: '8px', color: def.color, align: 'center', wordWrap: { width: boxW - 4 } }).setOrigin(0.5).setDepth(62).setScrollFactor(0);
      const overlay = this.add.rectangle(x, y + boxW / 2, boxW, boxW, 0x000000, 0.65).setOrigin(0.5, 1).setDepth(61).setScrollFactor(0); overlay.height = 0;
      this.skillBoxes.push({ slot, def, overlay, boxW, x, y });
    });
  }

  buildTouchControls() {
    this.joyBase = this.add.circle(0, 0, 60, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.25).setDepth(70).setScrollFactor(0).setVisible(false);
    this.joyThumb = this.add.circle(0, 0, 26, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.5).setDepth(71).setScrollFactor(0).setVisible(false);

    const ccx = CONFIG.width - 44, ccy = 30;
    const cbtn = this.add.circle(ccx, ccy, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffd24a, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(ccx, ccy, 'C', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    cbtn.on('pointerdown', () => this.toggleCharPanel()); this.charBtn = { x: ccx, y: ccy, r: 22 };

    const aimX = CONFIG.width - 44, aimY = 80;
    const aimBg = this.add.circle(aimX, aimY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x6cd0ff, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.aimText = this.add.text(aimX, aimY, 'AIM', { fontFamily: 'Segoe UI', fontSize: '10px', fontStyle: 'bold', color: '#6cd0ff' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    aimBg.on('pointerdown', () => this.toggleAutoAim());
    this.aimBtn = { x: aimX, y: aimY, r: 22 };

    const setX = CONFIG.width - 44, setY = 130;
    const setBg = this.add.circle(setX, setY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xb8a4ff, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(setX, setY, '⚙', { fontFamily: 'Segoe UI', fontSize: '18px', color: '#b8a4ff' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    setBg.on('pointerdown', () => this.settings.toggle()); this.settingsBtn = { x: setX, y: setY, r: 22 };

    const invX = CONFIG.width - 44, invY = 180;
    const invBg = this.add.circle(invX, invY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x8bd96a, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(invX, invY, 'I', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#8bd96a' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    invBg.on('pointerdown', () => this.inventory.toggle()); this.invBtn = { x: invX, y: invY, r: 22 };

    if (!this.isTouch) return;
    const ax = CONFIG.width - 80, ay = CONFIG.height - 96;
    const btn = this.add.circle(ax, ay, 46, this.classDef.color, 0.9).setStrokeStyle(3, 0xffffff, 0.85).setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(ax, ay, 'ATK', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    btn.on('pointerdown', () => this.net.sendBasic()); this.attackBtn = { x: ax, y: ay, r: 46 };
  }

  toggleAutoAim() { this.autoAim = !this.autoAim; this.aimText.setText(this.autoAim ? 'AUTO' : 'AIM').setColor(this.autoAim ? '#ffe066' : '#6cd0ff'); }

  buildCharPanel() {
    this.charPanelOpen = false;
    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    const panel = this.add.container(0, 0).setDepth(120).setScrollFactor(0).setVisible(false);
    panel.add(this.add.rectangle(cx, cy, 360, 320, 0x10131f, 0.96).setStrokeStyle(2, 0x3a4366).setScrollFactor(0));
    this.charTitle = this.add.text(cx, cy - 130, '', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5).setScrollFactor(0);
    panel.add(this.charTitle);
    this.charRows = [];
    STAT_INFO.forEach(([attr, desc], i) => {
      const ry = cy - 80 + i * 42;
      const label = this.add.text(cx - 150, ry, '', { fontFamily: 'Consolas, monospace', fontSize: '14px', color: '#e6e9f2' }).setOrigin(0, 0.5).setScrollFactor(0);
      const plus = this.add.rectangle(cx + 130, ry, 30, 30, 0x2a6e3a, 1).setStrokeStyle(2, 0x4ad06a).setScrollFactor(0).setInteractive();
      const plusText = this.add.text(cx + 130, ry, '+', { fontFamily: 'Segoe UI', fontSize: '18px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setScrollFactor(0);
      plus.on('pointerdown', () => this.net.spendStat(attr));
      panel.add(label); panel.add(plus); panel.add(plusText);
      this.charRows.push({ attr, desc, label });
    });
    panel.add(this.add.text(cx, cy + 132, 'C / button to close', { fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad' }).setOrigin(0.5).setScrollFactor(0));
    this.charPanel = panel;
  }
  toggleCharPanel() { this.charPanelOpen = !this.charPanelOpen; this.charPanel.setVisible(this.charPanelOpen); }
  refreshCharPanel() {
    if (!this.me) return;
    this.charTitle.setText(`${this.classDef.name}  —  ${this.me.statPoints} point(s)`);
    for (const row of this.charRows) row.label.setText(`${row.attr}  ${this.me.stats[row.attr]}   (${row.desc})`);
  }

  updateHud(snap) {
    const me = this.me; const z = ZONES[snap.zoneKey];
    if (me) {
      const meEnt = snap.players.find((p) => p.id === this.net.youId) || { hp: 0, maxHp: 1 };
      const s = me.stats;
      this.statsText.setText([`${this.classDef.name}  Lv ${me.level}`, `HP ${Math.ceil(meEnt.hp)}/${meEnt.maxHp}`, `XP ${me.xp}/${me.xpToNext}`, `STR ${s.STR} DEX ${s.DEX} INT ${s.INT} VIT ${s.VIT} AGI ${s.AGI}`, me.statPoints > 0 ? `>> ${me.statPoints} point(s) — press C` : ''].join('\n'));
      this.xpFill.width = CONFIG.width * Phaser.Math.Clamp(me.xp / me.xpToNext, 0, 1);
      for (const sb of this.skillBoxes) sb.overlay.height = sb.boxW * Phaser.Math.Clamp((me.cd[sb.slot] || 0) / sb.def.cd, 0, 1);
    }
    this.zoneText.setText(`Party ${this.net.code}   ·   ${z.name}${z.safe ? '  (safe)' : ''}`);
    const lines = snap.players.map((p) => `${p.id === this.net.youId ? '>' : ' '} ${p.name} Lv${p.level}  ${Math.ceil(p.hp)}/${p.maxHp}`);
    this.partyText.setText('PARTY (this zone)\n' + lines.join('\n'));
    if (this.charPanelOpen) this.refreshCharPanel();
  }

  // ------------------------------------------------------------------- fx ----
  spawnText(x, y, value, color = '#ffffff', big = false) { const txt = this.add.text(x, y, String(value), { fontFamily: 'Segoe UI', fontSize: big ? '20px' : '14px', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(80); this.tweens.add({ targets: txt, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() }); }
  spawnArc(cx, cy, facing, range, half) { const gfx = this.add.graphics().setDepth(15); let t = 0; const ev = this.time.addEvent({ delay: 14, loop: true, callback: () => { t += 14; gfx.clear(); gfx.lineStyle(5, 0xffeedd, (1 - t / 170) * 0.9); gfx.beginPath(); const steps = 12; for (let i = 0; i <= steps; i++) { const a = facing - half + (half * 2 * i) / steps; const px = cx + Math.cos(a) * range, py = cy + Math.sin(a) * range; i === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py); } gfx.strokePath(); if (t >= 170) { gfx.destroy(); ev.remove(); } } }); }
  spawnRing(x, y, radius, colorHex) { const color = this.hexToInt(colorHex, 0xc89bff); const fx = this.add.graphics().setDepth(12); let t = 0; const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => { t += 16; fx.clear(); fx.lineStyle(4, color, Phaser.Math.Clamp(1 - t / 300, 0, 1)); fx.strokeCircle(x, y, radius * (t / 300)); if (t >= 300) { fx.destroy(); ev.remove(); } } }); }
  spawnBlast(x, y, radius, colorHex) { const color = this.hexToInt(colorHex, 0xff7a3c); const fx = this.add.graphics().setDepth(12); let t = 0; const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => { t += 16; const p = t / 280; fx.clear(); fx.fillStyle(color, (1 - p) * 0.5); fx.fillCircle(x, y, radius * Math.min(1, p * 1.2)); fx.lineStyle(3, color, 1 - p); fx.strokeCircle(x, y, radius); if (t >= 280) { fx.destroy(); ev.remove(); } } }); }
  hexToInt(hex, fallback) { if (typeof hex === 'number') return hex; if (typeof hex === 'string' && hex[0] === '#') return parseInt(hex.slice(1), 16); return fallback; }
}
