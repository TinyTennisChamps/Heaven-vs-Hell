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
- M4: throw, Archer, tokens.
- M5: Level 1 flow.
- M6: Rage and vials.
- M7: Gabriel.
- M8: Level 2, Ophan, Virtue and Raphael.
- M9: polish, then an independent bug-hunt agent.
