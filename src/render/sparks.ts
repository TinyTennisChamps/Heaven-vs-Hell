import { Graphics } from 'pixi.js';
import { HEAVEN, SATAN } from './palette';

/**
 * Deflect sparks, per the PDF: white core, gold ring, red rays.
 * Perfect deflects get a bigger starburst and a one-frame screen flash, so
 * "that was a good parry" reads instantly even mid-fight. Real-time based,
 * so it keeps animating through hit-stop (when the world is frozen).
 */
interface Spark {
  x: number;
  y: number;
  t: number;
  life: number;
  perfect: boolean;
  /** Ray angles, fixed at spawn so they don't flicker. */
  rays: number[];
}

export class Sparks {
  readonly g = new Graphics();
  private list: Spark[] = [];
  /** Remaining screen-flash time (seconds), read by the scene. */
  flash = 0;

  spawn(x: number, y: number, perfect: boolean, dirAngle: number): void {
    const n = perfect ? 12 : 7;
    const rays: number[] = [];
    for (let i = 0; i < n; i++) rays.push(dirAngle + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35);
    this.list.push({ x, y, t: 0, life: perfect ? 0.42 : 0.26, perfect, rays });
    if (perfect) this.flash = 0.05;
  }

  update(dt: number): void {
    for (const s of this.list) s.t += dt;
    this.list = this.list.filter((s) => s.t < s.life);
    this.flash = Math.max(0, this.flash - dt);
  }

  draw(): void {
    const g = this.g;
    g.clear();
    for (const s of this.list) {
      const k = s.t / s.life; // 0..1
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      const big = s.perfect ? 1 : 0.6;

      // Gold shockwave ring, squashed to the iso floor plane.
      const r = (4 + 26 * Math.sqrt(k)) * big;
      g.ellipse(x, y, r, r * 0.6).stroke({ width: k < 0.4 ? 2 : 1, color: k < 0.25 ? HEAVEN.gold1 : HEAVEN.gold2, alpha: 1 - k });
      if (s.perfect && k > 0.1) {
        const r2 = r * 0.6;
        g.ellipse(x, y, r2, r2 * 0.6).stroke({ width: 1, color: 0xffffff, alpha: (1 - k) * 0.8 });
      }

      // Rays: white near the core, hellfire at the tips (Satan's colour — it's his parry).
      const rayLen = (s.perfect ? 22 : 12) * (k < 0.3 ? k / 0.3 : 1) * (1 - k * 0.5);
      const inner = 3 + 10 * k;
      s.rays.forEach((a, i) => {
        const len = rayLen * (i % 2 === 0 ? 1 : 0.6);
        const cx = Math.cos(a);
        const cy = Math.sin(a) * 0.75;
        const x0 = x + cx * inner;
        const y0 = y + cy * inner;
        const xm = x + cx * (inner + len * 0.5);
        const ym = y + cy * (inner + len * 0.5);
        const x1 = x + cx * (inner + len);
        const y1 = y + cy * (inner + len);
        g.moveTo(x0, y0).lineTo(xm, ym).stroke({ width: s.perfect && k < 0.3 ? 2 : 1, color: 0xffffff, alpha: 1 - k });
        g.moveTo(xm, ym).lineTo(x1, y1).stroke({ width: 1, color: i % 3 === 0 ? SATAN.ember : SATAN.hellfire, alpha: 1 - k });
      });

      // White-hot core: a 4-point star that pops then shrinks.
      const core = (s.perfect ? 7 : 4) * (k < 0.15 ? 1 + k * 4 : Math.max(0, 1 - (k - 0.15) * 1.6));
      if (core > 0.5) {
        g.poly([x, y - core * 1.6, x + core * 0.45, y - core * 0.45, x + core * 1.6, y, x + core * 0.45, y + core * 0.45, x, y + core * 1.6, x - core * 0.45, y + core * 0.45, x - core * 1.6, y, x - core * 0.45, y - core * 0.45]).fill({ color: 0xffffff, alpha: 1 });
        g.circle(x, y, core * 0.5).fill({ color: HEAVEN.gold1 });
      }
    }
  }
}
