/**
 * Named input actions. Gameplay code only ever sees these, never raw keys,
 * so rebinding and gamepad support can be added later in one place.
 */
export const BUTTON_ACTIONS = ['slash', 'throw', 'parry', 'dash', 'rage'] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

/** One sim tick's worth of input. Plain data, safe to record for replays. */
export interface InputFrame {
  /** Screen-aligned move intent, each axis in [-1, 1], NOT yet normalised. */
  move: { x: number; y: number };
  /** Cursor in internal render pixels (0..427, 0..240). */
  aimScreen: { x: number; y: number };
  /** Optional ground-space aim target; overrides aimScreen (tests, replays, future gamepad). */
  aimGround?: { x: number; y: number };
  /** Buttons pressed (edge) since the previous sim tick. */
  pressed: ButtonAction[];
  /** Buttons currently held. */
  held: Record<ButtonAction, boolean>;
}

export function emptyHeld(): Record<ButtonAction, boolean> {
  return { slash: false, throw: false, parry: false, dash: false, rage: false };
}

export function emptyInputFrame(): InputFrame {
  return { move: { x: 0, y: 0 }, aimScreen: { x: 0, y: 0 }, pressed: [], held: emptyHeld() };
}
