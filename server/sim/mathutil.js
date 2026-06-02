// Tiny math helpers so the server sim doesn't depend on Phaser.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Wrap an angle to [-PI, PI].
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
