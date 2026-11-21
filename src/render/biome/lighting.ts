import { Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { VIEW_H, VIEW_W } from '../../core/constants';
import type { LightSource } from './roomArt';

/** Hard budget: dynamic lights rendered per frame (the rest are dropped, least important first). */
export const MAX_LIGHTS = 16;

/**
 * Pixel-friendly 2D lighting. A tinted darkness layer covers the floor and
 * back walls (never Satan, enemies or telegraphs, which stay full-bright) and
 * each light "erases" a stepped radial hole in it, so pools of light read as
 * crisp bands, not blur. A faint additive glow adds colour on top.
 * Transient flashes (hits, parries, Rage) briefly light the room.
 */
export class Lighting {
  /** Screen-sized darkness, placed in the world layer above the floor. */
  readonly dark: Sprite;
  /** Additive colour glows (world space). */
  readonly glow = new Container();
  private rt: RenderTexture;
  private darkC = new Container();
  private darkRect = new Graphics();
  private holes: Sprite[] = [];
  private glows: Sprite[] = [];
  private flashes: { x: number; y: number; r: number; color: number; alpha: number; life: number; max: number }[] = [];
  /** Lights drawn last frame (for the budget readout). */
  count = 0;

  constructor(private renderer: Renderer) {
    this.rt = RenderTexture.create({ width: VIEW_W, height: VIEW_H });
    this.dark = new Sprite(this.rt);
    this.darkC.addChild(this.darkRect);
    const tex = lightTexture();
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const h = new Sprite(tex);
      h.anchor.set(0.5);
      h.blendMode = 'erase';
      this.darkC.addChild(h);
      this.holes.push(h);
      const g = new Sprite(tex);
      g.anchor.set(0.5);
      g.blendMode = 'add';
      this.glow.addChild(g);
      this.glows.push(g);
    }
  }

  flash(x: number, y: number, color: number, radius: number, alpha: number, frames: number): void {
    this.flashes.push({ x, y, r: radius, color, alpha, life: frames, max: frames });
    if (this.flashes.length > 6) this.flashes.shift();
  }

  /**
   * Render the darkness for this frame. `offset` is the world layer's screen
   * position (lights are in world-layer coordinates). Satan's light first,
   * then flashes, then the rest nearest the view centre.
   */
  render(lights: LightSource[], offset: { x: number; y: number }, darkness: number, darknessAlpha: number, enabled: boolean): void {
    for (const f of this.flashes) f.life--;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    const all: LightSource[] = [...lights.slice(0, 1), ...this.flashes.map((f) => ({ x: f.x, y: f.y, radius: f.r * (0.6 + 0.4 * (f.life / f.max)), color: f.color, alpha: f.alpha * (f.life / f.max) })), ...lights.slice(1)];
    const cx = VIEW_W / 2 - offset.x;
    const cy = VIEW_H / 2 - offset.y;
    const head = all.slice(0, 1 + this.flashes.length);
    const rest = all.slice(head.length).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const use = [...head, ...rest].slice(0, MAX_LIGHTS);
    this.count = use.length;

    this.dark.visible = enabled && darknessAlpha > 0.01;
    this.glow.visible = enabled;
    this.dark.position.set(-offset.x, -offset.y);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = use[i];
      const h = this.holes[i]!;
      const g = this.glows[i]!;
      h.visible = g.visible = !!l;
      if (!l) continue;
      h.position.set(Math.round(l.x + offset.x), Math.round(l.y + offset.y));
      h.scale.set((l.radius * 2) / 64, (l.radius * 2) / 64 / 2); // iso: pools are flattened ellipses
      h.alpha = Math.min(1, l.alpha);
      g.position.set(Math.round(l.x), Math.round(l.y));
      g.scale.set((l.radius * 1.6) / 64, (l.radius * 1.6) / 64 / 2);
      g.tint = l.color;
      g.alpha = Math.min(0.35, l.alpha * 0.22);
    }
    if (!this.dark.visible) return;
    this.darkRect.clear().rect(0, 0, VIEW_W, VIEW_H).fill({ color: darkness, alpha: darknessAlpha });
    this.renderer.render({ container: this.darkC, target: this.rt, clear: true });
  }

  destroy(): void {
    this.rt.destroy(true);
  }
}

/** A 64×64 radial light in 5 hard bands (pixel-art friendly). */
let cached: Texture | null = null;
function lightTexture(): Texture {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const bands = [1, 0.8, 0.6, 0.38, 0.18];
  bands.forEach((_, i) => {
    g.beginPath();
    g.arc(32, 32, 32 * (1 - i / bands.length), 0, Math.PI * 2);
    g.fillStyle = `rgba(255,255,255,${bands[bands.length - 1 - i]})`;
    g.fill();
  });
  cached = Texture.from(c);
  cached.source.scaleMode = 'nearest';
  return cached;
}
