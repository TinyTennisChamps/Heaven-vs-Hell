import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { facingOf, pickPlayerAnim, syncedFrame, type AnimConfig } from '../src/render/animSync';
import { input, loadData, run, testConfig, testWorld } from './helpers';
import { step } from '../src/sim/step';

const cfg = testConfig();
const anim = loadData<AnimConfig>('anim/satan');

describe('animation sync with frame data', () => {
  it('shows the smear frame on exactly the active ticks of every slash', () => {
    for (const k of ['slash1', 'slash2', 'slash3'] as const) {
      const d = cfg.attacks[k]!;
      const map = anim[k];
      for (let f = 1; f <= d.startup + d.active + d.recovery; f++) {
        const idx = syncedFrame(map, d, f);
        const isActive = f > d.startup && f <= d.startup + d.active;
        expect(map.active.includes(idx), `${k} frame ${f}`).toBe(isActive);
      }
    }
  });

  it('plays every anticipation frame during startup, in order', () => {
    const d = cfg.attacks.slash3!;
    const seen: number[] = [];
    for (let f = 1; f <= d.startup; f++) seen.push(syncedFrame(anim.slash3, d, f));
    expect([...new Set(seen)]).toEqual(anim.slash3.startup);
  });

  it('still stays in sync if the frame data is retuned', () => {
    const d = { startup: 12, active: 1, recovery: 3 };
    expect(syncedFrame(anim.slash1, d, 12)).toBe(anim.slash1.startup.at(-1));
    expect(syncedFrame(anim.slash1, d, 13)).toBe(anim.slash1.active[0]);
    expect(syncedFrame(anim.slash1, d, 16)).toBe(anim.slash1.recovery.at(-1));
  });
});

describe('animation selection', () => {
  it('picks facing in screen space (W = up, D = right)', () => {
    expect(facingOf({ x: 1, y: -1 })).toBe('right'); // ground (+,-) projects to screen right
    expect(facingOf({ x: -1, y: 1 })).toBe('left');
    expect(facingOf({ x: 1, y: 1 })).toBe('down');
    expect(facingOf({ x: -1, y: -1 })).toBe('up');
  });

  it('idle -> run -> slash -> dash in response to the sim', () => {
    const w = testWorld(cfg, { withDummy: false });
    expect(pickPlayerAnim(w.player, cfg, anim).tag).toBe('idle');
    run(w, cfg, 8, () => input({ move: { x: 1, y: 0 } }));
    expect(pickPlayerAnim(w.player, cfg, anim).tag).toBe('run');
    step(w, input({ press: ['slash'], aim: { x: 300, y: 100 } }), cfg);
    expect(pickPlayerAnim(w.player, cfg, anim).tag).toBe('slash1');
    run(w, cfg, 10, () => input({ aim: { x: 300, y: 100 } }));
    step(w, input({ press: ['dash'], move: { x: 1, y: 0 } }), cfg);
    expect(pickPlayerAnim(w.player, cfg, anim).tag).toBe('dash');
  });

  it('every tag the game asks for exists in the generated atlas', () => {
    const atlas = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/sprites/satan.json'), 'utf8'));
    const names = new Set(atlas.meta.frameTags.map((t: { name: string }) => t.name));
    for (const tag of ['idle', 'run', 'slash1', 'slash2', 'slash3', 'dash', 'hurt']) {
      for (const d of ['down', 'up', 'right']) expect(names.has(`${tag}_${d}`), `${tag}_${d}`).toBe(true);
    }
    // Phase maps only reference frames that exist.
    for (const k of ['slash1', 'slash2', 'slash3'] as const) {
      const t = atlas.meta.frameTags.find((x: { name: string }) => x.name === `${k}_down`);
      const n = t.to - t.from + 1;
      for (const i of [...anim[k].startup, ...anim[k].active, ...anim[k].recovery]) expect(i).toBeLessThan(n);
    }
  });
});
