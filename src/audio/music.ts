import type { BiomeDef, SimConfig } from '../sim/config';
import type { World } from '../sim/world';
import { sfx } from './sfx';

/**
 * Adaptive music and room audio — named hooks only (silent until real audio
 * is registered with setSound). Layers: explore → combat when enemies are up
 * → boss when a boss is up. Changes wait for the next beat (bpm from the
 * biome) so there are no hard cuts. Also: the ambient bed and reverb per room,
 * footsteps by surface, and stings on room clear / reward / doors.
 *
 * Hook names: music:<track>:in|out, ambience:<id>, reverb:<type>,
 * step:<surface>, sting:clear|reward|doors, bell:warn|toll, script:<event>.
 */
type Layer = 'explore' | 'combat' | 'boss';

export class MusicDirector {
  private layer: Layer = 'explore';
  private pending: Layer | null = null;
  private audio: BiomeDef['audio'] | null = null;
  private lastBeat = 0;
  private stepAcc = 0;
  private lastPos = { x: 0, y: 0 };
  /** For the debug overlay. */
  get state(): string {
    return `${this.layer}${this.pending ? ` → ${this.pending}` : ''}`;
  }

  enterRoom(biome: BiomeDef, world: World, silence: boolean): void {
    const a = biome.audio;
    if (!this.audio || this.audio.explore !== a.explore) {
      if (this.audio) sfx(`music:${this.audio[this.layer]}:out`);
      this.audio = a;
      this.layer = 'explore';
      sfx(`music:${a.explore}:in`);
    }
    sfx(`ambience:${silence ? 'silence' : a.ambience}`);
    sfx(`reverb:${a.reverb}`);
    this.lastPos = { ...world.player.pos };
  }

  update(nowMs: number, world: World, cfg: SimConfig): void {
    const a = this.audio;
    if (!a) return;
    const alive = world.enemies.filter((e) => e.phase !== 'down');
    const want: Layer = alive.some((e) => cfg.enemies[e.type]?.boss) ? 'boss' : alive.length && !world.roomRun.cleared ? 'combat' : 'explore';
    if (want !== this.layer) this.pending = want;
    const beat = 60000 / a.bpm;
    if (this.pending && Math.floor(nowMs / beat) !== Math.floor(this.lastBeat / beat)) {
      sfx(`music:${a[this.layer]}:out`);
      this.layer = this.pending;
      this.pending = null;
      sfx(`music:${a[this.layer]}:in`);
    }
    this.lastBeat = nowMs;

    // Footsteps every ~18 px walked (not dashing).
    const p = world.player;
    const d = Math.hypot(p.pos.x - this.lastPos.x, p.pos.y - this.lastPos.y);
    this.lastPos = { ...p.pos };
    if (!p.dash && d < 10) {
      this.stepAcc += d;
      if (this.stepAcc >= 18) {
        this.stepAcc = 0;
        sfx(`step:${a.footsteps}`);
      }
    }
    for (const ev of world.events) {
      if (ev.type === 'roomCleared') {
        sfx('sting:clear');
        sfx('sting:doors');
      } else if (ev.type === 'vialGained') sfx('sting:reward');
      else if (ev.type === 'bellWarn') sfx('bell:warn');
      else if (ev.type === 'bellToll') sfx('bell:toll');
      else if (ev.type === 'script') sfx(`script:${ev.name}`);
    }
  }
}
