import { describe, expect, it } from "vitest";

import { POSE_REDRAW_M, POSE_REDRAW_RAD, poseMoved, type SmoothPose } from "@/lib/scene/pose";

const at = (over: Partial<SmoothPose> = {}): SmoothPose => ({ x: 1, y: 2, z: 0.5, yaw: 0.3, ...over });

/**
 * When the dashboard draws again for the robot. A view that redraws on every
 * pose message never rests; one that misses a move shows a robot where it
 * is not.
 */
describe("poseMoved", () => {
  it("is still for the last digits of a standing robot's pose", () => {
    expect(poseMoved(at(), at({ x: 1 + POSE_REDRAW_M / 2, yaw: 0.3 + POSE_REDRAW_RAD / 2 }))).toBe(false);
  });

  it("moves for any one of x, y, z and the heading", () => {
    expect(poseMoved(at(), at({ x: 1 + POSE_REDRAW_M * 2 }))).toBe(true);
    expect(poseMoved(at(), at({ y: 2 - POSE_REDRAW_M * 2 }))).toBe(true);
    expect(poseMoved(at(), at({ z: 0.5 + POSE_REDRAW_M * 2 }))).toBe(true);
    expect(poseMoved(at(), at({ yaw: 0.3 - POSE_REDRAW_RAD * 2 }))).toBe(true);
  });

  it("adds up a creep, measured from the pose drawn and not the last one seen", () => {
    const drawn = at();
    let x = drawn.x;
    let redraws = 0;
    // Steps of a fifth of the floor: none shows alone, five of them do.
    for (let i = 0; i < 10; i += 1) {
      x += POSE_REDRAW_M / 5;
      if (poseMoved(drawn, at({ x }))) redraws += 1;
    }
    expect(redraws).toBeGreaterThan(0);
  });

  it("always draws a robot appearing or vanishing, and never an absent one twice", () => {
    expect(poseMoved(null, at())).toBe(true);
    expect(poseMoved(at(), null)).toBe(true);
    expect(poseMoved(null, null)).toBe(false);
  });
});
