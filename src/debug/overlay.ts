/**
 * F1 debug overlay: crisp DOM text over the canvas (not pixel-scaled).
 * Callers push key/value lines each render frame via `set()`.
 */
export class DebugOverlay {
  readonly el: HTMLDivElement;
  private lines = new Map<string, string>();
  private fpsFrames = 0;
  private fpsTime = 0;
  private simTicks = 0;
  fps = 0;
  simHz = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  /** Call once per render frame with real elapsed seconds and sim steps run. */
  frame(elapsedSec: number, steps: number): void {
    this.fpsFrames++;
    this.simTicks += steps;
    this.fpsTime += elapsedSec;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.simHz = this.simTicks / this.fpsTime;
      this.fpsFrames = 0;
      this.simTicks = 0;
      this.fpsTime = 0;
    }
  }

  set(key: string, value: string | number): void {
    this.lines.set(key, typeof value === 'number' ? fmt(value) : value);
  }

  render(): void {
    if (this.el.hidden) return;
    let s = `FPS ${this.fps.toFixed(0)}  ·  sim ${this.simHz.toFixed(1)} Hz\n`;
    for (const [k, v] of this.lines) s += `${k}: ${v}\n`;
    this.el.textContent = s;
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
