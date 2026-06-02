// Aggro / threat system. The boss reads this table to decide who to attack.
// Whoever has the most accumulated threat becomes the boss's target.

export default class AggroTable {
  constructor() {
    this.table = new Map(); // entity -> threat (number)
  }

  register(entity) {
    if (!this.table.has(entity)) this.table.set(entity, 0);
  }

  add(entity, amount) {
    this.register(entity);
    this.table.set(entity, this.table.get(entity) + amount);
  }

  get(entity) {
    return this.table.get(entity) || 0;
  }

  // Taunt: vault this entity above the current highest threat by a flat margin.
  forceTop(entity, margin) {
    let max = 0;
    for (const v of this.table.values()) max = Math.max(max, v);
    this.table.set(entity, max + margin);
  }

  remove(entity) {
    this.table.delete(entity);
  }

  // Highest-threat entity that is still alive.
  getTarget() {
    let best = null;
    let bestVal = -Infinity;
    for (const [entity, threat] of this.table) {
      if (!entity.alive) continue;
      if (threat > bestVal) {
        bestVal = threat;
        best = entity;
      }
    }
    return best;
  }
}
