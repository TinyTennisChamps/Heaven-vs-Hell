import { createRng, type RngState } from '../core/rng';
import { v2, type Vec2 } from '../core/math';

export interface PlayerState {
  pos: Vec2;
  /** Position at the start of the last tick, for render interpolation. */
  prevPos: Vec2;
  vel: Vec2;
}

export interface World {
  tick: number;
  rng: RngState;
  player: PlayerState;
}

export function createWorld(seed = 1): World {
  return {
    tick: 0,
    rng: createRng(seed),
    player: { pos: v2(0, 0), prevPos: v2(0, 0), vel: v2(0, 0) },
  };
}
