import type { Vec2 } from '../core/math';
import { isValidSpot, type World } from './world';
import type { Seg } from './physics/collide';

/**
 * Navigation for walkers: a flow field toward Satan on a coarse grid,
 * rebuilt every few ticks by BFS over walkable cells (Dominion-sized). When a
 * walker's straight line to Satan is blocked by a wall it follows the field
 * around it instead of pushing into the wall. Cheap: ~1–2k cells, BFS every
 * `REBUILD` ticks. Deterministic (pure, no randomness).
 */
const CELL = 8;
const REBUILD = 10;
const CLEARANCE = 9;

export interface Nav {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  walk: Uint8Array;
  dist: Int32Array;
  built: number;
}

export function makeNav(world: World): Nav {
  const b = world.room.bounds;
  const x0 = Math.min(...b.map((p) => p[0]));
  const y0 = Math.min(...b.map((p) => p[1]));
  const nx = Math.ceil((Math.max(...b.map((p) => p[0])) - x0) / CELL) + 1;
  const ny = Math.ceil((Math.max(...b.map((p) => p[1])) - y0) / CELL) + 1;
  const walk = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) walk[j * nx + i] = isValidSpot(world, x0 + i * CELL, y0 + j * CELL, CLEARANCE) ? 1 : 0;
  return { x0, y0, nx, ny, walk, dist: new Int32Array(nx * ny).fill(-1), built: -999 };
}

function cellOf(n: Nav, p: Vec2): number {
  const i = Math.max(0, Math.min(n.nx - 1, Math.round((p.x - n.x0) / CELL)));
  const j = Math.max(0, Math.min(n.ny - 1, Math.round((p.y - n.y0) / CELL)));
  return j * n.nx + i;
}

/** Nearest walkable cell to a point (Satan can stand where a Dominion can't). */
function nearestWalk(n: Nav, c: number): number {
  if (n.walk[c]) return c;
  const ci = c % n.nx;
  const cj = Math.floor(c / n.nx);
  for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = ci + di;
    const j = cj + dj;
    if (i >= 0 && j >= 0 && i < n.nx && j < n.ny && n.walk[j * n.nx + i]) return j * n.nx + i;
  }
  return c;
}

export function updateNav(world: World): void {
  const n = world.nav;
  if (!n || world.tick - n.built < REBUILD) return;
  n.built = world.tick;
  n.dist.fill(-1);
  const start = nearestWalk(n, cellOf(n, world.player.pos));
  const q = new Int32Array(n.nx * n.ny);
  let h = 0;
  let t = 0;
  q[t++] = start;
  n.dist[start] = 0;
  while (h < t) {
    const c = q[h++]!;
    const i = c % n.nx;
    const j = (c - i) / n.nx;
    const d = n.dist[c]! + 1;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n.nx || b >= n.ny) continue;
      const k = b * n.nx + a;
      if (!n.walk[k] || n.dist[k]! >= 0) continue;
      n.dist[k] = d;
      q[t++] = k;
    }
  }
}

/** Is the straight line from a to b clear of every wall segment? */
export function lineClear(segs: readonly Seg[], a: Vec2, b: Vec2): boolean {
  for (const s of segs) if (segX(a.x, a.y, b.x, b.y, s.ax, s.ay, s.bx, s.by)) return false;
  return true;
}

function segX(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return u > 0 && u < 1 && v > 0 && v < 1;
}

/** Direction to walk from `from` toward Satan around walls (null if no better route is known). */
export function flowDir(world: World, from: Vec2): Vec2 | null {
  const n = world.nav;
  if (!n) return null;
  const c = nearestWalk(n, cellOf(n, from));
  const here = n.dist[c]!;
  if (here < 0) return null;
  const i = c % n.nx;
  const j = (c - i) / n.nx;
  let best = -1;
  let bd = here;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const a = i + di;
    const b = j + dj;
    if (a < 0 || b < 0 || a >= n.nx || b >= n.ny) continue;
    const k = b * n.nx + a;
    const d = n.dist[k]!;
    // Diagonals only when both orthogonal neighbours are open (no corner cutting).
    if (di && dj && (!n.walk[j * n.nx + a] || !n.walk[b * n.nx + i])) continue;
    if (d >= 0 && d < bd) {
      bd = d;
      best = k;
    }
  }
  if (best < 0) return null;
  const tx = n.x0 + (best % n.nx) * CELL;
  const ty = n.y0 + Math.floor(best / n.nx) * CELL;
  const dx = tx - from.x;
  const dy = ty - from.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
