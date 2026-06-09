// Placeholder isometric "billboard" art. Characters/mobs/bosses are drawn as
// UPRIGHT figures in screen space at a projected ground point, so the iso floor
// transform never squashes them. Pure Phaser-graphics drawing, no state.
//   (g, x, y, r, ...): x,y = the ground point (the figure's feet); r = footprint.

function shade(color, f) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const m = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (m(r * f) << 16) | (m(g * f) << 8) | m(b * f);
}

export function drawShadow(g, x, y, r, alpha = 0.28) {
  g.fillStyle(0x000000, alpha);
  g.fillEllipse(x, y, r * 2.3, r * 1.05);
}

// A humanoid: shadow + torso + head + a facing nub. faceDx/faceDy is a screen-
// space unit direction (project a world facing vector through projectDir first).
export function drawHumanoid(g, x, y, r, color, opts = {}) {
  const alpha = opts.alpha ?? 1;
  drawShadow(g, x, y, r, 0.28 * alpha);
  const headR = r * 0.6;
  const headCy = y - r * 2.5 + headR;
  const torsoTop = headCy + headR * 0.7;
  const torsoBot = y - r * 0.12;
  const torsoW = r * 1.35;
  const light = shade(color, 1.18);

  // outline (drawn slightly fatter behind for readability)
  g.fillStyle(color, alpha);
  g.fillRoundedRect(x - torsoW / 2, torsoTop, torsoW, torsoBot - torsoTop, r * 0.45);
  g.lineStyle(2, 0x0a0d14, 0.55 * alpha);
  g.strokeRoundedRect(x - torsoW / 2, torsoTop, torsoW, torsoBot - torsoTop, r * 0.45);

  g.fillStyle(light, alpha); g.fillCircle(x, headCy, headR);
  g.lineStyle(2, 0x0a0d14, 0.55 * alpha); g.strokeCircle(x, headCy, headR);

  if (opts.faceDx != null) {
    g.fillStyle(0x10131f, 0.85 * alpha);
    g.fillCircle(x + opts.faceDx * headR * 0.5, headCy + opts.faceDy * headR * 0.5, headR * 0.3);
  }

  // status rings around the torso center (buff/shield/i-frames)
  if (opts.rings) {
    const cy = (torsoTop + torsoBot) / 2;
    for (const ring of opts.rings) { g.lineStyle(ring.w || 2, ring.color, ring.alpha ?? 0.9); g.strokeCircle(x, cy, r + (ring.pad || 6)); }
  }
}

// A mob: squat eyed blob (melee) or a floating gem (ranged).
export function drawCreature(g, x, y, r, color, ranged = false) {
  drawShadow(g, x, y, r);
  if (ranged) {
    const cy = y - r * 1.5;
    g.fillStyle(color, 1);
    g.beginPath(); g.moveTo(x, cy - r); g.lineTo(x + r * 0.82, cy); g.lineTo(x, cy + r); g.lineTo(x - r * 0.82, cy); g.closePath(); g.fillPath();
    g.lineStyle(2, 0x0a0d14, 0.5); g.strokePath();
    g.fillStyle(shade(color, 1.4), 0.9); g.fillCircle(x, cy - r * 0.2, r * 0.22);
  } else {
    const cy = y - r * 0.95;
    g.fillStyle(color, 1); g.fillCircle(x, cy, r);
    g.lineStyle(2, 0x0a0d14, 0.5); g.strokeCircle(x, cy, r);
    g.fillStyle(0xffffff, 0.92); g.fillCircle(x - r * 0.32, cy - r * 0.12, r * 0.2); g.fillCircle(x + r * 0.32, cy - r * 0.12, r * 0.2);
    g.fillStyle(0x101018, 0.95); g.fillCircle(x - r * 0.3, cy - r * 0.1, r * 0.09); g.fillCircle(x + r * 0.34, cy - r * 0.1, r * 0.09);
  }
}

// The boss: a big horned brute. Tints/outlines red while enraged.
export function drawBoss(g, x, y, r, color, opts = {}) {
  drawShadow(g, x, y, r, 0.38);
  const cy = y - r * 0.95;
  g.fillStyle(color, 1); g.fillCircle(x, cy, r);
  g.lineStyle(opts.enraged ? 5 : 3, opts.enraged ? 0xff3a3a : 0x0a0d14, opts.enraged ? 0.95 : 0.6); g.strokeCircle(x, cy, r);
  // horns
  g.fillStyle(shade(color, 1.25), 1);
  g.fillTriangle(x - r * 0.78, cy - r * 0.55, x - r * 0.42, cy - r * 1.28, x - r * 0.22, cy - r * 0.5);
  g.fillTriangle(x + r * 0.78, cy - r * 0.55, x + r * 0.42, cy - r * 1.28, x + r * 0.22, cy - r * 0.5);
  // eyes
  g.fillStyle(opts.enraged ? 0xffd24a : 0xff5a5a, 1);
  g.fillCircle(x - r * 0.32, cy - r * 0.08, r * 0.15); g.fillCircle(x + r * 0.32, cy - r * 0.08, r * 0.15);
  // facing marker
  if (opts.faceDx != null) { g.fillStyle(0xffd24a, 1); g.fillCircle(x + opts.faceDx * r, cy + opts.faceDy * r, r * 0.18); }
}

export function drawMinion(g, x, y, r, fade = 1) {
  drawShadow(g, x, y, r, 0.22 * fade);
  const cy = y - r * 0.85;
  g.fillStyle(0x9ad17a, fade); g.fillCircle(x, cy, r);
  g.lineStyle(2, 0x3a5a2a, fade); g.strokeCircle(x, cy, r);
  g.fillStyle(0x2a3a1a, fade); g.fillCircle(x - r * 0.3, cy - r * 0.1, r * 0.14); g.fillCircle(x + r * 0.3, cy - r * 0.1, r * 0.14);
}
