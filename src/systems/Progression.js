// XP + leveling. Killing mobs grants XP; filling the bar levels you up and
// awards stat points to spend on STR/DEX/INT/VIT/AGI.

export default class Progression {
  constructor() {
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    this.pointsPerLevel = 3;
  }

  // XP required to go from current level to the next. Scales up steeply so each
  // level is a bigger commitment than the last.
  xpToNext() {
    return Math.floor(100 * Math.pow(1.35, this.level - 1));
  }

  // Add XP; returns how many levels were gained this call.
  addXp(amount) {
    this.xp += amount;
    let gained = 0;
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level += 1;
      this.statPoints += this.pointsPerLevel;
      gained += 1;
    }
    return gained;
  }

  xpRatio() {
    return this.xp / this.xpToNext();
  }
}
