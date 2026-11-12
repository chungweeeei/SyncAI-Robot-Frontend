import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { drawnGround } from "@/lib/map/floors";
import { pickVertex } from "@/lib/scene/picking";
import { THEMES } from "@/lib/scene/theme";
import { createVertexLayer } from "@/lib/scene/vertex-layer";
import type { MapVertex } from "@/lib/types/map";

// jsdom has no 2D context; the badge only needs one to draw into.
beforeAll(() => {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop });
  // `never`: getContext's overloads leave no one return type to cast to.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.stubGlobal("Path2D", class {});
});

const stop = (over: Partial<MapVertex>): MapVertex =>
  ({
    id: "a",
    name: "a",
    type: "MOVE",
    map_name: "m",
    x: 0,
    y: 0,
    z: 0,
    theta: 0,
    ...over,
  }) as MapVertex;

/** A layer with its transforms resolved, as the first frame's render leaves it. */
const layerOf = (vertices: MapVertex[]) => {
  const layer = createVertexLayer(vertices, THEMES.light);
  layer.group.updateMatrixWorld(true);
  return layer;
};

/**
 * The world box of what one stop draws: its marker group's shown parts, so
 * neither the invisible hit disc nor the badge (hung off the layer) counts.
 * `keep` narrows it to the parts whose own box passes.
 */
const markerBox = (
  layer: ReturnType<typeof createVertexLayer>,
  keep: (own: THREE.Box3) => boolean = () => true,
) => {
  const marker = layer.group.children.find((child) => child instanceof THREE.Group)!;
  const box = new THREE.Box3();
  for (const part of marker.children) {
    if (!part.visible) continue;
    const own = new THREE.Box3().setFromObject(part);
    if (keep(own)) box.union(own);
  }
  return box;
};

/** A stop's marking, a hair over its ground (VERTEX_Z_M in the layer). */
const VERTEX_DISC_Z_M = 0.02;

/** A ray as a pointer casts one: with a camera, which a sprite's raycast needs. */
const rayAt = (origin: [number, number, number], direction: [number, number, number]) => {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction).normalize(),
  );
  raycaster.camera = new THREE.PerspectiveCamera();
  return raycaster;
};

describe("createVertexLayer", () => {
  it("stands a charger up from its floor's ground, where a stop lies flat", () => {
    const charger = markerBox(layerOf([stop({ type: "CHARGE", z: 3 })]));
    expect(charger.min.z).toBeCloseTo(drawnGround(3));
    expect(charger.max.z - charger.min.z).toBeGreaterThan(0.5);

    // A stop is its ground marking and a hairline stem; nothing as wide stands up.
    const flat = markerBox(layerOf([stop({})]));
    expect(flat.min.z).toBeGreaterThan(drawnGround(0));
  });

  it("lays a charger's plate under the waypoint and stands its post on the floor past it", () => {
    // Heading +y, into the wall. The plate is where the robot stands docked;
    // the post is beyond its far edge, not on it, the bolt on the face
    // towards the plate.
    const layer = layerOf([stop({ type: "CHARGE", theta: 90 })]);
    const ground = drawnGround(0);
    const plate = markerBox(layer, (own) => own.max.z < ground + 0.05);
    const post = markerBox(layer, (own) => own.max.z > ground + 0.1);
    expect(plate.min.y).toBeLessThan(0);
    expect(plate.max.y).toBeGreaterThan(0);
    expect(post.min.y).toBeGreaterThanOrEqual(plate.max.y - 0.01);
    expect(post.min.z).toBeCloseTo(ground);
    const marker = layer.group.children.find((child) => child instanceof THREE.Group)!;
    const bolt = marker.children.find(
      (part) =>
        part instanceof THREE.Mesh &&
        (part.material as THREE.MeshBasicMaterial).color.getHex() !== 0 &&
        part.geometry.type === "ShapeGeometry",
    )!;
    expect(new THREE.Box3().setFromObject(bolt).max.y).toBeCloseTo(post.min.y, 2);
  });

  it("never lets a charger's post take the tap on a stop behind it", () => {
    // The post stands between the ray and the stop's disc at (1, 0).
    const layer = layerOf([
      stop({ id: "dock", type: "CHARGE" }),
      stop({ id: "behind", x: 1 }),
    ]);
    const ground = drawnGround(0);
    const from = new THREE.Vector3(-1, 0, ground + 0.4);
    const to = new THREE.Vector3(1, 0, ground + VERTEX_DISC_Z_M);
    const ray = rayAt(from.toArray(), to.clone().sub(from).toArray());
    expect(pickVertex(ray, layer)?.id).toBe("behind");
  });
});
