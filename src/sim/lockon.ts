import type { InputFrame } from '../input/actions';
import type { SimConfig } from './config';
import { emit, type Enemy, type World } from './world';

/**
 * Sekiro-style lock-on.
 *  - Q while unlocked: lock the nearest enemy in range.
 *  - Tap Q while locked: cycle to the next enemy (nearest-first order).
 *  - Hold Q while locked: release.
 *  - Target dies or leaves breakRange: jump to the next nearest, else release.
 * Also decides the "focus" enemy for group fights: the lock target, or the
 * nearest enemy when unlocked.
 */
const alive = (e: Enemy) => e.phase !== 'down';
const dist = (w: World, e: Enemy) => Math.hypot(e.pos.x - w.player.pos.x, e.pos.y - w.player.pos.y);

function byDistance(w: World, maxRange: number): Enemy[] {
  return w.enemies.filter((e) => alive(e) && dist(w, e) <= maxRange).sort((a, b) => dist(w, a) - dist(w, b) || a.id - b.id);
}

export function lockTarget(w: World): Enemy | null {
  if (w.player.lockId === null) return null;
  return w.enemies.find((e) => e.id === w.player.lockId && alive(e)) ?? null;
}

function setLock(w: World, e: Enemy | null): void {
  const had = w.player.lockId;
  w.player.lockId = e ? e.id : null;
  if (e && e.id !== had) emit(w, { type: 'lockOn', pos: { ...e.pos } });
  if (!e && had !== null) emit(w, { type: 'lockOff', pos: { ...w.player.pos } });
}

export function updateLock(w: World, input: InputFrame, cfg: SimConfig): void {
  const L = cfg.combat.lockOn;
  const p = w.player;

  // Validate: dead or too far -> next nearest (auto-lock), else release.
  if (p.lockId !== null) {
    const t = w.enemies.find((e) => e.id === p.lockId);
    if (!t || !alive(t) || dist(w, t) > L.breakRange) {
      setLock(w, byDistance(w, L.range).find((e) => e.id !== p.lockId) ?? null);
      p.lockHold = -1;
    }
  }

  if (input.pressed.includes('lock')) {
    if (p.lockId === null) {
      setLock(w, byDistance(w, L.range)[0] ?? null);
      p.lockHold = -1;
    } else {
      p.lockHold = 0; // tap or hold? decided on release / threshold
    }
  }

  if (p.lockHold >= 0) {
    if (input.held.lock) {
      p.lockHold++;
      if (p.lockHold >= L.holdToReleaseFrames) {
        setLock(w, null);
        p.lockHold = -1;
      }
    } else {
      // Released quickly: cycle to the next enemy, nearest-first.
      const order = byDistance(w, L.breakRange);
      if (order.length > 1) {
        const i = order.findIndex((e) => e.id === p.lockId);
        setLock(w, order[(i + 1) % order.length]!);
      }
      p.lockHold = -1;
    }
  }

  const t = lockTarget(w);
  w.focusId = t ? t.id : (byDistance(w, Infinity)[0]?.id ?? null);
}
