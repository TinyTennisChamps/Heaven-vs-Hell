import { describe, expect, it } from 'vitest';
import { FixedLoop, SIM_DT } from '../src/core/loop';

describe('FixedLoop', () => {
  it('runs exactly one step per 60 Hz frame, with jitter snapped away', () => {
    const loop = new FixedLoop();
    const jitter = [16.5, 16.8, 16.6, 16.7, 16.55, 16.79].map((ms) => ms / 1000);
    const steps = jitter.map((e) => loop.advance(e).steps);
    // Without snapping, some frames would get 0 steps and others 2.
    expect(steps.every((s) => s === 1)).toBe(true);
  });

  it('produces 60 ticks per second at 30, 60, 120, 144 and 240 Hz', () => {
    for (const hz of [30, 60, 120, 144, 240]) {
      const loop = new FixedLoop();
      let total = 0;
      for (let i = 0; i < hz * 10; i++) total += loop.advance(1 / hz).steps;
      expect(Math.abs(total - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('gives an alpha in [0,1) for interpolation at high refresh', () => {
    const loop = new FixedLoop();
    for (let i = 0; i < 100; i++) {
      const { alpha } = loop.advance(1 / 144);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('caps steps after a long stall instead of fast-forwarding', () => {
    const loop = new FixedLoop();
    expect(loop.advance(2).steps).toBe(5);
    expect(loop.advance(SIM_DT).steps).toBe(1);
  });
});
