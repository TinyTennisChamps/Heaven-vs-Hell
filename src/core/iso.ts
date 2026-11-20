import type { Vec2 } from './math';

/**
 * 2:1 isometric projection. The simulation lives on a flat ground plane (gx, gy);
 * a 16×16 ground square projects to a 32×16 screen diamond.
 *   screen.x = gx − gy      screen.y = (gx + gy) / 2
 */
export const GROUND_TILE = 16;

export function groundToScreen(gx: number, gy: number): Vec2 {
  return { x: gx - gy, y: (gx + gy) / 2 };
}

export function screenToGround(sx: number, sy: number): Vec2 {
  return { x: sy + sx / 2, y: sy - sx / 2 };
}
