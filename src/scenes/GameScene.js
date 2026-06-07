import { CONFIG } from '../config.js';
import { Stats } from '../stats.js';
import AggroTable from '../systems/AggroTable.js';
import Progression from '../systems/Progression.js';
import Player from '../entities/Player.js';
import Boss from '../entities/Boss.js';
import Mob from '../entities/Mob.js';
import Minion from '../entities/Minion.js';
import { ZONES, START_ZONE } from '../world/zones.js';
import { CLASSES, DEFAULT_CLASS } from '../classes/classes.js';
import { loadProgress, saveProgress, clearProgress } from '../progress.js';
import SettingsPanel from '../ui/SettingsPanel.js';
import InventoryPanel from '../ui/InventoryPanel.js';
import SkillTreePanel from '../ui/SkillTreePanel.js';
import { buildFromTree, effectiveSkills, sanitizeAllocation, availablePoints, canSpend } from '../skilltree.js';
import {
  STAT_KEYS, EQUIP_SLOTS, INV_CAP, emptyGear, totalAttrs, canEquip, sanitizeItem,
  rollDrop, rollItem, rarityColor,
} from '../items.js';

const STAT_INFO = [
  ['STR', 'melee damage'],
  ['DEX', 'crit / atk speed'],
  ['INT', 'magic damage'],
  ['VIT', 'max health'],
  ['AGI', 'move speed'],
];

const PROJ_COLOR = { phys: 0xffe2a8, mag: 0x9be8ff };

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create(data) {
    this.isTouch = this.sys.game.device.input.touch || 'ontouchstart' in window;

    // --- chosen class -> player build ---
    this.classKey = (data && data.classKey) || DEFAULT_CLASS;
    this.classDef = CLASSES[this.classKey];
    this.skills = this.classDef.skills;
    this.basic = this.classDef.basic;

    this.progression = new Progression();
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

    // Restore this class's saved progress on this device (if any).
    const saved = loadProgress(this.classKey);
    if (saved) {
      this.progression.level = Math.max(1, saved.level);
      this.progression.xp = Math.max(0, saved.xp);
      this.progression.statPoints = Math.max(0, saved.statPoints);
      for (const attr of STAT_KEYS) if (saved.stats[attr] != null) this.baseAttrs[attr] = saved.stats[attr];
      if (Array.isArray(saved.inventory)) this.inventory = saved.inventory.map(sanitizeItem).filter(Boolean).slice(0, INV_CAP);
      if (saved.gear) for (const slot of EQUIP_SLOTS) {
        const it = sanitizeItem(saved.gear[slot]);
        if (it && it.slot === slot && canEquip(this.classKey, it)) this.gear[slot] = it;
      }
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

    this.zoneGfx = this.add.graphics().setDepth(-1);
    this.portalGfx = this.add.graphics().setDepth(1);
    this.projGfx = this.add.graphics().setDepth(7);

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
    this.treePanel = new SkillTreePanel(this, {
      getModel: () => ({ classKey: this.classKey, level: this.progression.level, alloc: this.skillTree }),
      onSpend: (nodeId) => this.spendSkillNode(nodeId),
      onRespec: () => this.respecSkills(),
    });
    this.settings = new SettingsPanel(this, {
      onMainMenu: () => { this.persist(); this.scene.start('LobbyScene'); },
      onResetProgress: () => { clearProgress(this.classKey); this.scene.restart({ classKey: this.classKey }); },
    });

    this.loadZone(START_ZONE, null);
  }

  // =============================================================== ZONES =====

  loadZone(key, fromKey) {
    this.respawnToken++;
    this.zoneKey = key;
    this.zone = ZONES[key];
    const z = this.zone;
    const bounds = { x: 0, y: 0, w: z.size.w, h: z.size.h };
    this.bounds = bounds;

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

    this.cameras.main.setBounds(0, 0, z.size.w, z.size.h);
    this.player.bounds = bounds;

    const entry = z.portals.find((p) => p.to === fromKey);
    if (entry) {
      const dx = entry.x < z.size.w / 2 ? 70 : entry.x > z.size.w - 80 ? -70 : 0;
      const dy = entry.y < z.size.h / 2 ? 70 : entry.y > z.size.h - 80 ? -70 : 0;
      this.player.x = entry.x + dx;
      this.player.y = entry.y + dy;
    } else {
      this.player.x = z.size.w / 2;
      this.player.y = z.size.h / 2;
    }

    this.drawZoneBackground(z);
    this.drawPortals(z);

    if (z.boss) this.spawnBossEncounter(bounds);
    else if (z.mobTypes) this.spawnMobs(z, bounds);

    this.portalLock = true;
    this.showZoneBanner(z.name);
    this.centerCamera(true);
  }

  drawZoneBackground(z) {
    const g = this.zoneGfx;
    g.clear();
    g.fillStyle(z.bg, 1);
    g.fillRect(0, 0, z.size.w, z.size.h);
    g.lineStyle(6, z.accent, 1);
    g.strokeRect(3, 3, z.size.w - 6, z.size.h - 6);
    g.lineStyle(1, z.accent, 0.4);
    for (let x = 80; x < z.size.w; x += 80) g.lineBetween(x, 0, x, z.size.h);
    for (let y = 80; y < z.size.h; y += 80) g.lineBetween(0, y, z.size.w, y);
  }

  drawPortals(z) {
    const g = this.portalGfx;
    g.clear();
    for (const p of z.portals) {
      g.fillStyle(0x6cd0ff, 0.25);
      g.fillCircle(p.x, p.y, 40);
      g.lineStyle(3, 0x6cd0ff, 0.9);
      g.strokeCircle(p.x, p.y, 40);
      const label = this.add.text(p.x, p.y - 56, p.label, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', fontStyle: 'bold',
        color: '#bfe9ff', stroke: '#06121c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(2);
      this.portalSprites.push(label);
    }
  }

  spawnMobs(z, bounds) {
    for (let i = 0; i < z.mobCount; i++) {
      const typeKey = Phaser.Utils.Array.GetRandom(z.mobTypes);
      const pos = this.randomSpawnPos(z);
      this.mobs.push(new Mob(this, typeKey, pos.x, pos.y, z.mobLevel, bounds));
    }
  }

  randomSpawnPos(z) {
    for (let tries = 0; tries < 20; tries++) {
      const x = Phaser.Math.Between(120, z.size.w - 120);
      const y = Phaser.Math.Between(120, z.size.h - 120);
      const nearPortal = z.portals.some((p) => Math.hypot(p.x - x, p.y - y) < 220);
      const nearPlayer = Math.hypot(this.player.x - x, this.player.y - y) < 260;
      if (!nearPortal && !nearPlayer) return { x, y };
    }
    return { x: z.size.w / 2, y: 120 };
  }

  spawnBossEncounter(bounds) {
    const cx = bounds.w / 2, cy = bounds.h / 2;
    this.boss = new Boss(this, cx, cy - 40, { bounds, bossKey: this.zone.boss });
    this.aggro.register(this.player);
  }

  // Boss-summoned add: spawn near the boss, pre-engaged, flagged so it never
  // respawns (summons are tied to the fight, not the zone's normal spawns).
  spawnAdd(typeKey, x, y, level) {
    if (this.mobs.length >= 40) return;
    const mob = new Mob(this, typeKey, x, y, level, this.bounds);
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

  checkPortals() {
    const z = this.zone;
    let onAny = false;
    for (const p of z.portals) {
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
    this.input.keyboard.addCapture('SPACE,ONE,TWO,THREE,FOUR,Q,E,C,I,K');

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
        case 'tree': this.treePanel.toggle(); break;
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
    if (this.treeBtn && Math.hypot(p.x - this.treeBtn.x, p.y - this.treeBtn.y) <= this.treeBtn.r) return true;
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
      const p = this.input.activePointer;
      let dx = p.worldX - px, dy = p.worldY - py;
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
          const mn = new Minion(this, this.player.x + Math.cos(ang) * 30, this.player.y + Math.sin(ang) * 30, dmg, hp, def.duration, this.bounds);
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
      this.mobs.push(new Mob(this, mob.typeKey, pos.x, pos.y, mob.level, this.bounds));
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
      g.fillStyle(pr.color, 1);
      g.fillCircle(pr.x, pr.y, pr.r);
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
      if (this.joy.active && (this.move.x !== 0 || this.move.y !== 0)) {
        this.player.moveBy(this.move.x, this.move.y, dt);
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
          const len = Math.hypot(mx, my);
          this.player.moveBy(mx / len, my / len, dt);
        }
      }
    }

    if (this.autoAim) {
      const e = this.nearestEnemy();
      if (e) this.player.facing = Math.atan2(e.y - this.player.y, e.x - this.player.x);
    } else if (this.isTouch) {
      if (this.joy.active && (this.move.x !== 0 || this.move.y !== 0)) {
        this.player.facing = Math.atan2(this.move.y, this.move.x);
      }
    } else {
      const p = this.input.activePointer;
      this.player.facing = Math.atan2(p.worldY - this.player.y, p.worldX - this.player.x);
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
      this.boss.update(dt, this.bossAdapter());
      if (bossWasAlive && !this.boss.alive) this.onBossDeath();
    }

    if (!this.player.alive) this.respawnInTown();

    this.checkPortals();
    this.centerCamera(false);
    this.updateHud();
  }

  onBossDeath() {
    const { loot, xp } = this.boss.cfg;
    this.spawnText(this.bounds.w / 2, this.bounds.h / 2, 'BOSS SLAIN!', '#7CFC9A', true);
    if (this.progression.addXp(xp)) this.onLevelUp();
    this.spawnText(this.player.x, this.player.y - 64, `+${xp} XP`, '#9be8ff');
    let full = false;
    for (let i = 0; i < loot.count; i++) {
      const drop = rollItem({ ilvl: loot.ilvl, rarityBoost: loot.rarityBoost });
      if (this.inventory.length < INV_CAP) {
        this.inventory.push(drop);
        this.spawnText(this.player.x + (i - (loot.count - 1) / 2) * 64, this.player.y - 40, '✦ ' + drop.name, rarityColor(drop.rarity));
      } else full = true;
    }
    if (full) this.spawnText(this.player.x, this.player.y - 80, 'Backpack full — make room!', '#ff7a7a');
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
    const tx = this.player.x - cam.width / 2;
    const ty = this.player.y - cam.height / 2;
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

    const trX = CONFIG.width - 44, trY = 230;
    const trBg = this.add.circle(trX, trY, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffd24a, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.treeBadge = this.add.text(trX, trY, 'K', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    trBg.on('pointerdown', () => this.treePanel.toggle());
    this.treeBtn = { x: trX, y: trY, r: 22 };

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

  // Save this class's progress to localStorage (per device, per class).
  persist() {
    saveProgress(this.classKey, {
      level: this.progression.level,
      xp: this.progression.xp,
      statPoints: this.progression.statPoints,
      stats: { ...this.baseAttrs },
      inventory: this.inventory,
      gear: this.gear,
      skillTree: this.skillTree,
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
      `STR ${s.STR} DEX ${s.DEX} INT ${s.INT} VIT ${s.VIT} AGI ${s.AGI}`,
      pr.statPoints > 0 ? `>> ${pr.statPoints} stat point(s) — press C` : '',
      this.skillPointsLeft() > 0 ? `>> ${this.skillPointsLeft()} skill point(s) — press K` : '',
    ].filter(Boolean).join('\n'));
    if (this.treeBadge) this.treeBadge.setColor(this.skillPointsLeft() > 0 ? '#7CFC9A' : '#ffd24a');

    this.zoneText.setText(this.zone.name + (this.zone.safe ? '  (safe)' : ''));
    this.xpFill.width = CONFIG.width * Phaser.Math.Clamp(pr.xpRatio(), 0, 1);

    for (const sb of this.skillBoxes) {
      sb.overlay.height = sb.boxW * Phaser.Math.Clamp(this.player.cooldowns[sb.slot] / sb.def.cd, 0, 1);
    }
    if (this.charPanelOpen) this.refreshCharPanel();
  }

  // ======================================================= EFFECTS / FX =====

  spawnSwingArc(player, range, half) {
    const gfx = this.add.graphics().setDepth(15);
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
    const fx = this.add.graphics().setDepth(12);
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
    const fx = this.add.graphics().setDepth(12);
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
    const txt = this.add.text(x, y, String(value), {
      fontFamily: 'Segoe UI, sans-serif', fontSize: big ? '20px' : '14px', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(80);
    this.tweens.add({ targets: txt, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
  }
}
