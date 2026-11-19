import { describe, expect, it } from "vitest";

import { buildPercent } from "@/lib/map/build-progress";

describe("buildPercent", () => {
  it("has no number for a build that has reported none", () => {
    // Queued behind another map's build, or a robot from before it reported:
    // a bar at 0% would say the build has started and is not moving.
    expect(buildPercent(null)).toBeNull();
  });

  it("reads a fraction as a whole percent, never ahead of the robot's", () => {
    expect(buildPercent(0)).toBe(0);
    expect(buildPercent(0.424)).toBe(42);
    expect(buildPercent(0.429)).toBe(42);
    expect(buildPercent(0.5)).toBe(50);
  });

  it("never reads 100% while the build is still running", () => {
    // Ready is the catalogue's `ok`; the robot is still writing its files.
    expect(buildPercent(0.999)).toBe(99);
    expect(buildPercent(1)).toBe(99);
    expect(buildPercent(1.7)).toBe(99);
  });

  it("holds a value the robot should not have sent inside the bar", () => {
    expect(buildPercent(-0.2)).toBe(0);
    expect(buildPercent(Number.NaN)).toBeNull();
    expect(buildPercent(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
