import { SIM_DT } from '../../core/loop';
import { moveToward, normalize, type Vec2 } from '../../core/math';
import type { SimConfig } from '../config';
import type { PlayerState } from '../world';

/**
 * Acceleration-based movement. `desiredDir` is a unit vector (or zero) in sim space.
 * Accel/decel are expressed as "ticks to reach / leave top speed" so they read
 * the same as frame data.
 */
export function stepPlayerMovement(p: PlayerState, desiredDir: Vec2, cfg: SimConfig, speedMul = 1): void {
  const t = cfg.player;
  const top = t.maxSpeed * speedMul;
  const dir = normalize(desiredDir);
  const moving = dir.x !== 0 || dir.y !== 0;
  const target = moving ? { x: dir.x * top, y: dir.y * top } : { x: 0, y: 0 };
  const rate = moving ? t.maxSpeed / Math.max(1, t.accelFrames) : t.maxSpeed / Math.max(1, t.decelFrames);
  p.vel = moveToward(p.vel, target, rate);
  p.pos.x += p.vel.x * SIM_DT;
  p.pos.y += p.vel.y * SIM_DT;
}
