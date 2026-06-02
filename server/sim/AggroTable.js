// Server-authoritative threat table. Whoever has the most threat is the boss's
// target. Threat is keyed by player id so it survives the player object churn.

export default class AggroTable {
  constructor() {
    this.threat = new Map(); // id -> number
  }

  add(id, amount) {
    this.threat.set(id, (this.threat.get(id) || 0) + amount);
  }

  forceTop(id, margin) {
    let max = 0;
    for (const v of this.threat.values()) max = Math.max(max, v);
    this.threat.set(id, max + margin);
  }

  remove(id) {
    this.threat.delete(id);
  }

  // Highest-threat *alive* player from the given list.
  getTarget(players) {
    let best = null, bestVal = -Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      const v = this.threat.get(p.id) || 0;
      if (v > bestVal) { bestVal = v; best = p; }
    }
    return best;
  }
}
