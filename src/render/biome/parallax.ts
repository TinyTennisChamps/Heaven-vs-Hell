import { Container, Graphics } from 'pixi.js';
import { VIEW_H, VIEW_W } from '../../core/constants';
import type { BiomeDef } from '../../sim/config';
import { decoRng, hex } from './geom';

/** Hard budget: parallax layers per biome. */
export const MAX_PARALLAX = 4;

/**
 * Screen-space backdrop behind the room: the sky (or the dark of the nave)
 * and up to four layers that scroll at a fraction of the camera's motion —
 * drifting clouds outdoors; vault ribs and gothic arches indoors. Low
 * contrast by construction (alpha from the biome), never over gameplay.
 */
export class Parallax {
  readonly root = new Container();
  private layers: { g: Graphics; factor: number; w: number }[] = [];

  constructor(biome: BiomeDef) {
    const sky = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(hex(biome.palette.sky));
    this.root.addChild(sky);
    biome.parallax.slice(0, MAX_PARALLAX).forEach((l, i) => {
      const g = new Graphics();
      const w = VIEW_W * 2;
      draw(g, l.kind, w, biome, i);
      g.alpha = l.alpha;
      this.root.addChild(g);
      this.layers.push({ g, factor: l.factor, w });
    });
  }

  update(camX: number, camY: number): void {
    for (const l of this.layers) {
      const x = -((((camX * l.factor) % (l.w / 2)) + l.w / 2) % (l.w / 2));
      l.g.position.set(Math.round(x), Math.round(-camY * l.factor * 0.3));
    }
  }
}

function draw(g: Graphics, kind: string, w: number, biome: BiomeDef, seed: number): void {
  const rnd = decoRng(seed * 131 + kind.length * 7);
  const half = w / 2;
  const P = (k: string, fb: number) => hex(biome.palette[k] ?? biome.accents[k], fb);
  // Everything is drawn twice (x and x + half) so the strip wraps seamlessly.
  const twice = (fn: (ox: number) => void) => {
    fn(0);
    fn(half);
  };
  switch (kind) {
    case 'skyClouds':
    case 'farClouds': {
      const far = kind === 'skyClouds';
      const blobs: [number, number, number][] = [];
      for (let i = 0; i < (far ? 8 : 6); i++) blobs.push([rnd() * half, (far ? 20 : 120) + rnd() * (far ? 70 : 110), (far ? 8 : 12) + rnd() * 12]);
      twice((ox) => {
        for (const [x, y, r] of blobs) {
          for (let k = 0; k < 4; k++) {
            const bx = ox + x + (k - 2) * r * 0.9;
            g.ellipse(Math.round(bx), Math.round(y + 2), r, r * 0.5).fill(P('cloudShade', 0xe4eef5));
            g.ellipse(Math.round(bx), Math.round(y), r, r * 0.5).fill(P('cloud', 0xffffff));
          }
        }
      });
      break;
    }
    case 'vault': {
      // Ribbed vaulting in the gloom high above.
      const rib = P('backWallShade', 0x6a6080);
      twice((ox) => {
        for (let x = 0; x < half; x += 70) {
          g.moveTo(ox + x, VIEW_H).bezierCurveTo(ox + x, 40, ox + x + 70, 40, ox + x + 70, VIEW_H).stroke({ width: 2, color: rib, alpha: 0.5 });
          g.moveTo(ox + x + 35, 0).lineTo(ox + x + 35, 60).stroke({ width: 1, color: rib, alpha: 0.35 });
        }
      });
      break;
    }
    case 'arches': {
      // A distant arcade: pointed arches with faint gold edges.
      const fill = P('backWallShade', 0x6a6080);
      const edge = P('wallTrim', 0xb8923e);
      twice((ox) => {
        for (let x = 10; x < half; x += 48) {
          const top = 70 + rnd() * 10;
          g.poly([ox + x, VIEW_H, ox + x, top + 20, ox + x + 16, top, ox + x + 32, top + 20, ox + x + 32, VIEW_H]).fill({ color: fill, alpha: 0.35 }).stroke({ width: 1, color: edge, alpha: 0.25 });
        }
      });
      break;
    }
  }
}
