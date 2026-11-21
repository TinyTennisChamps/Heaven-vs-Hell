import fs from 'node:fs';
import path from 'node:path';
import { emptyInputFrame, type ButtonAction, type InputFrame } from '../src/input/actions';
import type { RoomDef, SimConfig } from '../src/sim/config';
import { step } from '../src/sim/step';
import { createWorld, isValidSpot, type World } from '../src/sim/world';

/** Load a data file straight from disk (tests run in node, not through Vite). */
export function loadData<T>(key: string): T {
  const file = path.resolve(__dirname, '../data', key + '.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function testConfig(): SimConfig {
  return {
    player: loadData('tuning/player'),
    feel: loadData('tuning/feel'),
    combat: loadData('tuning/combat'),
    camera: loadData('tuning/camera'),
    attacks: loadData('attacks/satan'),
    enemies: Object.fromEntries(fs.readdirSync(path.resolve(__dirname, '../data/enemies')).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), loadData(`enemies/${f.replace('.json', '')}`)])),
    rooms: loadData('tuning/rooms'),
    rage: loadData('tuning/rage'),
    vials: loadData('vials'),
    biomes: { gardens: loadData('biomes/gardens'), nave: loadData('biomes/nave'), cage: loadData('biomes/cage') },
  };
}

export function trainingRoom(): RoomDef {
  return loadData('rooms/training');
}

/**
 * A world with the training room. By default only the dummy is kept.
 * `withDummy: false` removes every enemy; `only` keeps the listed types.
 */
export function testWorld(cfg: SimConfig, opts: { withDummy?: boolean; dummyAttacks?: boolean; only?: string[]; immortal?: boolean } = {}): World {
  const keep = opts.withDummy === false ? [] : (opts.only ?? ['dummy']);
  // Spawn only what the test uses, in the listed order, so adding content to
  // the training room never shifts a test's random stream.
  const base = trainingRoom();
  const room = { ...base, spawns: keep.map((type) => base.spawns.find((s) => s.type === type) ?? { type, at: [200, 120] as [number, number] }) };
  const w = createWorld(room, cfg, 7);
  w.flags.dummyAttacks = opts.dummyAttacks ?? false;
  w.flags.respawn = false;
  w.flags.immortal = opts.immortal ?? true;
  return w;
}

export function input(opts: { press?: ButtonAction[]; hold?: ButtonAction[]; move?: { x: number; y: number }; aim?: { x: number; y: number } } = {}): InputFrame {
  const f = emptyInputFrame();
  f.pressed = opts.press ?? [];
  for (const a of opts.hold ?? []) f.held[a] = true;
  if (opts.move) f.move = opts.move;
  if (opts.aim) f.aimGround = opts.aim;
  return f;
}

export function run(world: World, cfg: SimConfig, ticks: number, frame: () => InputFrame = () => input()): void {
  for (let i = 0; i < ticks; i++) step(world, frame(), cfg);
}

/** Flood-fill the walkable floor (Satan-sized) from the spawn on a 4 px grid. */
export function reachable(w: World, cfg: SimConfig): (x: number, y: number) => boolean {
  const r = w.room;
  const xs = r.bounds.map((b) => b[0]);
  const ys = r.bounds.map((b) => b[1]);
  const S = 4;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const nx = Math.ceil((Math.max(...xs) - x0) / S) + 1;
  const ny = Math.ceil((Math.max(...ys) - y0) / S) + 1;
  const seen = new Uint8Array(nx * ny);
  const rad = cfg.player.radius;
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && isValidSpot(w, x0 + i * S, y0 + j * S, rad);
  const si = Math.round((r.playerSpawn[0] - x0) / S);
  const sj = Math.round((r.playerSpawn[1] - y0) / S);
  const q: [number, number][] = [[si, sj]];
  seen[sj * nx + si] = 1;
  while (q.length) {
    const [i, j] = q.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di;
      const b = j + dj;
      if (!ok(a, b) || seen[b * nx + a]) continue;
      seen[b * nx + a] = 1;
      q.push([a, b]);
    }
  }
  // A point counts as reachable if Satan can stand within `tol` of it.
  return (x, y) => {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (seen[j * nx + i] && Math.hypot(x0 + i * S - x, y0 + j * S - y) <= 16) return true;
    return false;
  };
}
