import { VIEW_H, VIEW_W } from '../core/constants';
import { groundToScreen } from '../core/iso';
import { nextRange } from '../core/rng';
import type { SimConfig } from './config';
import type { World } from './world';

/** Shake runs every tick, including during hit-stop (that's when it matters most). */
export function updateShake(world: World, cfg: SimConfig): void {
  const c = world.camera;
  c.shake *= cfg.camera.shakeDecay;
  if (c.shake < 0.1) c.shake = 0;
  c.shakeOffset = c.shake > 0 ? { x: nextRange(world.rng, -c.shake, c.shake), y: nextRange(world.rng, -c.shake, c.shake) } : { x: 0, y: 0 };
}

/** Smoothed follow with look-ahead toward the cursor, clamped to the room. */
export function updateCamera(world: World, aimScreen: { x: number; y: number }, cfg: SimConfig): void {
  const c = world.camera;
  const t = cfg.camera;
  let p = groundToScreen(world.player.pos.x, world.player.pos.y);
  // Locked on: frame Satan and the target together.
  const lock = world.player.lockId !== null ? world.enemies.find((e) => e.id === world.player.lockId && e.phase !== 'down') : undefined;
  if (lock) {
    const q = groundToScreen(lock.pos.x, lock.pos.y);
    const k = cfg.combat.lockOn.cameraBias;
    p = { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  }

  let lx = (aimScreen.x - VIEW_W / 2) * t.lookAheadFactor;
  let ly = (aimScreen.y - VIEW_H / 2) * t.lookAheadFactor;
  const ll = Math.hypot(lx, ly);
  if (ll > t.lookAheadMax) {
    lx = (lx / ll) * t.lookAheadMax;
    ly = (ly / ll) * t.lookAheadMax;
  }

  let tx = p.x + lx;
  let ty = p.y + ly - 10; // frame the body, not the feet
  const b = world.screenBox;
  const m = t.roomMargin;
  tx = clampAxis(tx, b.minX - m, b.maxX + m, VIEW_W);
  ty = clampAxis(ty, b.minY - m, b.maxY + m, VIEW_H);

  c.pos.x += (tx - c.pos.x) * t.followRate;
  c.pos.y += (ty - c.pos.y) * t.followRate;
}

function clampAxis(v: number, lo: number, hi: number, view: number): number {
  const half = view / 2;
  if (hi - lo <= view) return (lo + hi) / 2;
  return Math.max(lo + half, Math.min(hi - half, v));
}
