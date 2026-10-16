import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { DOCK_STAGING_DISTANCE_M } from "@/lib/map/dock";
import { createDockLayer } from "@/lib/scene/dock-layer";
import { THEMES } from "@/lib/scene/theme";

describe("createDockLayer", () => {
  it("puts the staging point the robot's distance back from the dock", () => {
    const layer = createDockLayer({ x: 3, y: 2, theta: 90 }, THEMES.light);
    const dot = layer.group.children[0]!;

    expect(dot.position.x).toBeCloseTo(3);
    expect(dot.position.y).toBeCloseTo(2 - DOCK_STAGING_DISTANCE_M);
    layer.dispose();
  });

  it("marks the staging point with a dot, not a goal-sized marker", () => {
    // A ring and arrow is how an operator's own goal looks; the staging point
    // is only passed through, so it must not read as one.
    const layer = createDockLayer({ x: 0, y: 0, theta: 0 }, THEMES.light);
    const dot = layer.group.children[0] as THREE.Mesh;
    dot.geometry.computeBoundingSphere();

    expect(dot.geometry.boundingSphere!.radius).toBeLessThan(0.1);
    layer.dispose();
  });

  it("keeps the leg between the staging point and the dock", () => {
    const layer = createDockLayer({ x: 0, y: 0, theta: 0 }, THEMES.dark);
    const leg = layer.group.children[1] as THREE.Mesh;
    const xs = Array.from(
      { length: leg.geometry.getAttribute("position").count },
      (_, i) => leg.geometry.getAttribute("position").getX(i),
    );

    expect(Math.min(...xs)).toBeCloseTo(-DOCK_STAGING_DISTANCE_M);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1e-9);
    layer.dispose();
  });
});
