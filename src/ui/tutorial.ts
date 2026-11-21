import type { World } from '../sim/world';
import type { SimConfig } from '../sim/config';

/**
 * Contextual tutorial prompts for the early rooms. Each prompt appears the
 * first time its mechanic matters and is retired for good once Satan does the
 * thing (remembered in localStorage). Reads sim state and this frame's events;
 * never changes the sim.
 */
interface Step {
  id: string;
  text: string;
  show: (w: World, cfg: SimConfig) => boolean;
  /** Done by an event this frame (or a state check). */
  done: (w: World) => boolean;
}

const KEY = 'hvh.tutorial';
const MIN_SHOW_FRAMES = 90;

const alive = (w: World) => w.enemies.filter((e) => e.phase !== 'down' && e.arrive === 0);
const dist = (w: World, x: number, y: number) => Math.hypot(w.player.pos.x - x, w.player.pos.y - y);
const has = (w: World, type: string) => w.events.some((e) => e.type === type);

const STEPS: Step[] = [
  {
    id: 'move',
    text: 'WASD — move',
    show: () => true,
    done: (w) => dist(w, w.room.playerSpawn[0], w.room.playerSpawn[1]) > 30,
  },
  {
    id: 'deathblow',
    text: 'Posture broken!  LMB on the red diamond — Deathblow',
    show: (w) => w.enemies.some((e) => e.phase === 'broken'),
    done: (w) => has(w, 'deathblow'),
  },
  {
    id: 'rage',
    text: 'RAGE is full — press R to transform',
    show: (w, cfg) => w.player.rage >= cfg.rage.max && w.player.rageForm === 0,
    done: (w) => has(w, 'rageStart'),
  },
  {
    id: 'rageForm',
    text: 'In Rage: LMB claws · RMB hellfire roar · kills feed the flame',
    show: (w) => w.player.rageForm > 0,
    done: (w) => has(w, 'roar'),
  },
  {
    id: 'vial',
    text: 'A red glint in the rim — slash it 3 times',
    show: (w) => w.pickups.some((q) => q.kind === 'crack' && !q.open && Math.hypot(q.at.x - w.player.pos.x, q.at.y - w.player.pos.y) < 70),
    done: (w) => has(w, 'crackBroken'),
  },
  {
    id: 'parry',
    text: 'RMB just as it flashes white — Deflect   (hold RMB to block)',
    show: (w) => w.enemies.some((e) => e.phase === 'windup' && dist(w, e.pos.x, e.pos.y) < 90),
    done: (w) => has(w, 'deflect'),
  },
  { id: 'slash', text: 'LMB — slash (click again to chain 3)', show: (w) => alive(w).length > 0, done: (w) => has(w, 'hit') },
  {
    id: 'font',
    text: 'Kneel at the font to heal',
    show: (w) => !!w.room.font && !w.roomRun.fontUsed,
    done: (w) => has(w, 'restHeal'),
  },
  {
    id: 'door',
    text: 'The gates are open — walk into one. The icon shows what lies beyond.',
    show: (w) => w.roomRun.cleared && w.roomRun.exitCount > 0,
    done: (w) => w.roomRun.exit !== null,
  },
  {
    id: 'posture',
    text: 'Deflects and hits fill the gold posture bar — fill it to break them',
    show: (w, cfg) => w.enemies.some((e) => !cfg.enemies[e.type]?.noPosture && e.phase !== 'down' && e.posture > cfg.enemies[e.type]!.posture.max * 0.35),
    done: (w) => has(w, 'postureBreak'),
  },
  {
    id: 'lock',
    text: 'Q — lock on to one enemy (tap again to switch)',
    show: (w, cfg) => alive(w).filter((e) => !cfg.enemies[e.type]?.swarm).length >= 2,
    done: (w) => has(w, 'lockOn'),
  },
  {
    id: 'throw',
    text: 'E — throw a hellfire bolt (pips refill as your slashes land)',
    show: (w) => alive(w).some((e) => e.type === 'archer' && dist(w, e.pos.x, e.pos.y) > 70),
    done: (w) => has(w, 'throw'),
  },
  { id: 'dash', text: 'Space — dash (you pass through attacks mid-dash)', show: () => true, done: (w) => has(w, 'dash') },
];

export class Tutorial {
  private doneIds: Set<string>;
  private current: Step | null = null;
  private shownFor = 0;
  enabled = true;

  constructor(private el: HTMLElement) {
    this.doneIds = new Set(load());
  }

  reset(): void {
    this.doneIds.clear();
    save([]);
  }

  get finished(): boolean {
    return STEPS.every((s) => this.doneIds.has(s.id));
  }

  /** Call once per rendered frame BEFORE the frame's events are cleared. */
  observe(w: World, cfg: SimConfig): void {
    if (!this.enabled || w.player.dead) {
      this.hide();
      return;
    }
    let changed = false;
    for (const s of STEPS) {
      if (!this.doneIds.has(s.id) && s.done(w)) {
        this.doneIds.add(s.id);
        changed = true;
      }
    }
    if (changed) save([...this.doneIds]);

    if (this.current && (this.doneIds.has(this.current.id) || (!this.current.show(w, cfg) && this.shownFor >= MIN_SHOW_FRAMES))) this.current = null;
    // A more urgent prompt (earlier in the list) can take over.
    const want = STEPS.find((s) => !this.doneIds.has(s.id) && s.show(w, cfg)) ?? null;
    if (want && want !== this.current && (!this.current || STEPS.indexOf(want) < STEPS.indexOf(this.current))) {
      this.current = want;
      this.shownFor = 0;
    }
    if (!this.current) {
      this.hide();
      return;
    }
    this.shownFor++;
    if (this.el.textContent !== this.current.text) this.el.textContent = this.current.text;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode: prompts just reappear next time */
  }
}
