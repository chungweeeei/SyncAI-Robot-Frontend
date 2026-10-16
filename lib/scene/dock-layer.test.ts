import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { DOCK_STAGING_DISTANCE_M } from "@/lib/map/dock";
import { createDockLayer, dashSpans } from "@/lib/scene/dock-layer";
import { THEMES } from "@/lib/scene/theme";

describe("dashSpans", () => {
  it("never runs a dash past the end of the leg", () => {
    // The leg ends on the dock; a dash poking past it would draw onto the
    // charger as if the robot were meant to walk through it.
    for (const length of [0.05, 0.3, 1, 1.07]) {
      const spans = dashSpans(length);
      expect(spans.at(-1)![1]).toBeLessThanOrEqual(length);
      for (const [from, to] of spans) expect(to).toBeGreaterThan(from);
    }
  });

  it("starts on the staging point", () => {
    expect(dashSpans(1)[0]![0]).toBe(0);
  });

  it("draws nothing for a leg with no length", () => {
    expect(dashSpans(0)).toEqual([]);
    expect(dashSpans(Number.NaN)).toEqual([]);
  });
});

describe("createDockLayer", () => {
  it("puts the staging point the robot's distance back from the dock", () => {
    const layer = createDockLayer({ x: 3, y: 2, theta: 90 }, THEMES.light);
    const marker = layer.group.children[0]!;

    expect(marker.visible).toBe(true);
    expect(marker.position.x).toBeCloseTo(3);
    expect(marker.position.y).toBeCloseTo(2 - DOCK_STAGING_DISTANCE_M);
    // Facing the dock, so the last metre reads as a walk straight forward.
    expect(marker.rotation.z).toBeCloseTo(Math.PI / 2);
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
