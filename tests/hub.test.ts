import { describe, expect, it } from 'vitest';
import type { RoomDef } from '../src/sim/config';
import { hubTarget } from '../src/sim/rooms/hub';
import { step } from '../src/sim/step';
import { createWorld, isValidSpot, type World } from '../src/sim/world';
import { input, loadData, reachable, run, testConfig } from './helpers';

const cfg = testConfig();
const hubRoom = loadData<RoomDef>('rooms/hub/cage');
const hub = (): World => createWorld(hubRoom, cfg, 1, undefined, [], undefined, 'cage');
const at = (w: World, id: string) => {
  const it = w.room.interactables!.find((i) => i.id === id)!;
  return { x: it.at[0], y: it.at[1] };
};

describe('The Gilded Cage (hub)', () => {
  it('has a valid spawn, the Gate Down, the Yard, Vael, Kesh and the Codex', () => {
    const w = hub();
    expect(isValidSpot(w, hubRoom.playerSpawn[0], hubRoom.playerSpawn[1], cfg.player.radius)).toBe(true);
    const kinds = hubRoom.interactables!.map((i) => i.kind);
    for (const k of ['gate', 'yard', 'vael', 'kesh', 'codex', 'imp', 'sleeper', 'warden']) expect(kinds, k).toContain(k);
    expect(w.hub).not.toBeNull();
    expect(hubRoom.waves ?? []).toHaveLength(0);
  });

  it('every interactable can be reached on foot from the landing', () => {
    const w = hub();
    const reach = reachable(w, cfg);
    for (const it of hubRoom.interactables!) expect(reach(it.at[0], it.at[1]), it.id).toBe(true);
  });

  it('E talks to whoever is in reach instead of throwing', () => {
    const w = hub();
    const v = at(w, 'vael');
    w.player.pos = { x: v.x, y: v.y + 14 };
    const pips = w.player.pips;
    step(w, input(), cfg);
    expect(hubTarget(w)?.id).toBe('vael');
    step(w, input({ press: ['throw'] }), cfg);
    run(w, cfg, 20);
    expect(w.player.pips).toBe(pips);
    expect(w.projectiles).toHaveLength(0);
    expect(w.player.action).toBeNull();
  });

  it('E with nobody in reach does nothing (no throw in the hub)', () => {
    const w = hub();
    const pips = w.player.pips;
    const events: string[] = [];
    step(w, input({ press: ['throw'] }), cfg);
    for (let t = 0; t < 20; t++) {
      events.push(...w.events.map((e) => e.type));
      step(w, input(), cfg);
    }
    expect(hubTarget(w)).toBeNull();
    expect(w.player.pips).toBe(pips);
    expect(w.projectiles).toHaveLength(0);
    expect(events).not.toContain('interact');
  });

  it('interacting emits who was talked to', () => {
    const w = hub();
    const k = at(w, 'kesh');
    w.player.pos = { x: k.x - 14, y: k.y - 10 };
    step(w, input(), cfg);
    w.events.length = 0;
    step(w, input({ press: ['throw'] }), cfg);
    const ev = w.events.find((e) => e.type === 'interact');
    expect(ev && ev.type === 'interact' && ev.id).toBe('kesh');
  });

  it('walking into the Gate Down fires one hubExit; so does the Yard', () => {
    for (const id of ['gate', 'yard']) {
      const w = hub();
      const g = at(w, id);
      w.player.pos = { ...g };
      const exits: string[] = [];
      for (let t = 0; t < 30; t++) {
        step(w, input(), cfg);
        for (const e of w.events) if (e.type === 'hubExit') exits.push(e.id);
        w.events.length = 0;
      }
      expect(exits).toEqual([id]);
    }
  });

  it('movement and the dash feel the same as in a run', () => {
    const w = hub();
    run(w, cfg, 30, () => input({ move: { x: -1, y: 0 } }));
    const speed = Math.hypot(w.player.vel.x, w.player.vel.y);
    expect(speed).toBeGreaterThan(cfg.player.maxSpeed * 0.8);
    step(w, input({ press: ['dash'], move: { x: -1, y: 0 } }), cfg);
    expect(w.player.dash).not.toBeNull();
  });
});
