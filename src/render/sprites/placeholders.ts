import type { Graphics } from 'pixi.js';
import { ANGEL, HEAVEN, SATAN } from '../palette';

/**
 * Placeholder sprites drawn in code with the PDF palettes and silhouettes.
 * Origin = feet. Facing right; the caller mirrors with scale.x = -1.
 * `flash` paints the whole silhouette white (hit-flash / telegraph).
 */
export function drawSatan(g: Graphics, flash: boolean): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  g.clear();
  // Bat-wing cloak behind the body.
  g.poly([-3, -21, -12, -27, -13, -18, -10, -9, -6, -8]).fill(c(SATAN.cloak2));
  g.poly([3, -21, 12, -27, 13, -18, 10, -9, 6, -8]).fill(c(SATAN.cloak2));
  g.poly([-12, -27, -11, -25, -13, -18]).fill(c(SATAN.cloak));
  g.poly([12, -27, 11, -25, 13, -18]).fill(c(SATAN.cloak));
  // Robe with blood lining.
  g.poly([-8, 0, 8, 0, 6, -16, -6, -16]).fill(c(SATAN.cloak));
  g.rect(-6, -14, 1, 13).fill(c(SATAN.blood));
  g.rect(5, -14, 1, 13).fill(c(SATAN.blood));
  // Torso.
  g.rect(-4, -21, 8, 8).fill(c(SATAN.crimson));
  g.rect(-4, -14, 8, 1).fill(c(SATAN.blood));
  g.rect(-1, -20, 2, 5).fill(c(SATAN.blood));
  // Head and horns.
  g.rect(-3, -27, 6, 6).fill(c(SATAN.crimson));
  g.rect(-3, -22, 6, 1).fill(c(SATAN.blood));
  g.rect(-4, -30, 2, 3).fill(c(SATAN.horn));
  g.rect(2, -30, 2, 3).fill(c(SATAN.horn));
  g.rect(-5, -32, 1, 2).fill(c(SATAN.cloak));
  g.rect(4, -32, 1, 2).fill(c(SATAN.cloak));
  // Glowing eyes on the facing side.
  g.rect(0, -25, 1, 1).fill(c(SATAN.eyeGlow));
  g.rect(2, -25, 1, 1).fill(c(SATAN.eyeGlow));
  // Obsidian blade with hellfire edge, held low.
  g.rect(6, -13, 1, 11).fill(c(SATAN.cloak));
  g.rect(7, -13, 1, 11).fill(c(SATAN.hellfire));
}

export function drawDummy(g: Graphics, flash: boolean): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  g.clear();
  // Wings.
  g.poly([-4, -15, -12, -22, -13, -15, -9, -8]).fill(c(ANGEL.white)).stroke({ width: 1, color: line, alignment: 1 });
  g.poly([4, -15, 12, -22, 13, -15, 9, -8]).fill(c(ANGEL.white)).stroke({ width: 1, color: line, alignment: 1 });
  // Robe.
  g.poly([-6, 0, 6, 0, 4, -17, -4, -17]).fill(c(ANGEL.pearl)).stroke({ width: 1, color: line, alignment: 1 });
  g.rect(-4, -10, 8, 1).fill(c(HEAVEN.gold2));
  // Faceless helm.
  g.rect(-3, -23, 6, 6).fill(c(ANGEL.silver)).stroke({ width: 1, color: line, alignment: 1 });
  g.rect(-1, -21, 3, 1).fill(c(ANGEL.void));
  // Halo.
  g.ellipse(0, -26, 5, 1.5).stroke({ width: 1, color: flash ? 0xffffff : HEAVEN.gold2 });
  // Training staff.
  g.rect(8, -26, 1, 26).fill(c(HEAVEN.stoneDark));
  g.rect(7, -27, 3, 2).fill(c(HEAVEN.gold3));
}
