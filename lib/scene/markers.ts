// The goal / initial-pose marker: a ring and an arrow on the floor.

import * as THREE from "three";

import type { PlanarPose } from "@/lib/types/robot";

// Pose marker (goal / initial pose), in metres. The marker sits on the ground in
// a perspective view, so it has to be a real object of roughly robot size or it
// stops reading as a place on the floor — a screen-space arrow of fixed pixel
// length would grow into the horizon. Lifted off z=0 to keep it out of a
// z-fight with the ground.
const MARKER_RING_INNER_M = 0.26;
const MARKER_RING_OUTER_M = 0.34;
const MARKER_SHAFT_LEN_M = 0.5;
const MARKER_SHAFT_RADIUS_M = 0.035;
const MARKER_HEAD_LEN_M = 0.26;
const MARKER_HEAD_RADIUS_M = 0.1;
const MARKER_Z_M = 0.05;

/**
 * Ring + arrow marking a pose on the floor, built pointing down +x so the
 * group's rotation.z is the heading. Unlit (MeshBasicMaterial) like everything
 * else in the scene except the robot itself, so it keeps its colour whichever
 * way it faces.
 *
 * One material for all three meshes, which is also what lets `setMarkerColor`
 * recolour a marker in place — the draft marker changes hue with the pick mode
 * and must not force a scene rebuild to do it.
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

/** Move a marker to a pose (theta in degrees), or hide it when there is none. */
export function placePoseMarker(marker: THREE.Group, pose: PlanarPose | null) {
  marker.visible = pose !== null;
  if (!pose) return;
  marker.position.set(pose.x, pose.y, MARKER_Z_M);
  marker.rotation.z = (pose.theta * Math.PI) / 180;
}

/** Recolour a marker built by `createPoseMarker` (shared material). */
export function setMarkerColor(marker: THREE.Group, color: number) {
  const mesh = marker.children[0] as THREE.Mesh;
  (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
}
