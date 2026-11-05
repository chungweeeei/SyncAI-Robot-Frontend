import { describe, expect, it } from "vitest";

import { STALE_AFTER_M, previewPoints, previewStale, routeFloors } from "@/lib/map/route-preview";

describe("previewPoints", () => {
  it("lays the rows out as the triples the route ribbon walks", () => {
    expect(Array.from(previewPoints([[1, 2, 0], [3, 4, 2.8]]))).toEqual([
      1, 2, 0, 3, 4, expect.closeTo(2.8, 5),
    ]);
  });

  it("makes nothing of no route", () => {
    expect(previewPoints([]).length).toBe(0);
  });
});

describe("previewStale", () => {
  const route = [
    [0, 0, 0],
    [5, 0, 0],
  ];

  it("holds while the robot stands on the start, give or take the pose's wander", () => {
    expect(previewStale(route, { x: 0.1, y: -0.1 })).toBe(false);
  });

  it("goes out of date once the robot has walked off the start", () => {
    expect(previewStale(route, { x: STALE_AFTER_M + 0.01, y: 0 })).toBe(true);
  });

  it("is not stale with no pose: a lost fix says nothing about where it went", () => {
    expect(previewStale(route, null)).toBe(false);
  });

  it("has nothing to go stale without a route", () => {
    expect(previewStale([], { x: 9, y: 9 })).toBe(false);
  });
});

describe("routeFloors", () => {
  const floors = [
    { name: "1F", level: 0 },
    { name: "2F", level: 5 },
  ];

  it("names the floors a route climbs through, in order", () => {
    expect(routeFloors([[0, 0, 0], [1, 0, 0], [2, 0, 2.5], [3, 0, 5], [4, 0, 5]], floors)).toEqual([
      "1F",
      "2F",
    ]);
  });

  it("names a floor again when the route comes back to it", () => {
    expect(routeFloors([[0, 0, 5], [1, 0, 0], [2, 0, 5]], floors)).toEqual(["2F", "1F", "2F"]);
  });

  it("says nothing on a map of one storey", () => {
    expect(routeFloors([[0, 0, 0], [5, 0, 0]], [])).toEqual([]);
  });
});
