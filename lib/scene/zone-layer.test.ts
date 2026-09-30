import * as THREE from "three";
import { describe, expect, it } from "vitest";

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
    expect(group.position.z).toBeGreaterThan(0);
    expect(group.position.z).toBeLessThan(0.012);
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
});
