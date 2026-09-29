import { describe, expect, it } from "vitest";

import {
  MIN_ZONE_POINTS,
  canCloseZone,
  classifyZonePress,
  newZoneId,
  type ZonePoint,
} from "@/lib/map/zone";

/**
 * The rules a forbidden zone has to keep. Each is something the operator
 * would otherwise feel: a shape that closed into a line, a press on the first
 * corner that added a corner instead, a finger that could not hit the dot.
 */

const points = (n: number): ZonePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2 }));

describe("canCloseZone", () => {
  it("needs three corners before a shape can close", () => {
    // Two points are a line, which has no inside to keep the robot out of.
    expect(canCloseZone(points(2))).toBe(false);
    expect(canCloseZone(points(3))).toBe(true);
    expect(MIN_ZONE_POINTS).toBe(3);
  });
});

describe("classifyZonePress", () => {
  const first = { cx: 100, cy: 100 };

  it("adds the first corner when nothing is placed", () => {
    expect(classifyZonePress(0, null, first, 11)).toBe("add");
  });

  it("adds a corner on bare map", () => {
    expect(classifyZonePress(3, first, { cx: 160, cy: 100 }, 11)).toBe("add");
  });

  it("closes on the first corner only once there are three, and adds nothing before", () => {
    // A second corner on top of the first would be an edge that can never close.
    expect(classifyZonePress(2, first, first, 11)).toBe("ignore");
    expect(classifyZonePress(3, first, first, 11)).toBe("close");
    expect(classifyZonePress(5, first, first, 11)).toBe("close");
  });

  it("widens the first corner's target to the finger, edge included", () => {
    // 15 px off the dot: outside a mouse's 11 px slop, inside a finger's 22 px.
    const off = { cx: 115, cy: 100 };
    expect(classifyZonePress(3, first, off, 11)).toBe("add");
    expect(classifyZonePress(3, first, off, 22)).toBe("close");
    expect(classifyZonePress(3, first, { cx: 111, cy: 100 }, 11)).toBe("close");
  });
});

describe("newZoneId", () => {
  it("never repeats within a session", () => {
    expect(newZoneId()).not.toBe(newZoneId());
  });
});
