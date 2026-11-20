import { Graphics } from 'pixi.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
  size: number;
  drag: number;
}

/**
 * Cosmetic particles in iso screen space. Uses real time and Math.random —
 * allowed here because nothing in render feeds back into the sim.
 */
export class Particles {
  readonly g = new Graphics();
  private list: Particle[] = [];

  burst(x: number, y: number, opts: { count: number; colors: number[]; speed: number; life: number; dirX?: number; dirY?: number; spread?: number; size?: number; drag?: number }): void {
    const base = opts.dirX !== undefined ? Math.atan2(opts.dirY ?? 0, opts.dirX) : 0;
    const spread = opts.spread ?? Math.PI * 2;
    for (let i = 0; i < opts.count; i++) {
      const a = base + (Math.random() - 0.5) * spread;
      const s = opts.speed * (0.4 + Math.random() * 0.8);
      const life = opts.life * (0.6 + Math.random() * 0.6);
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6,
        life,
        max: life,
        color: opts.colors[i % opts.colors.length]!,
        size: opts.size ?? 1,
        drag: opts.drag ?? 0.86,
      });
    }
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(): void {
    const g = this.g;
    g.clear();
    for (const p of this.list) {
      const s = p.life / p.max > 0.5 ? p.size + 1 : p.size;
      g.rect(Math.round(p.x), Math.round(p.y), s, s).fill({ color: p.color, alpha: Math.min(1, (p.life / p.max) * 1.6) });
    }
  }
}
