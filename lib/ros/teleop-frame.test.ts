import { describe, expect, it } from "vitest";

import {
  ZERO_FRAME,
  encodeTeleopFrame,
  isAtRest,
  parseTeleopError,
  teleopTick,
} from "@/lib/ros/teleop-frame";

/**
 * The last gate before a velocity reaches a real robot, and the first thing a
 * malformed frame from it meets. Both halves are written to fail closed: an
 * out-of-range axis is clamped rather than sent, and an unexpected inbound
 * frame is skipped rather than allowed to kill the channel.
 */
describe("encodeTeleopFrame", () => {
  const decode = (v: Parameters<typeof encodeTeleopFrame>[0]) =>
    JSON.parse(encodeTeleopFrame(v)) as { vx: number; vy: number; wz: number };

  it("passes an in-range command through unchanged", () => {
    expect(decode({ vx: 0.5, vy: -0.25, wz: 1 })).toEqual({
      vx: 0.5,
      vy: -0.25,
      wz: 1,
    });
  });

  it("clamps each axis to [-1, 1] independently", () => {
    expect(decode({ vx: 4, vy: -9, wz: 0.3 })).toEqual({
      vx: 1,
      vy: -1,
      wz: 0.3,
    });
  });

  it("collapses every non-finite axis to a stop, infinities included", () => {
    // A NaN is a command with no meaning; an infinity is treated the same, not
    // as full stick — "as fast as possible" is never what a broken input meant.
    expect(decode({ vx: NaN, vy: Infinity, wz: -Infinity })).toEqual({
      vx: 0,
      vy: 0,
      wz: 0,
    });
  });

  it("emits exactly the three axes the backend reads", () => {
    expect(Object.keys(decode({ vx: 0, vy: 0, wz: 0 })).sort()).toEqual([
      "vx",
      "vy",
      "wz",
    ]);
  });

  it("precomputes a stop frame that really is a stop", () => {
    expect(JSON.parse(ZERO_FRAME)).toEqual({ vx: 0, vy: 0, wz: 0 });
  });
});

describe("parseTeleopError", () => {
  it("reads the backend's refusal sentence", () => {
    expect(parseTeleopError('{"error":"teleop refused: task running"}')).toBe(
      "teleop refused: task running",
    );
  });

  it("skips a frame that is not a refusal", () => {
    for (const frame of [
      '{"ok":true}',
      "{}",
      '{"error":42}',
      '{"error":null}',
      "null",
      "[]",
      "not json at all",
      "",
    ]) {
      expect(parseTeleopError(frame)).toBeNull();
    }
  });

  it("skips a binary frame instead of throwing", () => {
    expect(parseTeleopError(new ArrayBuffer(8))).toBeNull();
  });
});

/**
 * Every frame is a cmd_vel the backend publishes, so an armed panel nobody
 * touches must put nothing on the wire — and a release must still say stop.
 */
describe("teleopTick", () => {
  const REST = { vx: 0, vy: 0, wz: 0 };
  const FORWARD = { vx: 0.5, vy: 0, wz: 0 };

  it("stays quiet at rest when nothing was moving", () => {
    expect(teleopTick(REST, false)).toEqual({ frame: null, driving: false });
  });

  it("sends every tick while an input deflects", () => {
    // The positive control: a deflection does reach the wire, held or new.
    for (const driving of [false, true]) {
      const tick = teleopTick(FORWARD, driving);
      expect(tick.driving).toBe(true);
      expect(JSON.parse(tick.frame!)).toEqual(FORWARD);
    }
  });

  it("sends one zero on release, then nothing", () => {
    const release = teleopTick(REST, true);
    expect(release).toEqual({ frame: ZERO_FRAME, driving: false });
    expect(teleopTick(REST, release.driving).frame).toBeNull();
  });

  it("reads a broken axis as rest, as the encoder sends it", () => {
    // A NaN encodes to 0, so a frame of it would be a zero nobody asked for.
    expect(isAtRest({ vx: NaN, vy: 0, wz: 0 })).toBe(true);
    expect(teleopTick({ vx: NaN, vy: 0, wz: 0 }, false).frame).toBeNull();
  });
});
