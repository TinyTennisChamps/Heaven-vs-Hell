import type { SimConfig } from '../sim/config';
import type { SimEvent, World } from '../sim/world';
import type { AudioEngine } from './engine';

/** Map one sim event to the sound cue(s) it should play. */
export function playEventSound(audio: AudioEngine, ev: SimEvent, world: World, cfg: SimConfig): void {
  const play = (c: string, v = 1) => audio.play(c, v);
  switch (ev.type) {
    case 'swing':
      if (world.player.rageForm > 0) play('claw');
      else play(ev.step === 3 ? 'swing3' : ev.step === 2 ? 'swing2' : 'swing1');
      break;
    case 'hit':
      play(ev.riposte ? 'riposte' : ev.strong ? 'hitStrong' : 'hit');
      break;
    case 'deflect':
      play(ev.perfect ? 'deflectPerfect' : 'deflect');
      break;
    case 'telegraph': {
      // A specific cue for this enemy's attack if there is one; unblockables always get the danger cue.
      const named = ev.enemy && ev.attack ? `telegraph:${ev.enemy}:${ev.attack}` : '';
      if (named && audio.has(named)) play(named);
      if (ev.judgement) play('judgement');
      break;
    }
    case 'enemySwing':
      play(audio.has(`enemySwing:${ev.enemy}`) ? `enemySwing:${ev.enemy}` : ev.enemy.startsWith('gabriel') ? 'enemySwing:gabriel' : 'enemySwing');
      break;
    case 'arrowLoosed':
      play(ev.kind === 'laser' ? 'laser' : 'arrow');
      break;
    case 'spawnIn':
      play(ev.swarm ? 'spawnInSwarm' : 'spawnIn');
      break;
    case 'script':
      if (audio.has(ev.name)) play(ev.name);
      break;
    default:
      if (audio.has(ev.type)) play(ev.type);
  }
  void cfg;
}
