// The dual-thumbstick teleop maths: where a stick may go, how far it must go
// before it commands anything, which keys deflect it, and how a deflection in
// screen space becomes a velocity in the robot's body frame.
//
// Pure and React-free so vitest can hold it to its rules. This is the one
// place in the console where an arithmetic slip turns into the robot moving
// the wrong way, which is a poor thing to leave covered only by a hand on a
// stick. useJoystick owns the refs, the frame loop and the listeners.

import type { TeleopVector } from "@/lib/types/robot";

/** A stick deflection in screen space: x grows right, y grows DOWN. */
export interface StickValue {
  x: number;
  y: number;
}

export type StickId = "left" | "right";

/**
 * Radial deadzone as a fraction of full travel. Exported so the Thumbstick can
 * draw the ring at the same radius the math uses — a ring that only decorates
 * would drift from the truth the first time this constant moves.
 */
export const DEADZONE = 0.12;

/**
 * Physical key codes, not `event.key`: ZQSD on an AZERTY board should drive by
 * position, the way every game does it. Left (translation) stick is W/S/Q/E,
 * right (rotation) stick is A/D — screen-space signs, so "left" is negative x
 * and "up" is negative y.
 *
 * A/D rotate and Q/E strafe, not the other way round: A/D under the resting
 * fingers is the turn in every driving game, and strafing is the rarer command
 * on a chassis that mostly drives where it is pointed. The earlier binding had
 * them swapped, which read as sideways drift every time an operator tried to
 * turn.
 */
export const KEY_AXES: Readonly<
  Record<string, { stick: StickId; axis: "x" | "y"; sign: 1 | -1 }>
> = {
  KeyW: { stick: "left", axis: "y", sign: -1 },
  KeyS: { stick: "left", axis: "y", sign: 1 },
  KeyQ: { stick: "left", axis: "x", sign: -1 },
  KeyE: { stick: "left", axis: "x", sign: 1 },
  KeyA: { stick: "right", axis: "x", sign: -1 },
  KeyD: { stick: "right", axis: "x", sign: 1 },
};

/** Whether a physical key drives a stick at all. */
export function isStickKey(code: string): boolean {
  return Object.hasOwn(KEY_AXES, code);
}

/**
 * The left stick's reachable set is a disc, so the clamp is radial — clamping
 * x and y separately would let a diagonal command √2 times the straight-line
 * maximum. The right stick is one-dimensional by design (it commands wz only),
 * so its y is discarded rather than clamped.
 */
export function clampStick(stick: StickId, raw: StickValue): StickValue {
  if (stick === "right") {
    return { x: Math.min(1, Math.max(-1, raw.x)), y: 0 };
  }
  const m = Math.hypot(raw.x, raw.y);
  return m > 1 ? { x: raw.x / m, y: raw.y / m } : { x: raw.x, y: raw.y };
}

/**
 * The drive view's translation stick drives one axis at a time: forward /
 * back or strafe, whichever the thumb is further along, and the other is
 * dropped. A thumb on glass has no detent to find straight ahead by, so an
 * unlocked stick turned every intended "forward" into a slow crab. The drive
 * panel's stick keeps the full disc: a mouse has the precision, and the keys
 * already are the four directions.
 *
 * The kept axis is the projection, not the full deflection: the knob rides
 * the axis under the thumb like a rail, so pushing at 30° off straight ahead
 * is slower than pushing straight, and no sideways drag is a jump to full
 * speed. A tie goes to forward / back, the commoner command.
 */
export function lockToAxis(value: StickValue): StickValue {
  return Math.abs(value.x) > Math.abs(value.y)
    ? { x: value.x, y: 0 }
    : { x: 0, y: value.y };
}

/**
 * Radial deadzone with rescale, so the command is continuous from zero: a plain
 * cutoff would make the smallest possible command DEADZONE-sized, which on a
 * real robot is a visible lurch the moment the stick leaves the ring.
 */
export function applyDeadzone(value: StickValue): StickValue {
  const m = Math.hypot(value.x, value.y);
  if (m < DEADZONE) return { x: 0, y: 0 };
  const scale = (m - DEADZONE) / (1 - DEADZONE) / m;
  return { x: value.x * scale, y: value.y * scale };
}

/**
 * One stick's clamped, pre-deadzone position and whether anything is holding
 * it — what the knob draws.
 *
 * Per-stick, pointer wins: while a stick's pointer is captured, that whole
 * stick is pointer-owned and its keys are ignored; otherwise the stick shows
 * the keyboard deflection, where opposing keys sum to zero. Keyboard
 * deflection is instant full-scale — a slew ramp was considered and left for
 * the sender, which is where acceleration limits belong.
 */
export function resolveStick(
  stick: StickId,
  pointer: StickValue | null,
  keys: ReadonlySet<string>,
): { value: StickValue; active: boolean } {
  if (pointer) return { value: clampStick(stick, pointer), active: true };
  let x = 0;
  let y = 0;
  for (const [code, key] of Object.entries(KEY_AXES)) {
    if (key.stick !== stick || !keys.has(code)) continue;
    if (key.axis === "x") x += key.sign;
    else y += key.sign;
  }
  return { value: clampStick(stick, { x, y }), active: x !== 0 || y !== 0 };
}

/** No command: what a released stick, a disarm and a blur all come back to. */
export const AT_REST_VECTOR: TeleopVector = { vx: 0, vy: 0, wz: 0 };

/**
 * The linear speed limit, as a fraction of full stick. Full stick is 1.0 on
 * the wire, which the backend publishes as-is, so this is the one place an
 * operator can ask for slow translation. That matters most from the keyboard,
 * whose deflection is always full.
 *
 * The floor is 10%, not 0%: a limit of zero would leave the translation stick
 * silently dead while the panel still looked armed. The default is full
 * speed, so the panel drives as it always has until an operator asks for
 * slower.
 */
export const LINEAR_SCALE_MIN = 0.1;
export const LINEAR_SCALE_MAX = 1;
export const LINEAR_SCALE_STEP = 0.1;
export const LINEAR_SCALE_DEFAULT = 1;

/** A linear scale held inside its range. A non-finite one is the default. */
export function clampLinearScale(value: number): number {
  if (!Number.isFinite(value)) return LINEAR_SCALE_DEFAULT;
  return Math.min(LINEAR_SCALE_MAX, Math.max(LINEAR_SCALE_MIN, value));
}

/**
 * The commanded velocity for two knob positions: deadzone applied, then screen
 * space turned into the body frame. Stick up (-y) is forward, stick left (-x)
 * is +vy (REP-103 y points left) and, on the right stick, +wz (CCW).
 *
 * `linearScale` limits translation only, vx and vy together, so a diagonal
 * keeps its direction as it slows. Rotation is not scaled. It is applied here
 * rather than in the sender, so the panel's readouts, `vectorRef` and the
 * wire frame all carry the same number: what the panel shows is what is sent.
 * It defaults to 1, which is exactly the unscaled command.
 */
export function commandFrom(
  left: StickValue,
  right: StickValue,
  linearScale = 1,
): TeleopVector {
  const dzLeft = applyDeadzone(left);
  const dzRight = applyDeadzone(right);
  const scale = clampLinearScale(linearScale);
  return { vx: -dzLeft.y * scale, vy: -dzLeft.x * scale, wz: -dzRight.x };
}
