import type { InputFrame } from '../input/actions';
import type { SimConfig } from './config';
import type { World } from './world';
import { stepPlayerMovement } from './actors/player';

/**
 * Advance the world one fixed tick (1/60 s). Deterministic: same world + same
 * inputs + same config => same result. Never touches the DOM, Pixi or a clock.
 */
export function step(world: World, input: InputFrame, cfg: SimConfig): void {
  const p = world.player;
  p.prevPos = { x: p.pos.x, y: p.pos.y };

  // M0: screen-aligned movement on a flat plane. M1 swaps in the iso ground transform.
  const dir = { x: input.move.x, y: input.move.y * cfg.feel.verticalSpeedComp };
  stepPlayerMovement(p, dir, cfg);

  world.tick++;
}
