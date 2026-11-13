// A running charge's staging point, and the straight leg from it onto the
// charger's marker.

import * as THREE from "three";

import { stagingPose } from "@/lib/map/dock";
import { GROUND_FLOOR_Z_M } from "@/lib/map/floors";
import { createDashedRibbon } from "@/lib/scene/path-ribbon";
import type { Theme } from "@/lib/scene/theme";
import type { PlanarPose } from "@/lib/types/robot";

/*
 * The staging point is a dot, not a pose marker: the robot only passes
 * through it on the way in, and a robot-sized ring and arrow read as a goal
 * the operator set. The leg already says which way it faces.
 */
const STAGING_DOT_RADIUS_M = 0.09;
/* The rim around it, so the dot keeps its edge over the green trajectory. */
const STAGING_CASING_RADIUS_M = 0.12;
/* Over the leg, under the goal markers (MARKER_Z_M); the rim just under it. */
const STAGING_DOT_Z_M = 0.02;
const STAGING_CASING_Z_M = 0.018;

/*
 * The leg is dashed because it is intent, not a prediction: the robot does
 * not plan this metre, it steers onto the dock by a control law. Half the
 * route's width so it reads as a different mark from the predicted approach
 * (also dashed, at full width) where the two overlap.
 */
const LEG_WIDTH_M = 0.06;
/* Over the route (PATH_Z_M) and under the markers, like a stop. */
const LEG_Z_M = 0.016;

/**
 * The staging point (a green dot on a rim) and the dashed leg from it to the
 * dock, as one group with its disposer. Built per dock pose: it only changes
 * when a dock starts, so a rebuild is cheaper than a mutable layer.
 * The leg runs on to the marker, past where the robot stops: where it stops
 * is the charger's geometry, the robot's to know.
 */
export function createDockLayer(
  dock: PlanarPose,
  theme: Theme,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  // A dock is on the ground floor.
  group.position.z = GROUND_FLOOR_Z_M;
  const staging = stagingPose(dock);

  const dotGeometry = new THREE.CircleGeometry(STAGING_DOT_RADIUS_M, 24);
  const dotMaterial = new THREE.MeshBasicMaterial({
    color: theme.staging,
    side: THREE.DoubleSide,
  });
  const dot = new THREE.Mesh(dotGeometry, dotMaterial);
  dot.position.set(staging.x, staging.y, STAGING_DOT_Z_M);
  group.add(dot);

  const leg = createDashedRibbon([staging.x, staging.y, dock.x, dock.y], theme.dock, {
    width: LEG_WIDTH_M,
    z: LEG_Z_M,
  });
  if (leg) group.add(leg.mesh);

  const casingGeometry = new THREE.CircleGeometry(STAGING_CASING_RADIUS_M, 24);
  const casingMaterial = new THREE.MeshBasicMaterial({
    color: theme.stagingCasing,
    side: THREE.DoubleSide,
  });
  const casing = new THREE.Mesh(casingGeometry, casingMaterial);
  casing.position.set(staging.x, staging.y, STAGING_CASING_Z_M);
  group.add(casing);

  return {
    group,
    dispose: () => {
      dotGeometry.dispose();
      dotMaterial.dispose();
      casingGeometry.dispose();
      casingMaterial.dispose();
      leg?.dispose();
    },
  };
}
