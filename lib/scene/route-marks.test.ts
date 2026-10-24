import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { projectStops, stopNear } from "@/lib/scene/route-marks";
import type { MapVertex } from "@/lib/types/map";

/**
 * The 3D view's waypoints as screen marks: a stop is where the camera shows
 * it, its arrow points the way the screen shows its heading, and a tap
 * takes the nearest stop within reach — never one on a floor not shown.
 */

function stop(over: Partial<MapVertex>): MapVertex {
  return { id: "v", name: "v", type: "MOVE", map_name: "dp", x: 0, y: 0, theta: 0, z: 0, ...over };
}

/** Straight down on the origin, +x to the right and +y up the screen. */
function overhead(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
  camera.up.set(0, 1, 0);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  return camera;
}

describe("projectStops", () => {
  it("puts a stop under the camera at the middle of the view", () => {
    const at = projectStops(overhead(), [stop({ id: "a" })], null, 400, 300).get("a")!;
    expect(at.cx).toBeCloseTo(200, 0);
    expect(at.cy).toBeCloseTo(150, 0);
  });

  it("draws +x to the right and +y up, with the heading the screen shows", () => {
    const placed = projectStops(
      overhead(),
      [stop({ id: "east", x: 2, theta: 90 }), stop({ id: "north", y: 2, theta: 180 })],
      null,
      400,
      400,
    );
    expect(placed.get("east")!.cx).toBeGreaterThan(200);
    expect(placed.get("north")!.cy).toBeLessThan(200);
    expect(placed.get("east")!.theta).toBeCloseTo(90, 0);
    expect(Math.abs(placed.get("north")!.theta)).toBeCloseTo(180, 0);
  });

  it("leaves out a stop on another floor, and one behind the camera", () => {
    const placed = projectStops(
      overhead(),
      [stop({ id: "up", z: 5.2 }), stop({ id: "here" }), stop({ id: "behind", z: 40 })],
      { lo: -Infinity, hi: 4.4 },
      400,
      400,
    );
    expect([...placed.keys()]).toEqual(["here"]);
    const all = projectStops(overhead(), [stop({ id: "behind", z: 40 })], null, 400, 400);
    expect(all.size).toBe(0);
  });
});

describe("stopNear", () => {
  const vertices = [stop({ id: "a" }), stop({ id: "b" })];
  const placed = new Map([
    ["a", { cx: 100, cy: 100, theta: 0 }],
    ["b", { cx: 112, cy: 100, theta: 0 }],
  ]);

  it("takes the nearer of two close stops, not the last drawn", () => {
    expect(stopNear(placed, vertices, 103, 100, 11)?.id).toBe("a");
    expect(stopNear(placed, vertices, 110, 100, 11)?.id).toBe("b");
  });

  it("finds nothing past the reach, and never a stop that is not shown", () => {
    expect(stopNear(placed, vertices, 140, 100, 11)).toBeNull();
    expect(stopNear(new Map(), vertices, 100, 100, 11)).toBeNull();
  });
});
