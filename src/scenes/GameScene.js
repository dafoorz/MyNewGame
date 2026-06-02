import { CONFIG, STAT_PRESETS } from '../config.js';
import { Stats } from '../stats.js';
import AggroTable from '../systems/AggroTable.js';
import Progression from '../systems/Progression.js';
import Player from '../entities/Player.js';
import Ally from '../entities/Ally.js';
import Boss from '../entities/Boss.js';
import Mob from '../entities/Mob.js';
import { ZONES, START_ZONE } from '../world/zones.js';

const SKILLS = [
  { slot: 1, key: '1', name: 'Heavy Strike', cd: 5, color: '#ffcf6b' },
  { slot: 2, key: '2', name: 'Taunt', cd: 11, color: '#ff8c5a' },
  { slot: 3, key: '3', name: 'Shield Wall', cd: 16, color: '#66ccff' },
  { slot: 4, key: '4', name: 'Whirlwind', cd: 8, color: '#c89bff' },
];

const STAT_INFO = [
  ['STR', 'melee damage'],
  ['DEX', 'crit / atk speed'],
  ['INT', 'magic damage'],
  ['VIT', 'max health'],
  ['AGI', 'move speed'],
];

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.isTouch = this.sys.game.device.input.touch || 'ontouchstart' in window;

    // Persistent player + progression (survive zone changes).
    this.progression = new Progression();
    this.player = new Player(this, 200, 400, new Stats(STAT_PRESETS.tank), { name: 'Hero' });

    // Per-zone state.
    this.mobs = [];
    this.projectiles = [];
    this.boss = null;
    this.mage = null;
    this.aggro = new AggroTable();
    this.portalSprites = [];
    this.respawnToken = 0; // invalidates pending respawns on zone change

    // World graphics layers.
    this.zoneGfx = this.add.graphics().setDepth(-1);
    this.portalGfx = this.add.graphics().setDepth(1);
    this.projGfx = this.add.graphics().setDepth(7);

    this.setupInput();
    this.buildHud();
    this.buildTouchControls();
    this.buildCharPanel();

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

    // Clear previous zone contents.
    this.mobs.forEach((m) => m.destroy());
    this.mobs = [];
    this.projectiles = [];
    this.projGfx.clear();
    if (this.boss) { this.boss.destroy(); this.boss = null; }
    if (this.mage) { this.mage.destroy(); this.mage = null; }
    this.aggro = new AggroTable();
    this.portalSprites.forEach((o) => o.destroy());
    this.portalSprites = [];

    // Camera + player bounds.
    this.cameras.main.setBounds(0, 0, z.size.w, z.size.h);
    this.player.bounds = bounds;

    // Entry position: stand on the portal that leads back where we came from.
    const entry = z.portals.find((p) => p.to === fromKey);
    if (entry) {
      const inward = entry.x < z.size.w / 2 ? 70 : entry.x > z.size.w - 80 ? -70 : 0;
      const inwardY = entry.y < z.size.h / 2 ? 70 : entry.y > z.size.h - 80 ? -70 : 0;
      this.player.x = entry.x + inward;
      this.player.y = entry.y + inwardY;
    } else {
      this.player.x = z.size.w / 2;
      this.player.y = z.size.h / 2;
    }

    this.drawZoneBackground(z);
    this.drawPortals(z);

    if (z.boss) this.spawnBossEncounter(bounds);
    else if (z.mobTypes) this.spawnMobs(z, bounds);

    this.portalLock = true; // don't bounce straight back through the entry portal
    this.showZoneBanner(z.name);
    this.centerCamera(true);
  }

  drawZoneBackground(z) {
    const g = this.zoneGfx;
    g.clear();
    g.fillStyle(z.bg, 1);
    g.fillRect(0, 0, z.size.w, z.size.h);
    // border
    g.lineStyle(6, z.accent, 1);
    g.strokeRect(3, 3, z.size.w - 6, z.size.h - 6);
    // grid
    g.lineStyle(1, z.accent, 0.4);
    for (let x = 80; x < z.size.w; x += 80) {
      g.lineBetween(x, 0, x, z.size.h);
    }
    for (let y = 80; y < z.size.h; y += 80) {
      g.lineBetween(0, y, z.size.w, y);
    }
  }

  drawPortals(z) {
    const g = this.portalGfx;
    g.clear();
    for (const p of z.portals) {
      g.fillStyle(0x6cd0ff, 0.25);
      g.fillCircle(p.x, p.y, 40);
      g.lineStyle(3, 0x6cd0ff, 0.9);
      g.strokeCircle(p.x, p.y, 40);
      const label = this.add
        .text(p.x, p.y - 56, p.label, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#bfe9ff',
          stroke: '#06121c',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(2);
      this.portalSprites.push(label);
    }
  }

  spawnMobs(z, bounds) {
    this.zoneMobPlan = []; // remembered so respawns recreate the same population
    for (let i = 0; i < z.mobCount; i++) {
      const typeKey = Phaser.Utils.Array.GetRandom(z.mobTypes);
      const pos = this.randomSpawnPos(z);
      this.zoneMobPlan.push({ typeKey, x: pos.x, y: pos.y, level: z.mobLevel });
      this.mobs.push(new Mob(this, typeKey, pos.x, pos.y, z.mobLevel, bounds));
    }
  }

  randomSpawnPos(z) {
    // Keep mobs away from portals and the player's entry point.
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
    const cx = bounds.w / 2;
    const cy = bounds.h / 2;
    this.boss = new Boss(this, cx, cy - 40, { bounds });
    this.mage = new Ally(this, cx - 200, cy - 40, new Stats(STAT_PRESETS.mage), { name: 'Mage' });
    this.mage.bounds = bounds;
    this.aggro.register(this.player);
    this.aggro.register(this.mage);
  }

  checkPortals() {
    const z = this.zone;
    let onAny = false;
    for (const p of z.portals) {
      if (Math.hypot(p.x - this.player.x, p.y - this.player.y) <= 42) {
        onAny = true;
        if (!this.portalLock) {
          this.loadZone(p.to, this.zoneKey);
          return;
        }
      }
    }
    if (!onAny) this.portalLock = false;
  }

  // =============================================================== INPUT =====

  setupInput() {
    this.keys = this.input.keyboard.addKeys('W,A,S,D');
    this.input.addPointer(2);

    this.move = { x: 0, y: 0 };
    this.joy = { active: false, id: -1, baseX: 0, baseY: 0 };

    this.input.on('pointerdown', (p) => {
      if (this.isOverUI(p)) return;
      if (this.isTouch) {
        if (p.x < CONFIG.width * 0.5) this.startJoystick(p);
      } else if (p.button === 0) {
        this.basicAttack();
      }
    });
    this.input.on('pointermove', (p) => {
      if (this.joy.active && p.id === this.joy.id) this.updateJoystick(p);
    });
    const release = (p) => { if (this.joy.active && p.id === this.joy.id) this.endJoystick(); };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    this.input.keyboard.on('keydown-ONE', () => this.useSkill(1));
    this.input.keyboard.on('keydown-TWO', () => this.useSkill(2));
    this.input.keyboard.on('keydown-THREE', () => this.useSkill(3));
    this.input.keyboard.on('keydown-FOUR', () => this.useSkill(4));
    this.input.keyboard.on('keydown-C', () => this.toggleCharPanel());
  }

  isOverUI(p) {
    if (this.charPanelOpen && Math.abs(p.x - CONFIG.width / 2) < 200) return true;
    if (this.skillBoxes) {
      for (const sb of this.skillBoxes) {
        if (Math.abs(p.x - sb.x) <= sb.boxW / 2 && Math.abs(p.y - sb.y) <= sb.boxW / 2) return true;
      }
    }
    if (this.attackBtn && Math.hypot(p.x - this.attackBtn.x, p.y - this.attackBtn.y) <= this.attackBtn.r) return true;
    if (this.charBtn && Math.hypot(p.x - this.charBtn.x, p.y - this.charBtn.y) <= this.charBtn.r) return true;
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
    let dx = p.x - this.joy.baseX;
    let dy = p.y - this.joy.baseY;
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

  nearestEnemy(maxDist = 700) {
    let best = null;
    let bestD = maxDist;
    for (const e of this.enemies()) {
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  applyHit(enemy, amount, crit = false) {
    if (enemy === this.boss) {
      this.boss.takeDamage(amount);
      this.aggro.add(this.player, amount * this.player.threatMultiplier);
    } else {
      enemy.takeDamage(amount);
    }
    this.spawnText(enemy.x, enemy.y - enemy.radius - 4, amount, crit ? '#ffe066' : '#ffffff', crit);
    if (enemy !== this.boss && !enemy.alive) this.handleMobDeath(enemy);
  }

  hitArc(range, halfAngle, powerMult, threatMult, crit) {
    let any = false;
    for (const e of this.enemies()) {
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      if (Math.hypot(dx, dy) > range + e.radius) continue;
      const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - this.player.facing));
      if (diff <= halfAngle) {
        const { amount } = this.player.stats.roll(this.player.stats.physPower * powerMult);
        if (e === this.boss) {
          this.boss.takeDamage(amount);
          this.aggro.add(this.player, amount * this.player.threatMultiplier * threatMult);
          this.spawnText(e.x, e.y - e.radius - 4, amount, crit ? '#ffe066' : '#ffffff', crit);
        } else {
          this.applyHit(e, amount, crit);
        }
        any = true;
      }
    }
    return any;
  }

  basicAttack() {
    if (!this.player.canBasicAttack()) return;
    this.player.startBasicCooldown();
    this.spawnSwingArc(this.player);
    this.hitArc(this.player.attackRange, Math.PI * 0.42, 1, 1, false);
  }

  useSkill(slot) {
    if (!this.player.alive || this.player.isOnCooldown(slot)) return;
    const def = SKILLS[slot - 1];

    switch (slot) {
      case 1:
        this.spawnSwingArc(this.player);
        this.hitArc(this.player.attackRange + 10, Math.PI * 0.42, 2.6, 2.0, true);
        break;
      case 2:
        if (this.boss) this.aggro.forceTop(this.player, CONFIG.threat.tauntBonus);
        for (const m of this.mobs) if (Math.hypot(m.x - this.player.x, m.y - this.player.y) < 260) m.engaged = true;
        this.spawnText(this.player.x, this.player.y - 30, 'TAUNT!', '#ff8c5a');
        break;
      case 3:
        this.player.applyShield(0.55, 4);
        this.spawnText(this.player.x, this.player.y - 30, 'SHIELD', '#66ccff');
        break;
      case 4:
        this.spawnWhirlwind();
        for (const e of this.enemies()) {
          if (Math.hypot(e.x - this.player.x, e.y - this.player.y) <= 100 + e.radius) {
            const { amount } = this.player.stats.roll(this.player.stats.physPower * 1.7);
            this.applyHit(e, amount, true);
          }
        }
        break;
    }
    this.player.startCooldown(slot, def.cd);
  }

  handleMobDeath(mob) {
    const levels = this.progression.addXp(mob.xp);
    this.spawnText(mob.x, mob.y - 20, `+${mob.xp} XP`, '#9be8ff');
    if (levels > 0) this.onLevelUp(levels);

    mob.destroy();
    this.mobs = this.mobs.filter((m) => m !== mob);

    // Respawn to keep the zone populated.
    const token = this.respawnToken;
    const z = this.zone;
    this.time.delayedCall(8000, () => {
      if (token !== this.respawnToken) return; // changed zones
      const pos = this.randomSpawnPos(z);
      this.mobs.push(new Mob(this, mob.typeKey, pos.x, pos.y, mob.level, this.bounds));
    });
  }

  onLevelUp(levels) {
    this.player.recalc();
    this.player.hp = this.player.maxHp; // full heal on level up
    this.spawnText(this.player.x, this.player.y - 46, `LEVEL UP! Lv${this.progression.level}`, '#ffe066', true);
  }

  fireProjectile(fromX, fromY, tx, ty, dmg, speed) {
    const ang = Math.atan2(ty - fromY, tx - fromX);
    this.projectiles.push({
      x: fromX, y: fromY,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      dmg, ttl: 3,
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
      const hit = this.player.alive && Math.hypot(pr.x - this.player.x, pr.y - this.player.y) <= this.player.radius + 5;
      const out = pr.x < 0 || pr.y < 0 || pr.x > this.bounds.w || pr.y > this.bounds.h;
      if (hit) {
        const dealt = this.player.takeDamage(pr.dmg);
        this.spawnText(this.player.x, this.player.y - this.player.radius - 4, dealt, '#ff6b6b');
        continue;
      }
      if (pr.ttl <= 0 || out) continue;
      g.fillStyle(0xff7b5a, 1);
      g.fillCircle(pr.x, pr.y, 5);
      next.push(pr);
    }
    this.projectiles = next;
  }

  // ============================================================== UPDATE =====

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);

    // Movement.
    if (this.player.alive) {
      if (this.joy.active && (this.move.x !== 0 || this.move.y !== 0)) {
        this.player.moveBy(this.move.x, this.move.y, dt);
      } else {
        let mx = 0, my = 0;
        if (this.keys.A.isDown) mx -= 1;
        if (this.keys.D.isDown) mx += 1;
        if (this.keys.W.isDown) my -= 1;
        if (this.keys.S.isDown) my += 1;
        if (mx !== 0 || my !== 0) {
          const len = Math.hypot(mx, my);
          this.player.moveBy(mx / len, my / len, dt);
        }
      }
    }

    // Facing: desktop aims at mouse; touch faces nearest enemy.
    if (this.isTouch) {
      const e = this.nearestEnemy();
      if (e) this.player.facing = Math.atan2(e.y - this.player.y, e.x - this.player.x);
    } else {
      const p = this.input.activePointer;
      this.player.facing = Math.atan2(p.worldY - this.player.y, p.worldX - this.player.x);
    }

    this.player.update(dt);

    const ctx = {
      player: this.player,
      onMelee: (mob) => {
        const dealt = this.player.takeDamage(mob.damage);
        this.spawnText(this.player.x, this.player.y - this.player.radius - 4, dealt, '#ff6b6b');
      },
      fireProjectile: (fx, fy, tx, ty, dmg, sp) => this.fireProjectile(fx, fy, tx, ty, dmg, sp),
    };
    for (const m of this.mobs) m.update(dt, ctx);
    this.updateProjectiles(dt);

    if (this.boss) {
      this.mage.aiUpdate(dt, {
        boss: this.boss,
        telegraph: this.boss.telegraph,
        onCast: (amount, crit) => {
          this.boss.takeDamage(amount);
          this.aggro.add(this.mage, amount * this.mage.threatMultiplier);
          this.spawnText(this.boss.x, this.boss.y - this.boss.radius, amount, crit ? '#ffe066' : '#fff', crit);
        },
      });
      this.boss.update(dt, {
        players: [this.player, this.mage],
        aggro: this.aggro,
        onHit: (pl, amount) => {
          const dealt = pl.takeDamage(amount);
          this.spawnText(pl.x, pl.y - pl.radius - 4, dealt, '#ff6b6b');
          if (!pl.alive) this.aggro.remove(pl);
        },
      });
      if (!this.boss.alive) this.spawnText(this.bounds.w / 2, this.bounds.h / 2, 'BOSS SLAIN!', '#7CFC9A', true);
    }

    if (!this.player.alive) this.respawnInTown();

    this.checkPortals();
    this.centerCamera(false);
    this.updateHud();
  }

  respawnInTown() {
    this.player.alive = true;
    this.player.hp = this.player.maxHp;
    this.player.damageReduction = 0;
    this.spawnText(CONFIG.width / 2 + this.cameras.main.scrollX, 120 + this.cameras.main.scrollY, 'Defeated — back to town', '#ff6b6b', true);
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

    // XP bar across the very bottom.
    const xpY = CONFIG.height - 8;
    this.add.rectangle(CONFIG.width / 2, xpY, CONFIG.width, 10, 0x000000, 0.6).setDepth(59).setScrollFactor(0);
    this.xpFill = this.add.rectangle(0, xpY, 0, 10, 0x9be8ff, 0.9).setOrigin(0, 0.5).setDepth(60).setScrollFactor(0);

    // Skill bar.
    this.skillBoxes = [];
    const boxW = 60, gap = 10;
    const totalW = SKILLS.length * boxW + (SKILLS.length - 1) * gap;
    const startX = CONFIG.width / 2 - totalW / 2;
    const y = CONFIG.height - 56;
    SKILLS.forEach((def, i) => {
      const x = startX + i * (boxW + gap) + boxW / 2;
      const box = this.add.rectangle(x, y, boxW, boxW, 0x1c2138, 0.95)
        .setStrokeStyle(2, 0x3a4366).setDepth(60).setScrollFactor(0).setInteractive();
      box.on('pointerdown', () => this.useSkill(def.slot));
      this.add.text(x - boxW / 2 + 5, y - boxW / 2 + 3, def.key, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#fff',
      }).setDepth(62).setScrollFactor(0);
      this.add.text(x, y + boxW / 2 - 11, def.name, {
        fontFamily: 'Segoe UI, sans-serif', fontSize: '8px', color: def.color,
        align: 'center', wordWrap: { width: boxW - 4 },
      }).setOrigin(0.5).setDepth(62).setScrollFactor(0);
      const overlay = this.add.rectangle(x, y + boxW / 2, boxW, boxW, 0x000000, 0.65)
        .setOrigin(0.5, 1).setDepth(61).setScrollFactor(0);
      overlay.height = 0;
      this.skillBoxes.push({ def, overlay, boxW, x, y });
    });
  }

  buildTouchControls() {
    this.joyBase = this.add.circle(0, 0, 60, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.25)
      .setDepth(70).setScrollFactor(0).setVisible(false);
    this.joyThumb = this.add.circle(0, 0, 26, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.5)
      .setDepth(71).setScrollFactor(0).setVisible(false);

    // Character/stats button (always available, useful on desktop too).
    const cx = CONFIG.width - 44, cy = 30;
    const cbtn = this.add.circle(cx, cy, 22, 0x32405e, 0.9).setStrokeStyle(2, 0xffd24a, 0.8)
      .setDepth(70).setScrollFactor(0).setInteractive();
    this.add.text(cx, cy, 'C', { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#ffd24a' })
      .setOrigin(0.5).setDepth(71).setScrollFactor(0);
    cbtn.on('pointerdown', () => this.toggleCharPanel());
    this.charBtn = { x: cx, y: cy, r: 22 };

    if (!this.isTouch) return;
    const ax = CONFIG.width - 80, ay = CONFIG.height - 96;
    const btn = this.add.circle(ax, ay, 46, CONFIG.colors.tank, 0.9).setStrokeStyle(3, 0xffffff, 0.85)
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

  toggleCharPanel() {
    this.charPanelOpen = !this.charPanelOpen;
    this.charPanel.setVisible(this.charPanelOpen);
    if (this.charPanelOpen) this.refreshCharPanel();
  }

  spendStat(attr) {
    if (this.progression.statPoints <= 0) return;
    this.progression.statPoints--;
    this.player.stats[attr]++;
    if (attr === 'VIT') this.player.recalc();
    this.refreshCharPanel();
  }

  refreshCharPanel() {
    const s = this.player.stats;
    this.charTitle.setText(`Character  —  ${this.progression.statPoints} point(s)`);
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
      `Lv ${pr.level}   HP ${Math.ceil(this.player.hp)}/${this.player.maxHp}`,
      `XP ${pr.xp}/${pr.xpToNext()}`,
      `STR ${s.STR} DEX ${s.DEX} INT ${s.INT} VIT ${s.VIT} AGI ${s.AGI}`,
      pr.statPoints > 0 ? `>> ${pr.statPoints} stat point(s) — press C` : '',
    ].join('\n'));

    this.zoneText.setText(this.zone.name + (this.zone.safe ? '  (safe)' : ''));
    this.xpFill.width = CONFIG.width * Phaser.Math.Clamp(pr.xpRatio(), 0, 1);

    for (const sb of this.skillBoxes) {
      const remaining = this.player.cooldowns[sb.def.slot];
      sb.overlay.height = sb.boxW * Phaser.Math.Clamp(remaining / sb.def.cd, 0, 1);
    }

    if (this.charPanelOpen) this.refreshCharPanel();
  }

  // ======================================================= EFFECTS / FX =====

  spawnSwingArc(player) {
    const gfx = this.add.graphics().setDepth(15);
    const cx = player.x, cy = player.y, facing = player.facing, R = player.attackRange;
    const half = Math.PI * 0.4;
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
          const px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R;
          i === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py);
        }
        gfx.strokePath();
        if (t >= 170) { gfx.destroy(); ev.remove(); }
      },
    });
  }

  spawnWhirlwind() {
    const fx = this.add.graphics().setDepth(12);
    let t = 0;
    const ev = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        t += 16;
        fx.clear();
        fx.lineStyle(4, 0xc89bff, Phaser.Math.Clamp(1 - t / 300, 0, 1));
        fx.strokeCircle(this.player.x, this.player.y, 100 * (t / 300));
        if (t >= 300) { fx.destroy(); ev.remove(); }
      },
    });
  }

  spawnText(x, y, value, color = '#ffffff', big = false) {
    const txt = this.add.text(x, y, String(value), {
      fontFamily: 'Segoe UI, sans-serif', fontSize: big ? '20px' : '14px', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(80);
    this.tweens.add({ targets: txt, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
  }
}
