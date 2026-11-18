import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { CHARGE_STAGING_DISTANCE_M } from "@/lib/map/dock";
import { createDockLayer } from "@/lib/scene/dock-layer";
import { THEMES } from "@/lib/scene/theme";

describe("createDockLayer", () => {
  it("puts the staging point the robot's distance out in front of the charger", () => {
    const layer = createDockLayer({ x: 3, y: 2, theta: 90 }, THEMES.light);
    const dot = layer.group.children[0]!;

    expect(dot.position.x).toBeCloseTo(3);
    expect(dot.position.y).toBeCloseTo(2 + CHARGE_STAGING_DISTANCE_M);
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

  it("draws the staging point in the live hue, apart from the leg's violet", () => {
    // It is where the robot is heading now, so it reads in the hue of what is
    // happening; the leg keeps the charge's own.
    const layer = createDockLayer({ x: 0, y: 0, theta: 0 }, THEMES.dark);
    const dot = layer.group.children[0] as THREE.Mesh;
    const leg = layer.group.children[1] as THREE.Mesh;

    expect((dot.material as THREE.MeshBasicMaterial).color.getHex()).toBe(THEMES.dark.staging);
    expect((leg.material as THREE.MeshBasicMaterial).color.getHex()).toBe(THEMES.dark.dock);
    layer.dispose();
  });

  it("draws a tapped charger's staging point in a hue apart from a running charge's", () => {
    // A preview is not where the robot is heading, so it must not wear the
    // live hue — nor the route preview's cyan, which ends on it.
    const layer = createDockLayer({ x: 0, y: 0, theta: 0 }, THEMES.dark, { preview: true });
    const dot = layer.group.children[0] as THREE.Mesh;
    const hex = (dot.material as THREE.MeshBasicMaterial).color.getHex();

    expect(hex).toBe(THEMES.dark.stagingPreview);
    expect(hex).not.toBe(THEMES.dark.staging);
    expect(hex).not.toBe(THEMES.dark.preview);
    layer.dispose();
  });

  it("stands a tapped charger's staging point on the charger's own floor", () => {
    const layer = createDockLayer({ x: 0, y: 0, theta: 0, z: 3.2 }, THEMES.light, {
      preview: true,
    });

    expect(layer.group.position.z).toBeCloseTo(3.2);
    layer.dispose();
  });

  it("keeps the leg between the staging point and the charger", () => {
    const layer = createDockLayer({ x: 0, y: 0, theta: 0 }, THEMES.dark);
    const leg = layer.group.children[1] as THREE.Mesh;
    const xs = Array.from(
      { length: leg.geometry.getAttribute("position").count },
      (_, i) => leg.geometry.getAttribute("position").getX(i),
    );

    expect(Math.max(...xs)).toBeCloseTo(CHARGE_STAGING_DISTANCE_M);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9);
    layer.dispose();
  });
});
