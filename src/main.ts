import { FixedLoop } from './core/loop';
import { groundToScreen } from './core/iso';
import { getData } from './data/store';
import { DebugOverlay } from './debug/overlay';
import { TuningPanel } from './debug/tuningPanel';
import { emptyInputFrame } from './input/actions';
import { KeyboardMouseInput } from './input/keyboardMouse';
import { ANGEL, HEAVEN, SATAN } from './render/palette';
import { createPixiApp, VIEW_H, VIEW_W } from './render/pixiApp';
import { Scene } from './render/scene';
import { sfx } from './audio/sfx';
import { loadAtlas } from './render/atlas';
import type { AnimConfig } from './render/animSync';
import { attackDef, attackPhase } from './sim/actors/player';
import type { SimConfig, RoomDef } from './sim/config';
import { step } from './sim/step';
import { createWorld, spawnEnemyAt, type World } from './sim/world';
import { screenToGround } from './core/iso';

const cfg: SimConfig = {
  player: getData('tuning/player'),
  feel: getData('tuning/feel'),
  combat: getData('tuning/combat'),
  camera: getData('tuning/camera'),
  attacks: getData('attacks/satan'),
  enemies: { dummy: getData('enemies/dummy'), dominion: getData('enemies/dominion'), archer: getData('enemies/archer') },
};

async function boot() {
  const root = document.getElementById('app')!;
  const app = await createPixiApp(root, ANGEL.sky);
  const input = new KeyboardMouseInput(app.canvas, { w: VIEW_W, h: VIEW_H });
  const overlay = new DebugOverlay(root);
  const panel = new TuningPanel(root);

  const legend = document.createElement('div');
  legend.className = 'legend';
  root.appendChild(legend);
  const updateLegend = (w: World) => {
    legend.textContent = `WASD move · LMB slash · RMB parry (hold: block) · E throw · Space dash · Q lock · 1/2/3 spawn, 0 clear · F3 attacks ${w.flags.dummyAttacks ? 'ON' : 'OFF'} · F4 reset · F1 debug`;
  };

  // --- Spawn panel: test enemies one at a time (training room only) ---
  const SPAWNS: [string, string, string][] = [
    ['Digit1', 'dummy', 'Dummy'],
    ['Digit2', 'dominion', 'Dominion'],
    ['Digit3', 'archer', 'Archer'],
  ];
  const spawnPanel = document.createElement('div');
  spawnPanel.className = 'spawn-panel';
  root.appendChild(spawnPanel);
  const cursorGround = () => {
    const a = input.peekAim();
    const c = world.camera.pos;
    return screenToGround(c.x + a.x - VIEW_W / 2, c.y + a.y - VIEW_H / 2 + 10);
  };
  const spawn = (type: string) => spawnEnemyAt(world, cfg, type, cursorGround());
  const clear = () => {
    world.enemies = [];
    world.projectiles = [];
    world.player.lockId = null;
  };
  const title = document.createElement('div');
  title.textContent = 'Spawn at cursor';
  spawnPanel.appendChild(title);
  for (const [key, type, label] of SPAWNS) {
    const b = document.createElement('button');
    b.textContent = `${key.slice(-1)} ${label}`;
    b.addEventListener('click', () => {
      // Button clicks spawn in front of Satan (the cursor is on the button);
      // spawnEnemyAt validates the spot and falls back if it's off the arena.
      const p = world.player;
      spawnEnemyAt(world, cfg, type, { x: p.pos.x + p.facing.x * 50, y: p.pos.y + p.facing.y * 50 });
    });
    spawnPanel.appendChild(b);
  }
  const clr = document.createElement('button');
  clr.textContent = '0 Clear';
  clr.addEventListener('click', clear);
  spawnPanel.appendChild(clr);

  const room = getData<RoomDef>('rooms/training');
  const satanAtlas = await loadAtlas(`${import.meta.env.BASE_URL}sprites/satan.json`);
  const anim = getData<AnimConfig>('anim/satan');
  let world = createWorld(room, cfg, 1);
  world.flags.respawn = false; // training: spawned enemies stay dead
  let scene = new Scene(world, satanAtlas, anim);
  app.stage.addChild(scene.root);
  updateLegend(world);

  const reset = () => {
    const flags = world.flags;
    app.stage.removeChild(scene.root);
    scene.root.destroy({ children: true });
    world = createWorld(room, cfg, 1);
    world.flags = flags;
    world.flags.respawn = false;
    scene = new Scene(world, satanAtlas, anim);
    app.stage.addChild(scene.root);
  };

  // Dev-only hook for automated play-testing (headless browser scripts).
  if (import.meta.env.DEV) {
    (window as unknown as { __hvh: unknown }).__hvh = {
      get world() {
        return world;
      },
      /** Page (CSS px) coordinates of a ground point, for scripted mouse input. */
      toPage(gx: number, gy: number) {
        const s = groundToScreen(gx, gy);
        const c = world.camera.pos;
        const r = app.canvas.getBoundingClientRect();
        return [r.left + ((s.x - c.x + VIEW_W / 2) / VIEW_W) * r.width, r.top + ((s.y - 12 - c.y + VIEW_H / 2) / VIEW_H) * r.height];
      },
    };
  }

  // --- Debug toggles ---
  const renderCaps = [0, 30, 60, 144];
  let capIdx = 0;
  let debug = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') {
      e.preventDefault();
      debug = !debug;
      overlay.visible = debug;
      panel.visible = debug;
    } else if (e.code === 'F2') {
      e.preventDefault();
      capIdx = (capIdx + 1) % renderCaps.length;
    } else if (e.code === 'F3') {
      e.preventDefault();
      world.flags.dummyAttacks = !world.flags.dummyAttacks;
      updateLegend(world);
    } else if (e.code === 'F4') {
      e.preventDefault();
      reset();
    } else if (e.code === 'Digit0') {
      clear();
    } else {
      const sp = SPAWNS.find(([k]) => k === e.code);
      if (sp && !e.repeat) spawn(sp[1]);
    }
  });

  // --- Main loop ---
  const loop = new FixedLoop();
  let last = performance.now();
  let lastDrawn = last;
  let lastInput = emptyInputFrame();

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const cap = renderCaps[capIdx]!;
    if (cap > 0 && now - lastDrawn < 1000 / cap - 1) return; // simulate a slower display
    lastDrawn = now;

    const elapsed = (now - last) / 1000;
    last = now;
    const { steps, alpha } = loop.advance(elapsed);
    for (let i = 0; i < steps; i++) {
      // Edges go to the first tick only; held state/aim repeat for the rest.
      lastInput = i === 0 ? input.sample() : { ...lastInput, pressed: [] };
      step(world, lastInput, cfg);
    }
    const cursor = input.peekAim(); // render the cursor at its latest position without consuming presses

    spawnEffects(world, scene);
    scene.particles.update(Math.min(elapsed, 0.05));
    scene.particles.draw();
    scene.sparks.update(Math.min(elapsed, 0.05));
    scene.noPipsFlash = Math.max(0, scene.noPipsFlash - elapsed);
    scene.sparks.draw();
    scene.render(world, alpha, cursor, cfg, debug);
    app.render();

    overlay.frame(elapsed, steps);
    if (debug) {
      const p = world.player;
      let act = '—';
      if (p.action) {
        const d = attackDef(cfg, p.action.key);
        act = `${p.action.key} f${p.action.frame}/${d.startup + d.active + d.recovery} ${attackPhase(p.action, d)}`;
      }
      overlay.set('tick', world.tick);
      overlay.set('steps/frame', steps);
      overlay.set('render cap (F2)', cap ? `${cap} Hz` : 'display');
      overlay.set('hitstop', world.hitstop);
      overlay.set('player', `hp ${p.hp}  speed ${Math.hypot(p.vel.x, p.vel.y).toFixed(0)}`);
      overlay.set('action', act);
      overlay.set('dash', p.dash ? `f${p.dash.frame}/${cfg.player.dash.frames}` : p.dashEndLag ? `endlag ${p.dashEndLag}` : '—');
      overlay.set('combo timer', p.comboTimer);
      overlay.set('posture', `${p.posture.toFixed(1)} / ${cfg.player.posture.max}${p.broken ? `  BROKEN ${p.broken}` : ''}`);
      overlay.set('guard', p.parry ? `parry f${p.parry.frame}/${p.parry.window}${p.parry.deflected ? ' ✓' : ''}` : p.guarding ? 'block' : '—');
      overlay.set('anti-mash', p.parryPenalty);
      overlay.set('pips', `${p.pips} (+${p.pipProgress}/${cfg.player.throw.hitsPerPip})`);
      overlay.set('projectiles', world.projectiles.length);
      overlay.set('lock / focus', `${p.lockId ?? '—'} / ${world.focusId ?? '—'}`);
      overlay.set('buffer', world.buffer.snapshot());
      for (const e of world.enemies) overlay.set(`${e.type}#${e.id}`, `${e.phase}${e.attack ? `:${e.attack}` : ''} f${e.phaseFrame} hp ${e.hp} pos ${e.posture.toFixed(0)}`);
      overlay.set('hits landed/taken', `${world.stats.hitsLanded} / ${world.stats.hitsTaken}`);
      overlay.set('deflects (perfect) / deathblows', `${world.stats.deflects} (${world.stats.perfects}) / ${world.stats.deathblows}`);
    }
    overlay.render();
  };
  requestAnimationFrame(frame);
}

/** Turn sim events into particles and sound hooks. Red only for Satan's own effects. */
function spawnEffects(world: World, scene: Scene): void {
  const P = scene.particles;
  for (const ev of world.events) {
    const s = groundToScreen(ev.pos.x, ev.pos.y);
    sfx(ev.type);
    switch (ev.type) {
      case 'hit': {
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        if (ev.riposte) scene.sparks.spawn(s.x, s.y - 12, false, Math.atan2(d.y, d.x));
        P.burst(s.x, s.y - 12, { count: ev.strong ? 16 : 9, colors: [0xffffff, SATAN.ember, SATAN.hellfire, HEAVEN.gold1], speed: ev.strong ? 140 : 100, life: 0.28, dirX: d.x, dirY: d.y, spread: 1.6 });
        P.burst(s.x, s.y - 12, { count: 6, colors: [ANGEL.pearl, ANGEL.white], speed: 50, life: 0.35 });
        break;
      }
      case 'playerHit': {
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        P.burst(s.x, s.y - 14, { count: 12, colors: [SATAN.crimson, SATAN.blood, 0xffffff], speed: 110, life: 0.35, dirX: d.x, dirY: d.y, spread: 1.4 });
        break;
      }
      case 'deflect': {
        // PDF: parry flash is white core, gold ring, red rays. Perfect = bigger + screen flash.
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        scene.sparks.spawn(s.x, s.y - 14, ev.perfect, Math.atan2(d.y, d.x));
        P.burst(s.x, s.y - 14, { count: ev.perfect ? 18 : 8, colors: [HEAVEN.gold1, 0xffffff, SATAN.ember], speed: ev.perfect ? 160 : 90, life: 0.3, drag: 0.88 });
        if (ev.perfect) sfx('perfectDeflect');
        break;
      }
      case 'block':
        P.burst(s.x, s.y - 14, { count: 8, colors: [HEAVEN.gold2, ANGEL.silver], speed: 70, life: 0.2 });
        break;
      case 'shieldBlock': {
        const d = groundToScreen(-ev.dir.x, -ev.dir.y);
        P.burst(s.x, s.y - 14, { count: 10, colors: [HEAVEN.gold1, ANGEL.white, ANGEL.silver], speed: 90, life: 0.22, dirX: d.x, dirY: d.y, spread: 1.8 });
        break;
      }
      case 'postureBreak':
        P.burst(s.x, s.y - 18, { count: 22, colors: [0xffffff, HEAVEN.gold1, ANGEL.pearl], speed: 120, life: 0.4 });
        break;
      case 'playerBroken':
        P.burst(s.x, s.y - 18, { count: 18, colors: [SATAN.ember, SATAN.hellfire, 0xffffff], speed: 100, life: 0.4 });
        break;
      case 'deathblow': {
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        P.burst(s.x, s.y - 14, { count: 40, colors: [SATAN.hellfire, SATAN.crimson, SATAN.ember, 0xffffff], speed: 200, life: 0.6, dirX: d.x, dirY: d.y, spread: 2.2, drag: 0.9 });
        P.burst(s.x, s.y - 14, { count: 24, colors: [ANGEL.white, ANGEL.pearl, HEAVEN.gold2], speed: 90, life: 0.8 });
        break;
      }
      case 'dash':
        // A spammed dash (no i-frames) kicks up grey dust and no embers.
        if (ev.tired) P.burst(s.x, s.y, { count: 5, colors: [HEAVEN.stoneDark, ANGEL.silver2], speed: 25, life: 0.35, size: 1 });
        else P.burst(s.x, s.y, { count: 7, colors: [HEAVEN.marble, HEAVEN.stone, SATAN.ember], speed: 40, life: 0.3, size: 1 });
        break;
      case 'riposteOpen':
        P.burst(s.x, s.y - 4, { count: 10, colors: [SATAN.ember, SATAN.hellfire], speed: 60, life: 0.35 });
        break;
      case 'enemyDown':
        P.burst(s.x, s.y - 12, { count: 30, colors: [ANGEL.white, ANGEL.pearl, HEAVEN.gold2, ANGEL.lilac], speed: 120, life: 0.6 });
        break;
      case 'swing':
      case 'telegraph':
      case 'parryWhiff':
      case 'lockOn':
      case 'lockOff':
      case 'arrowLoosed':
      case 'pipGained':
        break;
      case 'throw': {
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        P.burst(s.x, s.y - 12, { count: 8, colors: [SATAN.ember, SATAN.hellfire, SATAN.eyeGlow], speed: 70, life: 0.2, dirX: d.x, dirY: d.y, spread: 1.2 });
        break;
      }
      case 'noPips':
        scene.noPipsFlash = 0.35;
        break;
      case 'projectileEnd':
        P.burst(s.x, s.y - 12, { count: 5, colors: ev.kind === 'arrow' && !ev.reflected ? [ANGEL.sky, 0xffffff] : [SATAN.ember, SATAN.hellfire], speed: 50, life: 0.2 });
        break;
      case 'reflect':
        P.burst(s.x, s.y - 12, { count: ev.perfect ? 12 : 6, colors: [SATAN.hellfire, SATAN.eyeGlow], speed: 90, life: 0.25 });
        break;
    }
  }
  world.events.length = 0;
}

boot();
