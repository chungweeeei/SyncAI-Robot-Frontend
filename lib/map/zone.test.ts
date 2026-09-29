import { describe, expect, it } from "vitest";

import {
  MIN_ZONE_POINTS,
  canCloseZone,
  classifyZonePress,
  newZoneId,
  pointInPolygon,
  zoneAt,
  type ZonePoint,
  type ZonePressInput,
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
  const press = (over: Partial<ZonePressInput> = {}): ZonePressInput => ({
    count: 3,
    firstAt: first,
    press: first,
    radius: 11,
    onZone: false,
    ...over,
  });

  it("adds the first corner when nothing is placed", () => {
    expect(classifyZonePress(press({ count: 0, firstAt: null }))).toBe("add");
  });

  it("adds a corner on bare map", () => {
    expect(classifyZonePress(press({ press: { cx: 160, cy: 100 } }))).toBe("add");
  });

  it("closes on the first corner only once there are three, and adds nothing before", () => {
    // A second corner on top of the first would be an edge that can never close.
    expect(classifyZonePress(press({ count: 2 }))).toBe("ignore");
    expect(classifyZonePress(press({ count: 3 }))).toBe("close");
    expect(classifyZonePress(press({ count: 5 }))).toBe("close");
  });

  it("widens the first corner's target to the finger, edge included", () => {
    // 15 px off the dot: outside a mouse's 11 px slop, inside a finger's 22 px.
    const off = { cx: 115, cy: 100 };
    expect(classifyZonePress(press({ press: off }))).toBe("add");
    expect(classifyZonePress(press({ press: off, radius: 22 }))).toBe("close");
    expect(classifyZonePress(press({ press: { cx: 111, cy: 100 } }))).toBe("close");
  });

  it("selects a finished zone only while no shape is in flight", () => {
    // Once a corner is down, a press inside a zone is the next corner, so a
    // shape can still be drawn across one that is already there.
    expect(classifyZonePress(press({ count: 0, firstAt: null, onZone: true }))).toBe("select");
    expect(classifyZonePress(press({ count: 1, onZone: true, press: { cx: 300, cy: 300 } }))).toBe("add");
  });
});

describe("pointInPolygon", () => {
  const square: ZonePoint[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it("is inside within the edges and outside beyond them", () => {
    expect(pointInPolygon(square, { x: 1, y: 1 })).toBe(true);
    expect(pointInPolygon(square, { x: 3, y: 1 })).toBe(false);
    expect(pointInPolygon(square, { x: 1, y: -1 })).toBe(false);
  });

  it("reads a concave shape by its edges, not its hull", () => {
    // An L: the notch at top-right is outside even though the hull covers it.
    const ell: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(pointInPolygon(ell, { x: 1.5, y: 1.5 })).toBe(false);
    expect(pointInPolygon(ell, { x: 0.5, y: 1.5 })).toBe(true);
  });
});

describe("zoneAt", () => {
  it("picks the zone drawn last where two overlap, and none on bare map", () => {
    const under = { id: "under", points: points(0).concat([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]) };
    const over = { id: "over", points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }] };
    expect(zoneAt([under, over], { x: 2, y: 2 })?.id).toBe("over");
    expect(zoneAt([under, over], { x: 0.5, y: 0.5 })?.id).toBe("under");
    expect(zoneAt([under, over], { x: 9, y: 9 })).toBeNull();
  });
});

describe("newZoneId", () => {
  it("never repeats within a session", () => {
    expect(newZoneId()).not.toBe(newZoneId());
  });
});
