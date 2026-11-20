import { describe, expect, it } from "vitest";

import { LOOP_PERIOD_S, loopPose, routeAhead } from "@/lib/scene/walk-loop";

describe("loopPose", () => {
  it("faces along the oval, the way it is walking", () => {
    for (let i = 0; i < 32; i += 1) {
      const t = (i / 32) * LOOP_PERIOD_S;
      const here = loopPose(t);
      const next = loopPose(t + 0.01);
      const travel = Math.atan2(next.y - here.y, next.x - here.x);
      const off = Math.atan2(Math.sin(travel - here.yaw), Math.cos(travel - here.yaw));
      expect(Math.abs(off)).toBeLessThan(0.01);
    }
  });

  it("comes back to where it started after a lap", () => {
    const start = loopPose(0);
    const lap = loopPose(LOOP_PERIOD_S);
    expect(lap.x).toBeCloseTo(start.x);
    expect(lap.y).toBeCloseTo(start.y);
  });
});

describe("routeAhead", () => {
  it("starts where the robot stands and runs the way it faces", () => {
    for (const t of [0, 7, 23.5]) {
      const robot = loopPose(t);
      const points = routeAhead(t);
      expect(points[0]).toBeCloseTo(robot.x);
      expect(points[1]).toBeCloseTo(robot.y);
      const heading = Math.atan2(points[4] - points[1], points[3] - points[0]);
      const off = Math.atan2(Math.sin(heading - robot.yaw), Math.cos(heading - robot.yaw));
      expect(Math.abs(off)).toBeLessThan(0.05);
    }
  });
});
