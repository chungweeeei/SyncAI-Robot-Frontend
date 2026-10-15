import { describe, expect, it } from "vitest";

import { DOCK_STAGING_DISTANCE_M, stagingPose } from "@/lib/map/dock";

/**
 * The approach point has to be where the robot will really stand before it
 * walks on: behind the dock along the heading it docks facing, never beside it
 * or in front of it, or the preview shows the operator a leg the robot will not
 * drive.
 */
describe("stagingPose", () => {
  it("stands back along the dock's heading, facing the same way", () => {
    const at = stagingPose({ x: 2, y: 1, theta: 0 });
    expect(at.x).toBeCloseTo(2 - DOCK_STAGING_DISTANCE_M);
    expect(at.y).toBeCloseTo(1);
    expect(at.theta).toBe(0);
  });

  it("reads the heading in degrees, counter-clockwise from +x", () => {
    const at = stagingPose({ x: 0, y: 0, theta: 90 });
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(-DOCK_STAGING_DISTANCE_M);
    expect(at.theta).toBe(90);
  });

  it("is the one distance from the dock whatever the heading", () => {
    for (const theta of [-135, -45, 30, 180]) {
      const at = stagingPose({ x: 5, y: -3, theta });
      expect(Math.hypot(at.x - 5, at.y + 3)).toBeCloseTo(DOCK_STAGING_DISTANCE_M);
    }
  });
});
