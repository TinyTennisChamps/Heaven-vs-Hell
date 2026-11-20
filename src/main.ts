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
import { loadAtlas } from './render/atlas';
import type { AnimConfig } from './render/animSync';
import { attackDef, attackPhase } from './sim/actors/player';
import type { SimConfig, RoomDef } from './sim/config';
import { step } from './sim/step';
import { createWorld, type World } from './sim/world';

const cfg: SimConfig = {
  player: getData('tuning/player'),
  feel: getData('tuning/feel'),
  combat: getData('tuning/combat'),
  camera: getData('tuning/camera'),
  attacks: getData('attacks/satan'),
  dummy: getData('enemies/dummy'),
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
    legend.textContent = `WASD move · Mouse aim · LMB slash (×3 combo) · Space dash · F3 dummy attacks: ${w.flags.dummyAttacks ? 'ON' : 'OFF'} · F4 reset · F1 debug`;
  };

  const room = getData<RoomDef>('rooms/training');
  const satanAtlas = await loadAtlas(`${import.meta.env.BASE_URL}sprites/satan.json`);
  const anim = getData<AnimConfig>('anim/satan');
  let world = createWorld(room, cfg, 1);
  let scene = new Scene(world, satanAtlas, anim);
  app.stage.addChild(scene.root);
  updateLegend(world);

  const reset = () => {
    const flags = world.flags;
    app.stage.removeChild(scene.root);
    scene.root.destroy({ children: true });
    world = createWorld(room, cfg, 1);
    world.flags = flags;
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
    scene.render(world, alpha, cursor, cfg, debug);
    app.render();

    overlay.frame(elapsed, steps);
    if (debug) {
      const p = world.player;
      let act = '—';
      if (p.action) {
        const d = attackDef(cfg, p.action.step);
        act = `slash${p.action.step} f${p.action.frame}/${d.startup + d.active + d.recovery} ${attackPhase(p.action, d)}`;
      }
      overlay.set('tick', world.tick);
      overlay.set('steps/frame', steps);
      overlay.set('render cap (F2)', cap ? `${cap} Hz` : 'display');
      overlay.set('hitstop', world.hitstop);
      overlay.set('player', `hp ${p.hp}  speed ${Math.hypot(p.vel.x, p.vel.y).toFixed(0)}`);
      overlay.set('action', act);
      overlay.set('dash', p.dash ? `f${p.dash.frame}/${cfg.player.dash.frames}` : p.dashEndLag ? `endlag ${p.dashEndLag}` : '—');
      overlay.set('combo timer', p.comboTimer);
      overlay.set('buffer', world.buffer.snapshot());
      for (const e of world.enemies) overlay.set(`dummy#${e.id}`, `${e.phase} f${e.phaseFrame} hp ${e.hp}`);
      overlay.set('hits landed/taken', `${world.stats.hitsLanded} / ${world.stats.hitsTaken}`);
    }
    overlay.render();
  };
  requestAnimationFrame(frame);
}

/** Turn sim events into particles. Red only for Satan's own effects. */
function spawnEffects(world: World, scene: Scene): void {
  for (const ev of world.events) {
    const s = groundToScreen(ev.pos.x, ev.pos.y);
    switch (ev.type) {
      case 'hit': {
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        scene.particles.burst(s.x, s.y - 12, { count: ev.strong ? 16 : 9, colors: [0xffffff, SATAN.ember, SATAN.hellfire, HEAVEN.gold1], speed: ev.strong ? 140 : 100, life: 0.28, dirX: d.x, dirY: d.y, spread: 1.6 });
        scene.particles.burst(s.x, s.y - 12, { count: 6, colors: [ANGEL.pearl, ANGEL.white], speed: 50, life: 0.35 });
        break;
      }
      case 'playerHit': {
        const d = groundToScreen(ev.dir.x, ev.dir.y);
        scene.particles.burst(s.x, s.y - 14, { count: 12, colors: [SATAN.crimson, SATAN.blood, 0xffffff], speed: 110, life: 0.35, dirX: d.x, dirY: d.y, spread: 1.4 });
        break;
      }
      case 'dash':
        scene.particles.burst(s.x, s.y, { count: 7, colors: [HEAVEN.marble, HEAVEN.stone], speed: 40, life: 0.3, size: 1 });
        break;
      case 'enemyDown':
        scene.particles.burst(s.x, s.y - 12, { count: 30, colors: [ANGEL.white, ANGEL.pearl, HEAVEN.gold2, ANGEL.lilac], speed: 120, life: 0.6 });
        break;
      case 'swing':
      case 'telegraph':
        break;
    }
  }
  world.events.length = 0;
}

boot();
