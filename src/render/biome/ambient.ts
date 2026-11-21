import { Graphics } from 'pixi.js';
import type { BiomeDef } from '../../sim/config';
import { hex } from './geom';

/** Hard budget: ambient particles alive per room. */
export const MAX_AMBIENT = 120;

interface Mote {
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
  phase: number;
}

/**
 * Ambient life per biome: petals and feathers in the gardens; dust motes in
 * the light, smoke curling off braziers and the odd distant winged shape in
 * the nave. Cosmetic only (render-side randomness is fine). Low alpha, tiny,
 * never over 120 alive.
 */
export class Ambient {
  readonly g = new Graphics();
  private list: Mote[] = [];
  private acc: number[];

  constructor(private biome: BiomeDef) {
    this.acc = biome.ambient.map(() => 0);
  }

  get count(): number {
    return this.list.length;
  }

  /** `view` = the visible area in world-layer coordinates; `sources` = light/flame points to emit near. */
  update(dt: number, view: { x: number; y: number; w: number; h: number }, sources: { flames: { x: number; y: number }[]; pools: { x: number; y: number }[] }, enabled: boolean): void {
    if (enabled) {
      this.biome.ambient.forEach((e, i) => {
        this.acc[i]! += e.perSec * dt;
        const alive = this.list.filter((m) => m.kind === e.kind).length;
        while (this.acc[i]! >= 1) {
          this.acc[i]! -= 1;
          if (alive >= e.max || this.list.length >= MAX_AMBIENT) continue;
          this.spawn(e.kind, e.colors.map((c) => hex(c)), view, sources);
        }
      });
    }
    for (const m of this.list) {
      m.life -= dt;
      m.phase += dt;
      const sway = m.kind === 'petal' || m.kind === 'feather' ? Math.sin(m.phase * 2.2) * 8 : 0;
      m.x += (m.vx + sway) * dt;
      m.y += m.vy * dt;
    }
    this.list = this.list.filter((m) => m.life > 0);
    this.draw(enabled);
  }

  private spawn(kind: string, colors: number[], v: { x: number; y: number; w: number; h: number }, src: { flames: { x: number; y: number }[]; pools: { x: number; y: number }[] }): void {
    const c = colors[Math.floor(Math.random() * colors.length)] ?? 0xffffff;
    const r = Math.random;
    switch (kind) {
      case 'petal':
        this.list.push({ kind, x: v.x + r() * v.w, y: v.y - 10 + r() * v.h * 0.3, vx: 10 + r() * 14, vy: 8 + r() * 8, life: 7, max: 7, color: c, phase: r() * 6 });
        break;
      case 'feather':
        this.list.push({ kind, x: v.x + r() * v.w, y: v.y - 10, vx: 4 + r() * 6, vy: 6 + r() * 4, life: 10, max: 10, color: c, phase: r() * 6 });
        break;
      case 'mote': {
        // Mostly inside light pools, a few anywhere.
        const p = src.pools.length && r() < 0.8 ? src.pools[Math.floor(r() * src.pools.length)]! : { x: v.x + r() * v.w, y: v.y + r() * v.h };
        this.list.push({ kind, x: p.x + (r() - 0.5) * 50, y: p.y - r() * 50, vx: (r() - 0.5) * 3, vy: -2 - r() * 3, life: 5, max: 5, color: c, phase: r() * 6 });
        break;
      }
      case 'smoke': {
        if (!src.flames.length) return;
        const f = src.flames[Math.floor(r() * src.flames.length)]!;
        this.list.push({ kind, x: f.x, y: f.y - 6, vx: (r() - 0.5) * 3, vy: -8 - r() * 4, life: 3, max: 3, color: c, phase: 0 });
        break;
      }
      case 'silhouette':
        // A distant winged shape crossing high over the room.
        this.list.push({ kind, x: v.x - 20, y: v.y + 12 + r() * 30, vx: 26 + r() * 10, vy: 0, life: (v.w + 40) / 30, max: 99, color: c, phase: 0 });
        break;
    }
  }

  private draw(visible: boolean): void {
    const g = this.g;
    g.clear();
    g.visible = visible;
    if (!visible) return;
    for (const m of this.list) {
      const k = Math.min(1, m.life / 0.6, (m.max - m.life) / 0.6 + 0.2);
      const x = Math.round(m.x);
      const y = Math.round(m.y);
      switch (m.kind) {
        case 'petal':
          g.rect(x, y, Math.sin(m.phase * 3) > 0 ? 2 : 1, 1).fill({ color: m.color, alpha: 0.8 * k });
          break;
        case 'feather':
          g.rect(x, y, 3, 1).fill({ color: m.color, alpha: 0.75 * k });
          break;
        case 'mote':
          g.rect(x, y, 1, 1).fill({ color: m.color, alpha: (0.35 + 0.35 * Math.sin(m.phase * 4)) * k });
          break;
        case 'smoke': {
          const s = 1 + (1 - m.life / m.max) * 3;
          g.circle(x, y, s).fill({ color: m.color, alpha: 0.16 * (m.life / m.max) });
          break;
        }
        case 'silhouette':
          g.moveTo(x - 5, y - 2).lineTo(x, y).lineTo(x + 5, y - 2 + Math.round(Math.sin(m.phase * 8))).stroke({ width: 1, color: m.color, alpha: 0.35 });
          break;
      }
    }
  }
}
