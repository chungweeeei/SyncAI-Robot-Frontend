import { describe, expect, it } from "vitest";

import { LOOP_PERIOD_S, loopDistance, loopPose, routeAhead } from "@/lib/scene/walk-loop";

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

describe("loopDistance", () => {
  it("is the path walked, summed from the poses", () => {
    // A wheel turned by this is turned by the ground it really covered.
    for (const end of [3.7, LOOP_PERIOD_S * 0.5, LOOP_PERIOD_S * 1.3]) {
      let walked = 0;
      let prev = loopPose(0);
      for (let i = 1; i <= 4000; i += 1) {
        const here = loopPose((end * i) / 4000);
        walked += Math.hypot(here.x - prev.x, here.y - prev.y);
        prev = here;
      }
      expect(loopDistance(end)).toBeCloseTo(walked, 3);
    }
  });

  it("only grows, across the lap boundary too", () => {
    let prev = loopDistance(0);
    expect(prev).toBe(0);
    for (let t = 0.25; t <= LOOP_PERIOD_S * 2; t += 0.25) {
      const here = loopDistance(t);
      expect(here).toBeGreaterThan(prev);
      prev = here;
    }
  });
});
