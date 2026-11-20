import { Container, Graphics, Sprite } from 'pixi.js';
import { VIEW_H, VIEW_W } from '../core/constants';
import type { Atlas } from './atlas';
import { ANGEL, GARDEN, HEAVEN, SATAN } from './palette';

/**
 * Title backdrop after the PDF's title mock: a pale amphitheatre of candles
 * ringing the pit down through Heaven, Satan seen from behind at its lip.
 * The menu itself is DOM (crisp text) laid over this.
 */
export class TitleScene {
  readonly root = new Container();
  private g = new Graphics();
  private flicker = new Graphics();
  private candles: { x: number; y: number; h: number }[] = [];

  constructor(satan: Atlas) {
    this.root.addChild(this.g, this.flicker);
    this.drawStatic();
    const tag = satan.tags.get('idle_up') ?? [...satan.tags.values()][0]!;
    const s = new Sprite(tag.frames[0]!);
    s.anchor.set(satan.pivot.x / satan.frameW, satan.pivot.y / satan.frameH);
    s.position.set(Math.round(VIEW_W / 2), VIEW_H - 22);
    this.root.addChild(s);
  }

  private drawStatic(): void {
    const g = this.g;
    const cx = Math.round(VIEW_W / 2);
    g.rect(0, 0, VIEW_W, VIEW_H).fill(HEAVEN.ivory);
    // Amphitheatre tiers, outer (pale) to inner (gold), then the pit.
    const tiers: [number, number, number][] = [
      [250, 92, HEAVEN.ivory2],
      [215, 78, HEAVEN.marble],
      [180, 64, HEAVEN.stone],
      [148, 52, HEAVEN.gold2],
      [120, 42, HEAVEN.gold3],
    ];
    const cy = 168;
    for (const [rx, ry, col] of tiers) {
      g.ellipse(cx, cy, rx, ry).fill(col);
      g.ellipse(cx, cy, rx, ry).stroke({ width: 1, color: HEAVEN.goldDark, alpha: 0.35 });
    }
    // The pit: lilac rim, void, a hellfire glow at the bottom (Satan's way down).
    g.ellipse(cx, cy, 98, 32).fill(ANGEL.lilac);
    g.ellipse(cx, cy + 2, 90, 28).fill(ANGEL.angelLine);
    g.ellipse(cx, cy + 4, 80, 23).fill(ANGEL.void);
    g.ellipse(cx, cy + 8, 34, 8).fill({ color: SATAN.blood, alpha: 0.8 });
    g.ellipse(cx, cy + 9, 16, 3).fill({ color: SATAN.hellfire, alpha: 0.9 });
    // Candles on the tiers.
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
    for (const [rx, ry] of tiers.slice(0, 4)) {
      for (let i = 0; i < 26; i++) {
        const a = Math.PI + (i / 25) * Math.PI + (rnd() - 0.5) * 0.05;
        const x = Math.round(cx + Math.cos(a) * (rx - 8));
        const y = Math.round(cy + Math.sin(a) * (ry - 4));
        if (y > cy - 6) continue;
        const h = 4 + Math.round(rnd() * 5);
        g.rect(x, y - h, 2, h).fill(HEAVEN.ivory);
        this.candles.push({ x, y: y - h, h });
      }
    }
    // Light shafts.
    for (const [x, w] of [[120, 18], [210, 12], [300, 22]] as const) g.poly([x, 0, x + w, 0, x + w + 40, VIEW_H, x + 40, VIEW_H]).fill({ color: 0xffffff, alpha: 0.12 });
    // Clouds along the bottom.
    for (let i = 0; i < 14; i++) {
      const x = Math.round((i / 13) * VIEW_W + (rnd() - 0.5) * 20);
      const r = 14 + rnd() * 12;
      g.ellipse(x, VIEW_H - 4, r, r * 0.55).fill(GARDEN.cloudShade);
      g.ellipse(x, VIEW_H - 7, r, r * 0.55).fill(GARDEN.cloud);
    }
    // Satan's ledge.
    g.ellipse(cx, VIEW_H - 22, 22, 6).fill(HEAVEN.stone);
  }

  update(t: number): void {
    const f = this.flicker;
    f.clear();
    for (let i = 0; i < this.candles.length; i++) {
      const c = this.candles[i]!;
      const on = Math.sin(t * 6 + i * 2.3) > -0.6;
      f.rect(c.x, c.y - 2, 2, 2).fill(on ? HEAVEN.gold1 : HEAVEN.gold2);
    }
  }
}
