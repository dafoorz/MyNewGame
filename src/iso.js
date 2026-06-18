// Isometric projection (Stage 8) — CLIENT RENDER ONLY. The whole simulation
// stays in flat world space: the server is authoritative, and stats / classes /
// leveling / loot / bosses / skill trees / multiplayer are completely unchanged.
// We only project world (x, y) -> screen for an isometric look, and rotate input
// so movement feels aligned with the view. Fall back to the original top-down
// rendering anytime with ?iso=0.
//
// World graphics (ground, bodies, telegraphs, projectiles, FX) live inside a
// "world container" with this transform applied, so circles become ellipses,
// AoE telegraphs distort correctly, and the grid becomes a diamond — for free.
// Text and health bars are NOT put in the container (a rotated, non-uniformly
// scaled parent would shear them); instead they're positioned at project(x,y)
// each frame so they stay crisp and upright. Depth is sorted by world x+y.

const ENABLED = (() => {
  try { return new URLSearchParams(location.search).get('iso') !== '0'; } catch { return true; }
})();

// rotate 45° + squash Y → a 2:1 isometric diamond.
const R = -Math.PI / 4;
const SX = 1;
const SY = 0.72;
const C = Math.cos(R), S = Math.sin(R);

export const ISO = { enabled: ENABLED, R, SX, SY };

// Apply the isometric transform to a scene's world container (no-op if disabled).
export function applyIso(container) {
  if (ENABLED) { container.setRotation(R); container.setScale(SX, SY); }
  return container;
}

// World (x,y) -> scene position. Matches the container transform exactly so the
// cursor math lines up. Identity when disabled.
export function project(x, y) {
  if (!ENABLED) return { x, y };
  const sx = SX * x, sy = SY * y;
  return { x: sx * C - sy * S, y: sx * S + sy * C };
}

// Scene position (e.g. pointer.worldX/Y) -> world (x,y). For cursor aim/facing.
export function unproject(px, py) {
  if (!ENABLED) return { x: px, y: py };
  return { x: C * px + S * py, y: (-S * px + C * py) / SY };
}

// Screen movement intent (WASD up = -y) -> world velocity vector that moves the
// character at a UNIFORM on-screen speed in every direction. Because the iso view
// squashes Y by SY, a world-uniform speed otherwise renders ~2x faster along the
// screen's NE/SW axis than its NW/SE axis (the "fast diagonal" bug). We instead
// un-project the *normalized screen* direction so its projected length is constant
// (= SY), and scale by SY so the magnitude stays in [SY, 1] — never tripping the
// server's anti-cheat clamp (which caps |input| at 1).
export function dirToWorld(ix, iy) {
  const len = Math.hypot(ix, iy);
  if (len === 0) return { x: 0, y: 0 };
  const sx = ix / len, sy = iy / len; // unit screen direction
  if (!ENABLED) return { x: sx, y: sy }; // top-down: world == screen
  return { x: SY * (C * sx + S * sy), y: -S * sx + C * sy };
}

// Multiplier that makes a world-space velocity move at a UNIFORM on-screen speed
// under the iso squash (1 when iso is disabled). Pass the world direction (any
// magnitude); returns ~0.71x along the fast screen axis up to ~1.41x along the
// slow one so mobs/projectiles look like they move at one speed in every heading.
export function isoSpeedScale(dx, dy) {
  if (!ENABLED) return 1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 1;
  const ux = dx / len, uy = dy / len;
  const proj = Math.sqrt(ux * ux + SY * SY * uy * uy); // |project(unit dir)|
  return Math.SQRT1_2 / proj; // target screen speed = 0.707 * world speed
}

// Painter's-order depth for a world position (closer to the camera = larger).
export function depth(x, y) { return x + y; }

// Depth for an upright billboard (entity) in SCENE space: sorts entities by
// ground position while staying in a band above the floor and below the HUD.
export function bodyDepth(x, y) { return 10 + (x + y) * 0.018; }

// Project a world-space DIRECTION (no translation) to a normalized screen-space
// direction — used to point a billboard's facing marker along the iso ground.
export function projectDir(dx, dy) {
  const p = project(dx, dy);
  const len = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / len, y: p.y / len };
}

// Scene-space AABB of a w×h world zone — for camera bounds. { x, y, w, h }.
export function zoneBounds(w, h) {
  if (!ENABLED) return { x: 0, y: 0, w, h };
  const pts = [project(0, 0), project(w, 0), project(0, h), project(w, h)];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
