# Heaven vs Hell — conventions

Pixel-art action roguelike. TypeScript + Vite + PixiJS v8 (render only) with a custom 60 Hz fixed-step simulation. The design lives in GAME_DESIGN.md and the art direction in docs/visual-direction.pdf.

## Commands
Node comes from nvm and is not on the default PATH, so run `source ~/.nvm/nvm.sh && nvm use 22` first.
- `npm run dev`: the game at http://localhost:5173. It opens on the title screen. **Begin Descent** starts an L1 run, **Training Court** opens the spawn sandbox (keys 1–4 spawn, 6 Gabriel, 7 the Watcher, 0 clears, 5 fills Rage), and **Esc** returns to the title. **F1** toggles the debug overlay (hitboxes, states, frame counters) and the tuning panel. **F2** cycles the render-rate cap (display / 30 / 60 / 144). **F3** toggles enemy attacks. **F4** resets the Training Court. **F5** pauses the sim, **F6** steps one tick while paused, and **F7** toggles ¼-speed slow motion.
- In dev builds `window.__hvh` exposes `world`, `mode`, `run`, `begin()`, `training()`, `reenter()` and `toPage(gx, gy)` for scripted play-testing. Headless Chrome needs `--enable-gpu --use-angle=metal` to get WebGL on this Mac.
- `npm test`: Vitest (sim only). `npm run typecheck`, `npm run build`, and `npm run check` (typecheck + tests).

## Hard rules
1. **`src/sim/` is pure.** It must not import pixi.js, `src/render`, `src/debug`, `src/data/store` or the DOM. It must not use `performance.now`, `Date.now` or `Math.random`. Randomness goes through `src/core/rng.ts` with its state stored in the world. `tests/determinism.test.ts` enforces this.
2. **No frame-rate-dependent logic.** Gameplay runs only inside `step()` at a fixed 1/60 s. Durations are counted in ticks (frames), and speeds are px/s multiplied by `SIM_DT`.
3. **All tunables live in `/data/*.json`**, never as literals in code. The sim reads config objects every tick, because they are mutated in place on hot reload, so never cache a tuning value.
4. **Input goes through named actions** (`src/input/actions.ts`). Raw keys appear only in `src/input/keyboardMouse.ts`.
5. **Rendering:** the internal size is 427×240 with an integer scale and nearest-neighbour sampling. Simulation positions stay floats, and sprites are snapped with `Math.round` only at draw time, after interpolation.
6. **Palette:** the red family (`SATAN` in `src/render/palette.ts`) is only for Satan, his attacks, his HUD and his items. Judgement telegraphs use white-gold (`JUDGEMENT`), never red.
7. Content (enemies, bosses, rooms, levels) plugs in through registries. Don't add stubs for out-of-scope content (Seraph, Michael, L3, L4).

## Layout
- `src/core`: the loop, rng and math.
- `src/input`: actions, buffer, keyboard/mouse.
- `src/sim`: the world, step, actors, combat, physics and rooms. `rooms/roomRunner.ts` handles waves, gates and the font; `rooms/run.ts` is the seeded run planner.
- `src/render`: Pixi, the iso projection, sprites, the HUD and the title backdrop.
- `src/ui`: DOM screens (title, Fallen, cleared, room HUD, fade) and the tutorial prompts.
- `src/debug`: the overlay and tuning panel.
- `src/data/store.ts`: the live JSON store.
- `vite-plugin-tuning.ts`: pushes data/ edits live and handles panel saves (dev only).

## Workflow
Work milestone by milestone (see GAME_DESIGN.md §Milestones). Commit at the end of each one and stop for review. Ask before making big decisions: new mechanics, changing a confirmed control, adding dependencies, or reworking the architecture.
