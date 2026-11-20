/**
 * Shapes of the tuning data the sim reads. The objects are owned by the data
 * store and mutated in place on hot reload, so the sim must read fields each
 * tick rather than caching them.
 */
export interface PlayerTuning {
  /** Ground px per second. */
  maxSpeed: number;
  /** Ticks from standstill to maxSpeed. */
  accelFrames: number;
  /** Ticks from maxSpeed to standstill. */
  decelFrames: number;
  radius: number;
}

export interface FeelTuning {
  inputBufferFrames: number;
  /** Multiplier on screen-vertical movement to offset iso foreshortening. */
  verticalSpeedComp: number;
}

export interface SimConfig {
  player: PlayerTuning;
  feel: FeelTuning;
}
