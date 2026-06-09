import BossCore from '../../src/world/BossCore.js';

// Headless authoritative boss. All behavior lives in the shared, Phaser-free
// BossCore (driven by data in src/world/bosses.js); this subclass exists only as
// the server's handle. The Zone builds the per-tick adapter and passes it to
// update(); snapshot() is inherited from BossCore.

export default class Boss extends BossCore {
  constructor(bounds, bossKey) {
    super(bossKey, bounds);
  }
}
