import { CONFIG, STAT_PRESETS } from '../config.js';
import { Stats } from '../stats.js';
import AggroTable from '../systems/AggroTable.js';
import Player from '../entities/Player.js';
import Ally from '../entities/Ally.js';
import Boss from '../entities/Boss.js';

// Tank skills. Slot -> behavior is handled in useSkill(); this is the data the
// UI and cooldown logic read.
const SKILLS = [
  { slot: 1, key: '1', name: 'Heavy Strike', cd: 5, color: '#ffcf6b' },
  { slot: 2, key: '2', name: 'Taunt', cd: 11, color: '#ff8c5a' },
  { slot: 3, key: '3', name: 'Shield Wall', cd: 16, color: '#66ccff' },
  { slot: 4, key: '4', name: 'Whirlwind', cd: 8, color: '#c89bff' },
];

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.over = false;
    this.outcome = null;

    this.drawArena();

    // --- systems + entities ---
    this.aggro = new AggroTable();

    const cx = CONFIG.arena.x + CONFIG.arena.w / 2;
    const cy = CONFIG.arena.y + CONFIG.arena.h / 2;

    this.boss = new Boss(this, cx, cy - 40);
    this.tank = new Player(this, cx, cy + 160, new Stats(STAT_PRESETS.tank), {
      name: 'Tank',
    });
    this.mage = new Ally(this, cx - 220, cy - 40, new Stats(STAT_PRESETS.mage), {
      name: 'Mage',
    });

    this.players = [this.tank, this.mage];
    this.aggro.register(this.tank);
    this.aggro.register(this.mage);

    this.setupInput();
    this.buildHud();
  }

  // ---------------------------------------------------------------- arena ----

  drawArena() {
    const a = CONFIG.arena;
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(CONFIG.colors.arenaFill, 1);
    g.fillRoundedRect(a.x, a.y, a.w, a.h, 10);
    g.lineStyle(3, CONFIG.colors.arenaEdge, 1);
    g.strokeRoundedRect(a.x, a.y, a.w, a.h, 10);

    // faint grid for spatial reference
    g.lineStyle(1, CONFIG.colors.arenaEdge, 0.35);
    for (let x = a.x + 60; x < a.x + a.w; x += 60) {
      g.beginPath();
      g.moveTo(x, a.y);
      g.lineTo(x, a.y + a.h);
      g.strokePath();
    }
    for (let y = a.y + 60; y < a.y + a.h; y += 60) {
      g.beginPath();
      g.moveTo(a.x, y);
      g.lineTo(a.x + a.w, y);
      g.strokePath();
    }
  }

  // ---------------------------------------------------------------- input ----

  setupInput() {
    this.keys = this.input.keyboard.addKeys('W,A,S,D');

    // Left click = basic attack.
    this.input.on('pointerdown', (pointer) => {
      if (this.over || pointer.button !== 0) return;
      this.basicAttack();
    });

    // Skills 1-4.
    this.input.keyboard.on('keydown-ONE', () => this.useSkill(1));
    this.input.keyboard.on('keydown-TWO', () => this.useSkill(2));
    this.input.keyboard.on('keydown-THREE', () => this.useSkill(3));
    this.input.keyboard.on('keydown-FOUR', () => this.useSkill(4));

    // Restart when the encounter is finished.
    this.input.keyboard.on('keydown-R', () => {
      if (this.over) this.scene.restart();
    });
  }

  // ---------------------------------------------------------------- combat ---

  inMeleeRange(target = this.boss) {
    const dist = Math.hypot(target.x - this.tank.x, target.y - this.tank.y);
    return dist <= this.tank.attackRange + target.radius;
  }

  dealToBoss(amount, threatMultiplier, source, crit = false) {
    if (!this.boss.alive) return;
    this.boss.takeDamage(amount);
    this.aggro.add(source, amount * source.threatMultiplier * threatMultiplier);
    this.spawnText(this.boss.x, this.boss.y - this.boss.radius, amount, crit ? '#ffe066' : '#ffffff', crit);
  }

  basicAttack() {
    if (!this.tank.canBasicAttack()) return;
    this.tank.startBasicCooldown();
    if (!this.inMeleeRange()) return; // swing whiffs if out of range
    const { amount, crit } = this.tank.stats.roll(this.tank.stats.physPower);
    this.dealToBoss(amount, 1, this.tank, crit);
  }

  useSkill(slot) {
    if (this.over || !this.tank.alive) return;
    if (this.tank.isOnCooldown(slot)) return;
    const def = SKILLS[slot - 1];

    switch (slot) {
      case 1: {
        // Heavy Strike — big single hit + threat.
        if (!this.inMeleeRange()) return;
        const { amount } = this.tank.stats.roll(this.tank.stats.physPower * 2.6);
        this.dealToBoss(amount, 2.0, this.tank, true);
        break;
      }
      case 2: {
        // Taunt — vault to the top of the threat table (+ a light hit).
        this.aggro.forceTop(this.tank, CONFIG.threat.tauntBonus);
        this.spawnText(this.tank.x, this.tank.y - 30, 'TAUNT!', '#ff8c5a');
        if (this.inMeleeRange()) {
          const { amount } = this.tank.stats.roll(this.tank.stats.physPower * 0.8);
          this.dealToBoss(amount, 1, this.tank);
        }
        break;
      }
      case 3: {
        // Shield Wall — heavy damage reduction for a few seconds.
        this.tank.applyShield(0.55, 4);
        this.spawnText(this.tank.x, this.tank.y - 30, 'SHIELD', '#66ccff');
        break;
      }
      case 4: {
        // Whirlwind — AoE; only connects if the boss is right on top of you.
        this.spawnWhirlwind();
        const dist = Math.hypot(this.boss.x - this.tank.x, this.boss.y - this.tank.y);
        if (dist <= 95 + this.boss.radius) {
          const { amount } = this.tank.stats.roll(this.tank.stats.physPower * 1.7);
          this.dealToBoss(amount, 1.5, this.tank, true);
        }
        break;
      }
    }

    this.tank.startCooldown(slot, def.cd);
  }

  spawnWhirlwind() {
    const fx = this.add.graphics().setDepth(12);
    let t = 0;
    const ev = this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        t += 16;
        fx.clear();
        const a = Phaser.Math.Clamp(1 - t / 300, 0, 1);
        fx.lineStyle(4, 0xc89bff, a);
        fx.strokeCircle(this.tank.x, this.tank.y, 95 * (t / 300));
        if (t >= 300) {
          fx.destroy();
          ev.remove();
        }
      },
    });
  }

  // ---------------------------------------------------------------- update ---

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    if (this.over) return;

    // Tank movement (WASD).
    let mx = 0;
    let my = 0;
    if (this.keys.A.isDown) mx -= 1;
    if (this.keys.D.isDown) mx += 1;
    if (this.keys.W.isDown) my -= 1;
    if (this.keys.S.isDown) my += 1;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      this.tank.moveBy(mx / len, my / len, dt);
    }

    // Tank faces the mouse.
    const p = this.input.activePointer;
    this.tank.facing = Math.atan2(p.worldY - this.tank.y, p.worldX - this.tank.x);

    this.tank.update(dt);

    this.mage.aiUpdate(dt, {
      boss: this.boss,
      telegraph: this.boss.telegraph,
      onCast: (amount, crit) => this.dealToBoss(amount, 1, this.mage, crit),
    });

    this.boss.update(dt, {
      players: this.players,
      aggro: this.aggro,
      onHit: (player, amount) => {
        const dealt = player.takeDamage(amount);
        this.spawnText(player.x, player.y - player.radius - 4, dealt, '#ff6b6b');
        if (!player.alive) this.aggro.remove(player);
      },
    });

    this.checkEndState();
    this.updateHud();
  }

  checkEndState() {
    if (!this.boss.alive) return this.endEncounter('victory');
    if (this.players.every((p) => !p.alive)) return this.endEncounter('defeat');
  }

  endEncounter(outcome) {
    this.over = true;
    this.outcome = outcome;

    this.add
      .rectangle(CONFIG.width / 2, CONFIG.height / 2, CONFIG.width, CONFIG.height, 0x000000, 0.55)
      .setDepth(200)
      .setScrollFactor(0);

    const win = outcome === 'victory';
    this.add
      .text(CONFIG.width / 2, CONFIG.height / 2 - 20, win ? 'VICTORY' : 'DEFEAT', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '56px',
        fontStyle: 'bold',
        color: win ? '#7CFC9A' : '#ff6b6b',
      })
      .setOrigin(0.5)
      .setDepth(201)
      .setScrollFactor(0);

    this.add
      .text(CONFIG.width / 2, CONFIG.height / 2 + 36, 'Press R to fight again', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '18px',
        color: '#cdd2e0',
      })
      .setOrigin(0.5)
      .setDepth(201)
      .setScrollFactor(0);
  }

  // ------------------------------------------------------------------- hud ---

  buildHud() {
    // Stats panel (top-left).
    this.statsText = this.add
      .text(16, 60, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '12px',
        color: '#a9b2cc',
        lineSpacing: 2,
      })
      .setDepth(60)
      .setScrollFactor(0);

    // Controls hint (top-right).
    this.add
      .text(
        CONFIG.width - 16,
        60,
        ['WASD: move', 'Mouse: aim', 'Click: attack', '1 Heavy  2 Taunt', '3 Shield  4 Whirlwind'].join('\n'),
        {
          fontFamily: 'Consolas, monospace',
          fontSize: '12px',
          color: '#a9b2cc',
          align: 'right',
          lineSpacing: 2,
        }
      )
      .setOrigin(1, 0)
      .setDepth(60)
      .setScrollFactor(0);

    // Skill bar (bottom-center).
    this.skillBoxes = [];
    const boxW = 64;
    const gap = 12;
    const totalW = SKILLS.length * boxW + (SKILLS.length - 1) * gap;
    const startX = CONFIG.width / 2 - totalW / 2;
    const y = CONFIG.height - 50;

    SKILLS.forEach((def, i) => {
      const x = startX + i * (boxW + gap) + boxW / 2;
      this.add
        .rectangle(x, y, boxW, boxW, 0x1c2138, 0.95)
        .setStrokeStyle(2, 0x3a4366)
        .setDepth(60)
        .setScrollFactor(0);

      this.add
        .text(x - boxW / 2 + 5, y - boxW / 2 + 3, def.key, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setDepth(62)
        .setScrollFactor(0);

      this.add
        .text(x, y + boxW / 2 - 12, def.name, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '9px',
          color: def.color,
          align: 'center',
          wordWrap: { width: boxW - 4 },
        })
        .setOrigin(0.5)
        .setDepth(62)
        .setScrollFactor(0);

      // Cooldown overlay (shrinks from full to empty as the skill recharges).
      const overlay = this.add
        .rectangle(x, y + boxW / 2, boxW, boxW, 0x000000, 0.65)
        .setOrigin(0.5, 1)
        .setDepth(61)
        .setScrollFactor(0);
      overlay.height = 0;

      this.skillBoxes.push({ def, overlay, boxW });
    });
  }

  updateHud() {
    const s = this.tank.stats;
    this.statsText.setText(
      [
        `${this.tank.name}  HP ${Math.ceil(this.tank.hp)}/${this.tank.maxHp}`,
        `STR ${s.STR}  DEX ${s.DEX}  INT ${s.INT}`,
        `VIT ${s.VIT}  AGI ${s.AGI}`,
        `Threat ${Math.round(this.aggro.get(this.tank))}`,
      ].join('\n')
    );

    for (const sb of this.skillBoxes) {
      const remaining = this.tank.cooldowns[sb.def.slot];
      const ratio = Phaser.Math.Clamp(remaining / sb.def.cd, 0, 1);
      sb.overlay.height = sb.boxW * ratio;
    }
  }

  // ------------------------------------------------------------ floating text
  spawnText(x, y, value, color = '#ffffff', big = false) {
    const txt = this.add
      .text(x, y, String(value), {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: big ? '20px' : '15px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(80);

    this.tweens.add({
      targets: txt,
      y: y - 34,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy(),
    });
  }
}
