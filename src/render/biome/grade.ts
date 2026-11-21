import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { VIEW_H, VIEW_W } from '../../core/constants';

/**
 * Screen-space mood: a faint colour grade over the whole picture and a
 * stepped (pixel-friendly) vignette. No filters — just two cheap quads.
 */
export class Grade {
  readonly root = new Container();
  private tint = new Graphics();
  private vignette: Sprite;

  constructor() {
    this.vignette = new Sprite(vignetteTexture());
    this.vignette.width = VIEW_W;
    this.vignette.height = VIEW_H;
    this.root.addChild(this.tint, this.vignette);
  }

  set(color: number, alpha: number, vignette: number, enabled: boolean): void {
    this.root.visible = enabled;
    this.tint.clear().rect(0, 0, VIEW_W, VIEW_H).fill({ color, alpha });
    this.vignette.alpha = vignette;
  }
}

let cached: Texture | null = null;
function vignetteTexture(): Texture {
  if (cached) return cached;
  const W = 107;
  const H = 60;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, Math.min(1, (d - 0.65) / 0.55));
      const stepped = Math.round(a * 5) / 5;
      const i = (y * W + x) * 4;
      img.data[i] = 10;
      img.data[i + 1] = 8;
      img.data[i + 2] = 20;
      img.data[i + 3] = Math.round(stepped * 255);
    }
  }
  g.putImageData(img, 0, 0);
  cached = Texture.from(c);
  cached.source.scaleMode = 'nearest';
  return cached;
}
