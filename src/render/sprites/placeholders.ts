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

export type ArcherPose = 'idle' | 'draw' | 'loose' | 'bash' | 'recoil' | 'broken';

/**
 * Choir Archer: gold-blindfolded cantor with a bow of pale-blue light.
 * Silhouette per the PDF: "a cone and an arc". Draw/loose follow the
 * mannequin's BowShot reference.
 */
export function drawArcher(g: Graphics, pose: ArcherPose, flash: boolean): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  const st = { width: 1, color: line, alignment: 1 } as const;
  g.clear();
  const crouch = pose === 'broken' ? 3 : 0;
  const lean = pose === 'draw' ? -1 : pose === 'bash' ? 2 : pose === 'recoil' ? -3 : 0;
  const y = (v: number) => v + crouch;

  // Small wings.
  g.poly([-2 + lean, y(-19), -9 + lean, y(-25), -10 + lean, y(-17), -5 + lean, y(-13)]).fill(c(ANGEL.white)).stroke(st);
  // Choir robe: a cone.
  g.poly([-8, 0, 8, 0, 2 + lean, y(-20), -2 + lean, y(-20)]).fill(c(ANGEL.pearl)).stroke(st);
  g.rect(-1 + lean, y(-18), 2, 16).fill(c(ANGEL.pearl2));
  g.rect(-4 + lean, y(-21), 8, 2).fill(c(HEAVEN.gold2));
  // Head: gold blindfold, mouth open mid-hymn.
  g.rect(-3 + lean, y(-28), 6, 7).fill(c(ANGEL.pearl2)).stroke(st);
  g.rect(-3 + lean, y(-26), 6, 2).fill(c(HEAVEN.gold2));
  g.rect(0 + lean, y(-23), 2, 1).fill(flash ? 0xffffff : ANGEL.void);
  g.ellipse(0 + lean, y(-31), 5, 1.5).stroke({ width: 1, color: flash ? 0xffffff : HEAVEN.gold2 });

  if (pose === 'broken') {
    // Bow dropped.
    g.moveTo(-2, -1).lineTo(12, -3).stroke({ width: 1, color: c(ANGEL.sky2) });
    return;
  }
  // Bow of pale-blue light: an arc held forward.
  const bx = pose === 'bash' ? 10 + lean : pose === 'recoil' ? 2 + lean : 7 + lean;
  const by = y(-14);
  const pts: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (-70 + (140 * i) / 8) * (Math.PI / 180);
    pts.push(bx + Math.cos(a) * 4, by + Math.sin(a) * 9);
  }
  for (let i = 0; i < pts.length - 2; i += 2) g.moveTo(pts[i]!, pts[i + 1]!).lineTo(pts[i + 2]!, pts[i + 3]!);
  g.stroke({ width: 1, color: c(ANGEL.sky2) });
  const top = { x: pts[0]!, y: pts[1]! };
  const bot = { x: pts[pts.length - 2]!, y: pts[pts.length - 1]! };
  if (pose === 'draw') {
    // String pulled back, an arrow of light nocked.
    const pull = bx - 7;
    g.moveTo(top.x, top.y).lineTo(pull, by).lineTo(bot.x, bot.y).stroke({ width: 1, color: c(ANGEL.sky) });
    g.moveTo(pull, by).lineTo(bx + 7, by).stroke({ width: 1, color: c(0xffffff) });
    g.rect(bx + 6, by - 1, 2, 3).fill(c(ANGEL.sky));
  } else {
    g.moveTo(top.x, top.y).lineTo(bot.x, bot.y).stroke({ width: 1, color: c(ANGEL.sky), alpha: 0.8 });
  }
}

export type CherubPose = 'idle' | 'windup' | 'lunge' | 'recoil';

/**
 * Cherub: a winged head with hollow black eyes, a gold halo. Silhouette per
 * the PDF: "a dot with ears". It hovers — origin is the ground point below it;
 * `lift` raises the head (the caller bobs it).
 */
export function drawCherub(g: Graphics, pose: CherubPose, flash: boolean, lift: number): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  const st = { width: 1, color: line, alignment: 1 } as const;
  g.clear();
  const hy = -14 - lift + (pose === 'lunge' ? 3 : 0);
  const hx = pose === 'lunge' ? 2 : pose === 'windup' ? -1 : pose === 'recoil' ? -2 : 0;
  // Wings: raised on the windup, swept back in the lunge.
  const wy = pose === 'windup' ? -4 : pose === 'lunge' ? 2 : 0;
  const ws = pose === 'lunge' ? -3 : 0;
  g.poly([hx - 3, hy, hx - 10 + ws, hy - 5 + wy, hx - 11 + ws, hy + 1 + wy, hx - 7, hy + 3]).fill(c(ANGEL.white)).stroke(st);
  g.poly([hx + 3, hy, hx + 10 + ws, hy - 5 + wy, hx + 11 + ws, hy + 1 + wy, hx + 7, hy + 3]).fill(c(ANGEL.white)).stroke(st);
  // Head.
  g.circle(hx, hy, 5).fill(c(ANGEL.pearl)).stroke(st);
  // Hollow black eyes, a small dark mouth.
  if (!flash) {
    g.rect(hx - 3, hy - 1, 2, 2).fill(ANGEL.void);
    g.rect(hx + 1, hy - 1, 2, 2).fill(ANGEL.void);
    g.rect(hx, hy + 2, 1, 1).fill(ANGEL.angelLine);
  }
  // Halo.
  g.ellipse(hx, hy - 8, 4, 1.2).stroke({ width: 1, color: flash ? 0xffffff : HEAVEN.gold2 });
}

export type GabrielPose = 'idle' | 'drawBack' | 'thrust' | 'trumpet' | 'horn' | 'charge' | 'ring' | 'recoil' | 'broken' | 'rally' | 'crouch' | 'air' | 'cast' | 'bladeHigh' | 'bladeLow';

/**
 * Gabriel, the Herald: tall, great wings, a sun-gold halo, a spear in one
 * hand and the herald's trumpet in the other. Pearl and gold, lilac outline.
 * Origin = feet, facing right.
 */
export function drawGabriel(g: Graphics, pose: GabrielPose, flash: boolean): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  const st = { width: 1, color: line, alignment: 1 } as const;
  g.clear();
  const crouch = pose === 'broken' ? 6 : pose === 'crouch' ? 5 : pose === 'charge' || pose === 'thrust' ? 2 : 0;
  const lean = pose === 'thrust' ? 3 : pose === 'charge' ? 5 : pose === 'drawBack' ? -3 : pose === 'recoil' ? -5 : 0;
  const y = (v: number) => v + crouch;
  const wingUp = pose === 'ring' || pose === 'rally' || pose === 'air' ? -8 : pose === 'horn' || pose === 'cast' ? -4 : pose === 'crouch' ? 4 : 0;

  // Great wings (behind).
  g.poly([-3 + lean, y(-34), -22 + lean, y(-50) + wingUp, -26 + lean, y(-30) + wingUp, -18 + lean, y(-14), -6 + lean, y(-20)]).fill(c(ANGEL.white)).stroke(st);
  g.poly([3 + lean, y(-34), 20 + lean, y(-52) + wingUp, 24 + lean, y(-32) + wingUp, 16 + lean, y(-16), 6 + lean, y(-22)]).fill(c(ANGEL.pearl)).stroke(st);
  g.moveTo(-8 + lean, y(-40)).lineTo(-20 + lean, y(-44) + wingUp).stroke({ width: 1, color: c(ANGEL.pearl2) });
  // Robe: long, flaring, gold hem and belt.
  g.poly([-10, 0, 10, 0, 5 + lean, y(-30), -5 + lean, y(-30)]).fill(c(ANGEL.pearl)).stroke(st);
  g.rect(-10, -2, 20, 2).fill(c(HEAVEN.gold2));
  g.rect(-5 + lean, y(-20), 10, 2).fill(c(HEAVEN.gold2));
  g.rect(-1 + lean, y(-29), 2, 27).fill(c(ANGEL.pearl2));
  // Head: a calm helm-face, a single gold band; the sun halo behind.
  const hx = lean;
  const hy = y(-38);
  g.circle(hx, hy - 4, pose === 'rally' ? 10 : 8).stroke({ width: 2, color: flash ? 0xffffff : HEAVEN.gold1 });
  g.rect(hx - 4, hy - 4, 8, 9).fill(c(ANGEL.silver)).stroke(st);
  g.rect(hx - 4, hy - 1, 8, 2).fill(c(HEAVEN.gold2));
  if (!flash) g.rect(hx + 1, hy + 2, 2, 1).fill(ANGEL.void);

  if (pose === 'broken') {
    g.moveTo(-14, -2).lineTo(14, -6).stroke({ width: 1, color: c(HEAVEN.stoneDark) });
    return;
  }
  if (pose === 'cast') {
    // Light lances: a hand raised, an orb of white light gathering.
    g.moveTo(hx + 3, hy + 8).lineTo(hx + 12, hy - 6).stroke({ width: 2, color: c(ANGEL.pearl) });
    g.circle(hx + 13, hy - 8, 4).fill({ color: flash ? 0xffffff : 0xfff6c8, alpha: 0.95 });
    g.circle(hx + 13, hy - 8, 2).fill(0xffffff);
    return;
  }
  if (pose === 'bladeHigh' || pose === 'bladeLow' || pose === 'air' || pose === 'crouch') {
    // Blade of light: a long pale-gold sword, raised high or swept low.
    const up = pose === 'bladeHigh' || pose === 'air' || pose === 'crouch';
    const bx0 = hx + 6;
    const by0 = y(-22);
    const bx1 = up ? hx + 10 : hx + 30;
    const by1 = up ? y(-58) : y(-10);
    g.moveTo(bx0, by0).lineTo(bx1, by1).stroke({ width: 3, color: c(0xfff6c8), alpha: 0.9 });
    g.moveTo(bx0, by0).lineTo(bx1, by1).stroke({ width: 1, color: 0xffffff });
    g.rect(bx0 - 3, by0 - 1, 7, 2).fill(c(HEAVEN.gold2));
    return;
  }
  // Trumpet (left hand / back side): raised to the lips for horn and trumpet blast.
  const blowing = pose === 'horn' || pose === 'trumpet';
  if (blowing) {
    g.poly([hx + 3, hy + 2, hx + 16, hy - 4, hx + 18, hy + 4]).fill(c(HEAVEN.gold2)).stroke({ width: 1, color: c(HEAVEN.gold3), alignment: 1 });
    g.rect(hx + 16, hy - 6, 2, 12).fill(c(HEAVEN.gold1));
  } else {
    g.poly([-8 + lean, y(-18), -16 + lean, y(-14), -16 + lean, y(-9)]).fill(c(HEAVEN.gold2));
  }
  // Spear: drawn back, thrust forward, couched for the charge, raised for the ring.
  const sx = pose === 'drawBack' ? -6 : pose === 'thrust' ? 16 : pose === 'charge' ? 20 : 8;
  if (pose === 'ring' || pose === 'rally') {
    g.rect(hx + 6, hy - 26, 1, 34).fill(c(HEAVEN.stoneDark));
    g.poly([hx + 4, hy - 26, hx + 9, hy - 26, hx + 6.5, hy - 33]).fill(c(HEAVEN.gold1));
  } else if (!blowing) {
    const sy = y(-20);
    g.moveTo(sx - 26 + lean, sy + 4).lineTo(sx + lean, sy).stroke({ width: 1, color: c(HEAVEN.stoneDark) });
    g.poly([sx + lean, sy - 2, sx + 7 + lean, sy - 1, sx + lean, sy + 2]).fill(c(HEAVEN.gold1)).stroke({ width: 1, color: c(HEAVEN.gold3), alignment: 1 });
  }
}

export type WatcherPose = 'idle' | 'charge' | 'fire' | 'biteWindup' | 'bite' | 'jammed' | 'grounded';

/**
 * Watcher ("Grigori"): one great eye — pearl sclera, pale-blue iris, black
 * slit — on golden wings. For the laser the iris (only the iris) turns the
 * telegraph colour. For the chomp the slit splits vertically into a toothed
 * maw and the eye swells. Origin = ground point below it; `lift` raises it.
 * Asset slots: idle, hover_move, laser_charge, laser_fire, laser_recover,
 * bite_windup, bite_lunge, bite_recover, hurt, stagger, grounded, death.
 */
export function drawWatcher(g: Graphics, pose: WatcherPose, flash: boolean, lift: number, flap: number, irisTelegraph: number): void {
  const c = (col: number) => (flash ? 0xffffff : col);
  const line = flash ? 0xffffff : ANGEL.angelLine;
  const st = { width: 1, color: line, alignment: 1 } as const;
  g.clear();
  const grounded = pose === 'grounded';
  const R = pose === 'bite' || pose === 'jammed' ? 19 : pose === 'charge' || pose === 'fire' ? 16 : 14; // swells 1.3x to bite
  const cy = grounded ? -R + 2 : -30 - lift;
  // Wings: slow flap idle, flared wide to attack, drooped when grounded.
  const flare = pose === 'charge' || pose === 'fire' || pose === 'biteWindup' || pose === 'bite' ? -8 : 0;
  const wy = grounded ? 8 : flap + flare;
  for (const s of [-1, 1]) {
    const x0 = s * (R - 3);
    g.poly([x0, cy - 4, s * (R + 16), cy - 14 + wy, s * (R + 22), cy - 2 + wy, s * (R + 12), cy + 8 + wy * 0.5, x0, cy + 6]).fill(c(HEAVEN.gold2)).stroke(st);
    g.moveTo(x0 + s * 4, cy - 2).lineTo(s * (R + 16), cy - 10 + wy).stroke({ width: 1, color: c(HEAVEN.gold1) });
    g.moveTo(x0 + s * 4, cy + 3).lineTo(s * (R + 13), cy + 4 + wy * 0.7).stroke({ width: 1, color: c(HEAVEN.gold3) });
  }
  if (pose === 'bite' || pose === 'biteWindup' || pose === 'jammed') {
    // The eye splits open vertically into a maw: dark throat, white teeth on both lips.
    const open = pose === 'biteWindup' ? 0.55 : 1;
    g.circle(0, cy, R).fill(c(ANGEL.pearl)).stroke(st);
    const mw = R * 0.95 * open;
    g.ellipse(0, cy, mw, R * 0.9).fill(flash ? 0xffffff : ANGEL.void);
    if (!flash) {
      g.ellipse(0, cy + 2, mw * 0.6, R * 0.6).fill(0x1c1a2c);
      for (let i = -3; i <= 3; i++) {
        const ty = cy + i * (R * 0.24);
        const half = Math.sqrt(Math.max(0, 1 - (i * 0.27) ** 2)) * mw;
        g.poly([-half, ty - 2, -half + 4, ty, -half, ty + 2]).fill(0xffffff);
        g.poly([half, ty - 2, half - 4, ty, half, ty + 2]).fill(0xffffff);
      }
    }
    return;
  }
  // Eyeball.
  g.circle(0, cy, R).fill(c(ANGEL.pearl)).stroke(st);
  g.circle(-R * 0.35, cy - R * 0.4, R * 0.25).fill({ color: 0xffffff, alpha: 0.7 });
  if (grounded) {
    // Eye shut: a lid line and lashes.
    g.moveTo(-R + 2, cy).lineTo(R - 2, cy).stroke({ width: 2, color: c(ANGEL.angelLine) });
    for (let i = -2; i <= 2; i++) g.moveTo(i * 4, cy).lineTo(i * 5, cy + 3).stroke({ width: 1, color: c(ANGEL.angelLine) });
    return;
  }
  const iris = pose === 'charge' || pose === 'fire' ? irisTelegraph : ANGEL.sky2;
  g.circle(1, cy, R * 0.5).fill(c(iris)).stroke({ width: 1, color: c(ANGEL.angelLine), alignment: 1 });
  if (!flash) g.rect(0, cy - R * 0.4, 2, R * 0.8).fill(ANGEL.void);
}
