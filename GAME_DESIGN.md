# Heaven vs Hell: Game Design Record

Satan is trapped in Heaven and cuts his way down through its layers to get home. Heaven is bright and ordered, and he is the only saturated thing in it. Combat is Sekiro-inspired: health plus posture, deflects, deathblows. **Feel is the feature.** When code simplicity and game feel conflict, game feel wins.

## Confirmed decisions
| Topic | Decision |
|---|---|
| Stack | TypeScript + Vite + PixiJS v8 (render only). Custom fixed-step sim. Vitest. |
| Camera | 3/4 view, Hades-like. The sim runs on a flat ground plane. Floors are drawn as 2:1 isometric diamonds (32×16 tiles, which are 16×16 ground squares). |
| Resolution | 427×240 internal, integer-scaled with letterboxing (×3 = 1281×720, which letterboxes by 1 px). |
| Scope | L1 Outer Gardens (4 of 6 combat rooms + rest room + Gabriel). L2 Gilded Nave (5 of 7 + rest room + Raphael). |
| Rest room | Heals 40% HP and refills throw pips. Natural home for a hidden vial. No enemies. |
| Vials | Per-run: reset on death. |
| Rage carry-over | `min(40, 0.5·meter + 5·deaths)`, so a run can never start able to transform. |
| Placeholder art | Shapes drawn in code in the PDF palettes, matching the PDF silhouettes. Swappable for Aseprite atlases. |

## Controls
| Input | Action |
|---|---|
| W A S D | Move, screen-aligned, with diagonals normalised |
| Mouse | Aim. The player and attacks face the cursor. |
| LMB | Slash, a 3-hit combo, fires on press. In Rage form, a claw combo. On a posture-broken enemy nearby, a deathblow. |
| E | Throw a hellfire projectile at the cursor (uses pips) |
| RMB press | Parry (deflect window) |
| RMB hold | Block (front 120° cone toward the cursor), moving at 0.5× speed |
| Space | Dash |
| Q | Lock-on. Tap to lock the nearest enemy, tap again to cycle (nearest first), hold to release. If the target dies, the lock jumps to the next nearest. |
| R (tap) | Rage transform when the meter is full. Buffered, with an invulnerable transform of about 20 frames. |

## Feel targets (starting values, which live in /data)
- Movement: 110 px/s, 6 frames to reach top speed, 4 frames to stop.
- Dash: 56 px over 12 frames with ease-out, i-frames on frames 2–9, and cancellable out of attack recovery.
- Input buffer: 8 frames. It freezes during hit-stop.
- Slash frame data (startup/active/recovery): 5/3/10, 4/3/10, 7/4/16. Lunge of 10–14 px, with the facing locked at the end of startup.
- Aim assist: a ±20° cone within 40 px, rotating the lunge by at most 15°.
- Hit-stop: 3 frames on a hit, 6 on a posture break, 12 plus 0.4× slow-motion for 20 frames on a deathblow.
- Deflect window: 9 frames (perfect = the first 4). Anti-mash: after a *missed* parry, a new attempt within 20 frames gets a 5-frame window. A successful deflect resets the penalty.
- Dash is not allowed out of hit-stun, but is allowed out of block-stun after 6 frames.
- Attack tokens: 2 for normal enemies, plus a separate cherub pool of 3.

## Combat
- Posture regeneration starts after 60 frames without a hit, at a rate of `regen · lerp(lowHealthMul, 1, hp/maxHp)`.
- Hit resolution order: i-frames, then judgement, then deflect, then block, then hit.
- Judgement attacks are unblockable and undeflectable, telegraphed with a white-gold glyph.
- Throw: 5 pips that refill from melee hits (1 per 3 hits) and perfect parries (+1). Blocked by Dominion shields from the front. Bonus posture damage against archers and ophans.
- Rage: gains are +8 per kill, +15 per deathblow, +4 per perfect parry and +6 when Satan takes a hit. The form lasts about 10 s, uses a claw combo, has a bigger collider, and gains health and time from kills. Parry and throw are disabled.

## Implemented in M3: posture fight
- **Parry:** tapping RMB opens a 9-frame deflect window. The first 4 frames are a perfect deflect, which costs Satan no posture and gives the attacker ×2.2 posture damage. A normal deflect gives Satan ×0.25 and the attacker ×1.4.
- **Anti-mash:** a parry that whiffs, or a re-press during a window that hasn't deflected anything, sets a 20-frame penalty. During it, the next parry window is only 5 frames. A successful deflect clears the penalty.
- **Block:** after the window, holding RMB guards a 120° cone toward the cursor at 0.5× movement speed. It costs no health but costs full posture, with 10 frames of block-stun. You can dash out of block-stun after 6 frames.
- **Posture break:**
  - Satan staggers for 75 frames, then his posture resets to 0.
  - Enemies are stunned for their `brokenFrames`, with a red diamond showing. If the deathblow window passes, they recover with half posture.
- **Deathblow (brought forward from M4):** left-click within 26 px of a broken enemy. It uses the slash3 art, kills instantly, and adds a 12-frame hit-stop plus 0.4× slow motion for 24 frames.
- **Judgement attacks:** a white-gold glyph and path are shown. They can't be blocked or deflected, so dash through or away.
- **Dominion:**
  - The tower shield absorbs frontal hits: no health damage, ×0.6 posture damage.
  - It turns slowly (5°/tick), so flanking works.
  - The shield is down during its attack recovery, which is the punish window.
  - It thrusts, and half the time follows with a quicker second thrust.
  - It shield-bashes up close, and counter-bashes after absorbing 3 hits.
  - It has an occasional Judgement lunge.

## Parry reward pass (after M3 playtest)
**The problem:** dash-and-slash beat parrying. Dashing was nearly free, and getting behind the Dominion was easy.

**The fixes the user chose:**
- **Riposte:** a perfect deflect staggers the attacker for 30 frames. During the stagger its shield is down, and Satan's hits deal ×2 health and ×3 posture. A normal deflect doesn't stagger.
- **Dash anti-spam:** a dash started within 18 frames of the previous one ending has no i-frames, and shows grey dust instead of embers. There's still no stamina bar.

**Measured** (`tests/balance.test.ts`: scripted bots, 10 seeds, against a Dominion): parrying kills **2.14×** faster than dash-and-slash, at the "Balanced" target. The test fails if the ratio drifts outside 1.6–2.8×.

**Still open:** the dash-and-slash bot takes almost no damage (about 3 HP), because the Dominion turns too slowly to punish flanking. The "enemies punish flanking" fix was offered but not chosen yet.

## Second playtest pass
- **Parry window widened** to 14 frames, with the first 7 perfect (it was 9 and 4). The user found perfects too hard to land.
- **Lock-on (full focus):** Satan faces the target, and slashes and guard go at it (the cursor is ignored for aiming). The camera frames Satan and the target. The marker is a hellfire dot with brackets.
- **Group fights:** the *focus* (the lock target, or the nearest enemy when unlocked) attacks freely. Every other enemy hangs back about 60 px away and circles. When its cooldown ends it has a 30% chance to get a turn, step in and attack. Then it falls back.
- **No overlap:** no two enemies ever have attacks in flight at once, and this is tested. The focus waits for an in-flight supporter swing, and a supporter waits for the focus.

## M4: throw and the Choir Archer
- **Throw (E):** tap for an instant hellfire bolt (5-frame startup) at your aim or lock target.
  - It costs 1 of 5 pips. Every 3 melee hits that land refill one, and a perfect parry refills one.
  - The Dominion's shield stops bolts from the front.
  - Archers take ×2 posture from bolts.
  - Walls and pillars stop bolts.
- **Choir Archer:**
  - Keeps about 95 px away, backing off and drifting sideways.
  - Its draw is telegraphed by an aim line.
  - Sometimes it follows with a quick second shot, and it bow-bashes when cornered.
- **Arrows:** they're pale light.
  - **Any deflect sends one back at its archer** (12 HP / 30 posture).
  - A perfect deflect sends it back faster and burning hellfire (18 HP / 55 posture).
  - Blocking stops an arrow, dashing passes through it, and pillars block it.
  - Guard auto-faces incoming arrows.
- **Groups:** an arrow in the air counts as an attack in flight, so no other attack starts until it lands.
- **Attack tokens:** the focus/hold-back system from the second playtest pass covers what tokens were for, so no separate token system was built.

**Balance re-measured honestly:** the earlier 2.14× came from 10 lucky seeds. Over 40 seeds the true ratio is about **1.7×**. The benchmark now uses 20 seeds and reads 1.91×. Riposte tuning plateaus at 1.75×: the parrier is limited by how *often* the Dominion attacks, and the aggressor takes about 0 damage by flanking.

## Third playtest pass: parrying felt impossible against the Dominion
**Why:** the white "now!" flash began only 10 frames (0.17 s) before the hit, which is less than human reaction time (about 0.2 s). Block also only came on *after* the parry window ended, and holding block past the window counted as a whiffed parry.

**Fixes:**
- Parry window 18 frames, the first 9 perfect.
- Anti-mash: penalised window 8, penalty 14 frames, and holding into a block is never penalised.
- Block is live the instant RMB is held.
- The flash starts 18 frames before the hit (`combat.telegraph.flashLeadFrames`).
- Longer Dominion windups: thrust 28, thrust2 22, bash 22.
- A test checks that reacting to the flash with 12 frames of reaction time still deflects. In the real game, a scripted "human" reacting 0.2 s after the flash went 4/4 perfect.

**Flanking punish (the user chose this one):** the Dominion pivots at 12°/tick when Satan is outside its shield arc. After 10 ticks behind it within 30 px, it shield-spins: a 360° bash with a 16-frame windup that can be parried, on a 100-tick cooldown. Dominion cooldown is 25–50 ticks.

**Balance:** parrying is now **1.67×** faster (20 seeds), against the 2× target. The longer windups that make parrying easy cap how fast a parry player can kill. To revisit at polish (M9).

**Training spawns:** the court starts empty. Keys 1/2/3 or the panel buttons spawn a dummy, Dominion or Archer at the cursor, and 0 clears. Spawned enemies don't respawn.

## Dash cooldown (user request: no double dash)
- After a dash ends there's an 18-tick (0.3 s) cooldown before the next one. A press in the last 8 ticks of the cooldown is buffered and fires on the first ready tick. An ember flicker at Satan's feet shows the dash is back.
- This **replaces** the dash anti-spam rule. Chained dashes are now impossible, so the "lose i-frames" rule became redundant and was removed.
- **Balance:** parrying is now **1.99×** faster than dash-and-slash over 40 seeds, hitting the 2× target. The aggressor now takes damage (about 6 HP per fight, up from about 0).

## M5: Level 1 (The Outer Gardens)
Decisions confirmed with the user on 2026-11-20:
- Cherubs have their own pool, with up to 3 lunging at once regardless of focus.
- Two doors with icons.
- Tutorial prompts appear in the early rooms.
- Title → run → restart, with Training on the title screen.

**Cherub (swarmer).**
- A winged head with hollow eyes and a halo.
- It has 8 HP, so one slash or one bolt kills it, and it has no posture bar (`noPosture`).
- It circles Satan at `orbitRange` 42, each cherub at its own angle, then lunges: a 26f windup, 40 px over 8f, 6 damage.
- The lunge can be deflected and blocked.
- Swarmers skip the focus/hold-back rule. At most `combat.groups.swarmMax` (3) are in windup or active at once.
- Swarm attacks don't count as "busy" for Dominions and Archers, and the reverse holds too, so a cloud never stops the Dominion's turn.
- The unlocked focus is the nearest non-swarmer.

**Rooms** (`data/rooms/l1/*.json`):
- Each room has bounds, walls with `wallKinds` (pillar, hedge or fountain), waves, an entry gate and two exit gates.
- Each wave spawns when the field is clear, after `waveDelayFrames`.
- Enemies arrive over `arriveFrames`. They descend in a shaft of light, harmless and not thinking.
- When every wave is down, the exits unlock and a light beam rises from each open gate.
- Walking into an open gate leaves the room.
- Pool:

  | Room | Tier |
  |---|---|
  | Cloister of Blossoms | opener |
  | Hedgerow Walk | opener |
  | Fountain of Light | combat |
  | The Marble Cross | combat |
  | High Terrace | hard |
  | The Balustrade | hard |
  | The Still Font | rest |

  At the font, Satan heals 40% once and refills his pips.

**Run** (`src/sim/rooms/run.ts`, pure and seeded):
- The first room is an opener. A run is `combatRooms` (4) combat rooms with no repeats, plus the rest room, then the level end.
- After each room, two gates offer two different rooms. The icons are a sword (combat), crossed swords (hard), a chalice (rest) and a horn (the end, Gabriel).
- From `restFrom` (2) rooms on, one gate may be the rest room. If it was skipped, it's the only gate before the end.
- HP and pips carry over. Posture resets.
- Hard rooms have no extra reward yet. M6 puts the locked vial cages in them.

**Death:**
- At 0 HP Satan falls. Training sets `flags.immortal`, so he refills there instead.
- The Fallen screen appears after `deathFrames`, with "Descend again" (a new seed, so a new room order) or Title.
- Runs and falls are counted in localStorage for the title, and later for Rage carry-over.

**Level end (until M7):** a "Level cleared" screen, then back to the title.

**Tutorial** (`src/ui/tutorial.ts`):
- One prompt at a time: move, deathblow, deflect, slash, font, gates, posture, lock, throw, dash.
- Each prompt shows when it's relevant and retires once you've done it. This is remembered in localStorage.
- The title offers "Replay tutorial" once it's complete.

**Enemy unstick:** an enemy that walks head-on into a wall for more than 6 ticks steers sideways around it. Archers used to stall behind hedges.

**Difficulty check** (`tests/difficulty.test.ts`): a "decent player" bot plays every room. It deflects with ±3f human jitter, misses 1 in 5, blocks most arrows, and doesn't hack at a raised shield. Average damage per room:

| Room | Damage |
|---|---|
| Openers | 7–12 |
| Combat | 8–21 |
| Hard | 30–38 |

So a full run costs a decent player about 70 of 140 effective HP. The guard rails are under 35% of max HP for combat rooms and under 50% for hard ones.

## Rage Vials (7, flat additive, every stat ≤ +20%)
| L1 | L2 |
|---|---|
| Hidden: +5% max posture | Hidden: +1 deflect frame |
| Locked: +5% Rage gain | Hidden: +5% max health |
| Gabriel: +4% slash posture damage | Locked: +1 throw pip |
| | Raphael: +5% posture regen |

L2 enemies get ×1.35 health and ×1.25 posture (data in `levels/l2.json`).

## Enemies
Cherub (swarmer, L1/L2), Choir Archer (ranged, deflectable arrows, L1/L2), Dominion (shield, posture fight, L1/L2), Ophan (roller with radial bursts, centre-eye weak point, L2), Veiled Virtue (support that restores allies' posture, L2).

## Bosses (proposed in the plan)
- **Gabriel (L1):**
  - Horn Call: summons cherubs, interruptible.
  - Triple Thrust: with a varied delay.
  - Trumpet Blast: a cone.
  - Herald's Charge: Judgement.
  - Phase 2: a 5-hit thrust, more frequent horn calls, and Annunciation (a Judgement ring).
- **Raphael (L2):**
  - Wide Sweep.
  - Overhead Cleave.
  - Mending Rite: a 90-frame channel that restores posture, interrupted by hits.
  - Serpent Staff: Judgement.
  - Phase 2: a double sweep, the Rite also heals HP, and he summons 2 Virtues once.

## Milestones
- M0: scaffold, loop, input, debug overlay, tuning panel.
- M1: movement, collision, dash, camera.
- M2: slash combo and training room.
- M3: posture, parry, block, Dominion, and deathblow (pulled forward from M4).
- M4: throw, Archer, projectiles and deflectable arrows (tokens covered by the focus system). Done.
- M5: Level 1 flow: cherub, rooms, doors, rest, tutorial, title and death. Done.
- M6: Rage and vials.
- M7: Gabriel.
- M8: Level 2, Ophan, Virtue and Raphael.
- M9: polish, then an independent bug-hunt agent.
