import type { PostureTuning, SimConfig, VialStat } from './config';
import type { PlayerState, World } from './world';

/**
 * Satan's effective stats: base tuning (read live from cfg every call, so hot
 * reload still works) adjusted by this run's vials (world.mods) and Rage form.
 * Every read of max health / posture / pips / radius goes through here.
 */
export type Mods = Record<VialStat, number>;

export function noMods(): Mods {
  return { maxPosture: 0, rageGain: 0, slashPosture: 0, deflectFrames: 0, maxHealth: 0, pips: 0, postureRegen: 0 };
}

/** Flat additive per stat (no multiplicative stacking). Unknown ids are ignored. */
export function modsFromVials(ids: readonly string[], cfg: SimConfig): Mods {
  const m = noMods();
  for (const id of ids) {
    const v = cfg.vials.vials.find((x) => x.id === id);
    if (v) m[v.stat] += v.amount;
  }
  return m;
}

export function raging(p: PlayerState): boolean {
  return p.rageForm > 0;
}

export function maxHp(w: World, cfg: SimConfig): number {
  return Math.round(cfg.player.maxHealth * (1 + w.mods.maxHealth));
}

export function maxPosture(w: World, cfg: SimConfig): number {
  return cfg.player.posture.max * (1 + w.mods.maxPosture);
}

export function maxPips(w: World, cfg: SimConfig): number {
  return cfg.player.throw.maxPips + Math.round(w.mods.pips);
}

export function playerPostureTuning(w: World, cfg: SimConfig): PostureTuning {
  const t = cfg.player.posture;
  return { ...t, max: maxPosture(w, cfg), regenPerSec: t.regenPerSec * (1 + w.mods.postureRegen) };
}

export function playerRadius(w: World, cfg: SimConfig): number {
  return cfg.player.radius * (raging(w.player) ? cfg.rage.radiusMul : 1);
}

export function deflectWindowBonus(w: World): number {
  return Math.round(w.mods.deflectFrames);
}
