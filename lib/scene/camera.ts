// Camera policy: what the mouse and touch buttons do, and how a map is framed.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Wire the OrbitControls buttons for a camera mode.
 *  - "move":  left-drag pans, right-drag orbits.
 *  - "focus": left-drag orbits the target, which stays pinned to the robot
 *    (no pan).
 * Middle button always dollies.
 *
 * An armed pick maps the left button to null rather than disabling the
 * controls, so right-drag orbit and wheel zoom stay live while placing a pose.
 *
 * `touches` must be set too: OrbitControls reads it, not `mouseButtons`, for
 * touch pointers, and its defaults made one finger orbit in both modes (no way
 * to pan on a tablet) and swing the camera mid-pick. It mirrors the mouse
 * table; two fingers add pinch-zoom. In "focus", DOLLY_PAN degrades to
 * pinch-zoom since pan is off.
 *
 * `zoomToCursor` is on in "move" so the wheel closes in on the pointer, as the
 * floor plan editor does. It is off in "focus" because it works by shifting
 * the target, which the render loop re-pins to the robot every frame
 * (`stepPose`) — a lurch per notch.
 */
export function applyCameraMode(
  controls: OrbitControls,
  mode: "move" | "focus",
  picking: boolean,
) {
  const orbit = mode === "focus";
  controls.enablePan = !orbit;
  controls.zoomToCursor = !orbit;
  controls.mouseButtons = {
    LEFT: picking ? null : orbit ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: picking ? null : orbit ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN,
    TWO: orbit ? THREE.TOUCH.DOLLY_PAN : THREE.TOUCH.DOLLY_ROTATE,
  };
}

// Fallback framing with no floor plan: points arrive near the odom origin.
export const DEFAULT_SPAN_M = 20;

/** The rectangle a scene was built around, in metres on the z=0 floor. */
export interface MapFrame {
  cx: number;
  cy: number;
  widthM: number;
  heightM: number;
}

/**
 * The opening view: the map's centre from south and above, at a three-quarter
 * tilt with the whole extent in frame. Shared with Recenter so the two cannot
 * drift; oblique on purpose, since overhead is Top down's job.
 */
export function frameMap(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  frame: MapFrame,
) {
  const span = Math.max(frame.widthM, frame.heightM);
  camera.position.set(frame.cx, frame.cy - span * 0.6, span * 0.8);
  controls.target.set(frame.cx, frame.cy, 0);
  controls.update();
}

/**
 * Closest a zoom step may bring the camera to its target, in metres. Not the
 * near plane, where the next step would pass through the target and flip the view.
 */
export const MIN_DOLLY_M = 0.5;

/**
 * Move the camera one zoom step along its line to the target (`factor` > 1
 * closes in). Scales the offset rather than moving the target, which focus
 * mode re-pins every frame — what OrbitControls' private dolly does too.
 */
export function dollyStep(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  factor: number,
) {
  const offset = camera.position.clone().sub(controls.target);
  // On the target there is no line to move along; normalising would give NaN.
  if (offset.lengthSq() === 0) return;
  offset.setLength(Math.max(offset.length() / factor, MIN_DOLLY_M));
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

/**
 * How far south of the target an overhead camera is parked, as a fraction of
 * its height. Exactly overhead in z-up, up is parallel to the view direction
 * and the azimuth is undefined; a degree off pins map +y to the top.
 */
export const TOP_DOWN_TILT = 0.02;

/** Slack around the map extent when framing it from overhead. */
const TOP_DOWN_MARGIN = 1.08;

/** Height at which a perspective camera frames a `widthM` x `heightM` rectangle. */
export function overheadDistance(
  camera: THREE.PerspectiveCamera,
  widthM: number,
  heightM: number,
): number {
  const halfFov = (camera.fov * Math.PI) / 360;
  // The vertical fov is fixed; the horizontal follows from the aspect.
  const forHeight = heightM / 2 / Math.tan(halfFov);
  const forWidth = widthM / 2 / (Math.tan(halfFov) * camera.aspect);
  return Math.max(forHeight, forWidth) * TOP_DOWN_MARGIN;
}
