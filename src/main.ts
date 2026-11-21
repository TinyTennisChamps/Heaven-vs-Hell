import { FixedLoop } from './core/loop';
import { groundToScreen, screenToGround } from './core/iso';
import { dataKeys, getData } from './data/store';
import { DebugOverlay } from './debug/overlay';
import { TuningPanel } from './debug/tuningPanel';
import { emptyInputFrame } from './input/actions';
import { KeyboardMouseInput } from './input/keyboardMouse';
import { ANGEL, HEAVEN, SATAN } from './render/palette';
import { createPixiApp, VIEW_H, VIEW_W } from './render/pixiApp';
import { Scene } from './render/scene';
import { TitleScene } from './render/titleScene';
import { sfx } from './audio/sfx';
import { loadAtlas } from './render/atlas';
import type { AnimConfig } from './render/animSync';
import { attackDef, attackPhase } from './sim/actors/player';
import type { LevelDef, RoomDef, SimConfig } from './sim/config';
import { carryThroughGate, rageCarryOver, roomPickups, roomScale, startRun, takeExit, type RunState } from './sim/rooms/run';
import { maxHp } from './sim/stats';
import { step } from './sim/step';
import { createWorld, spawnEnemyAt, type World } from './sim/world';
import { Screens } from './ui/screens';
import { Tutorial } from './ui/tutorial';

const cfg: SimConfig = {
  player: getData('tuning/player'),
  feel: getData('tuning/feel'),
  combat: getData('tuning/combat'),
  camera: getData('tuning/camera'),
  attacks: getData('attacks/satan'),
  enemies: { dummy: getData('enemies/dummy'), dominion: getData('enemies/dominion'), archer: getData('enemies/archer'), cherub: getData('enemies/cherub'), gabriel: getData('enemies/gabriel') },
  rooms: getData('tuning/rooms'),
  rage: getData('tuning/rage'),
  vials: getData('vials'),
};

/** Every room under data/rooms/, keyed by its id (e.g. "l1/cloister"). */
function loadRooms(): Record<string, RoomDef> {
  const out: Record<string, RoomDef> = {};
  for (const k of dataKeys()) if (k.startsWith('rooms/')) {
    const r = getData<RoomDef>(k);
    out[r.id] = r;
  }
  return out;
}

type Mode = 'title' | 'run' | 'training';

/** Persistent meta (localStorage): runs started and deaths, for the title and later Rage carry-over. */
const meta = {
  get(k: string): number {
    try {
      return Number(localStorage.getItem(`hvh.${k}`) ?? 0) || 0;
    } catch {
      return 0;
    }
  },
  bump(k: string): number {
    const v = meta.get(k) + 1;
    meta.set(k, v);
    return v;
  },
  set(k: string, v: number): void {
    try {
      localStorage.setItem(`hvh.${k}`, String(v));
    } catch {
      /* ignore */
    }
  },
};

async function boot() {
  const root = document.getElementById('app')!;
  const app = await createPixiApp(root, ANGEL.sky);
  const input = new KeyboardMouseInput(app.canvas, { w: VIEW_W, h: VIEW_H });
  const overlay = new DebugOverlay(root);
  const panel = new TuningPanel(root);
  const screens = new Screens(root);
  const tutorial = new Tutorial(screens.prompt);

  const rooms = loadRooms();
  const level = getData<LevelDef>('levels/l1');
  const satanAtlas = await loadAtlas(`${import.meta.env.BASE_URL}sprites/satan.json`);
  const anim = getData<AnimConfig>('anim/satan');
  const titleScene = new TitleScene(satanAtlas);

  let mode: Mode = 'title';
  let run: RunState | null = null;
  let world = createWorld(rooms['training']!, cfg, 1);
  let scene: Scene | null = null;
  /** Sim paused (menus, transitions, end screens). */
  let frozen = true;
  let endShown = false;
  /** The gate just taken healed Satan: show it as he arrives. */
  let healedOnEntry = false;

  const legend = document.createElement('div');
  legend.className = 'legend';
  root.appendChild(legend);
  const updateLegend = () => {
    const base = 'WASD move · LMB slash · RMB parry (hold: block) · E throw · Space dash · Q lock · R rage';
    legend.hidden = mode === 'title';
    legend.textContent =
      mode === 'training' ? `${base} · 1/2/3/4/6 spawn (6 = Gabriel), 0 clear, 5 fill rage · F3 attacks ${world.flags.dummyAttacks ? 'ON' : 'OFF'} · F4 reset · Esc title · F1 debug` : `${base} · Esc title`;
  };

  // --- Spawn panel (training only): test enemies one at a time ---
  const SPAWNS: [string, string, string][] = [
    ['Digit1', 'dummy', 'Dummy'],
    ['Digit2', 'dominion', 'Dominion'],
    ['Digit3', 'archer', 'Archer'],
    ['Digit4', 'cherub', 'Cherub'],
    ['Digit6', 'gabriel', 'Gabriel'],
  ];
  const fillRage = () => {
    world.player.rage = cfg.rage.max;
    world.events.push({ type: 'rageFull', pos: { ...world.player.pos } });
  };
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
  const spTitle = document.createElement('div');
  spTitle.textContent = 'Spawn at cursor';
  spawnPanel.appendChild(spTitle);
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
  const rg = document.createElement('button');
  rg.textContent = '5 Fill Rage';
  rg.addEventListener('click', fillRage);
  spawnPanel.appendChild(rg);

  // --- Modes ---
  const setScene = (s: Scene | null) => {
    app.stage.removeChildren();
    if (scene) scene.root.destroy({ children: true });
    scene = s;
    app.stage.addChild(s ? s.root : titleScene.root);
  };

  const showTitle = () => {
    mode = 'title';
    frozen = true;
    run = null;
    setScene(null);
    spawnPanel.hidden = true;
    screens.hud.hidden = true;
    tutorial.hide();
    screens.showTitle({ runs: meta.get('runs'), deaths: meta.get('deaths'), tutorialDone: tutorial.finished, rageCarried: meta.get('rageCarry'), rageMax: cfg.rage.max });
    updateLegend();
  };

  const enterRoom = () => {
    if (!run) return;
    const room = rooms[run.current]!;
    world = createWorld(room, cfg, run.roomSeed, run.carry, roomPickups(run, room, cfg), roomScale(run, level, room));
    world.flags.respawn = false;
    world.roomRun.exitCount = run.options.length;
    if (healedOnEntry) world.events.push({ type: 'restHeal', pos: { ...world.player.pos } });
    healedOnEntry = false;
    const s = new Scene(world, satanAtlas, anim);
    s.doorKinds = run.options.map((o) => o.kind);
    setScene(s);
    endShown = false;
    frozen = false;
    const total = level.combatRooms + 2; // + rest + boss
    if (room.tier === 'boss') {
      const boss = room.waves?.flat().map((s) => cfg.enemies[s.type]).find((d) => d?.boss);
      if (boss?.title) screens.toast(boss.title, 'The Herald of the Host bars the way down');
    }
    screens.setHud(level.name, room.name, run.visited.length, total);
  };

  const beginRun = () => {
    mode = 'run';
    meta.bump('runs');
    screens.hideAll();
    screens.hud.hidden = false;
    spawnPanel.hidden = true;
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    // Vials are per run; a little Rage carries over from recent falls (never enough to transform).
    run = startRun(level, rooms, seed, { hp: cfg.player.maxHealth, pips: cfg.player.throw.maxPips, rage: meta.get('rageCarry'), vials: [] });
    tutorial.enabled = true;
    screens.fade(() => enterRoom());
    updateLegend();
  };

  const beginTraining = () => {
    mode = 'training';
    screens.hideAll();
    screens.hud.hidden = true;
    spawnPanel.hidden = false;
    tutorial.enabled = false;
    tutorial.hide();
    const flags = world.flags;
    world = createWorld(rooms['training']!, cfg, 1);
    world.flags = { ...flags, respawn: false, immortal: true };
    setScene(new Scene(world, satanAtlas, anim));
    frozen = false;
    updateLegend();
  };

  /** Called every frame in run mode after stepping. */
  const runFlow = () => {
    if (!run || endShown) return;
    const p = world.player;
    if (world.roomRun.exit !== null) {
      frozen = true;
      endShown = true;
      const opt = takeExit(run, world.roomRun.exit, level, rooms, carryThroughGate(world, cfg));
      healedOnEntry = run.carry.hp > p.hp;
      if (run.finished || opt.kind === 'end') {
        // A cleared level resets the fall streak and the carried Rage.
        meta.set('fallStreak', 0);
        meta.set('rageCarry', 0);
        screens.showCleared(level.name, { rooms: run.visited.length, hp: p.hp, max: maxHp(world, cfg) });
      } else {
        screens.fade(() => enterRoom());
      }
      return;
    }
    if (p.dead && world.roomRun.deadTicks >= cfg.rooms.deathFrames) {
      endShown = true;
      frozen = true;
      meta.bump('deaths');
      const streak = meta.bump('fallStreak');
      meta.set('rageCarry', rageCarryOver(p.rage, streak, cfg));
      screens.showFallen({ room: world.room.name, roomNo: run.visited.length, kills: world.stats.kills });
    }
  };

  screens.onAction = (a) => {
    if (a === 'begin') beginRun();
    else if (a === 'training') beginTraining();
    else if (a === 'title') showTitle();
    else if (a === 'tutorial') {
      tutorial.reset();
      beginRun();
    }
  };

  // Dev-only hook for automated play-testing (headless browser scripts).
  if (import.meta.env.DEV) {
    (window as unknown as { __hvh: unknown }).__hvh = {
      get world() {
        return world;
      },
      get mode() {
        return mode;
      },
      get run() {
        return run;
      },
      begin: beginRun,
      /** Rebuild the current run room (e.g. after editing run.hiddenRoom in a script). */
      reenter: () => enterRoom(),
      training: beginTraining,
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
      updateLegend();
    } else if (e.code === 'Escape') {
      if (mode !== 'title') showTitle();
    } else if (mode === 'title') {
      if (e.code === 'Enter' || e.code === 'Space') beginRun();
    } else if (mode === 'training') {
      if (e.code === 'F4') {
        e.preventDefault();
        beginTraining();
      } else if (e.code === 'Digit0') clear();
      else if (e.code === 'Digit5') fillRage();
      else {
        const sp = SPAWNS.find(([k]) => k === e.code);
        if (sp && !e.repeat) spawn(sp[1]);
      }
    } else if (mode === 'run' && endShown && (e.code === 'Enter' || e.code === 'Space') && screens.anyOpen) {
      // Fallen: Enter starts again. Cleared: Enter returns to the title.
      if (screens.fallenOpen) beginRun();
      else showTitle();
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

    if (!scene) {
      titleScene.update(now / 1000);
      input.sample(); // drain presses so they don't fire on entering a room
      app.render();
      overlay.frame(elapsed, steps);
      overlay.render();
      return;
    }

    if (!frozen) {
      for (let i = 0; i < steps; i++) {
        // Edges go to the first tick only; held state/aim repeat for the rest.
        lastInput = i === 0 ? input.sample() : { ...lastInput, pressed: [] };
        step(world, lastInput, cfg);
      }
    } else input.sample();
    const cursor = input.peekAim(); // render the cursor at its latest position without consuming presses

    // Boss bar.
    const boss = mode !== 'title' ? world.enemies.find((e) => cfg.enemies[e.type]?.boss && e.phase !== 'down') : undefined;
    if (boss) {
      const d = cfg.enemies[boss.type]!;
      screens.setBoss({ title: d.title ?? boss.type, hp: boss.hp, maxHp: boss.maxHp, posture: boss.posture, postureMax: boss.postureMax, segments: boss.segments, segmentsMax: d.segments ?? 1, broken: boss.phase === 'broken' });
    } else screens.setBoss(null);

    if (mode === 'run') {
      if (frozen || endShown) tutorial.hide();
      else tutorial.observe(world, cfg);
      runFlow();
    }
    for (const ev of world.events) {
      if (ev.type === 'vialGained') {
        const v = cfg.vials.vials.find((x) => x.id === ev.vialId);
        if (v) screens.toast(`${v.name}`, v.text);
      }
    }
    spawnEffects(world, scene);
    scene.particles.update(Math.min(elapsed, 0.05));
    scene.particles.draw();
    scene.sparks.update(Math.min(elapsed, 0.05));
    scene.noPipsFlash = Math.max(0, scene.noPipsFlash - elapsed);
    scene.sparks.draw();
    scene.render(world, frozen ? 1 : alpha, cursor, cfg, debug);
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
      overlay.set('player', `hp ${p.hp}  speed ${Math.hypot(p.vel.x, p.vel.y).toFixed(0)}${p.dead ? '  DEAD' : ''}`);
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
      const rr = world.roomRun;
      overlay.set('room', `${world.room.id} wave ${rr.wave}/${world.room.waves?.length ?? 0} t${rr.timer}${rr.cleared ? ' CLEARED' : ''} exits ${rr.exitCount}`);
      if (run) overlay.set('run', `${run.visited.join(' > ')} | combat ${run.combatDone} rest ${run.restTaken ? 'y' : 'n'} | next ${run.options.map((o) => o.kind).join('/')}`);
      for (const e of world.enemies) overlay.set(`${e.type}#${e.id}`, `${e.phase}${e.attack ? `:${e.attack}` : ''} f${e.phaseFrame} hp ${e.hp} pos ${e.posture.toFixed(0)}`);
      overlay.set('hits landed/taken', `${world.stats.hitsLanded} / ${world.stats.hitsTaken}`);
      overlay.set('deflects (perfect) / deathblows', `${world.stats.deflects} (${world.stats.perfects}) / ${world.stats.deathblows}`);
    }
    overlay.render();
  };
  showTitle();
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
        P.burst(s.x, s.y, { count: 7, colors: [HEAVEN.marble, HEAVEN.stone, SATAN.ember], speed: 40, life: 0.3, size: 1 });
        break;
      case 'dashReady':
        // Tiny ember flicker at the feet: the dash is back.
        P.burst(s.x, s.y - 2, { count: 4, colors: [SATAN.ember, SATAN.hellfire], speed: 20, life: 0.18, size: 1 });
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
      case 'spawnIn':
        P.burst(s.x, s.y - 10, { count: ev.swarm ? 5 : 12, colors: [ANGEL.white, HEAVEN.gold1, ANGEL.pearl], speed: 50, life: 0.5 });
        break;
      case 'roomCleared':
        P.burst(s.x, s.y - 14, { count: 24, colors: [HEAVEN.gold1, HEAVEN.gold2, 0xffffff], speed: 90, life: 0.7 });
        break;
      case 'vialGained': {
        P.burst(s.x, s.y - 10, { count: 30, colors: [SATAN.hellfire, SATAN.ember, SATAN.eyeGlow, 0xffffff], speed: 90, life: 0.8 });
        break;
      }
      case 'crackHit':
        P.burst(s.x, s.y - 2, { count: 8, colors: [HEAVEN.stone, HEAVEN.gold3, SATAN.ember], speed: 60, life: 0.3 });
        break;
      case 'crackBroken':
        P.burst(s.x, s.y - 4, { count: 22, colors: [HEAVEN.stone, HEAVEN.marble, HEAVEN.gold2, SATAN.hellfire], speed: 100, life: 0.5 });
        break;
      case 'cageOpen':
        P.burst(s.x, s.y - 10, { count: 16, colors: [HEAVEN.gold1, HEAVEN.gold2], speed: 70, life: 0.5 });
        break;
      case 'rageFull':
        P.burst(s.x, s.y - 14, { count: 14, colors: [SATAN.hellfire, SATAN.ember], speed: 60, life: 0.5 });
        break;
      case 'rageStart':
        P.burst(s.x, s.y - 14, { count: 50, colors: [SATAN.hellfire, SATAN.crimson, SATAN.ember, SATAN.eyeGlow], speed: 160, life: 0.8, drag: 0.9 });
        scene.sparks.spawn(s.x, s.y - 16, true, 0);
        break;
      case 'rageEnd':
        P.burst(s.x, s.y - 14, { count: 18, colors: [SATAN.cloak2, SATAN.blood, SATAN.ember], speed: 60, life: 0.6 });
        break;
      case 'roar':
        scene.roarRing(ev.pos);
        P.burst(s.x, s.y - 10, { count: 36, colors: [SATAN.hellfire, SATAN.ember, SATAN.eyeGlow], speed: 200, life: 0.4, drag: 0.85 });
        break;
      case 'leapLand':
        P.burst(s.x, s.y - 2, { count: 26, colors: [HEAVEN.marble, HEAVEN.stone, HEAVEN.gold1, 0xffffff], speed: 120, life: 0.45 });
        break;
      case 'restHeal':
        P.burst(s.x, s.y - 12, { count: 30, colors: [HEAVEN.gold1, ANGEL.sky, 0xffffff], speed: 70, life: 0.9 });
        break;
      case 'playerDied':
        P.burst(s.x, s.y - 14, { count: 40, colors: [SATAN.crimson, SATAN.blood, SATAN.ember, SATAN.cloak], speed: 120, life: 0.9, drag: 0.9 });
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
