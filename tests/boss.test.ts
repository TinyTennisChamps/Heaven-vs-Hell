import { describe, expect, it } from 'vitest';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import type { LevelDef, RoomDef } from '../src/sim/config';
import { killEnemy } from '../src/sim/combat/damage';
import { roomPickups, roomScale, startRun, takeExit } from '../src/sim/rooms/run';
import { step } from '../src/sim/step';
import { createWorld, spawnEnemy, type Enemy, type World } from '../src/sim/world';
import { playRoom } from './bots';
import { input, loadData, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const G = cfg.enemies.gabriel!;
const level = loadData<LevelDef>('levels/l1');
const rooms: Record<string, RoomDef> = {};
for (const id of [...level.pool, level.rest, level.boss]) rooms[id] = loadData<RoomDef>(`rooms/${id}`);

/** Satan and Gabriel face to face in the training court, attacks scripted by the test. */
function duel(): { w: World; g: Enemy } {
  const w = testWorld(cfg, { withDummy: false });
  const g = spawnEnemy(w, cfg, 'gabriel', { x: 140, y: 120 });
  w.player.pos = { x: 110, y: 120 };
  g.facing = { x: -1, y: 0 };
  g.cooldown = 99999;
  g.specialCooldown = 99999;
  return { w, g };
}

describe('Gabriel: two segments', () => {
  it('the first kill rallies him (untouchable) into phase two with full health; the second is final', () => {
    const { w, g } = duel();
    killEnemy(w, g, cfg);
    expect(g.phase).toBe('rally');
    expect(g.segments).toBe(1);
    expect(g.hp).toBe(G.health);
    // Untouchable while rallying.
    step(w, input({ press: ['slash'], aim: { ...g.pos } }), cfg);
    run(w, cfg, 20, () => input({ aim: { ...g.pos } }));
    expect(g.hp).toBe(G.health);
    run(w, cfg, G.rallyFrames! + 5);
    expect(g.phase).toBe('idle');
    killEnemy(w, g, cfg);
    expect(g.phase).toBe('down');
  });

  it('phase two uses the five-hit string; phase one the triple thrust', () => {
    const seen = (segments: number) => {
      const { w, g } = duel();
      g.segments = segments;
      g.cooldown = 0;
      w.flags.dummyAttacks = true;
      w.flags.immortal = true;
      const keys = new Set<string>();
      for (let t = 0; t < 60 * 20; t++) {
        step(w, input({ aim: { ...g.pos } }), cfg);
        if (g.attack) keys.add(g.attack);
        w.player.posture = 0;
      }
      return keys;
    };
    const p1 = seen(2);
    expect(p1.has('thrust3')).toBe(true);
    expect([...p1].some((k) => k.startsWith('p2'))).toBe(false);
    const p2 = seen(1);
    expect(p2.has('p2thrust5')).toBe(true);
  });

  it("the third thrust's delay varies (catches mashers)", () => {
    const { w, g } = duel();
    const lens = new Set<number>();
    for (let i = 0; i < 40; i++) {
      startEnemyAttack(w, g, 'thrust3', cfg);
      lens.add(g.windupLen);
    }
    const A = G.attacks.thrust3!;
    expect(Math.min(...lens)).toBeGreaterThanOrEqual(A.windup);
    expect(Math.max(...lens)).toBeLessThanOrEqual(A.windup + A.windupJitter!);
    expect(lens.size).toBeGreaterThan(5);
  });
});

describe('Gabriel: moves', () => {
  it('Horn Call summons cherubs; hitting him during the windup cancels it', () => {
    const a = duel();
    startEnemyAttack(a.w, a.g, 'horn', cfg);
    run(a.w, cfg, G.attacks.horn!.windup + 3);
    expect(a.w.enemies.filter((e) => e.type === 'cherub').length).toBe(G.attacks.horn!.summon!.count);

    const b = duel();
    startEnemyAttack(b.w, b.g, 'horn', cfg);
    run(b.w, cfg, 10);
    b.w.player.pos = { x: 124, y: 120 };
    step(b.w, input({ press: ['slash'], aim: { ...b.g.pos } }), cfg);
    run(b.w, cfg, G.attacks.horn!.windup + 3, () => input({ aim: { ...b.g.pos } }));
    expect(b.w.enemies.filter((e) => e.type === 'cherub').length).toBe(0);
    expect(b.w.events.some((e) => e.type === 'interrupt')).toBe(true);
  });

  it("Herald's Charge is unblockable but a timed parry deflects it", () => {
    const hit = (press: 'tap' | 'hold') => {
      const { w, g } = duel();
      w.player.pos = { x: 60, y: 120 };
      startEnemyAttack(w, g, 'charge', cfg);
      const at = g.windupLen;
      for (let t = 0; t < 90; t++) step(w, input({ press: press === 'tap' && t === at ? ['parry'] : [], hold: press === 'hold' ? ['parry'] : [], aim: { ...g.pos } }), cfg);
      return w.stats;
    };
    expect(hit('hold').hitsTaken).toBe(1);
    const tapped = hit('tap');
    expect(tapped.hitsTaken).toBe(0);
    expect(tapped.deflects).toBe(1);
  });

  it('Annunciation: a ring all round him that cannot be parried — but can be dashed through', () => {
    const go = (act: 'parry' | 'dash') => {
      const { w, g } = duel();
      w.player.pos = { x: 140, y: 160 }; // behind-ish, inside the ring
      startEnemyAttack(w, g, 'annunciation', cfg);
      const L = g.windupLen;
      for (let t = 0; t < 90; t++) step(w, input({ press: t === L - (act === 'dash' ? 3 : 1) ? [act] : [], move: act === 'dash' ? { x: 1, y: 0 } : undefined, aim: { ...g.pos } }), cfg);
      return w.stats.hitsTaken;
    };
    expect(go('parry')).toBe(1);
    expect(go('dash')).toBe(0);
  });
});

describe('Gabriel: arena and run', () => {
  it('the boss door follows the rest; after the boss comes the end', () => {
    const r = startRun(level, rooms, 3, { hp: 100, pips: 5 });
    for (let i = 0; i < 12 && !r.finished; i++) {
      if (r.current === level.boss) expect(r.options).toEqual([{ kind: 'end', roomId: null }]);
      // Skip the rest door while there's a choice, so it comes last, right before the boss.
      const other = r.options.findIndex((o) => o.kind !== 'rest');
      takeExit(r, other >= 0 ? other : 0, level, rooms, r.carry);
    }
    expect(r.visited[r.visited.length - 1]).toBe(level.boss);
    expect(r.visited[r.visited.length - 2]).toBe(level.rest);
  });

  it("Gabriel's fall dismisses his choir, clears the arena and drops the Herald's Ichor", () => {
    const r = startRun(level, rooms, 3, { hp: 100, pips: 5 });
    const room = rooms[level.boss]!;
    const w = createWorld(room, cfg, 1, r.carry, roomPickups(r, room, cfg));
    w.flags.dummyAttacks = false;
    run(w, cfg, cfg.rooms.firstWaveDelayFrames + 2);
    const g = w.enemies.find((e) => e.type === 'gabriel')!;
    spawnEnemy(w, cfg, 'cherub', { x: 200, y: 200 });
    killEnemy(w, g, cfg);
    run(w, cfg, G.rallyFrames! + 5);
    killEnemy(w, g, cfg);
    run(w, cfg, 3);
    expect(w.enemies.every((e) => e.phase === 'down')).toBe(true);
    expect(w.roomRun.cleared).toBe(true);
    const drop = w.pickups.find((q) => q.kind === 'drop')!;
    expect(drop.open).toBe(true);
    w.player.pos = { ...drop.vialAt };
    run(w, cfg, 2);
    expect(w.vials).toContain('l1_gabriel');
  });

  it('a decent player can beat Gabriel, but it costs real health', () => {
    const rs = [1, 2, 3, 4, 5, 6].map((s) => playRoom(rooms[level.boss]!, cfg, s));
    const dmg = rs.reduce((a, r) => a + r.dmg, 0) / rs.length;
    const secs = rs.reduce((a, r) => a + r.secs, 0) / rs.length;
    if (process.env.BOSS_DEBUG) for (const r of rs) console.log('[bossrun]', r.secs.toFixed(1), r.dmg, JSON.stringify(r.w.stats));
    console.log(`[boss] Gabriel: ${secs.toFixed(1)}s, ${dmg.toFixed(0)} dmg avg (min ${Math.min(...rs.map((r) => r.dmg))}, max ${Math.max(...rs.map((r) => r.dmg))})`);
    expect(rs.every((r) => Number.isFinite(r.secs))).toBe(true);
    expect(dmg).toBeGreaterThan(cfg.player.maxHealth * 0.3); // a real fight
    expect(dmg).toBeLessThan(cfg.player.maxHealth * 1.4); // beatable from a decent state
  });
});

describe('difficulty scaling', () => {
  it('rooms later in a run spawn tougher enemies (health, posture and damage); bosses ignore it', () => {
    const r = startRun(level, rooms, 3, { hp: 100, pips: 5 });
    r.combatDone = 3;
    const sc = roomScale(r, level, rooms['l1/cloister']!);
    const f = 1 + level.rampPerRoom * 3;
    expect(sc.health).toBeCloseTo(level.scaling.health * f, 5);
    const w = createWorld(rooms['l1/cloister']!, cfg, 1, undefined, [], sc);
    const d = spawnEnemy(w, cfg, 'dominion', { x: 120, y: 120 });
    expect(d.maxHp).toBe(Math.round(cfg.enemies.dominion!.health * sc.health));
    expect(d.postureMax).toBeCloseTo(cfg.enemies.dominion!.posture.max * sc.posture, 5);
    expect(d.dmgMul).toBeCloseTo(sc.damage, 5);
    const g = spawnEnemy(w, cfg, 'gabriel', { x: 200, y: 160 });
    expect(g.maxHp).toBe(G.health);
    expect(g.dmgMul).toBe(1);
  });

  it('scaled damage really lands harder', () => {
    const hitFor = (mul: number) => {
      const w = testWorld(cfg, { only: ['dummy'] });
      const e = w.enemies[0]!;
      e.dmgMul = mul;
      w.player.pos = { x: 100, y: 120 };
      e.pos = { x: 120, y: 120 };
      e.facing = { x: -1, y: 0 };
      e.cooldown = 9999;
      startEnemyAttack(w, e, 'swing', cfg);
      run(w, cfg, 60);
      return cfg.player.maxHealth - w.player.hp;
    };
    expect(hitFor(1.3)).toBe(Math.round(cfg.enemies.dummy!.attacks.swing!.healthDamage * 1.3));
    expect(hitFor(1.3)).toBeGreaterThan(hitFor(1));
  });
});
