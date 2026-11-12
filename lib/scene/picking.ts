// Projecting a pointer position onto the map floor.

import * as THREE from "three";

import type { VertexLayer } from "@/lib/scene/vertex-layer";
import type { MapVertex } from "@/lib/types/map";

/**
 * The plane a pick projects onto: the mathematical plane, not the ground
 * of any mesh. Bounds are checked
 * separately. Its height is set per cast — the ground of the floor shown —
 * so it is scratch like the two below.
 */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/**
 * Scratch reused so a pointermove allocates nothing; safe because three.js
 * keeps neither and callers copy the numbers out before the next cast.
 */
const POINTER_NDC = new THREE.Vector2();
const GROUND_HIT = new THREE.Vector3();
const PROJECTED = new THREE.Vector3();

/**
 * Aim a raycaster through a pointer position, given the canvas rect it was
 * measured against. The caller owns the raycaster so a pointermove reuses one.
 *
 * The camera's world matrix is brought up to date first: the ray is cast
 * from it, and only a render refreshes it. A framing (Fit, Top down, Front
 * view) moves the camera between frames, so a press that lands before the
 * next one was aimed from where the camera had been — on the editor's 3D view,
 * a waypoint pressed after Fit landed somewhere else, or nowhere.
 */
export function aimRaycaster(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(
    POINTER_NDC.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
}

/**
 * Where an aimed ray meets the ground at height `z`, or null when it runs
 * parallel or away. A floor has no cell where a pick lands between two
 * waypoints, so the cast is onto the floor's height rather than onto the
 * 3D map — and a wall in front of the spot must not take the press.
 */
export function intersectGround(
  raycaster: THREE.Raycaster,
  z = 0,
): { wx: number; wy: number } | null {
  GROUND_PLANE.constant = -z;
  const hit = raycaster.ray.intersectPlane(GROUND_PLANE, GROUND_HIT);
  return hit ? { wx: hit.x, wy: hit.y } : null;
}

/**
 * The stored stop an aimed ray meets first, or null. A stop the layer hides
 * (another floor's, one in the operator's hand) is not among its pickables.
 */
export function pickVertex(
  raycaster: THREE.Raycaster,
  layer: Pick<VertexLayer, "pickables" | "byId">,
): MapVertex | null {
  const hit = raycaster.intersectObjects(layer.pickables, false)[0];
  const id = hit?.object.userData.vertexId as string | undefined;
  return id ? (layer.byId.get(id) ?? null) : null;
}

/**
 * Map-frame points on screen: CSS pixels in the client frame a pointer event
 * uses, given the canvas rect, so a press can be tested against them as it
 * is. No depth test: a caller with points behind the camera has its own rule
 * for them (projectStops).
 */
export function projectToScreen(
  camera: THREE.Camera,
  rect: { left: number; top: number; width: number; height: number },
  points: readonly { x: number; y: number; z: number }[],
): { cx: number; cy: number }[] {
  camera.updateMatrixWorld();
  return points.map(({ x, y, z }) => {
    PROJECTED.set(x, y, z).project(camera);
    return {
      cx: rect.left + ((PROJECTED.x + 1) / 2) * rect.width,
      cy: rect.top + ((1 - PROJECTED.y) / 2) * rect.height,
    };
  });
}

export interface RectCache {
  /** The element's client rect; `fresh` measures it again first. */
  get: (fresh?: boolean) => DOMRect;
  /** Forget the rect: the element was resized. */
  invalidate: () => void;
  dispose: () => void;
}

/**
 * An element's client rect, cached: a cast runs per pointermove, and a live
 * read forces a layout each time. Dropped on any scroll (the page scrolls
 * below lg, which moves a canvas without resizing it); the owner drops it on
 * a resize, and measures afresh on every press, since a banner appearing
 * over a view moves it with neither and a stale rect would put a press
 * somewhere else.
 */
export function createRectCache(element: Element): RectCache {
  let cached: DOMRect | null = null;
  const invalidate = () => {
    cached = null;
  };
  // Capture phase, since scroll does not bubble from an ancestor.
  window.addEventListener("scroll", invalidate, { capture: true, passive: true });
  return {
    get: (fresh) => {
      if (fresh) cached = null;
      return (cached ??= element.getBoundingClientRect());
    },
    invalidate,
    dispose: () => window.removeEventListener("scroll", invalidate, { capture: true }),
  };
}
