import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GROUND_FLOOR_Z_M } from "@/lib/map/floors";
import { THEMES } from "@/lib/scene/theme";
import { createZoneLayer } from "@/lib/scene/zone-layer";

const triangle = (id: string) => ({
  id,
  points: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
  ],
});

const positionsOf = (group: THREE.Group) =>
  group.children.flatMap((child) => [
    ...((child as THREE.Mesh).geometry.getAttribute("position").array as Float32Array),
  ]);

describe("createZoneLayer", () => {
  it("draws each zone as a wash and an edge, in the editor's warn hue", () => {
    const { group } = createZoneLayer([triangle("a"), triangle("b")], THEMES.light);
    expect(group.children).toHaveLength(4);
    const material = (group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(THEMES.light.zone);
  });

  it("lies under the route, so a route through a zone stays on top", () => {
    const { group } = createZoneLayer([triangle("a")], THEMES.dark);
    // On the ground floor's real ground.
    expect(group.position.z - GROUND_FLOOR_Z_M).toBeGreaterThan(0);
    expect(group.position.z - GROUND_FLOOR_Z_M).toBeLessThan(0.012);
  });

  it("skips a zone that encloses nothing rather than throwing", () => {
    const line = { id: "l", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    expect(createZoneLayer([line], THEMES.light).group.children).toHaveLength(0);
  });

  it("puts no NaN in a buffer when two corners coincide", () => {
    // A NaN anywhere in a position buffer blanks the whole mesh.
    const doubled = {
      id: "d",
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
    };
    const { group } = createZoneLayer([doubled], THEMES.light);
    expect(positionsOf(group).some(Number.isNaN)).toBe(false);
  });

  it("lies a banded zone on its floor's ground and one of every floor at the floor shown", () => {
    const upstairs = { ...triangle("u"), z_min: 4.1, z_max: 5.1 };
    const { group } = createZoneLayer([upstairs, triangle("all")], THEMES.light, {
      defaultZ: 2,
    });
    const heights = group.children.map((child) => group.position.z + child.position.z);
    // Wash and edge of each, at the band's middle and at defaultZ, both lifted a hair.
    expect(heights[0]).toBeCloseTo(4.6, 1);
    expect(heights[1]).toBeCloseTo(4.6, 1);
    expect(heights[2]).toBeCloseTo(2, 1);
    expect(heights[0] - 4.6).toBeGreaterThan(0);
  });

  it("leaves out the zones the caller does not show", () => {
    const { group } = createZoneLayer([triangle("a"), triangle("b")], THEMES.light, {
      visible: (zone) => zone.id === "b",
    });
    expect(group.children).toHaveLength(2);
  });
});
