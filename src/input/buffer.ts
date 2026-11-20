import type { ButtonAction } from './actions';

/**
 * Input buffer: a press stays "live" for `window` sim ticks (including the tick it
 * arrived on), so inputs pressed slightly early still happen. Ticking can be
 * frozen (hit-stop) so a press made during a freeze isn't lost.
 */
export class InputBuffer {
  private remaining = new Map<ButtonAction, number>();

  constructor(private windows: Partial<Record<ButtonAction, number>>, private defaultWindow = 8) {}

  setWindow(action: ButtonAction, frames: number): void {
    this.windows[action] = frames;
  }

  press(action: ButtonAction): void {
    const w = this.windows[action] ?? this.defaultWindow;
    if (w > 0) this.remaining.set(action, w);
  }

  has(action: ButtonAction): boolean {
    return (this.remaining.get(action) ?? 0) > 0;
  }

  /** Returns true and clears the press if one is buffered. */
  consume(action: ButtonAction): boolean {
    if (!this.has(action)) return false;
    this.remaining.delete(action);
    return true;
  }

  clear(action?: ButtonAction): void {
    if (action) this.remaining.delete(action);
    else this.remaining.clear();
  }

  /** Call once at the end of every sim tick. */
  tick(frozen = false): void {
    if (frozen) return;
    for (const [a, n] of this.remaining) {
      if (n <= 1) this.remaining.delete(a);
      else this.remaining.set(a, n - 1);
    }
  }
}
