import { describe, expect, it } from 'vitest';
import { groundToScreen } from '../src/core/iso';
import { normalize, type Vec2 } from '../src/core/math';
import type { ButtonAction } from '../src/input/actions';
import type { SimConfig } from '../src/sim/config';
import { step } from '../src/sim/step';
import { createWorld, type World } from '../src/sim/world';
import { input, testConfig, trainingRoom } from './helpers';

/**
 * Balance benchmark: two scripted players with perfect information fight a
 * Dominion. "Balanced" target from the design: parrying should kill about 2x
 * faster than spamming dash + slash, and take less damage doing it.
 */
type Bot = (w: World, cfg: SimConfig) => { press: ButtonAction[]; move: Vec2; aim: Vec2 };

const screenMove = (d: Vec2): Vec2 => {
  const s = groundToScreen(d.x, d.y);
  const l = Math.hypot(s.x, s.y) || 1;
  return { x: s.x / l, y: s.y / l };
};

/** Spams dash toward the Dominion's back, then slashes nonstop. */
export const aggressor: Bot = (w) => {
  const p = w.player;
  const e = w.enemies[0]!;
  const aim = { ...e.pos };
  if (e.phase === 'broken') return { press: ['slash'], move: { x: 0, y: 0 }, aim };
  const behind = { x: e.pos.x - e.facing.x * 18, y: e.pos.y - e.facing.y * 18 };
  const to = { x: behind.x - p.pos.x, y: behind.y - p.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const move = dist > 4 ? screenMove(normalize(to)) : { x: 0, y: 0 };
  if (dist > 12 && !p.dash) return { press: ['dash'], move, aim };
  return { press: ['slash'], move, aim };
};

/** Keeps spacing, perfect-parries every thrust/bash, dashes out of Judgement, punishes openings. */
export const parrier: Bot = (w, cfg) => {
  const p = w.player;
  const e = w.enemies[0]!;
  const aim = { ...e.pos };
  const to = { x: e.pos.x - p.pos.x, y: e.pos.y - p.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  const atk = e.attack ? cfg.enemies[e.type]!.attacks[e.attack] : undefined;
  if (atk && e.phase === 'windup') {
    if (atk.judgement && e.phaseFrame === atk.windup - 2) return { press: ['dash'], move: screenMove({ x: -dir.y, y: dir.x }), aim };
    if (!atk.judgement && e.phaseFrame === atk.windup - 1) return { press: ['parry'], move: { x: 0, y: 0 }, aim };
    return { press: [], move: { x: 0, y: 0 }, aim };
  }
  if (e.phase === 'recoil' || e.phase === 'broken' || e.phase === 'recover') {
    const move = dist > 20 ? screenMove(dir) : { x: 0, y: 0 };
    return { press: ['slash'], move, aim };
  }
  // Neutral: hold spear range, wait for the read.
  const move = dist > 30 ? screenMove(dir) : dist < 20 ? screenMove({ x: -dir.x, y: -dir.y }) : { x: 0, y: 0 };
  return { press: [], move, aim };
};

export function duelResult(bot: Bot, cfg: SimConfig, seed: number) {
  const w = createWorld({ ...trainingRoom(), spawns: [{ type: 'dominion', at: [160, 120] }] }, cfg, seed);
  w.flags.respawn = false;
  w.player.pos = { x: 120, y: 120 };
  w.enemies[0]!.pos = { x: 160, y: 120 };
  let damageTaken = 0;
  let lastHp = w.player.hp;
  for (let t = 0; t < 60 * 120; t++) {
    const b = bot(w, cfg);
    step(w, input({ press: b.press, move: b.move, aim: b.aim }), cfg);
    if (w.player.hp < lastHp) damageTaken += lastHp - w.player.hp;
    if (w.player.hp > lastHp) damageTaken += lastHp + (cfg.player.maxHealth - w.player.hp); // training refill
    lastHp = w.player.hp;
    if (w.enemies[0]!.phase === 'down') return { ticks: t, damageTaken, deathblow: w.stats.deathblows > 0 };
  }
  return { ticks: Infinity, damageTaken, deathblow: false };
}

export function benchmark(cfg: SimConfig, seeds = Array.from({ length: 20 }, (_, i) => i + 1)) {
  const run = (bot: Bot) => {
    const rs = seeds.map((s) => duelResult(bot, cfg, s));
    return { ticks: rs.reduce((a, r) => a + r.ticks, 0) / rs.length, dmg: rs.reduce((a, r) => a + r.damageTaken, 0) / rs.length, rs };
  };
  return { aggressor: run(aggressor), parrier: run(parrier) };
}

describe('balance: parrying vs dash-and-slash (Dominion)', () => {
  const cfg = testConfig();
  const b = benchmark(cfg);
  const report = `aggressor ${(b.aggressor.ticks / 60).toFixed(1)}s, ${b.aggressor.dmg.toFixed(0)} dmg | parrier ${(b.parrier.ticks / 60).toFixed(1)}s, ${b.parrier.dmg.toFixed(0)} dmg | ratio ${(b.aggressor.ticks / b.parrier.ticks).toFixed(2)}x`;

  it(`parrying kills about 2x faster (${report})`, () => {
    console.log('[balance]', report);
    const ratio = b.aggressor.ticks / b.parrier.ticks;
    expect(ratio).toBeGreaterThanOrEqual(1.6);
    expect(ratio).toBeLessThanOrEqual(2.8);
  });

  it('parrying is at least as safe', () => {
    // Known gap: dash-and-slash also takes ~0 damage, because the Dominion
    // can't punish flanking (see GAME_DESIGN.md "Still open").
    expect(b.parrier.dmg).toBeLessThanOrEqual(b.aggressor.dmg);
  });

  it('aggression still works (the game is not parry-only)', () => {
    expect(b.aggressor.rs.every((r) => Number.isFinite(r.ticks))).toBe(true);
  });
});
