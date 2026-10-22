// Projecting a pointer position onto the map floor.

import * as THREE from "three";

/**
 * The plane a pick projects onto: the mathematical plane, not the ground
 * mesh, which spans only the floor plan (or is absent). Bounds are checked
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
