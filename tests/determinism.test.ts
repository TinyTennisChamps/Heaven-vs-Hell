import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FixedLoop } from '../src/core/loop';
import type { InputFrame } from '../src/input/actions';
import { step } from '../src/sim/step';
import { createWorld } from '../src/sim/world';
import { input, testConfig, trainingRoom } from './helpers';

/** Input as a function of sim tick, so every render rate feeds identical inputs. */
function scriptedInput(tick: number): InputFrame {
  const aim = { x: 200, y: 100 };
  if (tick === 10 || tick === 20 || tick === 30) return input({ press: ['slash'], aim });
  if (tick === 50) return input({ press: ['dash'], move: { x: 1, y: 1 }, aim });
  if (tick < 40) return input({ move: { x: 1, y: 0 }, aim });
  if (tick < 70) return input({ move: { x: 1, y: 1 }, aim });
  if (tick < 90) return input({ move: { x: 0, y: -1 }, aim });
  return input({ aim });
}

function runAt(hz: number, totalTicks: number) {
  const cfg = testConfig();
  // Explicit spawns (the training room itself starts empty).
  const room = { ...trainingRoom(), spawns: [{ type: 'dummy', at: [150, 70] as [number, number] }, { type: 'dominion', at: [200, 120] as [number, number] }] };
  const world = createWorld(room, cfg, 7);
  const loop = new FixedLoop();
  while (world.tick < totalTicks) {
    const { steps } = loop.advance(1 / hz);
    for (let i = 0; i < steps && world.tick < totalTicks; i++) step(world, scriptedInput(world.tick), cfg);
  }
  return { p: world.player.pos, e: world.enemies[0]!.pos, hp: world.enemies[0]!.hp };
}

describe('determinism', () => {
  it('ends in the identical state regardless of display refresh rate', () => {
    const ref = runAt(60, 240);
    for (const hz of [30, 120, 144, 240]) {
      const r = runAt(hz, 240);
      expect(r).toEqual(ref);
    }
  });
});

describe('sim purity', () => {
  it('src/sim never imports pixi, the DOM layer or reads a clock', () => {
    const dir = path.resolve(__dirname, '../src/sim');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(dir);
    const banned = [/from ['"]pixi\.js['"]/, /from ['"]\.\.?\/.*(render|debug|data\/store|keyboardMouse)/, /performance\.now/, /Date\.now/, /Math\.random/, /\bwindow\./, /\bdocument\./];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const re of banned) expect(re.test(src), `${path.basename(f)} matches ${re}`).toBe(false);
    }
  });
});
