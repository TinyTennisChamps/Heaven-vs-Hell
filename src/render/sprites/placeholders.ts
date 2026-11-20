import type { Graphics } from 'pixi.js';
import { ANGEL, HEAVEN, JUDGEMENT } from '../palette';

/**
 * Placeholder enemy sprites drawn in code with the PDF palettes and silhouettes.
 * Origin = feet. Facing right; the caller mirrors with scale.x = -1.
 * `flash` paints the whole silhouette white (hit-flash / telegraph).
 */
export function drawDummy(g: Graphics, flash: boolean): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  g.clear();
  g.poly([-4, -15, -12, -22, -13, -15, -9, -8]).fill(c(ANGEL.white)).stroke({ width: 1, color: line, alignment: 1 });
  g.poly([4, -15, 12, -22, 13, -15, 9, -8]).fill(c(ANGEL.white)).stroke({ width: 1, color: line, alignment: 1 });
  g.poly([-6, 0, 6, 0, 4, -17, -4, -17]).fill(c(ANGEL.pearl)).stroke({ width: 1, color: line, alignment: 1 });
  g.rect(-4, -10, 8, 1).fill(c(HEAVEN.gold2));
  g.rect(-3, -23, 6, 6).fill(c(ANGEL.silver)).stroke({ width: 1, color: line, alignment: 1 });
  g.rect(-1, -21, 3, 1).fill(c(ANGEL.void));
  g.ellipse(0, -26, 5, 1.5).stroke({ width: 1, color: flash ? 0xffffff : HEAVEN.gold2 });
  g.rect(8, -26, 1, 26).fill(c(HEAVEN.stoneDark));
  g.rect(7, -27, 3, 2).fill(c(HEAVEN.gold3));
}

export type DominionPose = 'guard' | 'drawBack' | 'thrust' | 'bash' | 'lunge' | 'recoil' | 'broken';

/**
 * Dominion: faceless helm with one open eye, tower shield, spear.
 * Silhouette per the PDF: "a block and a pole". Poses follow the mannequin's
 * Shieldwalk (guard), Stab (drawBack -> thrust) references.
 */
export function drawDominion(g: Graphics, pose: DominionPose, flash: boolean, shieldFlash: boolean): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  const st = { width: 1, color: line, alignment: 1 } as const;
  g.clear();
  const crouch = pose === 'broken' ? 4 : pose === 'thrust' || pose === 'lunge' || pose === 'recoil' ? 1 : 0;
  const lean = pose === 'thrust' || pose === 'lunge' ? 2 : pose === 'drawBack' ? -2 : pose === 'bash' ? 3 : pose === 'recoil' ? -4 : 0;
  const y = (v: number) => v + crouch;

  // Small wings behind.
  g.poly([-3 + lean, y(-26), -11 + lean, y(-33), -12 + lean, y(-24), -7 + lean, y(-18)]).fill(c(ANGEL.white)).stroke(st);

  // Spear (behind body when drawn back, otherwise held forward).
  const spear = () => {
    const sx = pose === 'thrust' || pose === 'lunge' ? 4 + lean : pose === 'drawBack' ? -6 + lean : pose === 'broken' ? -4 : 2 + lean;
    const sy = y(-17);
    const len = 30;
    const ext = pose === 'thrust' || pose === 'lunge' ? 14 : pose === 'drawBack' ? -4 : 0;
    if (pose === 'recoil') {
      // Spear knocked up and back by the deflect.
      g.moveTo(sx - 6, y(-12)).lineTo(sx + 10, y(-38)).stroke({ width: 1, color: c(HEAVEN.stoneDark) });
      return;
    }
    if (pose === 'guard' || pose === 'bash') {
      // Held upright behind the shield, like the Shieldwalk pose.
      g.rect(sx + 5, y(-36), 1, 34).fill(c(HEAVEN.stoneDark));
      g.poly([sx + 4, y(-36), sx + 7, y(-36), sx + 5.5, y(-41)]).fill(c(HEAVEN.gold2));
      return;
    }
    if (pose === 'broken') {
      g.moveTo(sx - 6, y(-2)).lineTo(sx + 16, y(-10)).stroke({ width: 1, color: c(HEAVEN.stoneDark) });
      return;
    }
    g.rect(sx + ext - 8, sy, len, 1).fill(c(HEAVEN.stoneDark));
    g.poly([sx + ext + len - 8, sy - 2, sx + ext + len - 2, sy + 0.5, sx + ext + len - 8, sy + 3]).fill(c(HEAVEN.gold2)).stroke(st);
  };
  if (pose === 'drawBack') spear();

  // Legs and armoured body (a block).
  g.rect(-5 + lean / 2, y(-8), 4, 8 - crouch).fill(c(ANGEL.silver2)).stroke(st);
  g.rect(1 + lean / 2, y(-8), 4, 8 - crouch).fill(c(ANGEL.silver2)).stroke(st);
  g.rect(-6 + lean, y(-22), 12, 15).fill(c(ANGEL.silver)).stroke(st);
  g.rect(-6 + lean, y(-12), 12, 2).fill(c(HEAVEN.gold2));
  g.rect(-1 + lean, y(-21), 2, 8).fill(c(HEAVEN.gold1));

  // Helm: faceless, one open eye.
  g.rect(-4 + lean, y(-31), 9, 9).fill(c(ANGEL.silver)).stroke(st);
  g.rect(-4 + lean, y(-31), 9, 2).fill(c(ANGEL.pearl2));
  g.rect(0 + lean, y(-27), 4, 2).fill(c(ANGEL.white));
  g.rect(1 + lean, y(-27), 2, 2).fill(flash ? 0xffffff : ANGEL.void);
  g.ellipse(0 + lean, y(-34), 6, 1.5).stroke({ width: 1, color: flash ? 0xffffff : HEAVEN.gold2 });

  if (pose !== 'drawBack') spear();

  // Tower shield in front (an eye on it, gold cross).
  if (pose !== 'broken') {
    // Recoil: shield flung wide to the back — the opening.
    const sx = pose === 'bash' ? 9 + lean : pose === 'thrust' || pose === 'lunge' ? 2 + lean : pose === 'recoil' ? -14 + lean : 5 + lean;
    const fill = shieldFlash ? JUDGEMENT : c(ANGEL.pearl);
    g.rect(sx, y(-28), 6, 25).fill(fill).stroke(st);
    g.rect(sx + 2, y(-25), 2, 19).fill(c(HEAVEN.gold2));
    g.rect(sx + 1, y(-20), 4, 2).fill(c(HEAVEN.gold2));
    g.rect(sx + 2, y(-15), 2, 2).fill(flash ? 0xffffff : ANGEL.void);
  } else {
    // Shield dropped: lying at the feet.
    g.rect(4, -3, 12, 3).fill(c(ANGEL.pearl)).stroke(st);
  }
}
