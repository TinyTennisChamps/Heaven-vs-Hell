import fs from 'node:fs';
import path from 'node:path';
import { emptyInputFrame, type ButtonAction, type InputFrame } from '../src/input/actions';
import type { RoomDef, SimConfig } from '../src/sim/config';
import { step } from '../src/sim/step';
import { createWorld, type World } from '../src/sim/world';

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
    enemies: { dummy: loadData('enemies/dummy'), dominion: loadData('enemies/dominion'), archer: loadData('enemies/archer'), cherub: loadData('enemies/cherub'), gabriel: loadData('enemies/gabriel'), watcher: loadData('enemies/watcher'), zealot: loadData('enemies/zealot') },
    rooms: loadData('tuning/rooms'),
    rage: loadData('tuning/rage'),
    vials: loadData('vials'),
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
