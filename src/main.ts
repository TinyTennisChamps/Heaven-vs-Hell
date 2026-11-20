import { Container, Graphics } from 'pixi.js';
import { FixedLoop } from './core/loop';
import { lerp } from './core/math';
import { getData } from './data/store';
import { DebugOverlay } from './debug/overlay';
import { TuningPanel } from './debug/tuningPanel';
import { emptyInputFrame } from './input/actions';
import { KeyboardMouseInput } from './input/keyboardMouse';
import { HEAVEN, SATAN } from './render/palette';
import { createPixiApp, VIEW_H, VIEW_W } from './render/pixiApp';
import type { FeelTuning, PlayerTuning, SimConfig } from './sim/config';
import { step } from './sim/step';
import { createWorld } from './sim/world';

const cfg: SimConfig = {
  player: getData<PlayerTuning>('tuning/player'),
  feel: getData<FeelTuning>('tuning/feel'),
};

async function boot() {
  const root = document.getElementById('app')!;
  const app = await createPixiApp(root, HEAVEN.ivory2);
  const input = new KeyboardMouseInput(app.canvas, { w: VIEW_W, h: VIEW_H });
  const overlay = new DebugOverlay(root);
  const panel = new TuningPanel(root);

  const world = createWorld(1);
  world.player.pos = { x: VIEW_W / 2, y: VIEW_H / 2 };
  world.player.prevPos = { ...world.player.pos };

  // --- M0 placeholder scene: a marble grid and Satan as a red block. ---
  const stage = new Container();
  app.stage.addChild(stage);
  const grid = new Graphics();
  for (let x = 0; x <= VIEW_W; x += 16) grid.rect(x, 0, 1, VIEW_H);
  for (let y = 0; y <= VIEW_H; y += 16) grid.rect(0, y, VIEW_W, 1);
  grid.fill(HEAVEN.marble);
  stage.addChild(grid);
  const satan = new Graphics().rect(-5, -14, 10, 14).fill(SATAN.crimson).rect(-5, -16, 10, 3).fill(SATAN.cloak);
  stage.addChild(satan);
  const cursor = new Graphics().rect(-1, 0, 3, 1).rect(0, -1, 1, 3).fill(SATAN.cloak);
  stage.addChild(cursor);

  // --- Debug toggles ---
  const renderCaps = [0, 30, 60, 144];
  let capIdx = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') {
      e.preventDefault();
      const v = !overlay.visible;
      overlay.visible = v;
      panel.visible = v;
    } else if (e.code === 'F2') {
      e.preventDefault();
      capIdx = (capIdx + 1) % renderCaps.length;
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

    const p = world.player;
    satan.x = Math.round(lerp(p.prevPos.x, p.pos.x, alpha));
    satan.y = Math.round(lerp(p.prevPos.y, p.pos.y, alpha));
    cursor.x = Math.round(lastInput.aimScreen.x);
    cursor.y = Math.round(lastInput.aimScreen.y);
    app.render();

    overlay.frame(elapsed, steps);
    overlay.set('tick', world.tick);
    overlay.set('steps/frame', steps);
    overlay.set('alpha', alpha);
    overlay.set('render cap (F2)', cap ? `${cap} Hz` : 'display');
    overlay.set('pos', `${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}`);
    overlay.set('speed', Math.hypot(p.vel.x, p.vel.y));
    overlay.render();
  };
  requestAnimationFrame(frame);
}

boot();
