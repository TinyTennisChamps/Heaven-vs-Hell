import type { SimConfig } from '../config';
import { emit, type World } from '../world';
import { spawnGroup } from './roomRunner';
import { reseedZones } from './zones';

/**
 * Set-piece scripting: each room's `script` steps fire once when their
 * trigger is met — on entering, when a wave has spawned, after a time, or
 * when the boss drops below a health fraction — and run their actions:
 * switch the lighting preset, re-seed the light pools, spawn reinforcements,
 * silence the bells, or emit a named event for render/audio.
 */
export function runScript(world: World, cfg: SimConfig): void {
  const steps = world.room.script;
  if (!steps?.length) return;
  const S = world.script;
  S.t++;
  steps.forEach((st, i) => {
    if (S.fired[i]) return;
    const on = st.on;
    let go = false;
    if (on.enter && S.t >= 1) go = true;
    if (on.wave !== undefined && world.roomRun.wave > on.wave) go = true;
    if (on.timer !== undefined && S.t >= on.timer) go = true;
    if (on.bossHpBelow !== undefined) {
      const boss = world.enemies.find((e) => cfg.enemies[e.type]?.boss && e.phase !== 'down' && e.arrive === 0);
      if (boss && boss.hp / boss.maxHp < on.bossHpBelow) go = true;
    }
    if (!go) return;
    S.fired[i] = true;
    for (const a of st.do) {
      if (a.lighting) S.lighting = a.lighting;
      if (a.reseedZones) reseedZones(world, a.reseedZones, cfg);
      if (a.spawn) for (const s of a.spawn) spawnGroup(world, cfg, s);
      if (a.silence) {
        world.zones.silenced = true;
        S.silenced = true;
      }
      if (a.event) emit(world, { type: 'script', pos: { ...world.player.pos }, name: a.event });
    }
  });
}
