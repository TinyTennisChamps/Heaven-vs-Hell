import { angleDiff, angleOf, DEG, fromAngle, type Vec2 } from '../../core/math';
import type { ArcHitbox } from '../config';

/** Does an arc (sector) hitbox overlap a circular hurtbox? Ground space. */
export function arcHitsCircle(attacker: Vec2, dir: Vec2, box: ArcHitbox, target: Vec2, targetRadius: number): boolean {
  const ox = attacker.x + dir.x * box.offset;
  const oy = attacker.y + dir.y * box.offset;
  const vx = target.x - ox;
  const vy = target.y - oy;
  const d = Math.hypot(vx, vy);
  if (d > box.radius + targetRadius) return false;
  if (d <= targetRadius) return true;
  const half = (box.angleDeg / 2) * DEG;
  // Widen the arc by the angle the target's radius subtends.
  const slack = Math.asin(Math.min(1, targetRadius / d));
  return Math.abs(angleDiff(angleOf(dir), Math.atan2(vy, vx))) <= half + slack;
}

/**
 * Light aim assist: if a target sits inside a narrow cone around the aim within
 * range, rotate the aim toward it by at most `maxRotateDeg`.
 */
export function assistAim(
  from: Vec2,
  aim: Vec2,
  targets: ReadonlyArray<{ pos: Vec2; radius: number }>,
  cfg: { coneDeg: number; range: number; maxRotateDeg: number },
): Vec2 {
  if (cfg.maxRotateDeg <= 0) return aim;
  const aimA = angleOf(aim);
  let best: number | null = null;
  for (const t of targets) {
    const vx = t.pos.x - from.x;
    const vy = t.pos.y - from.y;
    const d = Math.hypot(vx, vy);
    if (d < 1e-6 || d > cfg.range + t.radius) continue;
    const diff = angleDiff(aimA, Math.atan2(vy, vx));
    if (Math.abs(diff) <= cfg.coneDeg * DEG && (best === null || Math.abs(diff) < Math.abs(best))) best = diff;
  }
  if (best === null) return aim;
  const maxR = cfg.maxRotateDeg * DEG;
  return fromAngle(aimA + Math.max(-maxR, Math.min(maxR, best)));
}
