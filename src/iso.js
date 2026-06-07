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
const SY = 0.5;
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

// Screen movement intent (WASD up = -y) -> normalized world direction.
export function dirToWorld(ix, iy) {
  if (!ENABLED) return { x: ix, y: iy };
  let wx = C * ix + S * iy;
  let wy = (-S * ix + C * iy) / SY;
  const len = Math.hypot(wx, wy);
  if (len > 0) { wx /= len; wy /= len; }
  return { x: wx, y: wy };
}

// Painter's-order depth for a world position (closer to the camera = larger).
export function depth(x, y) { return x + y; }

// Scene-space AABB of a w×h world zone — for camera bounds. { x, y, w, h }.
export function zoneBounds(w, h) {
  if (!ENABLED) return { x: 0, y: 0, w, h };
  const pts = [project(0, 0), project(w, 0), project(0, h), project(w, h)];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
