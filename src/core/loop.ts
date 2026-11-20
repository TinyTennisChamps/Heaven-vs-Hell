/**
 * Fixed-timestep accumulator. Pure (no DOM, no clock): the caller passes in
 * elapsed real time and gets back how many sim steps to run plus the
 * interpolation alpha for rendering. Identical sim behaviour at any refresh rate.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export interface LoopAdvance {
  steps: number;
  /** 0..1 — how far between the previous and current sim state to render. */
  alpha: number;
}

export class FixedLoop {
  private acc = 0;

  constructor(
    readonly dt = SIM_DT,
    /** Cap per render frame to avoid the spiral of death after a stall. */
    readonly maxSteps = 5,
    /** Snap frame deltas within this many seconds of a whole number of ticks (vsync jitter). */
    readonly snapTolerance = 0.0002,
  ) {}

  advance(elapsedSec: number): LoopAdvance {
    let elapsed = Math.max(0, Math.min(elapsedSec, 0.25));
    // Vsync snapping: a 60 Hz display reports 16.5–16.8 ms; without snapping the
    // accumulator alternates 0- and 2-step frames, which reads as micro-stutter.
    const n = Math.round(elapsed / this.dt);
    if (n >= 1 && n <= 8 && Math.abs(elapsed - n * this.dt) < this.snapTolerance) {
      elapsed = n * this.dt;
    }
    this.acc += elapsed;

    let steps = 0;
    const eps = 1e-9;
    while (this.acc + eps >= this.dt && steps < this.maxSteps) {
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps && this.acc >= this.dt) {
      // Drop the backlog rather than fast-forwarding the game.
      this.acc %= this.dt;
    }
    if (this.acc < 0) this.acc = 0;
    return { steps, alpha: Math.min(1, this.acc / this.dt) };
  }

  reset(): void {
    this.acc = 0;
  }
}
