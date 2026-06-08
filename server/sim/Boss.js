import BossCore from '../../src/world/BossCore.js';

// Thin authoritative wrapper around the shared BossCore state machine.
// Zone.js feeds it a bossAdapter() each tick; rendering lives in OnlineScene.

export default class Boss {
  constructor(bounds, bossKey) {
    this.core = new BossCore(bossKey, bounds);
  }

  get x() { return this.core.x; }
  get y() { return this.core.y; }
  get alive() { return this.core.alive; }
  get cfg() { return this.core.cfg; }

  takeDamage(amount) { this.core.takeDamage(amount); }

  update(dt, adapter) { this.core.update(dt, adapter); }

  snapshot() { return this.core.snapshot(); }
}
