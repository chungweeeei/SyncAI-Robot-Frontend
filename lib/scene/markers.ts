// The goal / initial-pose marker: a ring and an arrow on the floor.

import * as THREE from "three";

import type { PlanarPose } from "@/lib/types/robot";

// Pose marker (goal / initial pose), in metres: robot-sized, so it reads as a
// place on the floor in perspective. Lifted off z=0 to avoid z-fighting.
const MARKER_RING_INNER_M = 0.26;
const MARKER_RING_OUTER_M = 0.34;
const MARKER_SHAFT_LEN_M = 0.5;
const MARKER_SHAFT_RADIUS_M = 0.035;
const MARKER_HEAD_LEN_M = 0.26;
const MARKER_HEAD_RADIUS_M = 0.1;
const MARKER_Z_M = 0.05;

/**
 * Ring + arrow marking a pose on the floor, pointing down +x so the group's
 * rotation.z is the heading. One shared material, so `setMarkerColor` can
 * recolour the draft marker without a scene rebuild.
 */
export function createPoseMarker(color: number, opacity: number): THREE.Group {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });

  const group = new THREE.Group();

  // RingGeometry is already in the XY plane, i.e. flat on this z-up world.
  group.add(
    new THREE.Mesh(
      new THREE.RingGeometry(MARKER_RING_INNER_M, MARKER_RING_OUTER_M, 32),
      material,
    ),
  );

  // Cylinder / cone run along +y by default; -90deg about z aims them down +x.
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(
      MARKER_SHAFT_RADIUS_M,
      MARKER_SHAFT_RADIUS_M,
      MARKER_SHAFT_LEN_M,
      12,
    ),
    material,
  );
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = MARKER_RING_OUTER_M + MARKER_SHAFT_LEN_M / 2;
  group.add(shaft);

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(MARKER_HEAD_RADIUS_M, MARKER_HEAD_LEN_M, 16),
    material,
  );
  head.rotation.z = -Math.PI / 2;
  head.position.x =
    MARKER_RING_OUTER_M + MARKER_SHAFT_LEN_M + MARKER_HEAD_LEN_M / 2;
  group.add(head);

  group.visible = false;
  return group;
}

/**
 * Move a marker to a pose (theta in degrees), or hide it when there is none.
 * `z` is the ground of the pose's floor, 0 when it has none.
 */
export function placePoseMarker(
  marker: THREE.Group,
  pose: (PlanarPose & { z?: number }) | null,
) {
  marker.visible = pose !== null;
  if (!pose) return;
  marker.position.set(pose.x, pose.y, (pose.z ?? 0) + MARKER_Z_M);
  marker.rotation.z = (pose.theta * Math.PI) / 180;
}

/** Recolour a marker built by `createPoseMarker` (shared material). */
export function setMarkerColor(marker: THREE.Group, color: number) {
  const mesh = marker.children[0] as THREE.Mesh;
  (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
}
