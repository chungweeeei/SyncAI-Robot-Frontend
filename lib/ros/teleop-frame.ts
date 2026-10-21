import type { TeleopVector } from "@/lib/types/robot";

/**
 * Wire codec for the teleop channel (`/api/v1/robot/teleop`). Pure, and free
 * of config.ts (process.env/window), so it runs under plain node.
 *
 * The wire carries [-1, 1] per axis, published as-is (full stick = 1.0 m/s /
 * 1.0 rad/s). A speed ceiling, if one returns, belongs in the backend.
 */

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * One command frame, clamped to [-1, 1] with NaN/±Infinity as 0. useJoystick
 * already guarantees the range; this is the last gate before the wire.
 */
export function encodeTeleopFrame(v: TeleopVector): string {
  return JSON.stringify({
    vx: clampAxis(v.vx),
    vy: clampAxis(v.vy),
    wz: clampAxis(v.wz),
  });
}

/**
 * The backend only speaks to refuse: `{"error": "<message>"}`. Anything else
 * answers null and is skipped, so an unexpected frame cannot kill the channel.
 */
export function parseTeleopError(data: string | ArrayBuffer | Blob): string | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Precomputed stop frame, sent best-effort on close (see teleop-channel). */
export const ZERO_FRAME = encodeTeleopFrame({ vx: 0, vy: 0, wz: 0 });

/** Whether a command, as encoded, moves nothing: NaN counts as rest. */
export function isAtRest(v: TeleopVector): boolean {
  return clampAxis(v.vx) === 0 && clampAxis(v.vy) === 0 && clampAxis(v.wz) === 0;
}

export interface TeleopTick {
  /** The frame to send this tick, or null to stay quiet. */
  frame: string | null;
  /** Whether the robot was last told to move; the next tick's `driving`. */
  driving: boolean;
}

/**
 * One send tick. Every frame the backend receives is a cmd_vel it publishes,
 * so an armed panel nobody is touching sends nothing: frames flow only while
 * an input deflects, every tick (the watchdog wants them), and the first tick
 * back at rest sends one zero to stop the robot, then the channel goes quiet.
 */
export function teleopTick(v: TeleopVector, driving: boolean): TeleopTick {
  if (!isAtRest(v)) return { frame: encodeTeleopFrame(v), driving: true };
  return { frame: driving ? ZERO_FRAME : null, driving: false };
}
