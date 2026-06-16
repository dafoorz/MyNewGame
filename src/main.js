import { CONFIG } from './config.js';
import ClassSelectScene from './scenes/ClassSelectScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import GameScene from './scenes/GameScene.js';
import OnlineScene from './scenes/OnlineScene.js';

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
  // DOM support lets the lobby use real <input> fields (name / party code).
  dom: { createContainer: true },
  render: {
    pixelArt: false,
    antialias: true,
  },
  scene: [LobbyScene, ClassSelectScene, GameScene, OnlineScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
