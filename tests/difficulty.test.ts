import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LevelDef, RoomDef, SimConfig } from '../src/sim/config';
import { playRoom } from './bots';
import { loadData, testConfig } from './helpers';

/**
 * Difficulty benchmark for the L1 rooms, played by the decent-player bot.
 * Combat rooms are measured as a first room; hard rooms as the third (with
 * the per-room ramp applied). Numbers are printed for tuning; the asserts are
 * loose guard rails.
 */
describe('L1 difficulty (decent-player bot)', () => {
  const cfg: SimConfig = testConfig();
  const dir = path.resolve(__dirname, '../data/rooms/l1');
  const level = loadData<LevelDef>('levels/l1');
  const ids = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).filter((id) => {
    const t = loadData<RoomDef>(`rooms/l1/${id}`).tier;
    return t === 'combat' || t === 'hard';
  });
  for (const id of ids) {
    it(`${id}: clearable, and affordable for a decent player`, () => {
      const room = loadData<RoomDef>(`rooms/l1/${id}`);
      const f = 1 + level.rampPerRoom * (room.tier === 'hard' ? 2 : 0);
      const rs = [1, 2, 3, 4, 5, 6].map((s) => playRoom(room, cfg, s, { health: f, posture: f, damage: f }));
      const secs = rs.reduce((a, r) => a + r.secs, 0) / rs.length;
      const dmg = rs.reduce((a, r) => a + r.dmg, 0) / rs.length;
      console.log(`[difficulty] ${room.tier} ${id}: ${secs.toFixed(1)}s, ${dmg.toFixed(0)} dmg avg (max ${Math.max(...rs.map((r) => r.dmg))})`);
      expect(rs.every((r) => Number.isFinite(r.secs))).toBe(true);
      // L1 is the gentlest layer: a decent player loses well under half a bar per room.
      expect(dmg).toBeLessThan(cfg.player.maxHealth * (room.tier === 'hard' ? 0.65 : 0.35));
    });
  }
});
