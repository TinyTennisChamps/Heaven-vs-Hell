import type { InteractableDef, SimConfig } from '../config';
import { playerRadius } from '../stats';
import { emit, type World } from '../world';

/**
 * The hub (The Gilded Cage): no combat. Finds the interactable in reach, turns
 * the throw button (E) into "interact", and fires walk-in exits (the Gate Down,
 * the Yard) once. Runs before the player update so E never throws here.
 */
export function updateHub(world: World, cfg: SimConfig): void {
  const hub = world.hub;
  const list = world.room.interactables;
  if (!hub || !list) return;
  const p = world.player;
  const reach = playerRadius(world, cfg);
  let best: InteractableDef | null = null;
  let bestD = Infinity;
  for (const it of list) {
    const d = Math.hypot(p.pos.x - it.at[0], p.pos.y - it.at[1]);
    if (it.walkIn) {
      if (!hub.exited && !p.dead && d <= it.radius) {
        hub.exited = true;
        emit(world, { type: 'hubExit', id: it.id, kind: it.kind, pos: { ...p.pos } });
      }
      continue;
    }
    if (d <= it.radius + reach && d < bestD) {
      best = it;
      bestD = d;
    }
  }
  hub.target = best?.id ?? null;
  if (world.buffer.has('throw')) {
    world.buffer.consume('throw');
    if (best) emit(world, { type: 'interact', id: best.id, kind: best.kind, pos: { x: best.at[0], y: best.at[1] } });
  }
}

/** The interactable Satan can use right now (or null). */
export function hubTarget(world: World): InteractableDef | null {
  const id = world.hub?.target;
  return id ? (world.room.interactables?.find((i) => i.id === id) ?? null) : null;
}
