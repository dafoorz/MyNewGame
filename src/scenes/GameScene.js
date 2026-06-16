import { CONFIG } from '../config.js';
import { Stats } from '../stats.js';
import AggroTable from '../systems/AggroTable.js';
import Progression from '../systems/Progression.js';
import Player from '../entities/Player.js';
import Boss from '../entities/Boss.js';
import Mob from '../entities/Mob.js';
import Minion from '../entities/Minion.js';
import { ZONES, START_ZONE, zonePortals, zoneWaystones, findWaystone } from '../world/zones.js';
import { CLASSES, DEFAULT_CLASS } from '../classes/classes.js';
import { loadProgress, saveProgress, clearProgress, loadWorldSeed } from '../progress.js';
import SettingsPanel from '../ui/SettingsPanel.js';
import InventoryPanel from '../ui/InventoryPanel.js';
import MapPanel from '../ui/MapPanel.js';
import SkillTreePanel from '../ui/SkillTreePanel.js';
import ShopPanel from '../ui/ShopPanel.js';
import MiniMap from '../ui/MiniMap.js';
import { buildFromTree, effectiveSkills, sanitizeAllocation, availablePoints, canSpend } from '../skilltree.js';
import {
  STAT_KEYS, EQUIP_SLOTS, INV_CAP, emptyGear, totalAttrs, canEquip, sanitizeItem,
  rollDrop, rollItem, rarityColor, mobGold, bossGold,
} from '../items.js';
import { buyCost, rollShopItem, upgradeCost, upgradeItem } from '../shop.js';
import { applyIso, project, unproject, dirToWorld, zoneBounds, bodyDepth } from '../iso.js';

const STAT_INFO = [
  ['STR', 'melee damage'],
  ['DEX', 'crit / atk speed'],
  ['INT', 'magic damage'],
  ['VIT', 'max health'],
  ['AGI', 'move speed'],
];

const PROJ_COLOR = { phys: 0xffe2a8, mag: 0x9be8ff };

export default class GameScene extends Phaser.Scene {
  preload() {
    this.load.image('town_inn', 'assets/town/inn.png');
    this.load.image('town_blue_house', 'assets/town/blue_house.png');
    this.load.image('town_tea_shop', 'assets/town/tea_shop.png');
    this.load.image('town_top_angle_house', 'assets/town/top_angle_house.png');
  }
  preload() {
    this.load.image('town_inn', 'assets/town/inn.png');
    this.load.image('town_blue_house', 'assets/town/blue_house.png');
    this.load.image('town_tea_shop', 'assets/town/tea_shop.png');
  }
  constructor() {
    super('GameScene');
  }

  create(data) {
    this.isTouch = this.sys.game.device.input.touch || 'ontouchstart' in window;

    // Isometric world container: all world GRAPHICS live here and inherit the
    // iso transform (ground, bodies, telegraphs, projectiles, FX). Text and
    // health bars stay in scene space, positioned via project() so they stay
    // crisp. The simulation itself is unchanged — flat world coordinates.
    this.world = applyIso(this.add.container(0, 0));

    // --- chosen class -> player build ---
    this.classKey = (data && data.classKey) || DEFAULT_CLASS;
    this.classDef = CLASSES[this.classKey];
    this.skills = this.classDef.skills;
    this.basic = this.classDef.basic;

    this.seed = loadWorldSeed();          // fixes the hidden dungeon portal layout
    this.discovered = new Set(['town']);  // discovered waystones (fast-travel)

    this.progression = new Progression();
    this.gold = 0;
    // Loot & equipment: base/leveled attributes live in baseAttrs; the player's
    // derived Stats are rebuilt from baseAttrs + equipped gear + skill tree.
    this.baseAttrs = { ...this.classDef.stats };
    this.gear = emptyGear();
    this.inventory = [];
    this.skillTree = {}; // skill-tree allocation { nodeId: rank }
    this.recomputeBuild();
    this.player = new Player(this, 200, 400, new Stats(totalAttrs(this.baseAttrs, this.gear)), {
      name: this.classDef.name,
      color: this.classDef.color,
      threatMultiplier: this.classDef.threat,
      attackRange: this.basic.range,
    });
    // The player BODY is an upright billboard in scene space (not the squashed
    // world container) — only its ground position is projected.

    // Restore this class's saved progress on this device (if any).
    const saved = loadProgress(this.classKey);
    if (saved) {
      this.progression.level = Math.max(1, saved.level);
      this.progression.xp = Math.max(0, saved.xp);
      this.progression.statPoints = Math.max(0, saved.statPoints);
      this.gold = Math.max(0, saved.gold | 0);
      for (const attr of STAT_KEYS) if (saved.stats[attr] != null) this.baseAttrs[attr] = saved.stats[attr];
      if (Array.isArray(saved.inventory)) this.inventory = saved.inventory.map(sanitizeItem).filter(Boolean).slice(0, INV_CAP);
      if (saved.gear) for (const slot of EQUIP_SLOTS) {
        const it = sanitizeItem(saved.gear[slot]);
        if (it && it.slot === slot && canEquip(this.classKey, it)) this.gear[slot] = it;
      }
      if (Array.isArray(saved.waypoints)) for (const w of saved.waypoints) this.discovered.add(w);
      // Skill tree: re-derive a legal allocation from the save (drops anything
      // the current level can't afford).
      this.skillTree = sanitizeAllocation(this.classKey, saved.skillTree, this.progression.level);
      this.recomputeBuild();
      this.recomputeStats();
      this.player.hp = this.player.maxHp;
    }

    // Per-zone state.
    this.mobs = [];
    this.projectiles = [];
    this.minions = [];
    this.dots = [];
    this.boss = null;
    this.aggro = new AggroTable();
    this.portalSprites = [];
    this.respawnToken = 0;
    this.autoAim = false;

    // Ground at the bottom, portals + waystones just above it, projectiles above bodies.
    // (Bodies/telegraphs depth-sort by world position; see iso depth().)
    this.zoneGfx = this.add.graphics(); this.zoneGfx.depth = -1e7; this.world.add(this.zoneGfx);
    this.portalGfx = this.add.graphics(); this.portalGfx.depth = -9e6; this.world.add(this.portalGfx);
    this.waystoneGfx = this.add.graphics(); this.waystoneGfx.depth = -9e6 + 1; this.world.add(this.waystoneGfx);
    this.projGfx = this.add.graphics().setDepth(53); // projectiles: upright billboards

    this.setupInput();
    this.buildHud();
    this.buildTouchControls();
    this.buildCharPanel();
    this.invPanel = new InventoryPanel(this, {
      getModel: () => ({
        classKey: this.classKey,
        statPoints: this.progression.statPoints,
        baseStats: this.baseAttrs,
        stats: this.player.stats,
        inventory: this.inventory,
        gear: this.gear,
      }),
      onEquip: (itemId) => this.equipItem(itemId),
      onUnequip: (slot) => this.unequipItem(slot),
      onDiscard: (itemId) => this.discardItem(itemId),
    });
    this.mapPanel = new MapPanel(this, {
      getZoneKey: () => this.zoneKey,
      getDiscovered: () => this.discovered,
      getSeed: () => this.seed,
      onTravel: (id) => this.travelToWaystone(id),
    });
    this.treePanel = new SkillTreePanel(this, {
      getModel: () => ({ classKey: this.classKey, level: this.progression.level, alloc: this.skillTree }),
      onSpend: (nodeId) => this.spendSkillNode(nodeId),
      onRespec: () => this.respecSkills(),
    });
    this.settings = new SettingsPanel(this, {
      onMainMenu: () => { this.persist(); this.scene.start('LobbyScene'); },
      onResetProgress: () => { clearProgress(this.classKey); this.scene.restart({ classKey: this.classKey }); },
    });
    this.shopPanel = new ShopPanel(this, {
      getModel: () => ({ classKey: this.classKey, gold: this.gold, gear: this.gear }),
      onBuy: (slot, tier) => this.buyGear(slot, tier),
      onUpgrade: (slot) => this.upgradeGear(slot),
    });

    this.miniMap = new MiniMap(this);

    this.loadZone(START_ZONE, null);
  }

  // =============================================================== ZONES =====

  loadZone(key, fromKey, at = null) {
    this.respawnToken++;
    if (key !== 'town' && this.shopPanel && this.shopPanel.open) this.shopPanel.close();
    this.zoneKey = key;
    this.zone = ZONES[key];
    const z = this.zone;
    const bounds = { x: 0, y: 0, w: z.size.w, h: z.size.h };
    this.bounds = bounds;
    this.portals = zonePortals(key, this.seed);   // resolved (random portals fixed)
    this.waystones = zoneWaystones(key, this.seed);

    this.mobs.forEach((m) => m.destroy());
    this.mobs = [];
    this.minions.forEach((m) => m.destroy());
    this.minions = [];
    this.projectiles = [];
    this.dots = [];
    this.projGfx.clear();
    if (this.boss) { this.boss.destroy(); this.boss = null; }
    this.aggro = new AggroTable();
    this.portalSprites.forEach((o) => o.destroy());
    this.portalSprites = [];

    const zb = zoneBounds(z.size.w, z.size.h); // camera bounds in projected space
    this.cameras.main.setBounds(zb.x, zb.y, zb.w, zb.h);
    this.player.bounds = bounds;

    if (at) {
      this.player.x = at.x;
      this.player.y = at.y;
    } else {
      const entry = this.portals.find((p) => p.to === fromKey);
      if (entry) {
        const dx = entry.x < z.size.w / 2 ? 70 : entry.x > z.size.w - 80 ? -70 : 0;
        const dy = entry.y < z.size.h / 2 ? 70 : entry.y > z.size.h - 80 ? -70 : 0;
        this.player.x = entry.x + dx;
        this.player.y = entry.y + dy;
      } else {
        this.player.x = z.size.w / 2;
        this.player.y = z.size.h / 2;
      }
    }

    this.drawZoneBackground(z);
    this.drawPortals();
    this.drawWaystones();

    if (z.raid) {
      this.raidState = 'wave1';
      this.spawnRaidWave(12);
      this.showZoneBanner('Ancient Bastion — Defeat the enemies!');
    } else if (z.boss) {
      this.spawnBossEncounter(bounds);
    } else if (z.mobTypes) {
      this.spawnMobs(z, bounds);
    }

    this.portalLock = true;
    this.showZoneBanner(z.name);
    this.centerCamera(true);
  }

  drawZoneBackground(z) {
    const g = this.zoneGfx;
    g.clear();
    g.fillStyle(z.bg, 1);
    g.fillRect(0, 0, z.size.w, z.size.h);

    if (this.zoneKey === 'town') {
      // Riverwood: hand-painted readable hub layout with roads, grass, river edge,
      // plaza, market area, and decorative trees that survive the iso projection.
      g.fillStyle(0x25472d, 1);
      g.fillRect(0, 0, z.size.w, z.size.h);

      // outer meadow bands
      g.fillStyle(0x2e5a38, 1); g.fillRect(34, 34, z.size.w - 68, z.size.h - 68);
      g.fillStyle(0x3a6a42, 0.95); g.fillRect(86, 86, z.size.w - 172, z.size.h - 172);

      // river/cove edge on the north-west side
      g.fillStyle(0x24505f, 0.95);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(420, 0);
      g.lineTo(300, 110);
      g.lineTo(220, 210);
      g.lineTo(110, 260);
      g.lineTo(0, 300);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x3d8795, 0.9);
      g.beginPath();
      g.moveTo(0, 34);
      g.lineTo(362, 34);
      g.lineTo(266, 126);
      g.lineTo(198, 198);
      g.lineTo(100, 244);
      g.lineTo(0, 278);
      g.closePath();
      g.fillPath();

      // central roads
      g.lineStyle(72, 0x947048, 1); g.lineCap = 'round';
      g.beginPath();
      g.moveTo(70, 525);
      g.lineTo(330, 525);
      g.lineTo(520, 540);
      g.lineTo(760, 560);
      g.lineTo(980, 540);
      g.lineTo(1200, 530);
      g.lineTo(1430, 530);
      g.strokePath();

      g.lineStyle(64, 0x8a6840, 1);
      g.beginPath();
      g.moveTo(750, 120);
      g.lineTo(748, 260);
      g.lineTo(752, 420);
      g.lineTo(760, 560);
      g.lineTo(742, 700);
      g.lineTo(720, 860);
      g.lineTo(706, 980);
      g.strokePath();

      // road edging + highlights
      g.lineStyle(36, 0x8d6943, 0.34);
      g.beginPath();
      g.moveTo(90, 525); g.lineTo(1430, 525); g.strokePath();
      g.beginPath();
      g.moveTo(752, 120); g.lineTo(720, 980); g.strokePath();
      g.lineStyle(16, 0xb38a57, 0.68);
      g.beginPath();
      g.moveTo(90, 525); g.lineTo(1430, 525); g.strokePath();
      g.beginPath();
      g.moveTo(752, 120); g.lineTo(720, 980); g.strokePath();
      g.lineStyle(4, 0xd3b17a, 0.45);
      g.beginPath();
      g.moveTo(90, 516); g.lineTo(1430, 516); g.strokePath();
      g.beginPath();
      g.moveTo(746, 120); g.lineTo(714, 980); g.strokePath();

      // riverbank polish
      g.fillStyle(0x7dc3da, 0.28); g.fillRect(1212, 0, 250, z.size.h);
      g.lineStyle(6, 0xe8e1a2, 0.55); g.beginPath(); g.moveTo(1200, 0); g.lineTo(1200, z.size.h); g.strokePath();
      g.lineStyle(2, 0xffffff, 0.16);
      for (let yy = 60; yy < z.size.h; yy += 100) { g.lineBetween(1230, yy, 1410, yy + 26); }

      // plaza around waystone
      g.fillStyle(0x7e684a, 1); g.fillCircle(750, 560, 126);
      g.fillStyle(0x99815f, 1); g.fillCircle(750, 560, 90);
      g.lineStyle(5, 0xcdb58a, 0.7);
      for (let r in [52, 88, 122]) {}
      [52, 88, 122].forEach((r) => g.strokeCircle(750, 560, r));

      // market square near the shop
      g.fillStyle(0x6d5338, 0.95); g.fillRoundedRect(620, 255, 260, 156, 18);
      g.lineStyle(4, 0xb79058, 0.8); g.strokeRoundedRect(620, 255, 260, 156, 18);
      g.fillStyle(0xb5443c, 0.85); g.fillRect(650, 272, 74, 38);
      g.fillStyle(0xcfb15c, 0.85); g.fillRect(730, 272, 60, 38);
      g.fillStyle(0x5b7f43, 0.85); g.fillRect(796, 272, 52, 38);
      g.fillStyle(0x7a3430, 0.85); g.fillRect(662, 320, 82, 42);
      g.fillStyle(0x4a6d78, 0.85); g.fillRect(752, 320, 74, 42);


      // fences toward exits
      g.lineStyle(6, 0x5f452e, 0.9);
      for (let x = 120; x <= 340; x += 32) { g.lineBetween(x, 180, x, 230); }
      g.lineBetween(104, 196, 356, 196); g.lineBetween(104, 222, 356, 222);
      for (let x = 1150; x <= 1370; x += 32) { g.lineBetween(x, 856, x, 906); }
      g.lineBetween(1134, 872, 1386, 872); g.lineBetween(1134, 898, 1386, 898);


      // flower patches / visual breakup
      const patches = [
        [540, 470, 38, 18], [952, 468, 36, 18], [622, 770, 46, 22], [866, 760, 42, 20], [540, 208, 48, 20], [1180, 618, 44, 22],
      ];
      for (const [x, y, w, h] of patches) {
        g.fillStyle(0x487b48, 0.55); g.fillEllipse(x, y, w, h);
        g.fillStyle(0xc9c36c, 0.35); g.fillEllipse(x + 6, y - 2, w * 0.35, h * 0.35);
      }

      g.lineStyle(8, 0x4f3523, 0.8);
      g.strokeRect(10, 10, z.size.w - 20, z.size.h - 20);

      this.drawTownProps();
      return;
    }

    g.lineStyle(6, z.accent, 1);
    g.strokeRect(3, 3, z.size.w - 6, z.size.h - 6);
    g.lineStyle(1, z.accent, 0.4);
    for (let x = 80; x < z.size.w; x += 80) g.lineBetween(x, 0, x, z.size.h);
    for (let y = 80; y < z.size.h; y += 80) g.lineBetween(0, y, z.size.w, y);
  }

  drawTownProps() {
    if (this.townPropLayer) this.townPropLayer.forEach((o) => o.g.destroy());
    this.townPropLayer = [];

    const houses = [
      { type: 'inn', x: 770, y: 548, roof: 0x7c5a35, wall: 0xe1cfaa, trim: 0x694830, door: 0x6a432d, w: 198, h: 150, deck: true, chimney: true },
      { type: 'cottageBlue', x: 1112, y: 438, roof: 0x4e88b7, wall: 0xe4dcc7, trim: 0x5c4f41, door: 0x744d35, w: 144, h: 108, chimney: true },
      { type: 'tea', x: 520, y: 850, roof: 0x8c5393, wall: 0xd8b1c8, trim: 0x603857, door: 0x6d4059, w: 166, h: 126, deck: true, chimney: true },
      { type: 'cottageBlue', x: 1152, y: 920, roof: 0x4d80b1, wall: 0xd8d3c4, trim: 0x4f473d, door: 0x6f4a34, w: 146, h: 110, chimney: true },
    ];
    for (const h of houses) this.spawnHouseProp(h);

    const trees = [
      [220, 240, 1.15], [174, 518, 1.0], [238, 910, 0.95], [432, 212, 0.95], [934, 180, 0.92],
      [1260, 210, 0.95], [1324, 404, 1.0], [1304, 736, 0.95], [1008, 994, 0.92], [352, 1000, 0.95],
    ];
    for (const [x, y, s] of trees) this.spawnTreeProp({ x, y, scale: s });

    const props = [
      { kind: 'lamp', x: 116, y: 602 },
      { kind: 'lamp', x: 1218, y: 786 },
      { kind: 'barrel', x: 676, y: 474 }, { kind: 'barrel', x: 708, y: 474 },
      { kind: 'crate', x: 1060, y: 502 }, { kind: 'barrel', x: 1094, y: 520 },
      { kind: 'barrel', x: 454, y: 874 }, { kind: 'crate', x: 1200, y: 946 },
      { kind: 'stall', x: 770, y: 366, cloth: 0xc45747 },
      { kind: 'stall', x: 690, y: 362, cloth: 0xcfb15c },
      { kind: 'sign', x: 614, y: 612 },
      { kind: 'bush', x: 604, y: 474 }, { kind: 'bush', x: 930, y: 480 }, { kind: 'bush', x: 852, y: 812 },
      { kind: 'bush', x: 1030, y: 618 }, { kind: 'bush', x: 582, y: 222 },
    ];
    for (const p of props) this.spawnTownDetail(p);
  }

  spawnHouseProp(data) {
    const g = this.add.graphics();
    this.townPropLayer.push({ kind: 'house', ...data, spriteKey: data.spriteKey || null, spriteScale: data.spriteScale || 1, spriteYOffset: data.spriteYOffset || 0, g });
  }

  spawnTreeProp(data) {
    const g = this.add.graphics();
    this.townPropLayer.push({ kind: 'tree', ...data, g });
  }

  spawnTownDetail(data) {
    const g = this.add.graphics();
    this.townPropLayer.push({ ...data, g });
  }

  updateTownProps() {
    if (!this.townPropLayer || !this.townPropLayer.length) return;
    for (const o of this.townPropLayer) {
      const g = o.g;
      const p = project(o.x, o.y);
      g.clear();
      g.setDepth(bodyDepth(o.x, o.y));

      if (o.kind === 'house') {
        if (o.spriteKey && this.textures.exists(o.spriteKey)) {
          if (!o.sprite) {
            o.sprite = this.add.image(p.x, p.y + (o.spriteYOffset || 0), o.spriteKey);
            o.sprite.setOrigin(0.5, 1);
          }
          o.sprite.setPosition(p.x, p.y + (o.spriteYOffset || 0));
          o.sprite.setScale(o.spriteScale || 1);
          o.sprite.setDepth(bodyDepth(o.x, o.y));
          g.clear();
          g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 8, o.w * 0.76, 18);
          continue;
        } else if (o.sprite) {
          o.sprite.destroy();
          o.sprite = null;
        }
        const w = o.w, h = o.h;
        const frontW = Math.round(w * 0.78);
        const sideW = Math.round(w * 0.2);
        const frontLeft = Math.round(p.x - frontW / 2);
        const frontRight = frontLeft + frontW;
        const sideRight = frontRight + sideW;
        const baseY = Math.round(p.y);
        const top = Math.round(baseY - h);
        const wallTop = Math.round(top + h * 0.44);
        const roofPeakY = Math.round(top - h * 0.14);
        const roofLeftX = Math.round(frontLeft + frontW * 0.16);
        const roofRightX = Math.round(frontRight - frontW * 0.14);
        const eaveY = Math.round(wallTop + 8);
        const roofLip = 10;
        const doorW = Math.max(20, Math.round(w * 0.13));
        const doorH = Math.max(30, Math.round(h * 0.24));
        const wallShade = Phaser.Display.Color.IntegerToColor(o.wall).darken(10).color;
        const wallDeep = Phaser.Display.Color.IntegerToColor(o.wall).darken(24).color;
        const wallLight = Phaser.Display.Color.IntegerToColor(o.wall).lighten(10).color;
        const roofDark = Phaser.Display.Color.IntegerToColor(o.roof).darken(20).color;
        const roofSide = Phaser.Display.Color.IntegerToColor(o.roof).darken(34).color;
        const trimDark = Phaser.Display.Color.IntegerToColor(o.trim).darken(10).color;

        g.fillStyle(0x000000, 0.14); g.fillEllipse(p.x + sideW * 0.18, baseY + 7, w * 0.78, 20);

        if (o.deck) {
          g.fillStyle(0xc4955f, 1); g.fillRoundedRect(frontLeft - 18, baseY - 18, frontW + sideW + 34, 22, 6);
          g.lineStyle(2, 0x7b5936, 0.45); g.strokeRoundedRect(frontLeft - 18, baseY - 18, frontW + sideW + 34, 22, 6);
          g.lineStyle(1, 0x9f7748, 0.4);
          for (let xx = frontLeft - 6; xx < sideRight + 14; xx += 14) g.lineBetween(xx, baseY - 16, xx, baseY + 2);
        }

        g.fillStyle(wallDeep, 1);
        g.beginPath();
        g.moveTo(frontRight, wallTop + 2);
        g.lineTo(sideRight, wallTop - 8);
        g.lineTo(sideRight, baseY);
        g.lineTo(frontRight, baseY);
        g.closePath();
        g.fillPath();
        g.lineStyle(2, trimDark, 0.5); g.strokePath();

        g.fillStyle(o.wall, 1); g.fillRoundedRect(frontLeft, wallTop, frontW, baseY - wallTop, 8);
        g.fillStyle(wallLight, 0.18); g.fillRect(frontLeft + 6, wallTop + 4, frontW - 12, 6);
        g.fillStyle(wallShade, 1); g.fillRect(frontLeft + 8, wallTop + 12, frontW - 16, 10);
        g.lineStyle(2, o.trim, 0.55); g.strokeRoundedRect(frontLeft, wallTop, frontW, baseY - wallTop, 8);

        g.fillStyle(roofSide, 1);
        g.beginPath();
        g.moveTo(roofRightX, top + 14);
        g.lineTo(sideRight + 8, top + 26);
        g.lineTo(sideRight + 10, eaveY + 1);
        g.lineTo(frontRight + 8, eaveY + roofLip - 2);
        g.closePath();
        g.fillPath();

        g.fillStyle(o.roof, 1);
        g.beginPath();
        g.moveTo(frontLeft - 10, eaveY);
        g.lineTo(roofLeftX, top + 14);
        g.lineTo(p.x, roofPeakY);
        g.lineTo(roofRightX, top + 14);
        g.lineTo(frontRight + 8, eaveY);
        g.closePath();
        g.fillPath();

        g.fillStyle(roofDark, 1);
        g.beginPath();
        g.moveTo(frontLeft - 12, eaveY + roofLip / 2);
        g.lineTo(frontLeft - 2, eaveY - 1);
        g.lineTo(frontRight + 2, eaveY - 1);
        g.lineTo(frontRight + 12, eaveY + roofLip / 2);
        g.lineTo(frontRight + 8, eaveY + roofLip);
        g.lineTo(frontLeft - 8, eaveY + roofLip);
        g.closePath();
        g.fillPath();

        g.lineStyle(2, roofDark, 0.55);
        for (let yy = top + 18; yy < eaveY - 1; yy += 8) {
          g.beginPath();
          g.moveTo(roofLeftX - 2, yy);
          g.lineTo(roofRightX + 2, yy);
          g.strokePath();
        }
        g.lineStyle(2, 0xf6e6be, 0.22);
        g.beginPath();
        g.moveTo(roofLeftX + 8, top + 18);
        g.lineTo(p.x, roofPeakY + 10);
        g.lineTo(roofRightX - 8, top + 18);
        g.strokePath();

        if (o.chimney) {
          const cx = Math.round(roofRightX - 6);
          g.fillStyle(0x7f6d61, 1); g.fillRoundedRect(cx, top + 10, 16, 25, 3);
          g.lineStyle(2, 0x58493f, 0.45); g.strokeRoundedRect(cx, top + 10, 16, 25, 3);
          g.fillStyle(0xa89888, 1); g.fillRect(cx + 2, top + 8, 12, 4);
        }

        const doorX = Math.round(p.x - doorW / 2);
        const doorY = Math.round(baseY - doorH - 4);
        g.fillStyle(o.door, 1); g.fillRoundedRect(doorX, doorY, doorW, doorH, 5);
        g.lineStyle(2, 0x2e1b12, 0.5); g.strokeRoundedRect(doorX, doorY, doorW, doorH, 5);
        g.fillStyle(0x1d1010, 0.18); g.fillRect(doorX + 3, doorY + 4, doorW - 6, doorH - 8);
        g.fillStyle(0xf0d66a, 0.45); g.fillCircle(doorX + doorW - 5, doorY + doorH / 2, 2);

        const winW = Math.round(frontW * 0.18), winH = Math.round(h * 0.13);
        const wy = wallTop + 18;
        for (const wx of [Math.round(frontLeft + frontW * 0.26), Math.round(frontLeft + frontW * 0.74)]) {
          g.fillStyle(0xd8f0ff, 1); g.fillRoundedRect(wx - winW / 2, wy, winW, winH, 4);
          g.lineStyle(2, o.trim, 0.45); g.strokeRoundedRect(wx - winW / 2, wy, winW, winH, 4);
          g.lineBetween(wx, wy + 2, wx, wy + winH - 2);
          g.lineBetween(wx - winW / 2 + 2, wy + winH / 2, wx + winW / 2 - 2, wy + winH / 2);
          g.fillStyle(0xffffff, 0.16); g.fillRect(wx - winW / 2 + 2, wy + 2, winW - 4, 3);
        }

        if (o.type === 'inn') {
          g.fillStyle(0x745031, 1); g.fillRoundedRect(Math.round(p.x - 34), wallTop - 26, 68, 16, 5);
          g.lineStyle(2, 0x3f2818, 0.55); g.strokeRoundedRect(Math.round(p.x - 34), wallTop - 26, 68, 16, 5);
          g.fillStyle(0xd5b98c, 0.45); g.fillRect(Math.round(p.x - 28), wallTop - 22, 56, 4);
        }
      } else if (o.kind === 'tree') {
        const s = o.scale || 1;
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 6, 58 * s, 18 * s);
        g.fillStyle(0x6e492d, 1); g.fillRoundedRect(p.x - 7 * s, p.y - 48 * s, 14 * s, 36 * s, 5);
        g.fillStyle(0x274d2d, 1); g.fillCircle(p.x, p.y - 82 * s, 26 * s);
        g.fillStyle(0x35693c, 1); g.fillCircle(p.x - 20 * s, p.y - 64 * s, 20 * s);
        g.fillStyle(0x35693c, 1); g.fillCircle(p.x + 20 * s, p.y - 64 * s, 20 * s);
        g.fillStyle(0x508755, 1); g.fillCircle(p.x, p.y - 54 * s, 18 * s);
        g.fillStyle(0x8ac17a, 0.24); g.fillCircle(p.x - 8 * s, p.y - 88 * s, 9 * s);
      } else if (o.kind === 'lamp') {
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 4, 22, 8);
        g.lineStyle(4, 0x51616c, 1); g.lineBetween(p.x, p.y - 38, p.x, p.y - 6);
        g.fillStyle(0x87c7db, 0.95); g.fillCircle(p.x, p.y - 44, 8);
        g.lineStyle(2, 0xd9f3ff, 0.4); g.strokeCircle(p.x, p.y - 44, 11);
      } else if (o.kind === 'stall') {
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 5, 54, 14);
        g.lineStyle(4, 0x714f31, 1); g.lineBetween(p.x - 18, p.y - 2, p.x - 18, p.y - 28); g.lineBetween(p.x + 18, p.y - 2, p.x + 18, p.y - 28);
        g.fillStyle(o.cloth || 0xc45747, 1); g.fillRoundedRect(p.x - 24, p.y - 34, 48, 14, 5);
        g.lineStyle(2, 0x5b2d2d, 0.45); g.strokeRoundedRect(p.x - 24, p.y - 34, 48, 14, 5);
        g.fillStyle(0xd1b27b, 1); g.fillRect(p.x - 18, p.y - 16, 36, 12);
      } else if (o.kind === 'sign') {
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 4, 24, 8);
        g.lineStyle(4, 0x6b4b2e, 1); g.lineBetween(p.x, p.y - 28, p.x, p.y - 4);
        g.fillStyle(0xd9c396, 1); g.fillRoundedRect(p.x - 14, p.y - 38, 28, 16, 4);
        g.lineStyle(2, 0x6b4b2e, 0.6); g.strokeRoundedRect(p.x - 14, p.y - 38, 28, 16, 4);
      } else if (o.kind === 'bush') {
        g.fillStyle(0x000000, 0.1); g.fillEllipse(p.x, p.y + 4, 28, 10);
        g.fillStyle(0x3f713f, 1); g.fillCircle(p.x - 8, p.y - 4, 10);
        g.fillStyle(0x528951, 1); g.fillCircle(p.x + 2, p.y - 7, 11);
        g.fillStyle(0x6aa463, 0.45); g.fillCircle(p.x + 7, p.y - 10, 6);
      } else if (o.kind === 'barrel') {
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 3, 20, 8);
        g.fillStyle(0x7f5a35, 1); g.fillRoundedRect(p.x - 8, p.y - 16, 16, 18, 5);
        g.lineStyle(2, 0x47311f, 0.65); g.strokeRoundedRect(p.x - 8, p.y - 16, 16, 18, 5);
        g.lineBetween(p.x - 8, p.y - 10, p.x + 8, p.y - 10); g.lineBetween(p.x - 8, p.y - 2, p.x + 8, p.y - 2);
      } else if (o.kind === 'crate') {
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, p.y + 3, 22, 8);
        g.fillStyle(0x8a633e, 1); g.fillRoundedRect(p.x - 9, p.y - 15, 18, 16, 4);
        g.lineStyle(2, 0x4f3824, 0.65); g.strokeRoundedRect(p.x - 9, p.y - 15, 18, 16, 4);
        g.lineBetween(p.x - 9, p.y - 15, p.x + 9, p.y + 1); g.lineBetween(p.x + 9, p.y - 15, p.x - 9, p.y + 1);
      }
    }
  }


  drawPortals() {
    const g = this.portalGfx;
    g.clear();
    for (const p of this.portals) {
      const isDungeon = ZONES[p.to] && (ZONES[p.to].dungeon || ZONES[p.to].raid);
      const col = ZONES[p.to] && ZONES[p.to].raid ? 0xc06cff : (isDungeon ? 0xff9a5a : 0x6cd0ff);
      g.fillStyle(col, 0.25);
      g.fillCircle(p.x, p.y, 40);
      g.lineStyle(3, col, 0.9);
      g.strokeCircle(p.x, p.y, 40);
      const sp = project(p.x, p.y);
      const label = this.add.text(sp.x, sp.y - 56, p.label, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', fontStyle: 'bold',
        color: '#bfe9ff', stroke: '#06121c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(40);
      this.portalSprites.push(label);
    }
    // Town market stall.
    const shop = this.zone && this.zone.shop;
    if (shop) {
      g.fillStyle(0x6a4a1a, 0.5); g.fillCircle(shop.x, shop.y, 34);
      g.lineStyle(3, 0xffe066, 0.9); g.strokeCircle(shop.x, shop.y, 34);
      const ssp = project(shop.x, shop.y);
      const slabel = this.add.text(ssp.x, ssp.y - 50, '🛒 Market (B)', {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', fontStyle: 'bold',
        color: '#ffe066', stroke: '#06121c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(40);
      this.portalSprites.push(slabel);
    }
  }

  // Fast-travel shrines. Cyan obelisk once discovered; dim & locked until then.
  drawWaystones() {
    const g = this.waystoneGfx;
    g.clear();
    for (const w of this.waystones) {
      const known = this.discovered.has(w.id);
      const col = known ? 0x4ad0ff : 0x55607a;
      g.fillStyle(col, known ? 0.22 : 0.12);
      g.fillCircle(w.x, w.y, 26);
      g.lineStyle(3, col, known ? 0.95 : 0.6);
      g.strokeCircle(w.x, w.y, 26);
      // little obelisk
      g.fillStyle(col, known ? 0.9 : 0.5);
      g.fillRect(w.x - 5, w.y - 18, 10, 30);
      const label = this.add.text(w.x, w.y - 34, (known ? '◈ ' : '🔒 ') + w.name, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '11px', fontStyle: 'bold',
        color: known ? '#bff0ff' : '#8b93ad', stroke: '#06121c', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(2);
      this.portalSprites.push(label);
    }
  }

  // Discover any waystone the player is standing on (solo).
  checkWaystones() {
    if (!this.waystones) return;
    for (const w of this.waystones) {
      if (this.discovered.has(w.id)) continue;
      if (Math.hypot(w.x - this.player.x, w.y - this.player.y) <= 46) {
        this.discovered.add(w.id);
        this.spawnText(w.x, w.y - 50, 'Waystone discovered: ' + w.name, '#4ad0ff', true);
        this.drawWaystones();
        this.persist();
      }
    }
  }

  travelToWaystone(id) {
    const w = findWaystone(id, this.seed);
    if (!w || !this.discovered.has(id)) return;
    const here = ZONES[this.zoneKey];
    if (here && (here.dungeon || here.raid)) { // no fast-travel out of a dungeon/raid
      this.spawnText(this.player.x, this.player.y - 64, "Can't travel inside a dungeon", '#ff7a7a');
      return;
    }
    if (this.player.inCombat) {                 // no fast-travel during combat
      this.spawnText(this.player.x, this.player.y - 64, "Can't travel in combat", '#ff7a7a');
      return;
    }
    if (w.zoneKey === this.zoneKey) {
      this.player.x = w.x; this.player.y = w.y;
      this.portalLock = true;
      this.centerCamera(true);
    } else {
      this.loadZone(w.zoneKey, null, { x: w.x, y: w.y });
    }
    this.player.hp = this.player.maxHp;         // travel restores full health
    if (this.player.hpBar) this.player.hpBar.setValue(1);
  }

  spawnMobs(z, bounds) {
    for (let i = 0; i < z.mobCount; i++) {
      const typeKey = Phaser.Utils.Array.GetRandom(z.mobTypes);
      const pos = this.randomSpawnPos(z);
      this.mobs.push(this.isoAdopt(new Mob(this, typeKey, pos.x, pos.y, z.mobLevel, bounds)));
    }
  }

  // Boss telegraphs are ground decals → they belong in the iso world layer so
  // they distort onto the floor. Bodies stay upright in scene space.
  isoAdopt(e) {
    if (e.telegraphGfx) this.world.add(e.telegraphGfx);
    return e;
  }

  randomSpawnPos(z) {
    for (let tries = 0; tries < 20; tries++) {
      const x = Phaser.Math.Between(120, z.size.w - 120);
      const y = Phaser.Math.Between(120, z.size.h - 120);
      const nearPortal = this.portals.some((p) => Math.hypot(p.x - x, p.y - y) < 220);
      const nearPlayer = Math.hypot(this.player.x - x, this.player.y - y) < 260;
      if (!nearPortal && !nearPlayer) return { x, y };
    }
    return { x: z.size.w / 2, y: 120 };
  }

  spawnBossEncounter(bounds) {
    const cx = bounds.w / 2, cy = bounds.h / 2;
    this.boss = this.isoAdopt(new Boss(this, cx, cy - 40, { bounds, bossKey: this.zone.boss }));
    this.aggro.register(this.player);
  }

  // Boss-summoned add: spawn near the boss, pre-engaged, flagged so it never
  // respawns (summons are tied to the fight, not the zone's normal spawns).
  spawnAdd(typeKey, x, y, level) {
    if (this.mobs.length >= 40) return;
    const mob = this.isoAdopt(new Mob(this, typeKey, x, y, level, this.bounds));
    mob.summoned = true; mob.engaged = true;
    this.mobs.push(mob);
  }

  // Per-frame adapter the shared BossCore uses (mirrors the server's Zone one).
  bossAdapter() {
    return {
      bounds: this.bounds,
      getCombatants: () => {
        const list = [];
        if (this.player.alive && !this.player.stealth) list.push(this.player);
        for (const mn of this.minions) if (mn.alive) list.push(mn);
        return list;
      },
      getTarget: () => this.aggro.getTarget(),
      hit: (e, amount) => {
        const dealt = e.takeDamage(amount);
        this.spawnText(e.x, e.y - e.radius - 4, dealt != null ? dealt : amount, '#ff6b6b');
        if (!e.alive) this.aggro.remove(e);
      },
      spawnAdd: (typeKey, x, y, level) => this.spawnAdd(typeKey, x, y, level),
      addFx: (f) => { if (f.t === 'text') this.spawnText(f.x, f.y, f.msg, f.color, f.big); },
    };
  }

  spawnAdd(typeKey, x, y, level) {
    if (this.mobs.length >= 40) return;
    const mob = new Mob(this, typeKey, x, y, level, this.bounds);
    mob.summoned = true; mob.engaged = true;
    this.mobs.push(mob);
  }

  spawnRaidWave(count) {
    const z = this.zone;
    for (let i = 0; i < count; i++) {
      const typeKey = Phaser.Utils.Array.GetRandom(z.mobTypes);
      const pos = this.randomSpawnPos(z);
      this.mobs.push(new Mob(this, typeKey, pos.x, pos.y, z.mobLevel, this.bounds));
    }
  }

  spawnRaidBossFor(bossKey) {
    const cx = this.bounds.w / 2, cy = this.bounds.h / 2;
    this.boss = new Boss(this, cx, cy - 40, { bounds: this.bounds, bossKey });
    this.aggro = new AggroTable();
    this.aggro.register(this.player);
    for (const mn of this.minions) this.aggro.register(mn);
  }

  clearRaidBoss() {
    if (!this.boss) return;
    const { loot, xp } = this.boss.cfg;
    this.spawnText(this.bounds.w / 2, this.bounds.h / 2 - 80, `${this.boss.name} defeated!`, '#7CFC9A', true);
    if (this.progression.addXp(xp)) this.onLevelUp();
    this.spawnText(this.player.x, this.player.y - 64, `+${xp} XP`, '#9be8ff');
    const gold = bossGold(xp);
    this.gold += gold;
    this.spawnText(this.player.x, this.player.y - 84, `+${gold}g`, '#ffe066');
    for (let i = 0; i < loot.count; i++) {
      const drop = rollItem({ ilvl: loot.ilvl, rarityBoost: loot.rarityBoost });
      if (this.inventory.length < INV_CAP) {
        this.inventory.push(drop);
        this.spawnText(this.player.x + (i - (loot.count - 1) / 2) * 64, this.player.y - 40, '✦ ' + drop.name, rarityColor(drop.rarity));
      }
    }
    this.mobs = this.mobs.filter((m) => { if (m.summoned) { this.aggro.remove(m); m.destroy(); return false; } return true; });
    this.boss.destroy();
    this.boss = null;
    this.aggro = new AggroTable();
    this.aggro.register(this.player);
    this.persist();
  }

  checkRaidProgress() {
    const liveMobs = this.mobs.filter((m) => !m.summoned);
    const bossAlive = this.boss && this.boss.alive;
    if (this.raidState === 'wave1' && liveMobs.length === 0) {
      this.raidState = 'boss1';
      this.spawnRaidBossFor('guardian');
      this.showZoneBanner('BOSS: Guardian of the Bastion!');
    } else if (this.raidState === 'boss1' && this.boss && !bossAlive) {
      this.clearRaidBoss();
      this.raidState = 'wave2';
      this.spawnRaidWave(8);
      this.showZoneBanner('More enemies incoming!');
    } else if (this.raidState === 'wave2' && liveMobs.length === 0) {
      this.raidState = 'boss2';
      this.spawnRaidBossFor('warden');
      this.showZoneBanner('BOSS: Warden of Chains!');
    } else if (this.raidState === 'boss2' && this.boss && !bossAlive) {
      this.clearRaidBoss();
      this.raidState = 'final';
      this.spawnRaidBossFor('worldbreaker');
      this.showZoneBanner('THE WORLDBREAKER AWAKENS!');
    } else if (this.raidState === 'final' && this.boss && !bossAlive) {
      this.raidState = 'done';
      this.onBossDeath();
      this.showZoneBanner('RAID COMPLETE! Ancient Bastion cleared!');
    }
  }

  bossAdapter() {
    return {
      bounds: this.bounds,
      getCombatants: () => {
        const list = [];
        if (this.player && this.player.alive) list.push(this.player);
        if (this.mage && this.mage.alive) list.push(this.mage);
        for (const mn of this.minions) if (mn.alive) list.push(mn);
        return list;
      },
      getTarget: () => this.aggro.getTarget(),
      hit: (e, amount, blockable) => {
        let finalAmount = amount;
        if (blockable && e.isBlocking) {
          finalAmount = Math.max(1, Math.round(amount * 0.25));
          this.spawnText(e.x, e.y - e.radius - 10, 'BLOCKED!', '#4ad0ff');
        }
        const dealt = e.takeDamage(finalAmount);
        this.spawnText(e.x, e.y - e.radius - 4, dealt != null ? dealt : finalAmount, '#ff6b6b');
        if (!e.alive) this.aggro.remove(e);
      },
      spawnAdd: (typeKey, x, y, level) => this.spawnAdd(typeKey, x, y, level),
      addFx: (f) => { if (f.t === 'text') this.spawnText(f.x, f.y, f.msg, f.color, f.big); },
    };
  }

  checkPortals() {
    let onAny = false;
    for (const p of this.portals) {
      if (Math.hypot(p.x - this.player.x, p.y - this.player.y) <= 42) {
        onAny = true;
        if (!this.portalLock) { this.loadZone(p.to, this.zoneKey); return; }
      }
    }
    if (!onAny) this.portalLock = false;
  }

  // =============================================================== INPUT =====

  setupInput() {
    this.input.addPointer(2);
    this.move = { x: 0, y: 0 };
    this.joy = { active: false, id: -1, baseX: 0, baseY: 0 };
    this.held = new Set();
    this.input.keyboard.addCapture('SPACE,ONE,TWO,THREE,FOUR,Q,E,R,C,I,K,M,B');

    this.input.on('pointerdown', (p) => {
      if (this.isOverUI(p)) return;
      if (this.isTouch) { if (p.x < CONFIG.width * 0.5) this.startJoystick(p); }
      else if (p.button === 0) this.basicAttack();
    });
    this.input.on('pointermove', (p) => { if (this.joy.active && p.id === this.joy.id) this.updateJoystick(p); });
    const release = (p) => { if (this.joy.active && p.id === this.joy.id) this.endJoystick(); };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    this.input.keyboard.on('keydown', (e) => {
      if (this.settings && this.settings.captureKey(e)) return;
      this.held.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Escape') { if (this.settings) this.settings.toggle(); return; }
      if (this.settings && this.settings.open) return;
      switch (this.settings.actionFor(e.code)) {
        case 'attack': this.basicAttack(); break;
        case 'skill1': this.useSkill(1); break;
        case 'skill2': this.useSkill(2); break;
        case 'skill3': this.useSkill(3); break;
        case 'skill4': this.useSkill(4); break;
        case 'skill5': this.useSkill(5); break;
        case 'aim': this.toggleAutoAim(); break;
        case 'char': this.toggleCharPanel(); break;
        case 'inv': this.invPanel.toggle(); break;
        case 'block': this.useSkill(6); break;
        case 'map': this.mapPanel.toggle(this.zoneKey); break;
        case 'tree': this.treePanel.toggle(); break;
        case 'shop': this.openShop(); break;
      }
    });
    this.input.keyboard.on('keyup', (e) => this.held.delete(e.code));
  }

  isOverUI(p) {
    if (this.settings && this.settings.open) return true;
    if (this.invPanel && this.invPanel.contains(p.x, p.y)) return true;
    if (this.treePanel && this.treePanel.contains(p.x, p.y)) return true;
    if (this.charPanelOpen && Math.abs(p.x - CONFIG.width / 2) < 200) return true;
    if (this.skillBoxes) {
      for (const sb of this.skillBoxes) {
        if (Math.abs(p.x - sb.x) <= sb.boxW / 2 && Math.abs(p.y - sb.y) <= sb.boxW / 2) return true;
      }
    }
    if (this.attackBtn && Math.hypot(p.x - this.attackBtn.x, p.y - this.attackBtn.y) <= this.attackBtn.r) return true;
    if (this.charBtn && Math.hypot(p.x - this.charBtn.x, p.y - this.charBtn.y) <= this.charBtn.r) return true;
    if (this.aimBtn && Math.hypot(p.x - this.aimBtn.x, p.y - this.aimBtn.y) <= this.aimBtn.r) return true;
    if (this.settingsBtn && Math.hypot(p.x - this.settingsBtn.x, p.y - this.settingsBtn.y) <= this.settingsBtn.r) return true;
    if (this.invBtn && Math.hypot(p.x - this.invBtn.x, p.y - this.invBtn.y) <= this.invBtn.r) return true;
    if (this.mapBtn && Math.hypot(p.x - this.mapBtn.x, p.y - this.mapBtn.y) <= this.mapBtn.r) return true;
    if (this.mapPanel && this.mapPanel.contains(p.x, p.y)) return true;
    if (this.treeBtn && Math.hypot(p.x - this.treeBtn.x, p.y - this.treeBtn.y) <= this.treeBtn.r) return true;
    if (this.shopBtn && Math.hypot(p.x - this.shopBtn.x, p.y - this.shopBtn.y) <= this.shopBtn.r) return true;
    if (this.shopPanel && this.shopPanel.contains(p.x, p.y)) return true;
    return false;
  }

  startJoystick(p) {
    this.joy.active = true; this.joy.id = p.id;
    this.joy.baseX = p.x; this.joy.baseY = p.y;
    this.move.x = 0; this.move.y = 0;
    this.joyBase.setPosition(p.x, p.y).setVisible(true);
    this.joyThumb.setPosition(p.x, p.y).setVisible(true);
  }

  updateJoystick(p) {
    const max = 60;
    let dx = p.x - this.joy.baseX, dy = p.y - this.joy.baseY;
    const r = Math.hypot(dx, dy);
    if (r > max) { dx = (dx / r) * max; dy = (dy / r) * max; }
    this.joyThumb.setPosition(this.joy.baseX + dx, this.joy.baseY + dy);
    if (Math.hypot(dx, dy) > 8) { this.move.x = dx / max; this.move.y = dy / max; }
    else { this.move.x = 0; this.move.y = 0; }
  }

  endJoystick() {
    this.joy.active = false; this.joy.id = -1;
    this.move.x = 0; this.move.y = 0;
    this.joyBase.setVisible(false);
    this.joyThumb.setVisible(false);
  }

  // ============================================================== COMBAT =====

  enemies() {
    const list = this.mobs.filter((m) => m.alive);
    if (this.boss && this.boss.alive) list.push(this.boss);
    return list;
  }

  nearestEnemyTo(x, y, max = 700) {
    let best = null, bd = max;
    for (const e of this.enemies()) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  nearestEnemy(max = 700) {
    return this.nearestEnemyTo(this.player.x, this.player.y, max);
  }

  // World target for placed skills (blast/dot): the cursor in manual AIM, the
  // nearest enemy in AUTO, or the aimed direction on touch. Clamped to castRange.
  aimPoint(castRange = 360) {
    const px = this.player.x, py = this.player.y;
    if (this.autoAim) { const e = this.nearestEnemy(); if (e) return { x: e.x, y: e.y }; }
    else if (!this.isTouch) {
      const wp = unproject(this.input.activePointer.worldX, this.input.activePointer.worldY);
      let dx = wp.x - px, dy = wp.y - py;
      const d = Math.hypot(dx, dy) || 1;
      if (d > castRange) { dx = (dx / d) * castRange; dy = (dy / d) * castRange; }
      return { x: px + dx, y: py + dy };
    }
    return { x: px + Math.cos(this.player.facing) * castRange, y: py + Math.sin(this.player.facing) * castRange };
  }

  // What a mob should attack: the nearest player-side entity. Minions are
  // treated identically to the player — no taunt preference, just closest wins
  // (a stealthed player isn't a valid target).
  mobTarget(mob) {
    let best = null, bd = Infinity;
    if (this.player.alive && !this.player.stealth) {
      best = this.player;
      bd = Math.hypot(this.player.x - mob.x, this.player.y - mob.y);
    }
    for (const mn of this.minions) {
      if (!mn.alive) continue;
      const d = Math.hypot(mn.x - mob.x, mn.y - mob.y);
      if (d < bd) { bd = d; best = mn; }
    }
    return best;
  }

  // Roll outgoing player damage, honoring crit / buffs / guaranteed-crit states.
  playerRoll(stat, mult, forceCrit = false) {
    const s = this.player.stats;
    const base = (stat === 'mag' ? s.magPower : s.physPower) * mult;
    let crit = forceCrit || Math.random() < s.critChance;
    let critMul = s.critMultiplier;
    if (this.player.nextHitCrit > 0) { crit = true; critMul = this.player.nextHitCrit; this.player.nextHitCrit = 0; }
    const variance = 0.9 + Math.random() * 0.2;
    const amount = Math.max(1, Math.round(base * variance * (crit ? critMul : 1) * this.player.damageMult));
    return { amount, crit };
  }

  // Low-level: apply a fixed damage number to any enemy (also feeds boss aggro).
  // `source` is the attacker credited with threat (defaults to the player).
  damageEnemy(enemy, amount, crit, threatMult = 1, source = this.player) {
    if (enemy === this.boss) {
      this.boss.takeDamage(amount, 'You');
      this.aggro.add(source, amount * (source.threatMultiplier || 1) * threatMult);
    } else {
      enemy.takeDamage(amount);
    }
    this.spawnText(enemy.x, enemy.y - enemy.radius - 4, amount, crit ? '#ffe066' : '#ffffff', crit);
    if (enemy !== this.boss && !enemy.alive) this.handleMobDeath(enemy);
  }

  applyPlayerDamage(enemy, stat, mult, forceCrit, threatMult = 1, lifesteal = 0) {
    const { amount, crit } = this.playerRoll(stat, mult, forceCrit);
    this.damageEnemy(enemy, amount, crit, threatMult);
    if (lifesteal > 0) {
      const healed = this.player.heal(Math.round(amount * lifesteal));
      if (healed > 0) this.spawnText(this.player.x, this.player.y - 30, '+' + healed, '#7CFC9A');
    }
  }

  basicAttack() {
    if (!this.player.canBasicAttack()) return;
    this.player.startBasicCooldown();
    this.player.enterCombat();
    if (this.basic.kind === 'melee') {
      this.spawnSwingArc(this.player, this.player.attackRange, 1.3);
      for (const e of this.enemies()) {
        if (this.inArc(e, this.player.attackRange, 1.3)) {
          this.applyPlayerDamage(e, this.basic.stat, this.basic.mult, false, 1);
        }
      }
    } else {
      this.fireBolt({ stat: this.basic.stat, count: 1, mult: this.basic.mult, speed: this.basic.speed });
    }
  }

  inArc(e, range, half) {
    const dx = e.x - this.player.x, dy = e.y - this.player.y;
    if (Math.hypot(dx, dy) > range + e.radius) return false;
    return Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - this.player.facing)) <= half;
  }

  useSkill(slot) {
    const def = this.effSkills[slot - 1]; // skill-tree upgrades/unlocks applied
    if (!def || !this.player.alive || this.player.isOnCooldown(slot)) return;
    this.castSkill(def);
    this.player.startCooldown(slot, def.cd);
    this.player.enterCombat();
  }

  // The skill engine: interprets a class skill's `type`.
  castSkill(def) {
    switch (def.type) {
      case 'arc': {
        const half = def.half != null ? def.half : 1.3;
        const range = this.player.attackRange + (def.rangeBonus || 0);
        this.spawnSwingArc(this.player, range, half);
        for (const e of this.enemies()) {
          if (this.inArc(e, range, half)) this.applyPlayerDamage(e, def.stat || 'phys', def.mult, def.crit, def.threat || 1);
        }
        break;
      }
      case 'nova': {
        this.spawnRing(this.player.x, this.player.y, def.radius, def.color);
        for (const e of this.enemies()) {
          if (Math.hypot(e.x - this.player.x, e.y - this.player.y) <= def.radius + e.radius) {
            this.applyPlayerDamage(e, def.stat || 'phys', def.mult, def.crit, 1.3);
          }
        }
        break;
      }
      case 'blast': {
        const { x: tx, y: ty } = this.aimPoint(def.range || 360);
        this.spawnBlastFx(tx, ty, def.radius, def.color);
        for (const e of this.enemies()) {
          if (Math.hypot(e.x - tx, e.y - ty) <= def.radius + e.radius) {
            this.applyPlayerDamage(e, def.stat, def.mult, false, 1.2);
          }
        }
        break;
      }
      case 'bolt':
        this.fireBolt(def);
        break;
      case 'taunt':
        if (this.boss) this.aggro.forceTop(this.player, CONFIG.threat.tauntBonus);
        for (const m of this.mobs) if (Math.hypot(m.x - this.player.x, m.y - this.player.y) < 280) m.engaged = true;
        if (def.arcMult) for (const e of this.enemies()) if (this.inArc(e, this.player.attackRange, 1.3)) this.applyPlayerDamage(e, 'phys', def.arcMult, false, 2);
        this.spawnText(this.player.x, this.player.y - 30, 'TAUNT!', '#ff8c5a');
        break;
      case 'shield':
        this.player.applyShield(def.reduction, def.duration);
        this.spawnText(this.player.x, this.player.y - 30, 'SHIELD', '#66ccff');
        if (def.heal) this.doHeal({ intMult: def.intMult || 1, allies: true });
        break;
      case 'heal':
        this.doHeal(def);
        break;
      case 'buff':
        this.player.applyBuff({ damageMult: def.damageMult || 1, speedMult: def.speedMult || 1, duration: def.duration });
        this.spawnText(this.player.x, this.player.y - 30, def.speedMult > 1 ? 'HASTE' : 'BLESSED', '#9be8ff');
        break;
      case 'stealth':
        this.player.applyStealth(def.duration, def.critMult);
        this.spawnText(this.player.x, this.player.y - 30, 'STEALTH', '#9aa6c4');
        break;
      case 'dash': {
        const nx = this.player.x + Math.cos(this.player.facing) * def.distance;
        const ny = this.player.y + Math.sin(this.player.facing) * def.distance;
        const b = this.bounds;
        this.player.x = Phaser.Math.Clamp(nx, b.x + this.player.radius, b.w - this.player.radius);
        this.player.y = Phaser.Math.Clamp(ny, b.y + this.player.radius, b.h - this.player.radius);
        this.spawnSwingArc(this.player, this.player.attackRange, 1.3);
        for (const e of this.enemies()) if (this.inArc(e, this.player.attackRange, 1.3)) this.applyPlayerDamage(e, 'phys', def.mult, true, 1);
        break;
      }
      case 'block':
        this.player.applyBlock(def.duration || 0.8);
        this.spawnText(this.player.x, this.player.y - 30, 'BLOCK!', '#4ad0ff');
        break;
      case 'dodge': {
        const dist = def.distance * (this.basic.kind === 'ranged' ? 1.5 : 1); // ranged roll farther
        const nx = this.player.x + Math.cos(this.player.facing) * dist;
        const ny = this.player.y + Math.sin(this.player.facing) * dist;
        const b = this.bounds;
        this.player.x = Phaser.Math.Clamp(nx, b.x + this.player.radius, b.w - this.player.radius);
        this.player.y = Phaser.Math.Clamp(ny, b.y + this.player.radius, b.h - this.player.radius);
        this.player.invulnTimer = def.iframe;
        this.spawnRing(this.player.x, this.player.y, this.player.radius + 16, def.color);
        this.spawnText(this.player.x, this.player.y - 34, 'DODGE', def.color);
        break;
      }
      case 'dot': {
        const aim = this.aimPoint(420);
        const t = this.nearestEnemyTo(aim.x, aim.y, 140);
        if (t) {
          this.dots.push({ target: t, dps: this.player.stats.magPower * def.intMult, remaining: def.duration, acc: 0 });
          this.spawnText(t.x, t.y - t.radius - 16, 'CURSED', '#c06cff');
        }
        break;
      }
      case 'summon': {
        const dmg = Math.round(6 + this.progression.level * 3 + this.player.stats.INT * 0.5);
        const hp = Math.round(30 + this.progression.level * 8 + this.player.stats.INT * 2);
        for (let i = 0; i < def.count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const mn = this.isoAdopt(new Minion(this, this.player.x + Math.cos(ang) * 30, this.player.y + Math.sin(ang) * 30, dmg, hp, def.duration, this.bounds));
          mn.threatMultiplier = 1.0; // minions share the same threat weight as non-tank classes
          if (this.boss) this.aggro.register(mn);
          this.minions.push(mn);
        }
        this.spawnText(this.player.x, this.player.y - 30, 'RISE!', '#a4f06c');
        break;
      }
    }
  }

  doHeal(def) {
    const amount = Math.round(this.player.stats.magPower * def.intMult);
    const healed = this.player.heal(amount);
    if (healed > 0) this.spawnText(this.player.x, this.player.y - 30, '+' + healed, '#7CFC9A');
  }

  fireBolt(def) {
    const count = def.count || 1;
    const spread = def.spread || 0;
    const speed = def.speed || 430;
    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? (i - (count - 1) / 2) * spread : 0;
      const ang = this.player.facing + offset;
      const { amount, crit } = this.playerRoll(def.stat, def.mult, def.crit);
      this.projectiles.push({
        team: 'player', x: this.player.x, y: this.player.y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        amount, crit, ttl: 2.2, r: 5,
        pierce: !!def.pierce, lifesteal: def.lifesteal || 0,
        color: PROJ_COLOR[def.stat] || 0xffffff,
      });
    }
  }

  handleMobDeath(mob) {
    const levels = this.progression.addXp(mob.xp);
    this.spawnText(mob.x, mob.y - 20, `+${mob.xp} XP`, '#9be8ff');
    const gold = mobGold(mob.level);
    this.gold += gold;
    this.spawnText(mob.x, mob.y - 4, `+${gold}g`, '#ffe066');
    if (levels > 0) this.onLevelUp();
    // Loot: roll a drop scaled by the mob's level.
    const drop = rollDrop({ mobLevel: mob.level });
    if (drop) {
      if (this.inventory.length < INV_CAP) {
        this.inventory.push(drop);
        this.spawnText(mob.x, mob.y - 30, '✦ ' + drop.name, rarityColor(drop.rarity));
        if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
      } else {
        this.spawnText(mob.x, mob.y - 30, 'Backpack full!', '#ff7a7a');
      }
    }
    this.persist();
    const wasSummoned = mob.summoned;
    mob.destroy();
    this.mobs = this.mobs.filter((m) => m !== mob);
    if (wasSummoned) return; // boss adds don't respawn

    const token = this.respawnToken;
    const z = this.zone;
    this.time.delayedCall(8000, () => {
      if (token !== this.respawnToken) return;
      const pos = this.randomSpawnPos(z);
      this.mobs.push(this.isoAdopt(new Mob(this, mob.typeKey, pos.x, pos.y, mob.level, this.bounds)));
    });
  }

  onLevelUp() {
    this.player.recalc();
    this.player.hp = this.player.maxHp;
    this.spawnText(this.player.x, this.player.y - 46, `LEVEL UP! Lv${this.progression.level}`, '#ffe066', true);
    if (this.treePanel && this.treePanel.open) this.treePanel.refresh();
  }

  // ============================================================ PROJECTILES ==

  fireProjectile(fromX, fromY, tx, ty, dmg, speed) {
    const ang = Math.atan2(ty - fromY, tx - fromX);
    this.projectiles.push({
      team: 'enemy', x: fromX, y: fromY,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      dmg, ttl: 3, r: 5, color: 0xff7b5a,
    });
  }

  updateProjectiles(dt) {
    const g = this.projGfx;
    g.clear();
    const next = [];
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.ttl -= dt;
      const out = pr.x < 0 || pr.y < 0 || pr.x > this.bounds.w || pr.y > this.bounds.h;
      if (pr.ttl <= 0 || out) continue;

      if (pr.team === 'player') {
        let consumed = false;
        for (const e of this.enemies()) {
          if (Math.hypot(pr.x - e.x, pr.y - e.y) <= e.radius + pr.r) {
            this.damageEnemy(e, pr.amount, pr.crit);
            if (pr.lifesteal > 0) {
              const healed = this.player.heal(Math.round(pr.amount * pr.lifesteal));
              if (healed > 0) this.spawnText(this.player.x, this.player.y - 30, '+' + healed, '#7CFC9A');
            }
            if (!pr.pierce) { consumed = true; break; }
          }
        }
        if (consumed) continue;
      } else {
        if (this.player.alive && Math.hypot(pr.x - this.player.x, pr.y - this.player.y) <= this.player.radius + pr.r) {
          const dealt = this.player.takeDamage(pr.dmg);
          this.spawnText(this.player.x, this.player.y - this.player.radius - 4, dealt, '#ff6b6b');
          continue;
        }
        let hitMinion = false;
        for (const mn of this.minions) {
          if (mn.alive && Math.hypot(pr.x - mn.x, pr.y - mn.y) <= mn.radius + pr.r) {
            mn.takeDamage(pr.dmg);
            this.spawnText(mn.x, mn.y - mn.radius - 4, pr.dmg, '#ff6b6b');
            hitMinion = true;
            break;
          }
        }
        if (hitMinion) continue;
      }
      const psp = project(pr.x, pr.y);
      g.fillStyle(pr.color, 1);
      g.fillCircle(psp.x, psp.y, pr.r);
      next.push(pr);
    }
    this.projectiles = next;
  }

  updateDots(dt) {
    const remaining = [];
    for (const d of this.dots) {
      if (!d.target.alive) continue;
      d.remaining -= dt;
      d.acc += dt;
      if (d.acc >= 0.5) {
        this.damageEnemy(d.target, Math.max(1, Math.round(d.dps * d.acc)), false);
        d.acc = 0;
      }
      if (d.remaining > 0 && d.target.alive) remaining.push(d);
    }
    this.dots = remaining;
  }

  // ============================================================== UPDATE =====

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    const bossWasAlive = this.boss && this.boss.alive;

    if (this.player.alive) {
      // Movement intent is in SCREEN space; rotate it into world space so the
      // controls feel aligned with the isometric view (dirToWorld).
      if (this.joy.active && (this.move.x !== 0 || this.move.y !== 0)) {
        const w = dirToWorld(this.move.x, this.move.y);
        this.player.moveBy(w.x, w.y, dt);
      } else {
        let mx = 0, my = 0;
        const b = this.settings.binds;
        if (!this.settings.open) {
          if (this.held.has(b.left)) mx -= 1;
          if (this.held.has(b.right)) mx += 1;
          if (this.held.has(b.up)) my -= 1;
          if (this.held.has(b.down)) my += 1;
        }
        if (mx !== 0 || my !== 0) {
          const w = dirToWorld(mx, my);
          this.player.moveBy(w.x, w.y, dt);
        }
      }
    }

    if (this.autoAim) {
      const e = this.nearestEnemy();
      if (e) this.player.facing = Math.atan2(e.y - this.player.y, e.x - this.player.x);
    } else if (this.isTouch) {
      if (this.joy.active && (this.move.x !== 0 || this.move.y !== 0)) {
        const w = dirToWorld(this.move.x, this.move.y);
        this.player.facing = Math.atan2(w.y, w.x);
      }
    } else {
      const p = this.input.activePointer;
      const wp = unproject(p.worldX, p.worldY); // cursor -> world target
      this.player.facing = Math.atan2(wp.y - this.player.y, wp.x - this.player.x);
    }

    this.player.update(dt);

    const mobCtx = {
      player: this.player,
      getTarget: (mob) => this.mobTarget(mob),
      onMelee: (mob, target) => {
        const dealt = target.takeDamage(mob.damage);
        this.spawnText(target.x, target.y - target.radius - 4, dealt, '#ff6b6b');
      },
      fireProjectile: (fx, fy, tx, ty, dmg, sp) => this.fireProjectile(fx, fy, tx, ty, dmg, sp),
    };
    for (const m of this.mobs) m.update(dt, mobCtx);

    const minionCtx = {
      player: this.player,
      nearestEnemyTo: (x, y, max) => this.nearestEnemyTo(x, y, max),
      applyHit: (src, e, amt, crit) => this.damageEnemy(e, amt, crit, 1, src),
    };
    for (const mn of this.minions) mn.update(dt, minionCtx);
    this.minions = this.minions.filter((mn) => { if (!mn.alive) { this.aggro.remove(mn); mn.destroy(); return false; } return true; });

    this.updateProjectiles(dt);
    this.updateDots(dt);

    if (this.boss) {
      if (this.mage) {
        this.mage.aiUpdate(dt, {
          boss: this.boss,
          telegraph: this.boss.telegraph,
          onCast: (amount, crit) => {
            this.boss.takeDamage(amount, 'Ally');
            this.aggro.add(this.mage, amount * this.mage.threatMultiplier);
            this.spawnText(this.boss.x, this.boss.y - this.boss.radius, amount, crit ? '#ffe066' : '#fff', crit);
          },
        });
      }
      this.boss.update(dt, this.bossAdapter());
      if (bossWasAlive && !this.boss.alive && !this.zone.raid) this.onBossDeath();
    }
    if (this.zone && this.zone.raid) this.checkRaidProgress();

    if (!this.player.alive) this.respawnInTown();

    this.world.sort('depth'); // painter's order for the iso world layer
    this.checkPortals();
    this.updateTownProps();
    this.checkWaystones();
    this.centerCamera(false);
    this.updateHud();
  }

  onBossDeath() {
    if (!this.boss) return;
    const { loot, xp } = this.boss.cfg;
    this.spawnText(this.bounds.w / 2, this.bounds.h / 2, 'BOSS SLAIN!', '#7CFC9A', true);
    if (this.progression.addXp(xp)) this.onLevelUp();
    this.spawnText(this.player.x, this.player.y - 64, `+${xp} XP`, '#9be8ff');
    const gold = bossGold(xp);
    this.gold += gold;
    this.spawnText(this.player.x, this.player.y - 84, `+${gold}g`, '#ffe066');
    let full = false;
    for (let i = 0; i < loot.count; i++) {
      const drop = rollItem({ ilvl: loot.ilvl, rarityBoost: loot.rarityBoost });
      if (this.inventory.length < INV_CAP) {
        this.inventory.push(drop);
        this.spawnText(this.player.x + (i - (loot.count - 1) / 2) * 64, this.player.y - 40, '✦ ' + drop.name, rarityColor(drop.rarity));
      } else full = true;
    }
    if (full) this.spawnText(this.player.x, this.player.y - 100, 'Backpack full — make room!', '#ff7a7a');
    // Despawn leftover summoned adds.
    this.mobs = this.mobs.filter((m) => { if (m.summoned) { this.aggro.remove(m); m.destroy(); return false; } return true; });
    if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
    this.persist();
  }

  respawnInTown() {
    this.player.alive = true;
    this.player.hp = this.player.maxHp;
    this.player.damageReduction = 0;
    this.loadZone('town', null);
  }

  centerCamera(snap) {
    const cam = this.cameras.main;
    const sp = project(this.player.x, this.player.y); // follow the projected position
    const tx = sp.x - cam.width / 2;
    const ty = sp.y - cam.height / 2;
    if (snap) { cam.scrollX = tx; cam.scrollY = ty; }
    else {
      cam.scrollX += (tx - cam.scrollX) * 0.12;
      cam.scrollY += (ty - cam.scrollY) * 0.12;
    }
  }

  // ================================================================= HUD =====

  buildHud() {
    this.statsText = this.add.text(14, 14, '', {
      fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#cdd6ee', lineSpacing: 3,
      stroke: '#000', strokeThickness: 3,
    }).setDepth(60).setScrollFactor(0);

    this.zoneText = this.add.text(CONFIG.width / 2, 14, '', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(60).setScrollFactor(0);

    const xpY = CONFIG.height - 8;
    this.add.rectangle(CONFIG.width / 2, xpY, CONFIG.width, 10, 0x000000, 0.6).setDepth(59).setScrollFactor(0);
    this.xpFill = this.add.rectangle(0, xpY, 0, 10, 0x9be8ff, 0.9).setOrigin(0, 0.5).setDepth(60).setScrollFactor(0);

    this.skillBoxes = [];
    const boxW = 60, gap = 10;
    const totalW = this.skills.length * boxW + (this.skills.length - 1) * gap;
    const startX = CONFIG.width / 2 - totalW / 2;
    const y = CONFIG.height - 56;
    this.skills.forEach((def, i) => {
      const slot = i + 1;
      const x = startX + i * (boxW + gap) + boxW / 2;
      const box = this.add.rectangle(x, y, boxW, boxW, 0x1c2138, 0.95)
        .setStrokeStyle(2, 0x3a4366).setDepth(60).setScrollFactor(0).setInteractive();
      box.on('pointerdown', () => this.useSkill(slot));
      this.add.text(x - boxW / 2 + 5, y - boxW / 2 + 3, def.key, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#fff',
      }).setDepth(62).setScrollFactor(0);
      const nameText = this.add.text(x, y + boxW / 2 - 11, this.effSkills[i].name, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '8px', color: def.color,
        align: 'center', wordWrap: { width: boxW - 4 },
      }).setOrigin(0.5).setDepth(62).setScrollFactor(0);
      const overlay = this.add.rectangle(x, y + boxW / 2, boxW, boxW, 0x000000, 0.65)
        .setOrigin(0.5, 1).setDepth(61).setScrollFactor(0);
      overlay.height = 0;
      this.skillBoxes.push({ slot, def: this.effSkills[i], overlay, boxW, x, y, nameText });
    });
  }

  buildTouchControls() {
    this.joyBase = this.add.circle(0, 0, 60, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.25)
      .setDepth(70).setScrollFactor(0).setVisible(false);
    this.joyThumb = this.add.circle(0, 0, 26, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.5)
      .setDepth(71).setScrollFactor(0).setVisible(false);

    const ccx = CONFIG.width - 44, ccy = 30;
    const cbtn = this.add.circle(ccx, ccy, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffd24a, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(ccx, ccy, 'C', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    cbtn.on('pointerdown', () => this.toggleCharPanel());
    this.charBtn = { x: ccx, y: ccy, r: 22 };

    const aimX = CONFIG.width - 44, aimY = 80;
    const aimBg = this.add.circle(aimX, aimY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x6cd0ff, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.aimText = this.add.text(aimX, aimY, 'AIM', {
      fontFamily: 'Segoe UI', fontSize: '10px', fontStyle: 'bold', color: '#6cd0ff',
    }).setOrigin(0.5).setDepth(71).setScrollFactor(0);
    aimBg.on('pointerdown', () => this.toggleAutoAim());
    this.aimBtn = { x: aimX, y: aimY, r: 22 };

    const setX = CONFIG.width - 44, setY = 130;
    const setBg = this.add.circle(setX, setY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xb8a4ff, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(setX, setY, '⚙', { fontFamily: 'Segoe UI', fontSize: '18px', color: '#b8a4ff' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    setBg.on('pointerdown', () => this.settings.toggle());
    this.settingsBtn = { x: setX, y: setY, r: 22 };

    const invX = CONFIG.width - 44, invY = 180;
    const invBg = this.add.circle(invX, invY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x8bd96a, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(invX, invY, 'I', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#8bd96a' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    invBg.on('pointerdown', () => this.invPanel.toggle());
    this.invBtn = { x: invX, y: invY, r: 22 };

    const mapBtnX = CONFIG.width - 44, mapBtnY = 230;
    const mapBtnBg = this.add.circle(mapBtnX, mapBtnY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0x6cd0ff, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(mapBtnX, mapBtnY, 'M', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#6cd0ff' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    mapBtnBg.on('pointerdown', () => this.mapPanel.toggle(this.zoneKey));
    this.mapBtn = { x: mapBtnX, y: mapBtnY, r: 22 };

    const trX = CONFIG.width - 44, trY = 280;
    const trBg = this.add.circle(trX, trY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffd24a, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.treeBadge = this.add.text(trX, trY, 'K', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    trBg.on('pointerdown', () => this.treePanel.toggle());
    this.treeBtn = { x: trX, y: trY, r: 22 };

    const shX = CONFIG.width - 44, shY = 330;
    const shBg = this.add.circle(shX, shY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffe066, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(shX, shY, 'B', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    shBg.on('pointerdown', () => this.openShop());
    this.shopBtn = { x: shX, y: shY, r: 22 };

    if (!this.isTouch) return;
    const ax = CONFIG.width - 80, ay = CONFIG.height - 96;
    const btn = this.add.circle(ax, ay, 46, this.classDef.color, 0.9).setStrokeStyle(3, 0xffffff, 0.85)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(ax, ay, 'ATK', { fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    btn.on('pointerdown', () => this.basicAttack());
    this.attackBtn = { x: ax, y: ay, r: 46 };
  }

  buildCharPanel() {
    this.charPanelOpen = false;
    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    const panel = this.add.container(0, 0).setDepth(120).setScrollFactor(0).setVisible(false);
    panel.add(this.add.rectangle(cx, cy, 360, 320, 0x10131f, 0.96).setStrokeStyle(2, 0x3a4366).setScrollFactor(0));
    this.charTitle = this.add.text(cx, cy - 130, '', {
      fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5).setScrollFactor(0);
    panel.add(this.charTitle);

    this.charRows = [];
    STAT_INFO.forEach(([attr, desc], i) => {
      const ry = cy - 80 + i * 42;
      const label = this.add.text(cx - 150, ry, '', {
        fontFamily: 'Consolas, monospace', fontSize: '14px', color: '#e6e9f2',
      }).setOrigin(0, 0.5).setScrollFactor(0);
      const plus = this.add.rectangle(cx + 130, ry, 30, 30, 0x2a6e3a, 1).setStrokeStyle(2, 0x4ad06a)
        .setScrollFactor(0).setInteractive();
      const plusText = this.add.text(cx + 130, ry, '+', {
        fontFamily: 'Segoe UI', fontSize: '18px', fontStyle: 'bold', color: '#fff',
      }).setOrigin(0.5).setScrollFactor(0);
      plus.on('pointerdown', () => this.spendStat(attr));
      panel.add(label); panel.add(plus); panel.add(plusText);
      this.charRows.push({ attr, desc, label, plus, plusText });
    });

    panel.add(this.add.text(cx, cy + 132, 'C / button to close', {
      fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad',
    }).setOrigin(0.5).setScrollFactor(0));
    this.charPanel = panel;
  }

  toggleAutoAim() {
    this.autoAim = !this.autoAim;
    this.aimText.setColor(this.autoAim ? '#ffe066' : '#6cd0ff');
    this.aimText.setText(this.autoAim ? 'AUTO' : 'AIM');
  }

  toggleCharPanel() {
    this.charPanelOpen = !this.charPanelOpen;
    this.charPanel.setVisible(this.charPanelOpen);
    if (this.charPanelOpen) this.refreshCharPanel();
  }

  spendStat(attr) {
    if (this.progression.statPoints <= 0 || !STAT_KEYS.includes(attr)) return;
    this.progression.statPoints--;
    this.baseAttrs[attr]++;
    this.recomputeStats();
    this.persist();
    this.refreshCharPanel();
  }

  // Rebuild the player's derived Stats from base attributes + equipped gear +
  // skill-tree stat nodes, keeping the current HP fraction.
  recomputeStats() {
    const ratio = this.player.maxHp ? this.player.hp / this.player.maxHp : 1;
    const a = totalAttrs(this.baseAttrs, this.gear);
    for (const k of STAT_KEYS) a[k] += this.build.stat[k] || 0;
    this.player.stats = new Stats(a);
    this.player.maxHp = this.player.stats.maxHp;
    this.player.hp = Math.min(this.player.maxHp, Math.max(1, Math.round(this.player.maxHp * ratio)));
  }

  // Recompute the skill-tree build + the effective skill defs (upgrades/unlocks).
  recomputeBuild() {
    this.build = buildFromTree(this.classKey, this.skillTree);
    this.effSkills = effectiveSkills(this.classDef, this.build);
    if (this.skillBoxes) for (const sb of this.skillBoxes) { const d = this.effSkills[sb.slot - 1]; sb.def = d; if (sb.nameText) sb.nameText.setText(d.name); }
  }

  // --- skill tree (solo, local) ---
  spendSkillNode(nodeId) {
    if (!canSpend(this.classKey, this.skillTree, this.progression.level, nodeId)) return;
    this.skillTree[nodeId] = (this.skillTree[nodeId] || 0) + 1;
    this.recomputeBuild();
    this.recomputeStats();
    this.persist();
  }
  respecSkills() {
    this.skillTree = {};
    this.recomputeBuild();
    this.recomputeStats();
    this.persist();
  }
  skillPointsLeft() { return availablePoints(this.classKey, this.progression.level, this.skillTree); }

  // --- inventory / equipment (solo, local) ---
  equipItem(itemId) {
    const idx = this.inventory.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    const item = this.inventory[idx];
    if (!canEquip(this.classKey, item)) return;
    const prev = this.gear[item.slot];
    this.gear[item.slot] = item;
    this.inventory.splice(idx, 1);
    if (prev) this.inventory.push(prev);
    this.recomputeStats();
    this.persist();
    if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
  }

  unequipItem(slot) {
    if (!EQUIP_SLOTS.includes(slot) || !this.gear[slot] || this.inventory.length >= INV_CAP) return;
    this.inventory.push(this.gear[slot]);
    this.gear[slot] = null;
    this.recomputeStats();
    this.persist();
    if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
  }

  discardItem(itemId) {
    const idx = this.inventory.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    this.inventory.splice(idx, 1);
    this.persist();
    if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
  }

  // --- town shop (solo, applied locally) ---
  openShop() {
    if (this.zoneKey !== 'town') { this.spawnText(this.player.x, this.player.y - 64, 'The shop is in town', '#ffd24a'); return; }
    this.shopPanel.toggle();
  }

  buyGear(slot, tier) {
    if (this.zoneKey !== 'town') return;
    const cost = buyCost(slot, tier);
    if (cost == null || this.gold < cost) return;
    if (this.inventory.length >= INV_CAP) { this.spawnText(this.player.x, this.player.y - 40, 'Backpack full!', '#ff7a7a'); return; }
    const item = rollShopItem(this.classKey, slot, tier);
    if (!item) return;
    this.gold -= cost;
    this.inventory.push(item);
    this.spawnText(this.player.x, this.player.y - 40, '✦ ' + item.name, rarityColor(item.rarity));
    this.persist();
    if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
  }

  upgradeGear(slot) {
    if (this.zoneKey !== 'town') return;
    const item = this.gear[slot];
    if (!item) return;
    const cost = upgradeCost(item);
    if (cost == null || this.gold < cost) return;
    this.gold -= cost;
    this.gear[slot] = upgradeItem(item);
    this.recomputeStats();
    this.spawnText(this.player.x, this.player.y - 40, 'Upgraded ' + this.gear[slot].name, '#7CFC9A');
    this.persist();
    if (this.invPanel && this.invPanel.open) this.invPanel.refresh();
  }

  // Save this class's progress to localStorage (per device, per class).
  persist() {
    saveProgress(this.classKey, {
      level: this.progression.level,
      xp: this.progression.xp,
      statPoints: this.progression.statPoints,
      gold: this.gold,
      stats: { ...this.baseAttrs },
      inventory: this.inventory,
      gear: this.gear,
      skillTree: this.skillTree,
      waypoints: [...this.discovered],
    });
  }

  refreshCharPanel() {
    const s = this.player.stats;
    this.charTitle.setText(`${this.classDef.name}  —  ${this.progression.statPoints} point(s)`);
    for (const row of this.charRows) {
      row.label.setText(`${row.attr}  ${s[row.attr]}   (${row.desc})`);
      const has = this.progression.statPoints > 0;
      row.plus.setFillStyle(has ? 0x2a6e3a : 0x2a2f3e, 1);
      row.plusText.setAlpha(has ? 1 : 0.3);
    }
  }

  showZoneBanner(name) {
    const t = this.add.text(CONFIG.width / 2, CONFIG.height / 2 - 120, name, {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '34px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(110).setScrollFactor(0).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 300, yoyo: true, hold: 1100, onComplete: () => t.destroy() });
  }

  updateHud() {
    const s = this.player.stats;
    const pr = this.progression;
    this.statsText.setText([
      `${this.classDef.name}  Lv ${pr.level}`,
      `HP ${Math.ceil(this.player.hp)}/${this.player.maxHp}`,
      `XP ${pr.xp}/${pr.xpToNext()}`,
      `Gold ${this.gold.toLocaleString()}`,
      `STR ${s.STR} DEX ${s.DEX} INT ${s.INT} VIT ${s.VIT} AGI ${s.AGI}`,
      pr.statPoints > 0 ? `>> ${pr.statPoints} stat point(s) — press C` : '',
      this.skillPointsLeft() > 0 ? `>> ${this.skillPointsLeft()} skill point(s) — press K` : '',
    ].filter(Boolean).join('\n'));
    if (this.treeBadge) this.treeBadge.setColor(this.skillPointsLeft() > 0 ? '#7CFC9A' : '#ffd24a');

    const raidLabel = this.zone.raid ? ` [${({ wave1: 'Wave 1', boss1: 'Guardian', wave2: 'Wave 2', boss2: 'Warden', final: 'WORLDBREAKER', done: 'CLEARED' })[this.raidState] || ''}]` : '';
    this.zoneText.setText(this.zone.name + (this.zone.safe ? '  (safe)' : '') + raidLabel);
    this.xpFill.width = CONFIG.width * Phaser.Math.Clamp(pr.xpRatio(), 0, 1);

    for (const sb of this.skillBoxes) {
      sb.overlay.height = sb.boxW * Phaser.Math.Clamp(this.player.cooldowns[sb.slot] / sb.def.cd, 0, 1);
    }
    if (this.charPanelOpen) this.refreshCharPanel();

    if (this.miniMap) {
      this.miniMap.update({
        bounds: this.bounds,
        player: { x: this.player.x, y: this.player.y },
        mobs: this.mobs,
        boss: this.boss,
        portals: this.portals,
        waystones: this.waystones,
      });
    }
  }

  // ======================================================= EFFECTS / FX =====

  spawnSwingArc(player, range, half) {
    const gfx = this.add.graphics(); gfx.depth = 5e6; this.world.add(gfx);
    const cx = player.x, cy = player.y, facing = player.facing;
    let t = 0;
    const ev = this.time.addEvent({
      delay: 14, loop: true,
      callback: () => {
        t += 14;
        gfx.clear();
        gfx.lineStyle(5, 0xffeedd, (1 - t / 170) * 0.9);
        gfx.beginPath();
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const a = facing - half + (half * 2 * i) / steps;
          const px = cx + Math.cos(a) * range, py = cy + Math.sin(a) * range;
          i === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py);
        }
        gfx.strokePath();
        if (t >= 170) { gfx.destroy(); ev.remove(); }
      },
    });
  }

  spawnRing(x, y, radius, colorHex) {
    const color = this.hexToInt(colorHex, 0xc89bff);
    const fx = this.add.graphics(); fx.depth = 5e6; this.world.add(fx);
    let t = 0;
    const ev = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        t += 16;
        fx.clear();
        fx.lineStyle(4, color, Phaser.Math.Clamp(1 - t / 300, 0, 1));
        fx.strokeCircle(x, y, radius * (t / 300));
        if (t >= 300) { fx.destroy(); ev.remove(); }
      },
    });
  }

  spawnBlastFx(x, y, radius, colorHex) {
    const color = this.hexToInt(colorHex, 0xff7a3c);
    const fx = this.add.graphics(); fx.depth = 5e6; this.world.add(fx);
    let t = 0;
    const ev = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        t += 16;
        const p = t / 280;
        fx.clear();
        fx.fillStyle(color, (1 - p) * 0.5);
        fx.fillCircle(x, y, radius * Math.min(1, p * 1.2));
        fx.lineStyle(3, color, 1 - p);
        fx.strokeCircle(x, y, radius);
        if (t >= 280) { fx.destroy(); ev.remove(); }
      },
    });
  }

  hexToInt(hex, fallback) {
    if (typeof hex === 'number') return hex;
    if (typeof hex === 'string' && hex[0] === '#') return parseInt(hex.slice(1), 16);
    return fallback;
  }

  spawnText(x, y, value, color = '#ffffff', big = false) {
    const sp = project(x, y); // floating text lives in screen space at the projected spot
    const txt = this.add.text(sp.x, sp.y, String(value), {
      fontFamily: 'Segoe UI, sans-serif', fontSize: big ? '20px' : '14px', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(80);
    this.tweens.add({ targets: txt, y: sp.y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
  }
}
