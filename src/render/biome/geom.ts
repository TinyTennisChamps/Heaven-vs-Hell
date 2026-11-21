import { groundToScreen } from '../../core/iso';
import { DEG, angleOf, lerp, type Vec2 } from '../../core/math';
import type { ArcHitbox } from '../../sim/config';

/** Projects a ground-space polygon to a flat screen point list. */
export function proj(points: ReadonlyArray<Vec2 | readonly [number, number]>, lift = 0): number[] {
  const out: number[] = [];
  for (const p of points) {
    const gx = Array.isArray(p) ? (p as readonly number[])[0]! : (p as Vec2).x;
    const gy = Array.isArray(p) ? (p as readonly number[])[1]! : (p as Vec2).y;
    const s = groundToScreen(gx, gy);
    out.push(s.x, s.y - lift);
  }
  return out;
}

export function groundCircle(c: Vec2, r: number, n = 18): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: c.x + Math.cos((i / n) * Math.PI * 2) * r, y: c.y + Math.sin((i / n) * Math.PI * 2) * r });
  return pts;
}

/** Ground-space ring sector for slash arcs / telegraphs. */
export function arcPoly(origin: Vec2, dir: Vec2, box: ArcHitbox, from: number, to: number, inner = 0.35): Vec2[] {
  const o = { x: origin.x + dir.x * box.offset, y: origin.y + dir.y * box.offset };
  const a0 = angleOf(dir) - (box.angleDeg / 2) * DEG;
  const span = box.angleDeg * DEG;
  const pts: Vec2[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = a0 + span * lerp(from, to, i / n);
    pts.push({ x: o.x + Math.cos(a) * box.radius, y: o.y + Math.sin(a) * box.radius });
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + span * lerp(from, to, i / n);
    pts.push({ x: o.x + Math.cos(a) * box.radius * inner, y: o.y + Math.sin(a) * box.radius * inner });
  }
  return pts;
}

/** "#rrggbb" → 0xrrggbb. */
export function hex(c: string | undefined, fallback = 0xff00ff): number {
  if (!c) return fallback;
  const n = parseInt(c.replace('#', ''), 16);
  return Number.isFinite(n) ? n : fallback;
}

/** Tiny deterministic RNG for decoration (never touches the sim's rng). */
export function decoRng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
}
