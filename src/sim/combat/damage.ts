import type { Vec2 } from '../../core/math';
import type { SimConfig } from '../config';
import { emit, type Enemy, type PlayerState, type World } from '../world';

export function isPlayerInvulnerable(p: PlayerState, cfg: SimConfig): boolean {
  if (!p.dash) return false;
  return p.dash.frame >= cfg.player.dash.iFrameStart && p.dash.frame <= cfg.player.dash.iFrameEnd;
}

export function startHitstop(world: World, frames: number, shake: number, cfg: SimConfig): void {
  world.hitstop = Math.max(world.hitstop, frames);
  world.camera.shake = Math.min(cfg.camera.shakeMax, Math.max(world.camera.shake, shake));
}

export interface HitSpec {
  healthDamage: number;
  knockback: number;
  hitstop: number;
  shake: number;
  strong?: boolean;
}

export function hitEnemy(world: World, e: Enemy, dir: Vec2, spec: HitSpec, cfg: SimConfig): void {
  e.hp -= spec.healthDamage;
  e.hitFlash = cfg.combat.hitFlashFrames;
  e.knock = { x: dir.x * spec.knockback, y: dir.y * spec.knockback };
  world.stats.hitsLanded++;
  startHitstop(world, spec.hitstop, spec.shake, cfg);
  emit(world, { type: 'hit', pos: { ...e.pos }, dir: { ...dir }, strong: !!spec.strong });
  if (e.hp <= 0) {
    e.hp = 0;
    e.phase = 'down';
    e.phaseFrame = 0;
    world.stats.kills++;
    emit(world, { type: 'enemyDown', pos: { ...e.pos } });
  }
}

/** Returns false if the hit was avoided (i-frames). */
export function hurtPlayer(world: World, dir: Vec2, spec: HitSpec, cfg: SimConfig): boolean {
  const p = world.player;
  if (isPlayerInvulnerable(p, cfg)) return false;
  p.hp -= spec.healthDamage;
  if (p.hp <= 0) p.hp = cfg.player.maxHealth; // training room: no death yet
  p.hitFlash = cfg.combat.hitFlashFrames;
  p.hurtStun = cfg.combat.hurtStunFrames;
  p.action = null;
  p.knock = { x: dir.x * spec.knockback, y: dir.y * spec.knockback };
  world.stats.hitsTaken++;
  startHitstop(world, spec.hitstop, spec.shake, cfg);
  emit(world, { type: 'playerHit', pos: { ...p.pos }, dir: { ...dir } });
  return true;
}
