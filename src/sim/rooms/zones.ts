import type { Vec2 } from '../../core/math';
import type { BiomeDef, SimConfig, ZoneDef } from '../config';
import { emit, type World } from '../world';

/**
 * Sanctified light (the Gilded Nave's signature): pools of stained-glass light
 * on the floor. Enemies standing in one recover posture `regenMul`× faster —
 * a posture buff only. Every `periodFrames` the bells toll: a warning bell
 * `warnFrames` before, then each pool dims, slides to its next anchor over
 * `shiftFrames` and brightens again. A set-piece can silence the bells.
 */
export interface ZoneState {
  pos: Vec2;
  from: Vec2;
  anchors: Vec2[];
  anchor: number;
  radius: number;
  glass?: string;
  /** 0..1, render brightness (dims during a shift). */
  intensity: number;
}

export interface Zones {
  list: ZoneState[];
  /** Ticks until the next toll. */
  timer: number;
  /** Ticks into the current shift (-1 = steady). */
  shift: number;
  silenced: boolean;
}

export function makeZones(defs: ZoneDef[] | undefined, biome: BiomeDef | undefined): Zones {
  const t = biome?.hazards?.zones;
  return {
    list: (t ? defs ?? [] : []).map((d) => {
      const anchors = d.anchors.map(([x, y]) => ({ x, y }));
      return { pos: { ...anchors[0]! }, from: { ...anchors[0]! }, anchors, anchor: 0, radius: d.radius, glass: d.glass, intensity: 1 };
    }),
    timer: t?.periodFrames ?? 0,
    shift: -1,
    silenced: false,
  };
}

export function zoneTuning(world: World, cfg: SimConfig) {
  return cfg.biomes?.[world.biomeId]?.hazards?.zones;
}

export function updateZones(world: World, cfg: SimConfig): void {
  const Z = world.zones;
  const t = zoneTuning(world, cfg);
  if (!t || !Z.list.length) return;
  if (Z.shift >= 0) {
    Z.shift++;
    const k = Math.min(1, Z.shift / t.shiftFrames);
    const e = k * k * (3 - 2 * k);
    for (const z of Z.list) {
      const to = z.anchors[z.anchor]!;
      z.pos = { x: z.from.x + (to.x - z.from.x) * e, y: z.from.y + (to.y - z.from.y) * e };
      z.intensity = 0.25 + 0.75 * Math.abs(1 - 2 * k); // dims mid-slide
    }
    if (k >= 1) {
      Z.shift = -1;
      for (const z of Z.list) z.intensity = 1;
    }
  }
  if (Z.silenced) return;
  Z.timer--;
  if (Z.timer === t.warnFrames) emit(world, { type: 'bellWarn', pos: { ...world.player.pos } });
  if (Z.timer <= 0) {
    Z.timer = t.periodFrames;
    emit(world, { type: 'bellToll', pos: { ...world.player.pos } });
    for (const z of Z.list) {
      z.from = { ...z.pos };
      z.anchor = (z.anchor + 1) % z.anchors.length;
    }
    if (Z.list.some((z) => z.anchors.length > 1)) Z.shift = 0;
  }
}

/** Posture-regen multiplier for something standing at `pos`. */
export function zoneRegenMul(world: World, cfg: SimConfig, pos: Vec2): number {
  const t = zoneTuning(world, cfg);
  if (!t) return 1;
  for (const z of world.zones.list) {
    if (z.intensity < 0.5) continue;
    if (Math.hypot(pos.x - z.pos.x, pos.y - z.pos.y) <= z.radius) return t.regenMul;
  }
  return 1;
}

/** Replace the pools (set-piece: the rose window shatters and the light moves). */
export function reseedZones(world: World, defs: ZoneDef[], cfg: SimConfig): void {
  world.zones = { ...makeZones(defs, cfg.biomes?.[world.biomeId]), silenced: world.zones.silenced };
}
