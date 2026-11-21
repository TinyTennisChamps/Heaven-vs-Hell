import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import type { BiomeDef, LevelDef, RoomDef } from '../src/sim/config';
import { hitEnemy, killEnemy } from '../src/sim/combat/damage';
import { findSpot, SECRET_EXIT } from '../src/sim/rooms/roomRunner';
import { roomPickups, startRun, takeExit } from '../src/sim/rooms/run';
import { zoneRegenMul } from '../src/sim/rooms/zones';
import { step } from '../src/sim/step';
import { createWorld, isValidSpot, spawnEnemy, type World } from '../src/sim/world';
import { playRoom } from './bots';
import { input, loadData, run, testConfig } from './helpers';

const cfg = testConfig();
const levels: Record<string, LevelDef> = { l1: loadData('levels/l1'), l2: loadData('levels/l2') };
const rooms: Record<string, RoomDef> = {};
for (const lvl of ['l1', 'l2']) {
  for (const f of fs.readdirSync(path.resolve(__dirname, `../data/rooms/${lvl}`))) {
    const r = loadData<RoomDef>(`rooms/${lvl}/${f.replace('.json', '')}`);
    rooms[r.id] = r;
  }
}
const L2 = levels.l2!;
const l2Rooms = Object.values(rooms).filter((r) => r.id.startsWith('l2/'));
const world = (r: RoomDef, seed = 1) => createWorld(r, cfg, seed, undefined, [], undefined, r.id.startsWith('l2/') ? 'nave' : 'gardens');

/** Flood-fill the walkable floor (Satan-sized) from the spawn on a 4 px grid. */
function reachable(w: World): (x: number, y: number) => boolean {
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

describe('L2 room data', () => {
  it('the level references real rooms and a real biome', () => {
    for (const id of [...L2.pool, ...L2.openers, L2.rest, L2.boss, L2.secret!, ...(L2.fixed ?? []).map((f) => f.room), ...(L2.secretHosts ?? [])]) expect(rooms[id], id).toBeDefined();
    expect(cfg.biomes!.nave).toBeDefined();
    expect(levels.l1!.next).toBe('l2');
  });

  for (const r of l2Rooms) {
    it(`${r.id}: connected — spawns, doors, font, cage, cracks and the secret door are all reachable; no light pool on a spawn or doorway`, () => {
      const w = world(r);
      expect(isValidSpot(w, r.playerSpawn[0], r.playerSpawn[1], cfg.player.radius), 'spawn').toBe(true);
      const reach = reachable(w);
      for (const wave of r.waves ?? []) for (const s of wave) {
        const at = findSpot(w, s.at[0], s.at[1], (cfg.enemies[s.type]?.radius ?? 8) + 2);
        expect(at, `${s.type} at ${s.at}`).not.toBeNull();
        if (!cfg.enemies[s.type]?.flying) expect(reach(at!.x, at!.y), `${s.type} reachable`).toBe(true);
      }
      for (const d of r.exits ?? []) expect(reach(d.at[0], d.at[1]), `exit ${d.at}`).toBe(true);
      for (const p of [r.font, r.cage, r.crack, r.secret?.crack, r.secret?.door, r.vial?.at].filter(Boolean) as [number, number][]) expect(reach(p[0], p[1]), `point ${p}`).toBe(true);
      for (const z of r.zones ?? []) for (const a of z.anchors) {
        const safe = (p: [number, number]) => Math.hypot(a[0] - p[0], a[1] - p[1]) > z.radius + 8;
        expect(safe(r.playerSpawn), `zone ${a} vs spawn`).toBe(true);
        for (const d of r.exits ?? []) expect(safe(d.at), `zone ${a} vs exit`).toBe(true);
        if (r.entry) expect(safe(r.entry.at), `zone ${a} vs entry`).toBe(true);
      }
      expect((r.props ?? []).length).toBeLessThanOrEqual(60);
    });
  }
});

describe('sanctified light and bells', () => {
  const Z = (cfg.biomes!.nave as BiomeDef).hazards!.zones!;
  it('an enemy inside a pool recovers posture faster; outside, normally', () => {
    const w = world(rooms['l2/narthex']!);
    const z = w.zones.list[0]!;
    expect(zoneRegenMul(w, cfg, z.pos)).toBe(Z.regenMul);
    expect(zoneRegenMul(w, cfg, { x: z.pos.x + z.radius + 5, y: z.pos.y })).toBe(1);
    const inside = spawnEnemy(w, cfg, 'dominion', { ...z.pos });
    const outside = spawnEnemy(w, cfg, 'dominion', { x: 60, y: 40 });
    for (const e of [inside, outside]) {
      e.posture = 60;
      e.sinceHit = 999;
      e.cooldown = 99999;
    }
    w.flags.dummyAttacks = false;
    run(w, cfg, 30);
    expect(60 - inside.posture).toBeGreaterThan((60 - outside.posture) * 1.5);
  });

  it(`the bells warn ${Z.warnFrames} ticks before each toll, every ${Z.periodFrames}, and the pools move`, () => {
    const w = world(rooms['l2/narthex']!);
    w.flags.dummyAttacks = false;
    const start = { ...w.zones.list[0]!.pos };
    const warns: number[] = [];
    const tolls: number[] = [];
    for (let t = 0; t < Z.periodFrames * 2 + 5; t++) {
      step(w, input(), cfg);
      for (const ev of w.events) {
        if (ev.type === 'bellWarn') warns.push(w.tick);
        if (ev.type === 'bellToll') tolls.push(w.tick);
      }
      w.events.length = 0;
    }
    expect(tolls.length).toBe(2);
    expect(tolls[1]! - tolls[0]!).toBe(Z.periodFrames);
    expect(tolls[0]! - warns[0]!).toBe(Z.warnFrames);
    expect(w.zones.list[0]!.pos).not.toEqual(start);
  });
});

describe('set-pieces', () => {
  it('The Shattered Rose: when the second wave arrives the window shatters — lighting flips, the pools re-seed', () => {
    const w = world(rooms['l2/rose']!);
    w.flags.dummyAttacks = false;
    const before = w.zones.list.map((z) => z.glass);
    let shattered = false;
    for (let g = 0; g < 30 && !shattered; g++) {
      for (const e of w.enemies) if (e.phase !== 'down') killEnemy(w, e, cfg);
      for (let t = 0; t < 120; t++) {
        step(w, input(), cfg);
        if (w.events.some((ev) => ev.type === 'script' && ev.name === 'roseShatter')) shattered = true;
        w.events.length = 0;
      }
    }
    expect(shattered).toBe(true);
    expect(w.script.lighting).toBe('shattered');
    expect(w.zones.list.map((z) => z.glass)).not.toEqual(before);
  });

  it("The Herald's Return: the bells fall silent, Gabriel descends, and his choir joins as he weakens", () => {
    const w = world(rooms['l2/herald_return']!);
    w.flags.dummyAttacks = false;
    w.flags.immortal = true;
    run(w, cfg, cfg.rooms.firstWaveDelayFrames + cfg.rooms.arriveFrames + 5);
    expect(w.script.silenced).toBe(true);
    const g = w.enemies.find((e) => e.type === 'gabriel_l2')!;
    expect(g).toBeDefined();
    expect(g.segments).toBe(1);
    g.hp = Math.round(g.maxHp * 0.2);
    run(w, cfg, 5);
    const types = w.enemies.map((e) => e.type);
    expect(types).toContain('cherub');
    expect(types).toContain('watcher');
    expect(types).toContain('zealot');
    expect(w.script.lighting).toBe('dark');
    // His fall dismisses the choir and clears the hall.
    killEnemy(w, g, cfg);
    run(w, cfg, 5);
    expect(w.enemies.every((e) => e.phase === 'down')).toBe(true);
    expect(w.roomRun.cleared).toBe(true);
  });

  it('Gabriel returns already in his second phase (five-hit string, Annunciation)', () => {
    const w = world(rooms['l2/herald_return']!);
    const g = spawnEnemy(w, cfg, 'gabriel_l2', { x: 160, y: 140 });
    w.player.pos = { x: 160, y: 110 };
    w.flags.immortal = true;
    w.flags.dummyAttacks = true;
    g.cooldown = 0;
    g.specialCooldown = 99999;
    const seen = new Set<string>();
    for (let t = 0; t < 60 * 30; t++) {
      step(w, input(), cfg);
      if (g.attack) seen.add(g.attack);
      w.player.posture = 0;
    }
    expect([...seen].some((k) => k.startsWith('p2'))).toBe(true);
    expect(seen.has('thrust1')).toBe(false);
  });
});

describe('the run: Level 1 → Level 2', () => {
  function playThrough(seed: number, pick = 0) {
    const r = startRun(levels.l1!, rooms, seed, { hp: 100, pips: 5 });
    const order: string[] = [r.current];
    for (let i = 0; i < 40 && !r.finished; i++) {
      takeExit(r, Math.min(pick, r.options.length - 1), levels[r.level]!, rooms, r.carry, levels);
      if (!r.finished) order.push(r.current);
    }
    return { r, order };
  }

  it('after Gabriel (L1), the run continues into the Gilded Nave and ends after Raphael', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { r, order } = playThrough(seed, seed % 2);
      expect(r.finished).toBe(true);
      const i = order.indexOf('l1/herald');
      expect(i).toBeGreaterThan(0);
      expect(L2.openers).toContain(order[i + 1]);
      expect(order[order.length - 1]).toBe('l2/sanctum');
      // The Herald's Return always comes after the 4th L2 combat room, before the rest/boss.
      const l2 = order.slice(i + 1);
      const hr = l2.indexOf('l2/herald_return');
      expect(hr).toBeGreaterThan(0);
      expect(l2.slice(0, hr).filter((id) => rooms[id]!.tier === 'combat' || rooms[id]!.tier === 'hard').length).toBe(L2.combatRooms);
      expect(l2.filter((id) => id === 'l2/chantry').length).toBe(1);
      expect(r.levelsDone).toEqual(['l1']);
    }
  });

  it('the secret door only opens once its cracked wall breaks, and leads to the Ossuary with its vial', () => {
    const run2 = startRun(L2, rooms, 5, { hp: 100, pips: 5 });
    run2.secretHost = 'l2/clerestory';
    const host = rooms['l2/clerestory']!;
    const w = createWorld(host, cfg, 1, run2.carry, roomPickups(run2, host, cfg), undefined, 'nave');
    w.flags.dummyAttacks = false;
    for (let g = 0; g < 20 && !w.roomRun.cleared; g++) {
      for (const e of w.enemies) if (e.phase !== 'down') killEnemy(w, e, cfg);
      run(w, cfg, cfg.rooms.waveDelayFrames + cfg.rooms.firstWaveDelayFrames + 2);
    }
    const sec = host.secret!;
    w.player.pos = findSpot(w, sec.door[0], sec.door[1], cfg.player.radius)!;
    run(w, cfg, 3);
    expect(w.roomRun.exit).toBeNull(); // still a wall
    const q = w.pickups.find((p) => p.kind === 'secret')!;
    for (let i = 0; i < cfg.rooms.crackHits; i++) {
      step(w, input({ press: ['slash'], aim: { ...q.at } }), cfg);
      run(w, cfg, 30, () => input({ aim: { ...q.at } }));
    }
    expect(w.roomRun.secretOpen).toBe(true);
    run(w, cfg, 2);
    expect(w.roomRun.exit).toBe(SECRET_EXIT);
    const before = run2.options;
    takeExit(run2, SECRET_EXIT, L2, rooms, run2.carry, levels);
    expect(run2.current).toBe('l2/ossuary');
    expect(run2.options).toEqual(before); // the same choices wait beyond
    const oss = rooms['l2/ossuary']!;
    const ps = roomPickups(run2, oss, cfg);
    expect(ps.map((p) => p.vialId)).toContain('l2_hidden_b');
  });
});

describe('Raphael', () => {
  const R = cfg.enemies.raphael!;
  function duel() {
    const w = world(rooms['l2/sanctum']!);
    const e = spawnEnemy(w, cfg, 'raphael', { x: 160, y: 160 });
    w.player.pos = { x: 160, y: 100 };
    e.facing = { x: 0, y: -1 };
    e.cooldown = 99999;
    return { w, e };
  }
  it('the Mending Rite restores 40% posture — unless a hit cuts it short', () => {
    const a = duel();
    a.e.posture = a.e.postureMax * 0.8;
    a.e.sinceHit = 0;
    startEnemyAttack(a.w, a.e, 'rite', cfg);
    run(a.w, cfg, R.attacks.rite!.windup + 3);
    expect(a.e.posture).toBeLessThan(a.e.postureMax * 0.45);
    const b = duel();
    b.e.posture = b.e.postureMax * 0.8;
    startEnemyAttack(b.w, b.e, 'rite', cfg);
    run(b.w, cfg, 20);
    hitEnemy(b.w, b.e, b.w.player.pos, { x: 0, y: 1 }, cfg.attacks.slash1!, cfg);
    run(b.w, cfg, R.attacks.rite!.windup);
    expect(b.e.posture).toBeGreaterThan(b.e.postureMax * 0.7);
  });

  it('the Serpent Staff is a Judgement: blocking fails, a dash works', () => {
    const go = (act: 'hold' | 'dash') => {
      const { w, e } = duel();
      startEnemyAttack(w, e, 'serpent', cfg);
      for (let t = 0; t < 90; t++) step(w, input({ press: act === 'dash' && e.phase === 'windup' && e.phaseFrame === e.windupLen - 2 ? ['dash'] : [], hold: act === 'hold' ? ['parry'] : [], move: act === 'dash' ? { x: 1, y: 0 } : undefined }), cfg);
      return w.stats.hitsTaken;
    };
    expect(go('hold')).toBe(1);
    expect(go('dash')).toBe(0);
  });

  it('in phase two he calls two Grigori — once', () => {
    const { w, e } = duel();
    e.segments = 1;
    e.cooldown = 0;
    w.flags.dummyAttacks = true;
    w.flags.immortal = true;
    for (let t = 0; t < 60 * 20; t++) {
      step(w, input(), cfg);
      w.player.posture = 0;
    }
    expect(w.enemies.filter((x) => x.type === 'watcher').length).toBe(2);
  });

  it('a decent player can beat him, at real cost', () => {
    const rs = [1, 2, 3, 4].map((s) => playRoom(rooms['l2/sanctum']!, cfg, s));
    const dmg = rs.reduce((a, r) => a + r.dmg, 0) / rs.length;
    console.log(`[boss] Raphael: ${(rs.reduce((a, r) => a + r.secs, 0) / rs.length).toFixed(1)}s, ${dmg.toFixed(0)} dmg avg`);
    expect(rs.every((r) => Number.isFinite(r.secs))).toBe(true);
    expect(dmg).toBeGreaterThan(cfg.player.maxHealth * 0.3);
  });
});

describe('readability and performance budgets', () => {
  const hsl = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, s, l };
  };
  for (const id of ['gardens', 'nave']) {
    it(`${id}: large-area colours are low-saturation and nothing in the biome is red`, () => {
      const B = cfg.biomes![id]!;
      // Perceived colourfulness (chroma = max − min) of every large area stays low; Satan's crimson is ~0.75.
      const chroma = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        return (Math.max(...v) - Math.min(...v)) / 255;
      };
      for (const [k, c] of Object.entries(B.palette)) expect(chroma(c), `${k} ${c}`).toBeLessThan(0.3);
      expect(chroma('#d3122a')).toBeGreaterThan(0.6);
      const all = [...Object.values(B.palette), ...Object.values(B.accents), B.lighting.darkness, B.lighting.grade.color, ...B.ambient.flatMap((a) => a.colors)];
      for (const c of all) {
        const x = hsl(c);
        expect((x.h >= 345 || x.h <= 20) && x.s > 0.3 && x.l > 0.2 && x.l < 0.85, `red-ish ${c}`).toBe(false);
      }
    });
  }

  it('every L2 room steps in well under the sim budget (1 ms per tick)', () => {
    for (const r of l2Rooms) {
      const w = world(r);
      w.flags.immortal = true;
      const t0 = performance.now();
      run(w, cfg, 600);
      const ms = (performance.now() - t0) / 600;
      expect(ms, r.id).toBeLessThan(1);
    }
  });
});
