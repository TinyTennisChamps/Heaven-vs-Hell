import { groundToScreen } from '../core/iso';
import type { Vec2 } from '../core/math';
import { attackDef } from '../sim/actors/player';
import type { SimConfig } from '../sim/config';
import type { PlayerState } from '../sim/world';

/**
 * Pure animation selection (no Pixi): which tag, facing and frame to show.
 * Attacks are driven by the sim's frame data, not wall-clock time, so the
 * smear frame always lands on the first active tick however the numbers are tuned.
 */
export interface PhaseMap {
  startup: number[];
  active: number[];
  recovery: number[];
}

export interface AnimConfig {
  slash1: PhaseMap;
  slash2: PhaseMap;
  slash3: PhaseMap;
  throw: PhaseMap;
  runMinSpeed: number;
  [k: string]: unknown;
}

export type Facing = 'down' | 'up' | 'right' | 'left';

export interface AnimPick {
  tag: string;
  facing: Facing;
  /** Index into the tag's frames, or -1 to use time-based looping. */
  frame: number;
}

/** 4-way facing from a ground-space direction, decided in screen space. */
export function facingOf(dir: Vec2): Facing {
  const s = groundToScreen(dir.x, dir.y);
  // Iso squashes y by half; undo that so diagonals split evenly.
  const ax = Math.abs(s.x);
  const ay = Math.abs(s.y * 2);
  if (ax >= ay) return s.x >= 0 ? 'right' : 'left';
  return s.y >= 0 ? 'down' : 'up';
}

/** Map a 1-based attack frame onto the tag's frame list for the phase it's in. */
export function syncedFrame(map: PhaseMap, d: { startup: number; active: number; recovery: number }, frame: number): number {
  let list: number[];
  let local: number;
  let len: number;
  if (frame <= d.startup) {
    list = map.startup;
    local = frame - 1;
    len = d.startup;
  } else if (frame <= d.startup + d.active) {
    list = map.active;
    local = frame - d.startup - 1;
    len = d.active;
  } else {
    list = map.recovery;
    local = frame - d.startup - d.active - 1;
    len = d.recovery;
  }
  const i = Math.min(list.length - 1, Math.max(0, Math.floor((local / Math.max(1, len)) * list.length)));
  return list[i]!;
}

export function pickPlayerAnim(p: PlayerState, cfg: SimConfig, anim: AnimConfig): AnimPick {
  if (p.dash) {
    const n = cfg.player.dash.frames;
    return { tag: 'dash', facing: facingOf(p.dash.dir), frame: p.dash.frame <= n / 2 ? 0 : 1 };
  }
  // Posture broken: reeling (hurt pose, alternating).
  if (p.broken > 0) return { tag: 'hurt', facing: facingOf(p.facing), frame: Math.floor(p.broken / 10) % 2 };
  if (p.hurtStun > 0) return { tag: 'hurt', facing: facingOf(p.facing), frame: p.hurtStun > cfg.combat.hurtStunFrames / 2 ? 0 : 1 };
  if (p.action) {
    // Deathblow reuses the overhead slash3 art, synced to its own frame data.
    const key = (p.action.key === 'deathblow' ? 'slash3' : p.action.key) as 'slash1' | 'slash2' | 'slash3' | 'throw';
    const d = attackDef(cfg, p.action.key);
    return { tag: key, facing: facingOf(p.action.dir), frame: syncedFrame(anim[key], d, Math.max(1, p.action.frame)) };
  }
  if (p.parry && !p.guarding) {
    // 4 frames: raise, deflect (glint), hold, lower — spread over the window.
    const f = p.parry.deflected ? 1 : Math.min(3, Math.floor(((p.parry.frame - 1) / Math.max(1, p.parry.window)) * 4));
    return { tag: 'parry', facing: facingOf(p.facing), frame: f };
  }
  if (p.parry && p.parry.frame <= 4) return { tag: 'parry', facing: facingOf(p.facing), frame: p.parry.deflected ? 1 : 0 };
  if (p.guarding) return { tag: 'block', facing: facingOf(p.facing), frame: 0 };
  const speed = Math.hypot(p.vel.x, p.vel.y);
  if (speed >= anim.runMinSpeed) return { tag: 'run', facing: facingOf(p.vel), frame: -1 };
  return { tag: 'idle', facing: facingOf(p.facing), frame: -1 };
}
