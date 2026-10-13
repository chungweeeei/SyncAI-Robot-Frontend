// Thumbstick teleop maths: clamp, deadzone, key bindings, and the turn from
// screen space into the body frame. Pure so it is tested: a slip here moves
// the robot the wrong way. useJoystick owns the refs and listeners.

import type { TeleopVector } from "@/lib/types/robot";

/** A stick deflection in screen space: x grows right, y grows DOWN. */
export interface StickValue {
  x: number;
  y: number;
}

export type StickId = "left" | "right";

/** Fraction of full travel; the Thumbstick draws its ring from it. */
export const DEADZONE = 0.12;

/**
 * Physical key codes, not `event.key`, so AZERTY drives by position. Signs are
 * screen space ("left" is -x, "up" is -y).
 *
 * A/D rotate and Q/E strafe: A/D is the turn in every driving game, and
 * strafing is the rarer command.
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

export function isStickKey(code: string): boolean {
  return Object.hasOwn(KEY_AXES, code);
}

/**
 * Radial for the left stick, or a diagonal would command √2 × the maximum.
 * The right stick commands wz only, so its y is discarded.
 */
export function clampStick(stick: StickId, raw: StickValue): StickValue {
  if (stick === "right") {
    return { x: Math.min(1, Math.max(-1, raw.x)), y: 0 };
  }
  const m = Math.hypot(raw.x, raw.y);
  return m > 1 ? { x: raw.x / m, y: raw.y / m } : { x: raw.x, y: raw.y };
}

/**
 * The drive view's translation stick: one axis at a time, whichever the thumb
 * is further along. A thumb on glass has no detent for straight ahead, so a
 * free stick turned every "forward" into a crab. (The drive panel keeps the
 * full disc.)
 *
 * The kept axis is the projection, so a push 30° off is slower than straight,
 * never a jump to full speed. A tie goes to forward / back.
 */
export function lockToAxis(value: StickValue): StickValue {
  return Math.abs(value.x) > Math.abs(value.y)
    ? { x: value.x, y: 0 }
    : { x: 0, y: value.y };
}

/**
 * Radial deadzone with rescale, so the command is continuous from zero; a
 * plain cutoff lurches as the stick leaves the ring.
 */
export function applyDeadzone(value: StickValue): StickValue {
  const m = Math.hypot(value.x, value.y);
  if (m < DEADZONE) return { x: 0, y: 0 };
  const scale = (m - DEADZONE) / (1 - DEADZONE) / m;
  return { x: value.x * scale, y: value.y * scale };
}

/**
 * One stick's clamped, pre-deadzone position (what the knob draws). A captured
 * pointer owns the whole stick; otherwise keys deflect it, opposing keys
 * cancelling. Keys are instant full scale: acceleration limits belong to the
 * sender.
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

export const AT_REST_VECTOR: TeleopVector = { vx: 0, vy: 0, wz: 0 };

/**
 * Linear speed limit as a fraction of full stick: the only way to ask for
 * slow translation, which matters most from the always-full keyboard. The
 * floor is 10%: zero would leave the stick dead while the panel looks armed.
 */
export const LINEAR_SCALE_MIN = 0.1;
export const LINEAR_SCALE_MAX = 1;
export const LINEAR_SCALE_STEP = 0.1;
export const LINEAR_SCALE_DEFAULT = 1;

/** Non-finite is the default. */
export function clampLinearScale(value: number): number {
  if (!Number.isFinite(value)) return LINEAR_SCALE_DEFAULT;
  return Math.min(LINEAR_SCALE_MAX, Math.max(LINEAR_SCALE_MIN, value));
}

/**
 * The commanded velocity for two knob positions. Stick up (-y) is forward,
 * stick left (-x) is +vy (REP-103) and, on the right stick, +wz (CCW).
 *
 * `linearScale` scales vx and vy together (a diagonal keeps its direction),
 * not wz. Applied here rather than in the sender, so what the panel shows is
 * what is sent.
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
