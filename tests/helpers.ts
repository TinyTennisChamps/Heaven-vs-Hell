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
    dummy: loadData('enemies/dummy'),
  };
}

export function trainingRoom(): RoomDef {
  return loadData('rooms/training');
}

/** A world with the training room. `withDummy: false` removes the dummy. */
export function testWorld(cfg: SimConfig, opts: { withDummy?: boolean; dummyAttacks?: boolean } = {}): World {
  const w = createWorld(trainingRoom(), cfg, 7);
  if (opts.withDummy === false) w.enemies = [];
  w.flags.dummyAttacks = opts.dummyAttacks ?? false;
  return w;
}

export function input(opts: { press?: ButtonAction[]; move?: { x: number; y: number }; aim?: { x: number; y: number } } = {}): InputFrame {
  const f = emptyInputFrame();
  f.pressed = opts.press ?? [];
  if (opts.move) f.move = opts.move;
  if (opts.aim) f.aimGround = opts.aim;
  return f;
}

export function run(world: World, cfg: SimConfig, ticks: number, frame: () => InputFrame = () => input()): void {
  for (let i = 0; i < ticks; i++) step(world, frame(), cfg);
}
