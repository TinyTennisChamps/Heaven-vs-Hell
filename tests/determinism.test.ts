import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FixedLoop } from '../src/core/loop';
import { emptyInputFrame, type InputFrame } from '../src/input/actions';
import { step } from '../src/sim/step';
import { createWorld } from '../src/sim/world';
import { testConfig } from './helpers';

/** Input as a function of sim tick, so every render rate feeds identical inputs. */
function scriptedInput(tick: number): InputFrame {
  const f = emptyInputFrame();
  if (tick < 40) f.move = { x: 1, y: 0 };
  else if (tick < 70) f.move = { x: 1, y: 1 };
  else if (tick < 90) f.move = { x: 0, y: -1 };
  return f;
}

function runAt(hz: number, totalTicks: number) {
  const world = createWorld(7);
  const cfg = testConfig();
  const loop = new FixedLoop();
  while (world.tick < totalTicks) {
    const { steps } = loop.advance(1 / hz);
    for (let i = 0; i < steps && world.tick < totalTicks; i++) step(world, scriptedInput(world.tick), cfg);
  }
  return world.player.pos;
}

describe('determinism', () => {
  it('ends in the identical position regardless of display refresh rate', () => {
    const ref = runAt(60, 120);
    for (const hz of [30, 120, 144, 240]) {
      const p = runAt(hz, 120);
      expect(p.x).toBe(ref.x);
      expect(p.y).toBe(ref.y);
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
