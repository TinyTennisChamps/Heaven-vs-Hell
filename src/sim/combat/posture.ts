import { SIM_DT } from '../../core/loop';
import type { PostureTuning } from '../config';

/**
 * Posture drain for one tick. Nothing happens until `regenDelay` ticks have
 * passed without being hit; then it drains at regenPerSec, scaled down at low
 * health (Sekiro: a wounded fighter recovers posture slowly).
 */
export function regenPosture(posture: number, sinceHit: number, hp: number, maxHp: number, t: PostureTuning): number {
  if (posture <= 0 || sinceHit < t.regenDelay) return posture;
  const healthFrac = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  const mul = t.lowHealthMul + (1 - t.lowHealthMul) * healthFrac;
  return Math.max(0, posture - t.regenPerSec * mul * SIM_DT);
}
