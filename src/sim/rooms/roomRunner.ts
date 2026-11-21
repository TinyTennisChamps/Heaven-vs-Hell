import { nextFloat } from '../../core/rng';
import type { SimConfig, WaveSpawn } from '../config';
import { killEnemy } from '../combat/damage';
import { maxHp, maxPips, modsFromVials } from '../stats';
import { emit, isValidSpot, spawnEnemy, type World } from '../world';

/**
 * Per-room flow, run inside step():
 *  - waves: the next wave appears `waveDelayFrames` after the field is clear;
 *  - cleared: when every wave is down, the exit doors unlock;
 *  - exits: walking into an open exit door sets roomRun.exit (the run layer
 *    outside the sim then builds the next room);
 *  - rest font: reaching it heals once and refills throw pips;
 *  - death: counts ticks since Satan fell.
 */
export function updateRoom(world: World, cfg: SimConfig): void {
  const rr = world.roomRun;
  const p = world.player;
  const T = cfg.rooms;
  if (p.dead) {
    rr.deadTicks++;
    return;
  }
  // A fallen boss takes its summoned choir with it.
  if (world.enemies.some((e) => cfg.enemies[e.type]?.boss && e.phase === 'down')) {
    for (const e of world.enemies) if (e.phase !== 'down') killEnemy(world, e, cfg);
  }
  const waves = world.room.waves ?? [];
  const fieldClear = world.enemies.every((e) => e.phase === 'down');

  if (!rr.cleared && fieldClear) {
    if (rr.wave < waves.length) {
      if (rr.timer > 0) rr.timer--;
      else {
        for (const s of waves[rr.wave]!) spawnGroup(world, cfg, s);
        rr.wave++;
        rr.timer = T.waveDelayFrames;
      }
    } else if (world.room.exits?.length || world.room.font) {
      rr.cleared = true;
      emit(world, { type: 'roomCleared', pos: { ...p.pos } });
    }
  }

  if (rr.cleared && rr.exit === null) {
    const exits = world.room.exits ?? [];
    for (let i = 0; i < Math.min(rr.exitCount, exits.length); i++) {
      const d = exits[i]!.at;
      if (Math.hypot(p.pos.x - d[0], p.pos.y - d[1]) <= T.doorRadius) {
        rr.exit = i;
        break;
      }
    }
  }

  // Vials: cages open with the room; revealed vials are picked up by walking over them.
  for (const q of world.pickups) {
    if (q.kind === 'cage' && !q.open && rr.cleared) {
      q.open = true;
      emit(world, { type: 'cageOpen', pos: { ...q.at } });
    }
    if (q.kind === 'drop' && !q.open && rr.cleared) {
      // A boss's vial falls where it fell.
      const boss = world.enemies.find((e) => cfg.enemies[e.type]?.boss);
      if (boss) q.vialAt = findSpot(world, boss.pos.x, boss.pos.y, cfg.player.radius) ?? { ...boss.pos };
      q.at = { ...q.vialAt };
      q.open = true;
      emit(world, { type: 'cageOpen', pos: { ...q.at } });
    }
    if (q.open && !q.taken && Math.hypot(p.pos.x - q.vialAt.x, p.pos.y - q.vialAt.y) <= T.pickupRadius + cfg.player.radius) {
      q.taken = true;
      if (!world.vials.includes(q.vialId)) world.vials.push(q.vialId);
      world.mods = modsFromVials(world.vials, cfg);
      emit(world, { type: 'vialGained', pos: { ...q.vialAt }, vialId: q.vialId });
    }
  }

  const font = world.room.font;
  if (font && !rr.fontUsed && Math.hypot(p.pos.x - font[0], p.pos.y - font[1]) <= T.fontRadius) {
    rr.fontUsed = true;
    p.hp = Math.min(maxHp(world, cfg), p.hp + Math.round(maxHp(world, cfg) * T.restHealFrac));
    p.pips = maxPips(world, cfg);
    emit(world, { type: 'restHeal', pos: { ...p.pos } });
  }
}

function spawnGroup(world: World, cfg: SimConfig, s: WaveSpawn): void {
  const def = cfg.enemies[s.type];
  if (!def) throw new Error(`room ${world.room.id}: unknown enemy ${s.type}`);
  const n = s.count ?? 1;
  const spread = s.spread ?? (n > 1 ? 22 : 0);
  const a0 = nextFloat(world.rng) * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const want = { x: s.at[0] + Math.cos(a) * spread, y: s.at[1] + Math.sin(a) * spread };
    const at = findSpot(world, want.x, want.y, def.radius + 2) ?? { x: s.at[0], y: s.at[1] };
    const e = spawnEnemy(world, cfg, s.type, at);
    e.arrive = cfg.rooms.arriveFrames;
    e.cooldown = Math.max(e.cooldown, cfg.rooms.arriveFrames + 20);
    emit(world, { type: 'spawnIn', pos: { ...at }, swarm: !!def.swarm });
  }
}

/** The nearest valid spot to (x, y), searching outward in rings. */
export function findSpot(world: World, x: number, y: number, r: number): { x: number; y: number } | null {
  if (isValidSpot(world, x, y, r)) return { x, y };
  for (let d = 6; d <= 90; d += 6) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cx = x + Math.cos(a) * d;
      const cy = y + Math.sin(a) * d;
      if (isValidSpot(world, cx, cy, r)) return { x: cx, y: cy };
    }
  }
  return null;
}
