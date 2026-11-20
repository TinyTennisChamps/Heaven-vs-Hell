import { emptyHeld, type ButtonAction, type InputFrame } from './actions';

/** The only place raw keys/buttons appear. Change bindings here. */
const KEY_BINDINGS: Record<string, ButtonAction | 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'dash',
  KeyE: 'throw',
  KeyR: 'rage',
};
const MOUSE_BINDINGS: Record<number, ButtonAction> = { 0: 'slash', 2: 'parry' };

/**
 * Collects DOM events between sim ticks and turns them into InputFrames.
 * Edges (presses) accumulate until the next `sample()`, so a press is never
 * dropped even when a render frame runs zero sim steps.
 */
export class KeyboardMouseInput {
  private dirs = { up: false, down: false, left: false, right: false };
  private held = emptyHeld();
  private pending: ButtonAction[] = [];
  private aim = { x: 0, y: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private internalSize: { w: number; h: number },
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', (e) => {
      if (e.target === canvas) e.preventDefault();
    });
  }

  private isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const b = KEY_BINDINGS[e.code];
    if (!b) return;
    e.preventDefault();
    if (b in this.dirs) {
      this.dirs[b as keyof typeof this.dirs] = true;
      return;
    }
    const a = b as ButtonAction;
    if (!e.repeat && !this.held[a]) this.pending.push(a);
    this.held[a] = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const b = KEY_BINDINGS[e.code];
    if (!b) return;
    if (b in this.dirs) this.dirs[b as keyof typeof this.dirs] = false;
    else this.held[b as ButtonAction] = false;
  };

  private onBlur = () => {
    this.dirs = { up: false, down: false, left: false, right: false };
    this.held = emptyHeld();
  };

  private onMouseMove = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.aim.x = ((e.clientX - r.left) / r.width) * this.internalSize.w;
    this.aim.y = ((e.clientY - r.top) / r.height) * this.internalSize.h;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.target !== this.canvas) return;
    const a = MOUSE_BINDINGS[e.button];
    if (!a) return;
    e.preventDefault();
    this.onMouseMove(e);
    if (!this.held[a]) this.pending.push(a);
    this.held[a] = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    const a = MOUSE_BINDINGS[e.button];
    if (a) this.held[a] = false;
  };

  /** Build the frame for the next sim tick and clear accumulated edges. */
  sample(): InputFrame {
    const frame: InputFrame = {
      move: {
        x: (this.dirs.right ? 1 : 0) - (this.dirs.left ? 1 : 0),
        y: (this.dirs.down ? 1 : 0) - (this.dirs.up ? 1 : 0),
      },
      aimScreen: { x: this.aim.x, y: this.aim.y },
      pressed: this.pending,
      held: { ...this.held },
    };
    this.pending = [];
    return frame;
  }
}
