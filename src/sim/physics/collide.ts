/**
 * Swept circle-vs-segment collision on the ground plane.
 *
 * Walls (arena bounds and obstacles alike) are just line segments, solid from
 * both sides. A moving circle is advanced to its earliest time of impact, the
 * remaining motion is projected onto the wall's tangent (slide), and the loop
 * repeats — so nothing tunnels, and walls never stick.
 */
export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface MoveResult {
  x: number;
  y: number;
  hit: boolean;
  /** Normal of the last wall touched (valid when hit). */
  nx: number;
  ny: number;
}

interface Toi {
  t: number;
  nx: number;
  ny: number;
}

/** Gap kept between a circle and a wall after a collision, so we never rest exactly on it. */
const SKIN = 0.01;

export function segmentsFromPolygon(poly: ReadonlyArray<readonly [number, number]>): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
  }
  return out;
}

export function sweepCircleSegment(px: number, py: number, dx: number, dy: number, r: number, s: Seg): Toi | null {
  let best: Toi | null = null;
  const consider = (h: Toi) => {
    if (!best || h.t < best.t) best = h;
  };

  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const l2 = ex * ex + ey * ey;

  if (l2 > 1e-12) {
    // Flat side of the capsule: the segment's line offset by ±r.
    const L = Math.sqrt(l2);
    const nx = -ey / L;
    const ny = ex / L;
    const d0 = (px - s.ax) * nx + (py - s.ay) * ny;
    const vn = dx * nx + dy * ny;
    const sgn = d0 >= 0 ? 1 : -1;
    if (vn * sgn < 0) {
      // Moving toward the line. t < 0 means we are already inside the corridor.
      const t = (sgn * r - d0) / vn;
      if (t <= 1) {
        const tc = Math.max(0, t);
        const u = ((px + dx * tc - s.ax) * ex + (py + dy * tc - s.ay) * ey) / l2;
        if (u >= 0 && u <= 1) consider({ t: tc, nx: sgn * nx, ny: sgn * ny });
      }
    }
  }

  // Round caps: sweep a point against a circle of radius r at each endpoint.
  const a2 = dx * dx + dy * dy;
  for (let k = 0; k < 2; k++) {
    const cx = k === 0 ? s.ax : s.bx;
    const cy = k === 0 ? s.ay : s.by;
    const fx = px - cx;
    const fy = py - cy;
    const c = fx * fx + fy * fy - r * r;
    const b = 2 * (dx * fx + dy * fy);
    if (c <= 0) {
      if (b < 0) {
        const d = Math.hypot(fx, fy) || 1;
        consider({ t: 0, nx: fx / d, ny: fy / d });
      }
    } else if (a2 > 1e-12) {
      const disc = b * b - 4 * a2 * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a2);
        if (t >= 0 && t <= 1) {
          const hx = fx + dx * t;
          const hy = fy + dy * t;
          const d = Math.hypot(hx, hy) || 1;
          consider({ t, nx: hx / d, ny: hy / d });
        }
      }
    }
  }
  return best;
}

/** Push a circle out of any segment it overlaps (for spawns, shoves and separation). */
export function depenetrate(x: number, y: number, r: number, segs: readonly Seg[]): { x: number; y: number } {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const s of segs) {
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const l2 = ex * ex + ey * ey;
      const u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2)) : 0;
      const cx = s.ax + ex * u;
      const cy = s.ay + ey * u;
      const vx = x - cx;
      const vy = y - cy;
      const d = Math.hypot(vx, vy);
      if (d < r - 1e-6) {
        let nx: number;
        let ny: number;
        if (d > 1e-9) {
          nx = vx / d;
          ny = vy / d;
        } else {
          const L = Math.sqrt(l2) || 1;
          nx = -ey / L;
          ny = ex / L;
        }
        x = cx + nx * (r + SKIN);
        y = cy + ny * (r + SKIN);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

export function moveAndSlide(x: number, y: number, dx: number, dy: number, r: number, segs: readonly Seg[], maxIter = 4): MoveResult {
  let rx = dx;
  let ry = dy;
  let hit = false;
  let lnx = 0;
  let lny = 0;

  for (let i = 0; i < maxIter; i++) {
    const rl = Math.hypot(rx, ry);
    if (rl < 1e-9) break;
    let best: Toi | null = null;
    for (const s of segs) {
      const h = sweepCircleSegment(x, y, rx, ry, r, s);
      if (h && (!best || h.t < best.t)) best = h;
    }
    if (!best) {
      x += rx;
      y += ry;
      break;
    }
    const b: Toi = best;
    hit = true;
    lnx = b.nx;
    lny = b.ny;
    const adv = Math.max(0, b.t - SKIN / rl);
    x += rx * adv;
    y += ry * adv;
    const rem = 1 - b.t;
    let ox = rx * rem;
    let oy = ry * rem;
    const dn = ox * b.nx + oy * b.ny;
    if (dn < 0) {
      ox -= dn * b.nx;
      oy -= dn * b.ny;
    }
    rx = ox;
    ry = oy;
  }

  const fixed = depenetrate(x, y, r, segs);
  return { x: fixed.x, y: fixed.y, hit, nx: lnx, ny: lny };
}

export function pointInPolygon(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
