import { describe, expect, it } from "vitest";

import {
  ZERO_FRAME,
  encodeTeleopFrame,
  parseTeleopError,
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
    // A NaN reaching cmd_vel is the failure this guard exists for: it is not
    // an out-of-range speed the driver would clamp, it is a command with no
    // meaning at all. An infinity is treated the same rather than clamped to
    // full stick — "as fast as possible" is never what a broken input meant.
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
