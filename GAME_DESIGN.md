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
- Judgement attacks are unblockable, telegraphed with a white-gold glyph, and undeflectable unless the attack sets `deflectable` (the Dominion's charge does).
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
- **Gate heal** (user request, after the M5 review): each gate you walk through heals 15% of max HP (`rooms.roomHealFrac`), shown as a gold burst on arrival. A 4-room run gets about +60 HP from gates, plus the font's 40%.
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

## The Dominion's charge can be parried (user request)
- The Judgement lunge now has `deflectable: true`.
- A timed RMB tap deflects it, and a perfect deflect staggers the Dominion for a riposte.
- Holding block still doesn't stop it, and it keeps its white-gold glyph. It's a "read it and tap" attack, and dashing through still works.
- Other Judgement attacks stay undeflectable unless they set the flag. This covers Gabriel's and Raphael's later.

## M6: Rage and Rage Vials
Decisions confirmed with the user on 2026-11-20:
- Hyper armour at half damage.
- RMB is a hellfire roar.
- A hard room's cage opens when the room is cleared.
- The hidden vial is opened by slashing a cracked rim 3 times.

**Rage meter** (`data/tuning/rage.json`):

| Source | Gain |
|---|---|
| Kill | +8 |
| Deathblow | +15 more (on top of the kill) |
| Perfect parry | +4 |
| Hit taken | +6 |

- The Vial of Wrath adds +5% to all gains.
- The meter is shown under the pips: ember while charging, pulsing with an "R" when full, white-gold burning down while in form.

**Transform:**
- Tap R with a full meter. It works out of anything except death, including hurt and posture-broken states.
- The transform is invulnerable for 20f plus a short hit-stop, while Satan swells and flashes.
- The form then lasts 600f (10 s). Each kill adds 60f and heals 5.
- The last 1.5 s flickers. When the form ends, the meter is empty.

**In the form:**
- **Size and speed:** Satan is drawn ×1.25 with a hellfire aura and embers. His collider is ×1.3 and he moves ×1.1 faster.
- **Claws:** LMB is the claw combo (`claw1`–`claw3` in `attacks/satan.json`, reusing the slash art). Claws are faster, wider and hit harder, with three raking streaks.
- **Roar (RMB):**
  - A 44 px burst with a 2 s cooldown.
  - 8 damage, enough to kill a cherub, plus 30 posture and a big knockback.
  - It ignores shields and burns enemy arrows in its radius.
- **Hyper armour:** hits deal 50% damage, never stagger or knock back, never add posture, and don't interrupt the claws.
- **Disabled:** parry, block and throw.
- **Deathblows** still work.

**Carry-over:**
- After a fall, the next run starts with `min(40, 0.5 × meter at the fall + 5 × falls in a row)`. Since 40 is below 100, you can never start a run able to transform.
- Clearing the level resets the streak and the carry.
- The title shows a "Rage carried over" panel, as in the PDF mock.
- Within a run, the meter goes through gates. A form still in progress when you leave is spent.

**Vials** (`data/vials.json`, 7 in all):
- They're per run. Each is flat and additive, with one vial per stat, so there's no stacking.
- A budget test keeps every stat at or below +20% of its base. For example, +1 deflect frame on an 18f window is about 5.6%, and +1 pip on 5 is 20%.
- `src/sim/stats.ts` is the only place the sim reads Satan's effective max HP, posture, pips, radius, regen and deflect window.

| Vial | Level | Where | Effect | Status |
|---|---|---|---|---|
| Vial of the Unbowed | L1 | Hidden | +5% max posture | Placed |
| Vial of Wrath | L1 | Locked | +5% Rage gain | Placed |
| Herald's Ichor | L1 | Gabriel drop | +4% slash posture | M7 |
| Vial of the Keen Eye | L2 | Hidden | +1 deflect frame | M8 |
| Vial of Ash | L2 | Hidden | +5% max health | M8 |
| Vial of Embers | L2 | Locked | +1 throw pip | M8 |
| Healer's Gall | L2 | Raphael drop | +5% posture regen | M8 |

**Hidden vial:**
- Each run picks one combat room from the pool to hide it in (`run.hiddenRoom`), and that room shows a cracked rim with a red glint every 1.5 s.
- 3 slashes break it (`rooms.crackHits`), and the vial rolls inward.
- You may never visit the room, since you only see 4 of the 6 combat rooms. That's part of it being hidden.

**Locked vial:**
- Every hard room has a gold cage (`cage`) that opens on clear, until you've collected the vial this run.
- Walk over a vial to take it. You get a toast with its name and effect, and a flask icon on the HUD.

**Training:** key 5, or the "Fill Rage" button, fills the meter.

## M7: Gabriel, the Herald, plus difficulty scaling
Decisions confirmed with the user on 2026-11-20, after "the game is too easy; later enemies need more posture, health and damage":
- Scaling is per level, plus a ramp within each run.
- Gabriel's moveset is as planned, and his charge can be parried.
- He has two deathblow segments.
- Dying to him means a full restart.

**Scaling** (`levels/l*.json`):
- `scaling {health, posture, damage}` sets each level's multipliers. L1 is ×1, so it stays the easier layer. L2 will set its own in M8.
- `rampPerRoom` (0.06) makes each combat room cleared earlier in the run make the next one 6% tougher in all three stats. The 4th room is ×1.18.
- Each enemy carries its own `maxHp`, `postureMax` and `dmgMul`, which also scales its arrows.
- Bosses ignore scaling and are hand-tuned.

**Run shape:** opener → combat rooms → rest → **The Herald's Court** (boss, horn icon on the gate) → level cleared.
- The boss arena is 320×320 with 4 pillars.
- When Gabriel falls, his summoned cherubs fall with him, the arena clears, and **Herald's Ichor** (+4% slash posture damage) drops where he fell.

**Gabriel** (`data/enemies/gabriel.json`, `src/sim/actors/gabriel.ts`): 360 HP per segment, 2 segments, 320 posture regenerating at 24/s.

| Move | What it does |
|---|---|
| Triple Thrust | 3 deflectable hits. The third has a 14–36f windup (`windupJitter`) to catch mashers. |
| Trumpet Blast | A wide cone that can be blocked or deflected, with heavy posture damage. |
| Horn Call | A 70f windup that summons 4 cherubs (at most 6 alive). Hitting him during the windup cancels it (`interruptible`): he staggers and takes double posture damage, with no riposte bonus. His first horn comes after 5 s (`specialDelay`), then every 20 s. |
| Herald's Charge | A Judgement lunge of 110 px. Holding block won't stop it, but a timed parry or a dash will. |

- **Between segments:** losing segment 1 puts him into a 100f rally. He's untouchable, wrapped in a white-gold light column, and comes back at full health in phase 2.
- **Phase 2:**
  - The thrust becomes a 5-hit string, with a jittered 4th hit.
  - Horn calls come every 12 s, with 5 cherubs and at most 7 alive.
  - **Annunciation:** a Judgement ring of radius 62 all around him. It can't be parried, so you dash out of or through it.

**Boss bar:** at the top of the screen, showing his name, a segment counter (◆◇), health, and a centre-fill posture bar.

**Benchmark** (`tests/boss.test.ts`): the decent-player bot beats him in about 15 s for **86 damage on average** (best case 20, worst 136, so it sometimes dies). Its timing is near-perfect, so humans will take longer and get hit more.

With the ramp, a hard room taken as your 3rd room costs the bot about 60 HP (balustrade).

## Rage nerf (user request after M7: "way too strong")

| Setting | Before | After |
|---|---|---|
| Duration | 600f | 300f (5 s) |
| Kill extend | 60f | 30f |
| Kill heal | 5 | 2 |
| Damage taken in form | ×0.5 | ×0.75 |
| Move speed bonus | ×1.1 | none |
| Claws 1–2 | 16 dmg / 14 posture / 32 px / 150° | 12 / 10 / 28 px / 130° |
| Claw 3 | 28 / 28 / 38 px / 220° | 20 / 18 / 32 px / 180° |
| Roar cooldown | 120f | 210f |
| Roar posture | 30 | 18 |
| Roar knockback | 280 | 220 |

- The roar still deals 8 damage, so it still kills cherubs.
- Gabriel can now be spawned in the Training Court (key 6), with his boss bar.

## Gabriel: three new attacks, tougher, plus Rage −20% (user request)
**New attacks:**
- **Leap** (`leap`):
  - A 24f crouch, then a 30f flight on an arc. He's untouchable in the air (blows glance off), and a lilac ring marks the landing spot.
  - He homes on Satan for the first third of the flight, then locks. Walking out of the ring after that is enough, and so is dashing, blocking or deflecting the slam.
  - The slam has a 22 px radius, does 22 damage and 40 posture.
- **Light Lances** (`beam1`–`beam3`):
  - He raises a hand, an orb gathers, and he fires three fast gold beams (330 px/s), each re-aimed at you.
  - Each can be blocked, and a deflect sends it back into him.
- **Blade of Light** (`blade1`–`blade5`; `p2blade1`–`p2blade7` in phase 2):
  - A long string with a sword of light, alternating high and low swings, with a small lunge each hit.
  - It's `relentless`: a perfect deflect doesn't stagger him or open a riposte, and the string keeps coming. Block or deflect every hit.
  - Perfect deflects still build his posture.

**AI:**
- At range he picks between the leap, the charge and the lances.
- Up close he picks between the blade string, the trumpet and the thrusts.

**Stats:** health 360 → **480** per segment, posture 320 → **420**.

**Benchmark bot made more human:** its deflect timing now spreads ±6f, so about half are perfect.
- Gabriel now costs it **123 HP on average** (best case 32), taking about 23 s. Without Rage, a decent player usually loses.
- L1 rooms got a little harder for it, so the Balustrade's opening wave drops to two archers.
- The guard rails are now under 40% of max HP for combat rooms and under 75% for hard ones.

**Rage −20%:**
- Duration is 4 s (240f) and kill extends are 24f.
- In form you take 80% damage.
- Claws do 10/10/16 damage and 8/8/14 posture.
- Roar: 6 damage, 14 posture, a 35 px radius, a 4.2 s cooldown and 176 knockback. It no longer one-shots a cherub; a cherub survives it on 2 HP.

## Rage meter fills half as fast (user request)
- Every gain is halved: kill +4, deathblow +7.5 more, perfect parry +2, hit taken +3.
- Filling the meter from empty takes about twice the fighting it used to.
- Carry-over is unchanged: at most 40 starts a run.

## Watcher ("Grigori") and shared enemy systems (user prompts; plan approved 2026-11-20)
Decisions:
- Parrying is now **one press = one deflect**, everywhere.
- The laser telegraph is a **red iris**, as requested.
- The new enemies are **Training Court only** for now.
- I **stop for review after each enemy**.

**One press = one deflect:**
- After a successful deflect, that parry is spent: it stays up for the rest of its window, so timing and animation are unchanged, but it can't deflect a second hit.
- Pressing again is never penalised.
- Multi-hit strings (Gabriel's blades and lances, the Zealot's Flurry) now need a press per hit.
- The balance benchmark is unchanged at 2.02×.

**New shared, data-driven systems** (later enemies can use them):
- `superArmor`: hits land but cause no knockback or flinch.
- `flinchFrames` / `flinchImmuneFrames`: a short hit-reaction that can't stun-lock.
- `preStep`: sidesteps, backsteps and pull-backs during the windup.
- `noHit` movement moves.
- `onDeflect {posture, perfectPosture, recoilFrames}`: any deflect can stagger.
- `volley`, `cooldownAfter`.
- `rangedPool`: these shots don't stop melee enemies attacking, and only one ranged telegraph is allowed in a room at once.
- `elite`: preferred as the focus.
- `flying`: flies over hedges and fountains but not pillars (`world.tallSegs`).
- `reflectPostureMul`, `knockbackMul`, `telegraphColor`, `displayName`, `height`, and an `ai` value bag.
- A `blockFail` event: holding guard against a Judgement gives a grey burst.
- `player.recentBlocks`.

**Debug and sound:**
- F5 pauses, F6 steps one tick, F7 runs at ¼ speed.
- The overlay shows each enemy's name, attack, frame/windup, health and posture against their maxes, and cooldowns.
- Sound hooks: `telegraph:<enemy>:<attack>` (e.g. `telegraph:watcher:laser` is the charge hum), plus `stagger`, `blockFail` and `flinch`.

**The Watcher** (`data/enemies/watcher.json`, `src/sim/actors/watcher.ts`, Training key 7): a floating eye with golden wings, a flyer.
- 100 HP (about 10 slashes; raised from 50 at the user's request) and **120 posture**, raised from 60 after "one parry destroys it".
- Light knockback, ×2 posture from bolts, ×1 from its own reflected lasers (30 normal, 55 perfect).
- The chomp parry gives +35 (perfect +55) and a 70f stagger. No single parry breaks it; it takes a parry plus a punish in the stagger, or several reflected lasers.
- It orbits Satan at 110–160 px and retreats fast inside 70 px.

| Attack | Windup | Active | Recovery | Damage / posture | Notes |
|---|---|---|---|---|---|
| Laser volley (90–200 px) | 40. The aim tracks to f26, then locks and the line turns white. | 3 lasers at f1, f11 and f21, 300 px/s, drawn white-gold with a pale-blue edge | 30 | 12 / 14 | Blockable. A deflect reflects the laser into the eye. Cooldown 150–210f. Ranged pool. |
| Chomp | 26: pulls back 8 px, then the eye splits into a toothed maw | 6: a 44 px lunge, the eye swells ×1.3 | 28 | 22 / 30 | Blockable. A deflect gives +45 posture (perfect +60, an instant break) and a 70f jaws-open stagger, which is a riposte window. A dash passes through. |

- **Chomp trigger:** Satan within 48 px for 20 ticks, or 2 melee hits taken.
- **Posture break:** the eye shuts and it drops to the ground ("grounded") for the deathblow.
- **Telegraph flash:** ranged windups no longer use the generic white flash; the red iris and the aim line locking are the tells. The chomp still flashes.

**Tests** (`tests/watcher.test.ts`, 13): volley count, aim lock-in, block, one press = one deflect, reflect posture, chomp parry → stagger → break → deathblow, perfect parry breaks it, dash through the lunge, block cost, both chomp triggers, a single ranged telegraph, lasers not stopping a Dominion, flight over a hedge but not a pillar, and the minimum telegraph rule.

## The Zealot ("Principality"), elite duellist (user prompt; plan approved 2026-11-20)
- **Data:** `data/enemies/zealot.json` and `src/sim/actors/zealot.ts`. Training key 8.
- **Stats:**
  - `elite`, so she takes the duel and other enemies hold back.
  - 60 HP (about 6 slashes; the prompt said 4, see the pushback in the plan), 70 posture recovering fast (delay 40, 30/s).
  - 190 px/s, circling at 52 px.
  - Flinch 8f with 40f immunity: only while circling or recovering, never mid-attack.
- **Every attack has super-armour:** a started attack is committed. Hits still deal damage and posture, but cause no knockback or flinch.
- The Flurry and Cross-step are also `relentless`: a parry, even a perfect one, doesn't end the string. Only a posture break does.

| Attack | Windups | Active | Recovery | Damage / posture | Notes |
|---|---|---|---|---|---|
| Flurry | 16 (glint), 8, 8, 10, 14 | 3 each | 3 between hits, 30 at the end | 8/10 per hit, 12/16 for the last | Each hit tracks until 3f before committing, with a 6 px lunge. Deflects give about +14, perfect +22, so 3–4 deflects break her. |
| Cross-step | 18, 12, 12 | 3 | 3, 3, 28 | 9 / 12 | An 18 px random-side sidestep (70°) before hits 2 and 3 |
| Thrust dash | 14 | 10, a 90 px lunge | 26 | 14 / 22 | Parryable and blockable; connects about 6f into the lunge |
| Sweep (Judgement) | 28, wings flared, white-gold crescent and glyph | 6: 240°, 62 px | 36 | 18 / 0 | Can't be blocked or parried (blocking gives the `blockFail` thud). Dash through it. 3–5 s cooldown. |
| Normal attacks: slash, double slash, backstep slash, sidestrike | 14–16 | 3 | 18–20 | 9 / 12 | — |
| Sidestep / wing-dash | 6 / 3 | – | – | – | Movement only: 14 px / 90 px with a feather burst |

**AI:**
- She circles at speed and never acts beyond 200 px.
- She wing-dashes in from beyond 110 px.
- At mid-range she uses the thrust.
- Close up she makes a weighted pick: flurry 3, cross 2, normal 3, sweep 1, with the sweep weight going up by 0.6 for each recent block, so a turtling player draws the Sweep.
- She throws in occasional sidesteps during cooldowns.

**Benchmark** (`tests/zealot.test.ts`, 16 tests):
- A parrier kills her in **3.5 s taking 0 damage**; a trader takes 3.8 s and **33 damage**.
- Before every attack got super-armour, trading won (3.4 s for 27 damage, against 6.7 s for 71). Slashing her cancelled her own attacks.

**Changed for everyone:**
- A deflect no longer knocks back a super-armoured attacker, so the next hit stays in reach.
- Flinch happens only while idle or recovering.

## Level 2 (The Gilded Nave) and the immersion systems: stop 1 of 2 (plan approved 2026-11-21)
Decisions:
- Build order: systems, then L2, then the L1 upgrade.
- **L2 roster:** Grigori, the Principality, the Dominion, the Archer and cherubs, all at L2 scaling (health ×1.4, posture ×1.3, damage ×1.3, plus the 6%-per-room ramp).
- **Gabriel returns** as a set-piece ambush, and **Raphael** is the boss.
- Two review stops.

**Identity: what's unique and what's shared**

| | L1 The Outer Gardens | L2 The Gilded Nave |
|---|---|---|
| Feel | Open floating platforms over clouds, high-key light | Enclosed cathedral, dim, coloured shafts, watched |
| Signature | (stop 2) platform edges, wind, turning statues | **Sanctified light** (×1.8 enemy posture regen) that shifts on **bells** |
| Cover | Hedges, fountains, pillars | **Columns** (tall: block flyers and line of sight; they fade when someone stands behind them), **pews** (low: flyers pass over), altars, the apse |
| Ambient | Petals, feathers, parallax clouds | Dust motes in the light, brazier smoke, a distant winged silhouette, vault and arch parallax |
| Edges | A gold lip over the clouds | Back walls with stained glass (blue, teal, lilac, gold; never red), pilasters, frieze eyes that track Satan, banners; front edges get a marble balustrade |

**Shared engine:**
- Biomes (`data/biomes/*.json`).
- `RoomArt`: floors, edges, walls by kind, props.
- `Lighting`: darkness over the floor and walls only, so gameplay is never darkened; stepped light holes; at most 16 lights; flashes on hits, parries, the roar, deathblows and room clears.
- `Parallax` (at most 4 layers), `Ambient` (at most 120 particles), `Grade` (tint and a stepped vignette, no filters).
- Title cards, the room-clear moment (24f at half speed, a flare and stings), door icons (combat, hard, **elite**, rest, **set-piece** bell, **secret** eye, boss, end).
- The music director (explore, combat and boss layers on the beat; ambience, reverb, footsteps, stings; all silent hooks).
- The descent arc: rooms get darker with each combat room cleared in a level.

**Rooms:**

| Room | Shape | Encounter | Notes |
|---|---|---|---|
| The Narthex | Opener | Cherubs → Archer and cherubs | — |
| The Long Aisle | Opener | Dominion → 2 Archers and cherubs | Colonnades |
| The Transept | Cross-shaped floor | Grigori ×2 → cherubs | Secret host |
| The Choir Stalls | Elite; pew lanes | Principality and Archer → Archer and cherubs | Cage |
| The Ambulatory | Elite; a ring around the apse | Dominion and cherubs → Principality and Grigori | Cage; rotating pools |
| The Clerestory | Two halls joined by an arcade | 2 Archers and a Dominion → cherubs | Secret host |
| The Shattered Rose | Elite set-piece | Grigori and cherubs → Principality and cherubs | When wave 2 arrives the window shatters: glass rains, the light turns cold blue, the shafts go out and the pools re-seed |
| The Herald's Return | Fixed set-piece after the 4th combat room | Gabriel | The bells fall silent and the hall darkens. Gabriel descends in phase two (one 560-HP bar, 440 posture); his choir joins at 75% (cherubs), 50% (Grigori) and 25% (Principality, room goes dark). His fall dismisses the choir. |
| The Quiet Chantry | Rest | — | — |
| The Ossuary | Secret, behind a cracked wall with a cold draught in the host room | — | Holds the Vial of Ash |
| The Sanctum of Raphael | Boss | Raphael | — |

**Run:** L1 → (after Gabriel) **L2 opener → 3 combat rooms → The Herald's Return → rest → Raphael** → victory. Health, vials and Rage carry over, and the title card announces each new layer.

**Raphael, the Healer-Knight** (`data/enemies/raphael.json`): two segments of 520 HP, 380 posture.

| Move | Details |
|---|---|
| Sweep | 180° |
| Cleave | Heavy; 40 posture, which a deflect turns on him |
| Mending Rite | A 90f kneeling channel with a teal ring. If it completes, posture −40% (and +10% HP in phase 2). A hit cancels it. |
| Serpent Staff | A Judgement lunge: dash it |
| Phase 2 | A double sweep, and **two Grigori summoned once** |

He drifts to sanctified pools between exchanges.

**Navigation (new, shared):** a flow field toward Satan (8 px grid, BFS every 10 ticks). Walkers whose straight line to Satan is blocked follow it round walls. Without it, enemies (and the test bot) could pin themselves against long walls.

**Benchmarks** (decent-player bot, average HP lost):

| | Level 1 | Level 2 |
|---|---|---|
| Combat rooms | 11–26 | 23–67 |
| Hard / elite rooms | 34–70 | 41–72 |
| Boss | Gabriel: 123 | Raphael: about 90–117 (varies with build) |

Every L2 room steps in under 1 ms per tick.

**Readability rules (tested):**
- Large-area biome colours keep their chroma below 0.3 (Satan's crimson is about 0.75).
- No red anywhere in a biome.
- Gameplay layers are never darkened or tinted by lighting.
- The **F8** panel toggles decoration, lighting, parallax, ambient life, hazards (pool routes), a **readability** view (decoration greyscale) and the HUD.
- In dev builds the title screen has a **room gallery**.

### How to author a biome
Create `data/biomes/<id>.json` with these fields:
- `palette`: large areas, low chroma.
- `accents`: trim, glass and flame; never red.
- `lighting`: darkness, Satan's light, flashes, grade, vignette, the descent darkening, and named `presets` for set-pieces.
- `parallax` kinds, plus `ambient` emitters with their own caps.
- `hazards.zones`: optional.
- `audio` ids.

Then point a level's `biome` at it. No engine code is needed unless you add a new parallax, ambient or prop *kind*.

### How to author a room
Create `data/rooms/<level>/<id>.json`:

| Field | What it is |
|---|---|
| `bounds` | Any polygon. Back edges get walls indoors; front edges get a lip or balustrade. |
| `walls` + `wallKinds` | pillar, column or apse (tall); hedge, fountain, pew or altar (low) |
| `playerSpawn`, `entry`, `exits` | Up to 2 exits, on edges |
| `waves` | Lists of `{type, at, count, spread}` |
| `props` | window (`wall` 'n' or 'w', `glass`), brazier, candelabra, eyes, banner |
| `zones` | `{anchors, radius, glass}` |
| `tier` | combat, hard, rest, boss, setpiece or secret |
| Optional | `elite`, `crack`, `cage`, `secret`, `vial`, `lighting`, `script` |

`script` steps fire once on `enter`, a `wave` index, a `timer` or `bossHpBelow`. They can switch `lighting`, `reseedZones`, `spawn`, `silence` the bells, or emit an `event` (used for render and audio).

`tests/l2.test.ts` checks every room automatically:
- spawns, doors, font, cages, cracks and the secret door are reachable by flood-fill;
- no pool sits on a spawn or doorway;
- props stay within budget.

## Rage Vials (original plan: 7, flat additive, every stat ≤ +20%)
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
- M6: Rage (transform, claws, roar, hyper armour, carry-over) and vials (hidden cracks, hard-room cages, budget). Done.
- M7: Gabriel (two segments, Horn Call, Triple Thrust, Trumpet, Charge, Annunciation) and difficulty scaling (per level plus a per-room ramp). Done.
- M8: Level 2 (the Gilded Nave), done as the immersion pass, stop 1: biome system, lighting, parallax, ambient life, sanctified light, 11 rooms, the Gabriel set-piece and Raphael. The Ophan and Virtue were dropped by the user.
- M9: polish, then an independent bug-hunt agent.
