import { describe, expect, it } from 'vitest';
import { createRng, nextRange } from '../src/core/rng';
import { moveAndSlide, pointInPolygon, segmentsFromPolygon, type Seg } from '../src/sim/physics/collide';

const R = 6;
const box: [number, number][] = [[0, 0], [200, 0], [200, 200], [0, 200]];
const pillar: [number, number][] = [[80, 80], [110, 80], [110, 110], [80, 110]];
const arena: Seg[] = [...segmentsFromPolygon(box), ...segmentsFromPolygon(pillar)];

describe('swept collision', () => {
  it('never tunnels through a wall, even with a huge single-step delta', () => {
    const wall = segmentsFromPolygon([[100, 0], [100, 200]]).slice(0, 1);
    const r = moveAndSlide(50, 100, 400, 0, R, wall);
    expect(r.x).toBeLessThan(100 - R);
    expect(r.x).toBeGreaterThan(100 - R - 0.1);
    expect(r.hit).toBe(true);
  });

  it('slides along a wall keeping the tangent component, without sticking', () => {
    const wall: Seg[] = [{ ax: 100, ay: 0, bx: 100, by: 200 }];
    const r = moveAndSlide(90, 50, 10, 10, R, wall);
    expect(r.y).toBeCloseTo(60, 1); // full tangent motion preserved
    expect(r.x).toBeLessThan(100 - R + 0.01);
  });

  it('keeps moving along a wall when the player barely pushes into it', () => {
    const wall: Seg[] = [{ ax: 100, ay: 0, bx: 100, by: 200 }];
    let x = 100 - R - 0.02;
    let y = 20;
    for (let i = 0; i < 100; i++) {
      const r = moveAndSlide(x, y, 0.05, 1.8, R, wall);
      x = r.x;
      y = r.y;
    }
    expect(y).toBeGreaterThan(190); // ~100 ticks × 1.8 px, never stuck
  });

  it('is stopped by a concave corner and does not leak through', () => {
    const corner: Seg[] = [{ ax: 0, ay: 100, bx: 100, by: 100 }, { ax: 100, ay: 100, bx: 100, by: 0 }];
    const r = moveAndSlide(60, 60, 200, 200, R, [...corner]);
    expect(r.x).toBeLessThanOrEqual(100 - R + 0.1);
    expect(r.y).toBeLessThanOrEqual(100 - R + 0.1);
  });

  it('rounds a pillar corner instead of snagging or entering it', () => {
    // Approach the pillar's corner diagonally.
    const r = moveAndSlide(60, 60, 25, 25, R, arena);
    expect(pointInPolygon(r.x, r.y, pillar)).toBe(false);
    expect(r.hit).toBe(true);
  });

  it('fuzz: 5000 random large steps never leave the arena or enter the pillar', () => {
    const rng = createRng(1234);
    let x = 40;
    let y = 40;
    for (let i = 0; i < 5000; i++) {
      const r = moveAndSlide(x, y, nextRange(rng, -60, 60), nextRange(rng, -60, 60), R, arena);
      x = r.x;
      y = r.y;
      expect(pointInPolygon(x, y, box)).toBe(true);
      expect(pointInPolygon(x, y, pillar)).toBe(false);
      expect(x).toBeGreaterThanOrEqual(R - 0.05);
      expect(y).toBeGreaterThanOrEqual(R - 0.05);
      expect(x).toBeLessThanOrEqual(200 - R + 0.05);
      expect(y).toBeLessThanOrEqual(200 - R + 0.05);
    }
  });
});
