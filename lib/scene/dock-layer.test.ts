import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { CHARGE_STAGING_DISTANCE_M } from "@/lib/map/dock";
import { drawnGround } from "@/lib/map/floors";
import { createDockLayer } from "@/lib/scene/dock-layer";
import {
  MAP_SURFACE_REACH_M,
  OVER_MAP_LIFT_M,
  type SurfaceTop,
} from "@/lib/scene/map-surface";
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

  it("stands the staging point over the 3D map's floor, clear of the cells drawn round it", () => {
    // dp's 2F: a charger's z of 5.15 m, the floor's top face at 5.30 m, and
    // the map's cells drawn reaching half a cell over it. On the charger's z
    // the dot was under them and the depth test ate it whole.
    const floorAt530: SurfaceTop = () => 5.3;
    const layer = createDockLayer({ x: 0, y: 0, theta: 0, z: 5.15 }, THEMES.light, {
      preview: true,
      surfaceTop: floorAt530,
    });

    expect(worldZ(layer, 0)).toBeGreaterThan(5.3 + OVER_MAP_LIFT_M);
    layer.dispose();
  });

  it("asks for the floor under the staging point, near the charger's ground", () => {
    // The staging point is 1.3 m out on open floor; the charger's own column
    // (its foot against the wall) is not where the dot lies.
    const asked: [number, number, number][] = [];
    const recordingSurfaceTop: SurfaceTop = (wx, wy, z) => {
      asked.push([wx, wy, z]);
      return null;
    };
    createDockLayer({ x: 3, y: 2, theta: 90, z: 5.15 }, THEMES.light, {
      surfaceTop: recordingSurfaceTop,
    }).dispose();
    createDockLayer({ x: 3, y: 2, theta: 90 }, THEMES.light, {
      surfaceTop: recordingSurfaceTop,
    }).dispose();

    const [[wx, wy, z], [, , groundFloorZ]] = asked;
    expect(wx).toBeCloseTo(3);
    expect(wy).toBeCloseTo(2 + CHARGE_STAGING_DISTANCE_M);
    expect(z).toBeCloseTo(5.15);
    // A charge read with no z is on the ground floor, drawn where its 0 is.
    expect(groundFloorZ).toBeCloseTo(drawnGround(0));
  });

  it("keeps the charger's ground with no 3D map drawn or no floor in reach", () => {
    const noFloorInReach: SurfaceTop = () => null;
    const without = createDockLayer({ x: 0, y: 0, theta: 0, z: 5.15 }, THEMES.light);
    const unreached = createDockLayer({ x: 0, y: 0, theta: 0, z: 5.15 }, THEMES.light, {
      surfaceTop: noFloorInReach,
    });

    expect(without.group.position.z).toBeCloseTo(5.15);
    expect(unreached.group.position.z).toBeCloseTo(5.15);
    without.dispose();
    unreached.dispose();
  });

  it("keeps the dot over the floor it finds, over many random chargers and floors", () => {
    // Seeded, so a failure names the same case on every run.
    let seed = 20261118;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let caseIndex = 0; caseIndex < 2_000; caseIndex++) {
      const chargerZ = (random() - 0.2) * 10;
      const floorTop = chargerZ + random() * MAP_SURFACE_REACH_M;
      const layer = createDockLayer(
        { x: (random() - 0.5) * 100, y: (random() - 0.5) * 100, theta: random() * 360 - 179, z: chargerZ },
        THEMES.dark,
        { preview: random() < 0.5, surfaceTop: () => floorTop },
      );

      // The dot, its rim and the leg all over the drawn cells.
      for (let childIndex = 0; childIndex < layer.group.children.length; childIndex++) {
        expect(worldZ(layer, childIndex)).toBeGreaterThan(floorTop + OVER_MAP_LIFT_M);
      }
      layer.dispose();
    }
  });
});

/** A child's height in the map frame: the group's lift plus its own. */
function worldZ(layer: ReturnType<typeof createDockLayer>, childIndex: number): number {
  const child = layer.group.children[childIndex] as THREE.Mesh;
  child.geometry.computeBoundingBox();
  return layer.group.position.z + child.position.z + child.geometry.boundingBox!.min.z;
}
