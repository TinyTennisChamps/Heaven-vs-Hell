import { describe, expect, it } from 'vitest';
import { InputBuffer } from '../src/input/buffer';

describe('InputBuffer', () => {
  it('keeps a press live for exactly `window` ticks, including the press tick', () => {
    const b = new InputBuffer({}, 8);
    b.press('slash');
    for (let t = 0; t < 8; t++) {
      expect(b.has('slash')).toBe(true);
      b.tick();
    }
    expect(b.has('slash')).toBe(false);
  });

  it('consume clears the press', () => {
    const b = new InputBuffer({}, 8);
    b.press('dash');
    expect(b.consume('dash')).toBe(true);
    expect(b.consume('dash')).toBe(false);
  });

  it('does not expire while frozen (hit-stop)', () => {
    const b = new InputBuffer({}, 2);
    b.press('parry');
    for (let t = 0; t < 20; t++) b.tick(true);
    expect(b.has('parry')).toBe(true);
    b.tick();
    b.tick();
    expect(b.has('parry')).toBe(false);
  });

  it('supports per-action windows', () => {
    const b = new InputBuffer({ rage: 3 }, 8);
    b.press('rage');
    b.press('slash');
    b.tick();
    b.tick();
    b.tick();
    expect(b.has('rage')).toBe(false);
    expect(b.has('slash')).toBe(true);
  });

  it('re-pressing refreshes the window', () => {
    const b = new InputBuffer({}, 3);
    b.press('slash');
    b.tick();
    b.tick();
    b.press('slash');
    b.tick();
    b.tick();
    expect(b.has('slash')).toBe(true);
  });
});
