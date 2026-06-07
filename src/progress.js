// Per-device, per-class progress saving (browser localStorage). One save slot
// per class, so picking a different class loads that class's own progress.
// Browser-only — never imported by the headless server.

const KEY = 'mng_progress_v1';
const ATTRS = ['STR', 'DEX', 'INT', 'VIT', 'AGI'];

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* private mode / quota */ }
}

// Returns saved progress for a class, or null if none. Shape:
// { level, xp, statPoints, stats: { STR, DEX, INT, VIT, AGI }, inventory, gear, skillTree }
export function loadProgress(classKey) {
  const all = readAll();
  return all[classKey] || null;
}

export function saveProgress(classKey, data) {
  if (!classKey || !data) return;
  const all = readAll();
  all[classKey] = {
    level: data.level | 0,
    xp: data.xp | 0,
    statPoints: data.statPoints | 0,
    stats: ATTRS.reduce((o, k) => { o[k] = (data.stats && data.stats[k]) | 0; return o; }, {}),
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
    gear: data.gear || null,
    skillTree: (data.skillTree && typeof data.skillTree === 'object') ? data.skillTree : {},
  };
  writeAll(all);
}

export function clearProgress(classKey) {
  const all = readAll();
  delete all[classKey];
  writeAll(all);
}
