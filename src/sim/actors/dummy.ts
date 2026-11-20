import { SIM_DT } from '../../core/loop';
import { normalize } from '../../core/math';
import type { SimConfig } from '../config';
import { arcHitsCircle } from '../combat/hitbox';
import { hurtPlayer } from '../combat/damage';
import { moveAndSlide } from '../physics/collide';
import { emit, type Enemy, type World } from '../world';

/**
 * Training dummy that fights back: walks into range, telegraphs (windup with a
 * tracking phase then a lock), swings once, recovers. Toggle with world.flags.dummyAttacks.
 */
export function updateDummy(world: World, e: Enemy, cfg: SimConfig): void {
  const d = cfg.dummy;
  const sw = d.swing;
  const p = world.player;

  if (e.hitFlash > 0) e.hitFlash--;
  if (e.cooldown > 0) e.cooldown--;
  e.phaseFrame++;

  const toP = { x: p.pos.x - e.pos.x, y: p.pos.y - e.pos.y };
  const dist = Math.hypot(toP.x, toP.y);
  const dirP = normalize(toP);
  let vx = 0;
  let vy = 0;

  switch (e.phase) {
    case 'down':
      if (e.phaseFrame >= d.respawnFrames) {
        e.hp = e.maxHp = d.health;
        e.pos = { ...e.spawn };
        e.prevPos = { ...e.spawn };
        e.knock = { x: 0, y: 0 };
        setPhase(e, 'idle');
        e.cooldown = d.attackCooldown;
      }
      return;
    case 'idle':
      if (dist > 1e-6) e.facing = dirP;
      if (world.flags.dummyAttacks) {
        if (dist > d.attackRange * 0.8) {
          vx = dirP.x * d.speed;
          vy = dirP.y * d.speed;
        }
        if (dist <= d.attackRange && e.cooldown <= 0) {
          setPhase(e, 'windup');
          emit(world, { type: 'telegraph', pos: { ...e.pos } });
        }
      }
      break;
    case 'windup':
      if (e.phaseFrame <= sw.trackUntil && dist > 1e-6) e.facing = dirP;
      if (e.phaseFrame >= sw.windup) {
        setPhase(e, 'swing');
        e.swingHit = false;
      }
      break;
    case 'swing':
      if (!e.swingHit && arcHitsCircle(e.pos, e.facing, sw.hitbox, p.pos, cfg.player.radius)) {
        e.swingHit = true;
        hurtPlayer(world, e.facing, { healthDamage: sw.damage, knockback: sw.knockback, hitstop: sw.hitstop, shake: sw.shake }, cfg);
      }
      if (e.phaseFrame >= sw.active) setPhase(e, 'recover');
      break;
    case 'recover':
      if (e.phaseFrame >= sw.recovery) {
        setPhase(e, 'idle');
        e.cooldown = d.attackCooldown;
      }
      break;
  }

  const dx = (vx + e.knock.x) * SIM_DT;
  const dy = (vy + e.knock.y) * SIM_DT;
  e.knock.x *= cfg.combat.knockbackFriction;
  e.knock.y *= cfg.combat.knockbackFriction;
  if (Math.hypot(e.knock.x, e.knock.y) < 2) e.knock = { x: 0, y: 0 };
  e.vel = { x: vx, y: vy };
  const r = moveAndSlide(e.pos.x, e.pos.y, dx, dy, e.radius, world.segs);
  e.pos.x = r.x;
  e.pos.y = r.y;
}

function setPhase(e: Enemy, phase: Enemy['phase']): void {
  e.phase = phase;
  e.phaseFrame = 0;
}
