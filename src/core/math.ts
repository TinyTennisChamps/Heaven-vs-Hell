export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}

/** Move `current` toward `target` by at most `maxDelta` (vector). */
export function moveToward(current: Vec2, target: Vec2, maxDelta: number): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxDelta || d < 1e-9) return { x: target.x, y: target.y };
  return { x: current.x + (dx / d) * maxDelta, y: current.y + (dy / d) * maxDelta };
}
