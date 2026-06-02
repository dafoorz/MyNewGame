import { CONFIG } from './config.js';
import GameScene from './scenes/GameScene.js';

// Phaser is loaded globally from the CDN <script> in index.html.
const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: CONFIG.width,
  height: CONFIG.height,
  backgroundColor: CONFIG.colors.bg,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: false,
    antialias: true,
  },
  scene: [GameScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
