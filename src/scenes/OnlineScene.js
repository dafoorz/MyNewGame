import { CONFIG } from '../config.js';
import { CLASSES } from '../classes/classes.js';
import { Stats } from '../stats.js';
import { ZONES, zonePortals, zoneWaystones } from '../world/zones.js';
import { MOB_TYPES } from '../world/zones.js';
import HealthBar from '../ui/HealthBar.js';
import { saveProgress } from '../progress.js';
import SettingsPanel from '../ui/SettingsPanel.js';
import InventoryPanel from '../ui/InventoryPanel.js';
import SkillTreePanel from '../ui/SkillTreePanel.js';
import { rarityColor } from '../items.js';
import MapPanel from '../ui/MapPanel.js';
import ShopPanel from '../ui/ShopPanel.js';
import MiniMap from '../ui/MiniMap.js';
import { buildFromTree, effectiveSkills, availablePoints } from '../skilltree.js';
import { applyIso, project, unproject, dirToWorld, projectDir, bodyDepth, zoneBounds } from '../iso.js';
import { drawHumanoid, drawCreature, drawBoss, drawMinion } from '../sprites.js';

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

    // Iso world layer (see src/iso.js): the FLOOR and ground decals (zone grid,
    // portals, waystones, boss telegraphs) live here and inherit the iso transform.
    // Bodies and projectiles are upright billboards in scene space at project(x,y).
    this.world = applyIso(this.add.container(0, 0));
    this.zoneGfx = this.add.graphics(); this.zoneGfx.depth = -1e7; this.world.add(this.zoneGfx);
    this.portalGfx = this.add.graphics(); this.portalGfx.depth = -9e6; this.world.add(this.portalGfx);
    this.waystoneGfx = this.add.graphics(); this.waystoneGfx.depth = -9e6 + 1; this.world.add(this.waystoneGfx);
    this.telegraphGfx = this.add.graphics(); this.telegraphGfx.depth = -1000; this.world.add(this.telegraphGfx);
    this.bossGfx = this.add.graphics().setDepth(20);   // boss billboard (scene space)
    this.projGfx = this.add.graphics().setDepth(53);   // projectiles (scene space)
    this.portalLabels = [];
    this.waystoneLabels = [];
    this._wpCount = -1; // track discovered count to know when to redraw shrines

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
    this.effSkills = this.classDef.skills; // recomputed from me.skillTree each snapshot
    this.treePanel = new SkillTreePanel(this, {
      getModel: () => ({ classKey: this.classKey, level: this.me ? this.me.level : 1, alloc: (this.me && this.me.skillTree) || {} }),
      onSpend: (nodeId) => this.net.sendSpendSkill(nodeId),
      onRespec: () => this.net.sendRespecSkill(),
    });
    this.settings = new SettingsPanel(this, {
      onMainMenu: () => { if (this.net) this.net.close(); this.scene.start('LobbyScene'); },
    });
    this.mapPanel = new MapPanel(this, {
      getZoneKey: () => this.curZone || 'town',
      getDiscovered: () => new Set((this.me && this.me.waypoints) || ['town']),
      getSeed: () => (this.net ? this.net.seed : 0),
      onTravel: (id) => {
        // Client-side hints (server enforces these authoritatively too).
        const here = ZONES[this.curZone];
        if (here && (here.dungeon || here.raid)) { this.showBanner("Can't travel inside a dungeon"); return; }
        if (this.me && this.me.inCombat) { this.showBanner("Can't travel in combat"); return; }
        if (this.net) this.net.sendMapTravel(id);
      },
    });
    this.shopPanel = new ShopPanel(this, {
      getModel: () => ({ classKey: this.classKey, gold: (this.me && this.me.gold) || 0, gear: (this.me && this.me.gear) || {} }),
      onBuy: (slot, tier) => { if (this.net) this.net.sendBuy(slot, tier); },
      onUpgrade: (slot) => { if (this.net) this.net.sendUpgrade(slot); },
    });
    // Server announces shrine discovery — show a banner.
    if (this.net) this.net.on('waystone', (d) => { if (d && d.name) this.showBanner('Waystone discovered: ' + d.name); });

    this.miniMap = new MiniMap(this);
    this.portals = [];

    this.inputAcc = 0;
    this.move = { x: 0, y: 0 };
  }

  // ----------------------------------------------------------------- zones ---
  onZoneChange(key) {
    this.curZone = key;
    if (key !== 'town' && this.shopPanel && this.shopPanel.open) this.shopPanel.close();
    const z = ZONES[key];
    this.bounds = { w: z.size.w, h: z.size.h };
    const zb = zoneBounds(z.size.w, z.size.h);
    this.cameras.main.setBounds(zb.x, zb.y, zb.w, zb.h);

    const g = this.zoneGfx; g.clear();
    g.fillStyle(z.bg, 1); g.fillRect(0, 0, z.size.w, z.size.h);
    if (key === 'town') {
      g.fillStyle(0x25472d, 1); g.fillRect(0, 0, z.size.w, z.size.h);
      g.fillStyle(0x2e5a38, 1); g.fillRect(34, 34, z.size.w - 68, z.size.h - 68);
      g.fillStyle(0x3a6a42, 0.95); g.fillRect(86, 86, z.size.w - 172, z.size.h - 172);
      g.fillStyle(0x24505f, 0.95);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(420, 0); g.lineTo(300, 110); g.lineTo(220, 210); g.lineTo(110, 260); g.lineTo(0, 300); g.closePath(); g.fillPath();
      g.fillStyle(0x3d8795, 0.9);
      g.beginPath(); g.moveTo(0, 34); g.lineTo(362, 34); g.lineTo(266, 126); g.lineTo(198, 198); g.lineTo(100, 244); g.lineTo(0, 278); g.closePath(); g.fillPath();
      g.lineStyle(72, 0x947048, 1); g.lineCap = 'round';
      g.beginPath(); g.moveTo(70, 525); g.lineTo(330, 525); g.lineTo(520, 540); g.lineTo(760, 560); g.lineTo(980, 540); g.lineTo(1200, 530); g.lineTo(1430, 530); g.strokePath();
      g.lineStyle(64, 0x8a6840, 1);
      g.beginPath(); g.moveTo(750, 120); g.lineTo(748, 260); g.lineTo(752, 420); g.lineTo(760, 560); g.lineTo(742, 700); g.lineTo(720, 860); g.lineTo(706, 980); g.strokePath();
      g.lineStyle(16, 0xb38a57, 0.65);
      g.beginPath(); g.moveTo(90, 525); g.lineTo(1430, 525); g.strokePath();
      g.beginPath(); g.moveTo(752, 120); g.lineTo(720, 980); g.strokePath();
      g.fillStyle(0x7e684a, 1); g.fillCircle(750, 560, 126);
      g.fillStyle(0x99815f, 1); g.fillCircle(750, 560, 90);
      g.lineStyle(5, 0xcdb58a, 0.7); [52, 88, 122].forEach((r) => g.strokeCircle(750, 560, r));
      g.fillStyle(0x6d5338, 0.95); g.fillRoundedRect(620, 255, 260, 156, 18);
      g.lineStyle(4, 0xb79058, 0.8); g.strokeRoundedRect(620, 255, 260, 156, 18);
      g.fillStyle(0xb5443c, 0.85); g.fillRect(650, 272, 74, 38);
      g.fillStyle(0xcfb15c, 0.85); g.fillRect(730, 272, 60, 38);
      g.fillStyle(0x5b7f43, 0.85); g.fillRect(796, 272, 52, 38);
      g.fillStyle(0x7a3430, 0.85); g.fillRect(662, 320, 82, 42);
      g.fillStyle(0x4a6d78, 0.85); g.fillRect(752, 320, 74, 42);
      g.lineStyle(6, 0x5f452e, 0.9);
      for (let x = 120; x <= 340; x += 32) { g.lineBetween(x, 180, x, 230); }
      g.lineBetween(104, 196, 356, 196); g.lineBetween(104, 222, 356, 222);
      for (let x = 1150; x <= 1370; x += 32) { g.lineBetween(x, 856, x, 906); }
      g.lineBetween(1134, 872, 1386, 872); g.lineBetween(1134, 898, 1386, 898);
      const patches = [[540,470,38,18],[952,468,36,18],[622,770,46,22],[866,760,42,20],[540,208,48,20],[1180,618,44,22]];
      for (const [x, y, w, h] of patches) {
        g.fillStyle(0x487b48, 0.55); g.fillEllipse(x, y, w, h);
        g.fillStyle(0xc9c36c, 0.35); g.fillEllipse(x + 6, y - 2, w * 0.35, h * 0.35);
      }
      g.lineStyle(8, 0x4f3523, 0.8); g.strokeRect(10, 10, z.size.w - 20, z.size.h - 20);
      this.drawTownProps();
    } else {
      g.lineStyle(6, z.accent, 1); g.strokeRect(3, 3, z.size.w - 6, z.size.h - 6);
      g.lineStyle(1, z.accent, 0.4);
      for (let x = 80; x < z.size.w; x += 80) g.lineBetween(x, 0, x, z.size.h);
      for (let y = 80; y < z.size.h; y += 80) g.lineBetween(0, y, z.size.w, y);
    }

    const seed = this.net ? this.net.seed : 0;
    const pg = this.portalGfx; pg.clear();
    this.portalLabels.forEach((l) => l.destroy()); this.portalLabels = [];
    for (const p of zonePortals(key, seed)) {
      const isDungeon = ZONES[p.to] && (ZONES[p.to].dungeon || ZONES[p.to].raid);
      const col = ZONES[p.to] && ZONES[p.to].raid ? 0xc06cff : (isDungeon ? 0xff9a5a : 0x6cd0ff);
      pg.fillStyle(col, 0.25); pg.fillCircle(p.x, p.y, 40);
      pg.lineStyle(3, col, 0.9); pg.strokeCircle(p.x, p.y, 40);
      const lp = project(p.x, p.y);
      this.portalLabels.push(this.add.text(lp.x, lp.y - 56, p.label, { fontFamily: 'Segoe UI', fontSize: '14px', fontStyle: 'bold', color: '#bfe9ff', stroke: '#06121c', strokeThickness: 4 }).setOrigin(0.5).setDepth(40));
    }
    // Town market stall.
    if (z.shop) {
      pg.fillStyle(0x6a4a1a, 0.5); pg.fillCircle(z.shop.x, z.shop.y, 34);
      pg.lineStyle(3, 0xffe066, 0.9); pg.strokeCircle(z.shop.x, z.shop.y, 34);
      const ssp = project(z.shop.x, z.shop.y);
      this.portalLabels.push(this.add.text(ssp.x, ssp.y - 50, '🛒 Market (B)', { fontFamily: 'Segoe UI', fontSize: '14px', fontStyle: 'bold', color: '#ffe066', stroke: '#06121c', strokeThickness: 4 }).setOrigin(0.5).setDepth(40));
    }

    this.portals = zonePortals(key, seed);
    this.waystones = zoneWaystones(key, seed);
    this._wpCount = -1; // force shrine redraw for the new zone
    this.drawWaystones();

    this.showBanner(z.name);
    this.localPos = null; // re-anchor to server pos after teleport
  }

  drawTownProps() {
    if (this.townPropLayer) this.townPropLayer.forEach((o) => o.g.destroy());
    this.townPropLayer = [];

    const houses = [
      [560, 756, 0x714334], [952, 748, 0x714334], [1066, 466, 0x6c4032],
      [392, 454, 0x6f4934], [1166, 852, 0x6b3b30], [318, 796, 0x70523a],
    ];
    for (const [x, y, roof] of houses) this.spawnHouseProp(x, y, roof);

    const trees = [
      [190, 150], [260, 138], [140, 392], [118, 690], [210, 878],
      [420, 160], [470, 860], [575, 930], [930, 122], [1110, 168],
      [1310, 180], [1360, 340], [1342, 650], [1280, 910], [1040, 930],
      [884, 866], [340, 916], [1240, 500], [1000, 250], [460, 300],
    ];
    for (const [x, y] of trees) this.spawnTreeProp(x, y);
  }

  spawnHouseProp(x, y, roofColor) {
    const g = this.add.graphics();
    this.townPropLayer.push({ kind: 'house', x, y, roofColor, g });
  }

  spawnTreeProp(x, y) {
    const g = this.add.graphics();
    this.townPropLayer.push({ kind: 'tree', x, y, g });
  }

  updateTownProps() {
    if (!this.townPropLayer || !this.townPropLayer.length) return;
    for (const o of this.townPropLayer) {
      const g = o.g;
      const p = project(o.x, o.y);
      g.clear();
      g.setDepth(bodyDepth(o.x, o.y));
      if (o.kind === 'house') {
        g.fillStyle(0x000000, 0.16); g.fillEllipse(p.x, p.y - 2, 84, 26);
        g.fillStyle(0xd7c6a4, 1); g.fillRoundedRect(p.x - 34, p.y - 72, 68, 48, 8);
        g.lineStyle(2, 0x6b5643, 0.45); g.strokeRoundedRect(p.x - 34, p.y - 72, 68, 48, 8);
        g.fillStyle(o.roofColor, 1);
        g.beginPath();
        g.moveTo(p.x - 42, p.y - 72); g.lineTo(p.x, p.y - 104); g.lineTo(p.x + 42, p.y - 72); g.closePath();
        g.fillPath();
        g.lineStyle(2, 0x3e241b, 0.45);
        g.beginPath();
        g.moveTo(p.x - 42, p.y - 72); g.lineTo(p.x, p.y - 104); g.lineTo(p.x + 42, p.y - 72);
        g.strokePath();
        g.fillStyle(0x6c4a33, 1); g.fillRoundedRect(p.x - 8, p.y - 46, 16, 22, 4);
        g.fillStyle(0xf0e1bf, 0.95); g.fillRect(p.x - 22, p.y - 62, 44, 7);
      } else {
        g.fillStyle(0x000000, 0.14); g.fillEllipse(p.x, p.y - 1, 58, 18);
        g.fillStyle(0x6a4628, 1); g.fillRect(p.x - 5, p.y - 42, 10, 28);
        g.fillStyle(0x274c30, 1); g.fillCircle(p.x, p.y - 66, 24);
        g.fillStyle(0x345f39, 1); g.fillCircle(p.x - 16, p.y - 52, 16);
        g.fillStyle(0x345f39, 1); g.fillCircle(p.x + 16, p.y - 52, 16);
        g.fillStyle(0x4f8352, 1); g.fillCircle(p.x, p.y - 46, 18);
      }
    }
  }

  // Shrines: cyan obelisk once discovered (server-tracked), dim & locked until then.
  drawWaystones() {
    const g = this.waystoneGfx; g.clear();
    this.waystoneLabels.forEach((l) => l.destroy()); this.waystoneLabels = [];
    const known = new Set((this.me && this.me.waypoints) || ['town']);
    for (const w of (this.waystones || [])) {
      const got = known.has(w.id);
      const col = got ? 0x4ad0ff : 0x55607a;
      g.fillStyle(col, got ? 0.22 : 0.12); g.fillCircle(w.x, w.y, 26);
      g.lineStyle(3, col, got ? 0.95 : 0.6); g.strokeCircle(w.x, w.y, 26);
      g.fillStyle(col, got ? 0.9 : 0.5); g.fillRect(w.x - 5, w.y - 18, 10, 30);
      const lp = project(w.x, w.y);
      this.waystoneLabels.push(this.add.text(lp.x, lp.y - 40, (got ? '◈ ' : '🔒 ') + w.name, {
        fontFamily: 'Segoe UI', fontSize: '11px', fontStyle: 'bold',
        color: got ? '#bff0ff' : '#8b93ad', stroke: '#06121c', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(40));
    }
    this._wpCount = known.size;
  }

  showBanner(text) {
    const t = this.add.text(CONFIG.width / 2, CONFIG.height / 2 - 120, text, { fontFamily: 'Segoe UI', fontSize: '30px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(110).setScrollFactor(0).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 300, yoyo: true, hold: 1100, onComplete: () => t.destroy() });
  }

  // ----------------------------------------------------------------- input ---
  setupInput() {
    this.input.addPointer(2);
    this.joy = { active: false, id: -1, baseX: 0, baseY: 0 };
    this.held = new Set();
    this.input.keyboard.addCapture('SPACE,ONE,TWO,THREE,FOUR,Q,E,R,C,I,K,M,B');

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
        case 'block': this.castSlot(6); break;
        case 'map': this.mapPanel.toggle(this.curZone); break;
        case 'tree': this.treePanel.toggle(); break;
        case 'shop': this.openShop(); break;
      }
    });
    this.input.keyboard.on('keyup', (e) => this.held.delete(e.code));
  }

  isOverUI(p) {
    if (this.settings && this.settings.open) return true;
    if (this.inventory && this.inventory.contains(p.x, p.y)) return true;
    if (this.treePanel && this.treePanel.contains(p.x, p.y)) return true;
    if (this.charPanelOpen && Math.abs(p.x - CONFIG.width / 2) < 200) return true;
    if (this.skillBoxes) for (const sb of this.skillBoxes) if (Math.abs(p.x - sb.x) <= sb.boxW / 2 && Math.abs(p.y - sb.y) <= sb.boxW / 2) return true;
    if (this.attackBtn && Math.hypot(p.x - this.attackBtn.x, p.y - this.attackBtn.y) <= this.attackBtn.r) return true;
    if (this.charBtn && Math.hypot(p.x - this.charBtn.x, p.y - this.charBtn.y) <= this.charBtn.r) return true;
    if (this.aimBtn && Math.hypot(p.x - this.aimBtn.x, p.y - this.aimBtn.y) <= this.aimBtn.r) return true;
    if (this.settingsBtn && Math.hypot(p.x - this.settingsBtn.x, p.y - this.settingsBtn.y) <= this.settingsBtn.r) return true;
    if (this.invBtn && Math.hypot(p.x - this.invBtn.x, p.y - this.invBtn.y) <= this.invBtn.r) return true;
    if (this.mapPanel && this.mapPanel.contains(p.x, p.y)) return true;
    if (this.mapBtn && Math.hypot(p.x - this.mapBtn.x, p.y - this.mapBtn.y) <= this.mapBtn.r) return true;
    if (this.treeBtn && Math.hypot(p.x - this.treeBtn.x, p.y - this.treeBtn.y) <= this.treeBtn.r) return true;
    if (this.shopBtn && Math.hypot(p.x - this.shopBtn.x, p.y - this.shopBtn.y) <= this.shopBtn.r) return true;
    if (this.shopPanel && this.shopPanel.contains(p.x, p.y)) return true;
    return false;
  }

  openShop() {
    if (this.curZone !== 'town') { this.showBanner('The shop is in town'); return; }
    this.shopPanel.toggle();
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
    // Re-light shrines when the server reports a newly discovered one.
    if (this.me && this.me.waypoints && this.me.waypoints.length !== this._wpCount) this.drawWaystones();

    // Persist this class's progress on this device (throttled).
    this._saveAcc = (this._saveAcc || 0) + dt;
    if (this._saveAcc >= 2 && this.me && this.me.stats) {
      this._saveAcc = 0;
      saveProgress(this.classKey, { level: this.me.level, xp: this.me.xp, statPoints: this.me.statPoints, gold: this.me.gold, stats: this.me.baseStats || this.me.stats, inventory: this.me.inventory, gear: this.me.gear, skillTree: this.me.skillTree, waypoints: this.me.waypoints });
    }
    // Recompute effective skills (tree upgrades/unlocks) only when the allocation
    // changes; refresh the open panels only on change (rebuilding every frame
    // would destroy their interactive elements before a click could register).
    if (this.me) {
      const tsig = JSON.stringify([this.me.skillTree, this.me.level]);
      if (tsig !== this._treeSig) {
        this._treeSig = tsig;
        this.effSkills = effectiveSkills(this.classDef, buildFromTree(this.classKey, this.me.skillTree || {}));
        if (this.skillBoxes) for (const sb of this.skillBoxes) { const d = this.effSkills[sb.slot - 1]; sb.def = d; if (sb.nameText) sb.nameText.setText(d.name); }
        if (this.treePanel && this.treePanel.open) this.treePanel.refresh();
      }
    }
    if (this.inventory && this.inventory.open && this.me) {
      const sig = JSON.stringify([this.me.inventory, this.me.gear, this.me.baseStats, this.me.statPoints]);
      if (sig !== this._invSig) { this._invSig = sig; this.inventory.refresh(); }
    }
    if (this.shopPanel && this.shopPanel.open && this.me) {
      const sig = JSON.stringify([this.me.gold, this.me.gear]);
      if (sig !== this._shopSig) { this._shopSig = sig; this.shopPanel.refresh(); }
    }

    const meEnt = snap.players.find((p) => p.id === this.net.youId);
    if (meEnt && !this.localPos) this.localPos = { x: meEnt.x, y: meEnt.y };

    // Screen-space movement intent...
    let ix = 0, iy = 0;
    if (this.joy.active) { ix = this.move.x; iy = this.move.y; }
    else if (!this.settings.open) { const b = this.settings.binds; if (this.held.has(b.left)) ix -= 1; if (this.held.has(b.right)) ix += 1; if (this.held.has(b.up)) iy -= 1; if (this.held.has(b.down)) iy += 1; const len = Math.hypot(ix, iy); if (len > 1) { ix /= len; iy /= len; } }
    // ...rotated into WORLD space (what the server understands) so it feels iso.
    let mx = 0, my = 0;
    if (ix !== 0 || iy !== 0) { const mag = Math.min(1, Math.hypot(ix, iy)); const w = dirToWorld(ix, iy); mx = w.x * mag; my = w.y * mag; }

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
    else { const ptr = this.input.activePointer; const wp = unproject(ptr.worldX, ptr.worldY); this.facing = Math.atan2(wp.y - py, wp.x - px); }
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
    this.world.sort('depth'); // painter's order for the iso world layer

    if (this.miniMap) {
      const meEnt = snap.players.find((p) => p.id === this.net.youId);
      this.miniMap.update({
        bounds: this.bounds,
        player: this.localPos ?? (meEnt ? { x: meEnt.x, y: meEnt.y } : null),
        allies: snap.players.filter((p) => p.id !== this.net.youId).map((p) => ({ x: p.x, y: p.y })),
        mobs: snap.mobs,
        boss: snap.boss,
        portals: this.portals,
        waystones: this.waystones,
      });
    }

    if (this.localPos) { const cam = this.cameras.main; const sp = project(this.localPos.x, this.localPos.y); cam.scrollX += (sp.x - cam.width / 2 - cam.scrollX) * 0.15; cam.scrollY += (sp.y - cam.height / 2 - cam.scrollY) * 0.15; }
    this.updateTownProps();
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
      const wp = unproject(ptr.worldX, ptr.worldY);
      let dx = wp.x - px, dy = wp.y - py;
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
      if (!e) { e = { color: CLASSES[p.classKey] ? CLASSES[p.classKey].color : 0xffffff, gfx: this.add.graphics(), label: this.add.text(0, 0, '', { fontFamily: 'Segoe UI', fontSize: '12px', color: '#fff' }).setOrigin(0.5).setDepth(55), hpBar: new HealthBar(this, 0, 0, 46, 6, { depth: 55 }), rx: p.x, ry: p.y }; this.players.set(p.id, e); }
      const isMe = p.id === this.net.youId;
      const tx = isMe && this.localPos ? this.localPos.x : p.x;
      const ty = isMe && this.localPos ? this.localPos.y : p.y;
      e.rx += (tx - e.rx) * (isMe ? 1 : 0.25); e.ry += (ty - e.ry) * (isMe ? 1 : 0.25);
      const facing = isMe ? this.facing : p.facing;

      const g = e.gfx; g.clear(); g.depth = bodyDepth(e.rx, e.ry);
      const sp = project(e.rx, e.ry);
      const r = 16, headTop = sp.y - r * 2.9;
      if (!p.alive) {
        g.fillStyle(0x000000, 0.3); g.fillEllipse(sp.x, sp.y, r * 2.3, r * 1.05);
        g.fillStyle(0x444a5e, 0.85); g.fillCircle(sp.x, sp.y - r * 0.4, r * 0.9);
        e.label.setText(p.name + ' (down)');
      } else {
        const rings = [];
        if (p.buff) rings.push({ color: 0xffe066, alpha: 0.7, pad: 8 });
        if (p.shield) rings.push({ color: 0x66ccff, alpha: 0.9, w: 3, pad: 11 });
        if (p.invuln) rings.push({ color: 0x5dd9ff, alpha: 0.9, w: 3, pad: 14 });
        if (p.blocking) rings.push({ color: 0x4ad0ff, alpha: 0.95, w: 4, pad: 17 });
        const fd = projectDir(Math.cos(facing), Math.sin(facing));
        drawHumanoid(g, sp.x, sp.y, r, e.color, { faceDx: fd.x, faceDy: fd.y, rings });
        e.label.setText(`${isMe ? p.name + ' (you)' : p.name}  Lv${p.level}`);
      }
      e.label.setPosition(sp.x, headTop - 8); e.hpBar.setPosition(sp.x, headTop + 8); e.hpBar.setValue(p.hp / p.maxHp);
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { e.gfx.destroy(); e.label.destroy(); e.hpBar.destroy(); this.players.delete(id); }
  }

  renderMobs(mobs) {
    const seen = new Set();
    for (const m of mobs) {
      seen.add(m.id);
      const t = MOB_TYPES[m.typeKey];
      let e = this.mobsR.get(m.id);
      if (!e) { e = { gfx: this.add.graphics(), label: this.add.text(0, 0, `Lv${m.level} ${t.name}`, { fontFamily: 'Segoe UI', fontSize: '10px', color: '#d8dcea' }).setOrigin(0.5).setDepth(55), hpBar: new HealthBar(this, 0, 0, 34, 5, { depth: 55 }), rx: m.x, ry: m.y }; this.mobsR.set(m.id, e); }
      e.rx += (m.x - e.rx) * 0.3; e.ry += (m.y - e.ry) * 0.3;
      const g = e.gfx; g.clear(); g.depth = bodyDepth(e.rx, e.ry);
      const sp = project(e.rx, e.ry);
      drawCreature(g, sp.x, sp.y, t.radius, t.color, t.kind === 'ranged');
      const top = sp.y - t.radius * (t.kind === 'ranged' ? 2.6 : 2.1);
      e.label.setPosition(sp.x, top - 6); e.hpBar.setPosition(sp.x, top + 6); e.hpBar.setValue(m.hp / m.maxHp);
    }
    for (const [id, e] of this.mobsR) if (!seen.has(id)) { e.gfx.destroy(); e.label.destroy(); e.hpBar.destroy(); this.mobsR.delete(id); }
  }

  renderMinions(list) {
    const seen = new Set();
    for (const m of list || []) {
      seen.add(m.id);
      let e = this.minionsR.get(m.id);
      if (!e) { e = { gfx: this.add.graphics(), rx: m.x, ry: m.y }; this.minionsR.set(m.id, e); }
      e.rx += (m.x - e.rx) * 0.3; e.ry += (m.y - e.ry) * 0.3;
      const g = e.gfx; g.clear(); g.depth = bodyDepth(e.rx, e.ry);
      const sp = project(e.rx, e.ry);
      drawMinion(g, sp.x, sp.y, 10);
      const bw = 24, by = sp.y - 24;
      g.fillStyle(0x220000, 1); g.fillRect(sp.x - bw / 2, by, bw, 4);
      g.fillStyle(0x66ff44, 1); g.fillRect(sp.x - bw / 2, by, bw * (m.hp / m.maxHp), 4);
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
    g.depth = bodyDepth(b.x, b.y);
    if (b.alive) {
      const sp = project(b.x, b.y);
      const fd = projectDir(Math.cos(b.facing), Math.sin(b.facing));
      drawBoss(g, sp.x, sp.y, radius, b.color != null ? b.color : CONFIG.colors.boss, { enraged: b.enraged, faceDx: fd.x, faceDy: fd.y });
    }
    if (b.telegraph) this.drawBossTelegraph(tg, b.telegraph);
  }

  // Snapshot-driven telegraph rendering (mirrors the solo drawTelegraph helper).
  // Yellow = blockable (can be partially blocked), Red = unblockable (must dodge).
  drawBossTelegraph(tg, t) {
    const alpha = 0.25 + (t.progress || 0) * 0.4;
    const isBlockable = t.blockable !== false && t.type !== 'safezone';
    const C = t.type === 'summon' ? 0xc06cff : (isBlockable ? 0xffe066 : 0xff3b3b);
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

  renderProjectiles(list) { const g = this.projGfx; g.clear(); if (!list) return; for (const pr of list) { const sp = project(pr.x, pr.y); g.fillStyle(pr.color, 1); g.fillCircle(sp.x, sp.y, pr.r); } }

  consumeFx(fx) {
    if (!fx) return;
    for (const f of fx) {
      if (f.t === 'dmg') this.spawnText(f.x, f.y - 4, f.amount, f.enemy ? '#ff6b6b' : (f.crit ? '#ffe066' : '#ffffff'), f.crit);
      else if (f.t === 'heal') this.spawnText(f.x, f.y, '+' + f.amount, '#7CFC9A');
      else if (f.t === 'xp') this.spawnText(f.x, f.y, '+' + f.amount + ' XP', '#9be8ff');
      else if (f.t === 'gold') this.spawnText(f.x, f.y, '+' + f.amount + 'g', '#ffe066');
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
      const nameText = this.add.text(x, y + boxW / 2 - 11, def.name, { fontFamily: 'Segoe UI', fontSize: '8px', color: def.color, align: 'center', wordWrap: { width: boxW - 4 } }).setOrigin(0.5).setDepth(62).setScrollFactor(0);
      const overlay = this.add.rectangle(x, y + boxW / 2, boxW, boxW, 0x000000, 0.65).setOrigin(0.5, 1).setDepth(61).setScrollFactor(0); overlay.height = 0;
      this.skillBoxes.push({ slot, def, overlay, boxW, x, y, nameText });
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

    const mapX = CONFIG.width - 44, mapY = 230;
    const mapBg = this.add.circle(mapX, mapY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x6cd0ff, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(mapX, mapY, 'M', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#6cd0ff' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    mapBg.on('pointerdown', () => this.mapPanel.toggle(this.curZone));
    this.mapBtn = { x: mapX, y: mapY, r: 22 };

    const trX = CONFIG.width - 44, trY = 280;
    const trBg = this.add.circle(trX, trY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffd24a, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.treeBadge = this.add.text(trX, trY, 'K', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    trBg.on('pointerdown', () => this.treePanel.toggle()); this.treeBtn = { x: trX, y: trY, r: 22 };

    const shX = CONFIG.width - 44, shY = 330;
    const shBg = this.add.circle(shX, shY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffe066, 0.8).setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(shX, shY, 'B', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffe066' }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    shBg.on('pointerdown', () => this.openShop()); this.shopBtn = { x: shX, y: shY, r: 22 };

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
      const sp = me.skillPoints || 0;
      this.statsText.setText([`${this.classDef.name}  Lv ${me.level}`, `HP ${Math.ceil(meEnt.hp)}/${meEnt.maxHp}`, `XP ${me.xp}/${me.xpToNext}`, `Gold ${(me.gold || 0).toLocaleString()}`, `STR ${s.STR} DEX ${s.DEX} INT ${s.INT} VIT ${s.VIT} AGI ${s.AGI}`, me.statPoints > 0 ? `>> ${me.statPoints} stat point(s) — press C` : '', sp > 0 ? `>> ${sp} skill point(s) — press K` : ''].filter(Boolean).join('\n'));
      this.xpFill.width = CONFIG.width * Phaser.Math.Clamp(me.xp / me.xpToNext, 0, 1);
      if (this.treeBadge) this.treeBadge.setColor(sp > 0 ? '#7CFC9A' : '#ffd24a');
      for (const sb of this.skillBoxes) sb.overlay.height = sb.boxW * Phaser.Math.Clamp((me.cd[sb.slot] || 0) / sb.def.cd, 0, 1);
    }
    this.zoneText.setText(`Party ${this.net.code}   ·   ${z.name}${z.safe ? '  (safe)' : ''}`);
    const lines = snap.players.map((p) => `${p.id === this.net.youId ? '>' : ' '} ${p.name} Lv${p.level}  ${Math.ceil(p.hp)}/${p.maxHp}`);
    this.partyText.setText('PARTY (this zone)\n' + lines.join('\n'));
    if (this.charPanelOpen) this.refreshCharPanel();
  }

  // ------------------------------------------------------------------- fx ----
  spawnText(x, y, value, color = '#ffffff', big = false) { const sp = project(x, y); const txt = this.add.text(sp.x, sp.y, String(value), { fontFamily: 'Segoe UI', fontSize: big ? '20px' : '14px', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(80); this.tweens.add({ targets: txt, y: sp.y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() }); }
  spawnArc(cx, cy, facing, range, half) { const gfx = this.add.graphics(); gfx.depth = 5e6; this.world.add(gfx); let t = 0; const ev = this.time.addEvent({ delay: 14, loop: true, callback: () => { t += 14; gfx.clear(); gfx.lineStyle(5, 0xffeedd, (1 - t / 170) * 0.9); gfx.beginPath(); const steps = 12; for (let i = 0; i <= steps; i++) { const a = facing - half + (half * 2 * i) / steps; const px = cx + Math.cos(a) * range, py = cy + Math.sin(a) * range; i === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py); } gfx.strokePath(); if (t >= 170) { gfx.destroy(); ev.remove(); } } }); }
  spawnRing(x, y, radius, colorHex) { const color = this.hexToInt(colorHex, 0xc89bff); const fx = this.add.graphics(); fx.depth = 5e6; this.world.add(fx); let t = 0; const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => { t += 16; fx.clear(); fx.lineStyle(4, color, Phaser.Math.Clamp(1 - t / 300, 0, 1)); fx.strokeCircle(x, y, radius * (t / 300)); if (t >= 300) { fx.destroy(); ev.remove(); } } }); }
  spawnBlast(x, y, radius, colorHex) { const color = this.hexToInt(colorHex, 0xff7a3c); const fx = this.add.graphics(); fx.depth = 5e6; this.world.add(fx); let t = 0; const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => { t += 16; const p = t / 280; fx.clear(); fx.fillStyle(color, (1 - p) * 0.5); fx.fillCircle(x, y, radius * Math.min(1, p * 1.2)); fx.lineStyle(3, color, 1 - p); fx.strokeCircle(x, y, radius); if (t >= 280) { fx.destroy(); ev.remove(); } } }); }
  hexToInt(hex, fallback) { if (typeof hex === 'number') return hex; if (typeof hex === 'string' && hex[0] === '#') return parseInt(hex.slice(1), 16); return fallback; }
}
