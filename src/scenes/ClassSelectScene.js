import { CONFIG } from '../config.js';
import { CLASSES, CLASS_ORDER } from '../classes/classes.js';

// Character creation: pick one of the six classes, then start the game.
export default class ClassSelectScene extends Phaser.Scene {
  constructor() {
    super('ClassSelectScene');
  }

  create() {
    this.cameras.main.setBackgroundColor(CONFIG.colors.bg);

    this.add.text(CONFIG.width / 2, 40, 'CHOOSE YOUR CLASS', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '34px', fontStyle: 'bold', color: '#ffd24a',
    }).setOrigin(0.5);

    this.add.text(CONFIG.width / 2, 80, 'Tap / click a class to begin your adventure', {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', color: '#9aa6c4',
    }).setOrigin(0.5);

    const cols = 3, rows = 2;
    const cardW = 300, cardH = 230, gapX = 24, gapY = 22;
    const gridW = cols * cardW + (cols - 1) * gapX;
    const startX = CONFIG.width / 2 - gridW / 2 + cardW / 2;
    const startY = 150;

    CLASS_ORDER.forEach((key, i) => {
      const def = CLASSES[key];
      const cx = startX + (i % cols) * (cardW + gapX);
      const cy = startY + Math.floor(i / cols) * (cardH + gapY) + cardH / 2;
      this.makeCard(def, key, cx, cy, cardW, cardH);
    });
  }

  makeCard(def, key, cx, cy, w, h) {
    const card = this.add.rectangle(cx, cy, w, h, 0x161a2e, 0.96)
      .setStrokeStyle(3, def.color).setInteractive({ useHandCursor: true });

    this.add.circle(cx - w / 2 + 34, cy - h / 2 + 30, 14, def.color);
    this.add.text(cx - w / 2 + 58, cy - h / 2 + 18, def.name, {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ffffff',
    });
    this.add.text(cx - w / 2 + 58, cy - h / 2 + 44, def.role, {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: '#9aa6c4',
    });

    const s = def.stats;
    this.add.text(cx - w / 2 + 20, cy - 30, `STR ${s.STR}   DEX ${s.DEX}   INT ${s.INT}\nVIT ${s.VIT}   AGI ${s.AGI}`, {
      fontFamily: 'Consolas, monospace', fontSize: '13px', color: '#cdd6ee', lineSpacing: 4,
    });

    this.add.text(cx, cy + 28, def.desc, {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: '#b6bdd4',
      align: 'center', wordWrap: { width: w - 30 },
    }).setOrigin(0.5, 0);

    const skillNames = def.skills.map((sk) => sk.name).join(' · ');
    this.add.text(cx, cy + h / 2 - 22, skillNames, {
      fontFamily: 'Segoe UI, sans-serif', fontSize: '10px', color: '#7f88a6',
      align: 'center', wordWrap: { width: w - 24 },
    }).setOrigin(0.5);

    card.on('pointerover', () => card.setStrokeStyle(4, 0xffffff));
    card.on('pointerout', () => card.setStrokeStyle(3, def.color));
    card.on('pointerdown', () => this.scene.start('LobbyScene', { classKey: key }));
  }
}
