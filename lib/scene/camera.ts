// Camera policy: what the mouse and touch buttons do, and how a map is framed.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Wire the OrbitControls buttons for a camera mode.
 *  - "move":  left-drag pans (moves the view), right-drag orbits.
 *  - "focus": left-drag orbits around the locked target; panning is disabled
 *    so the target stays pinned to the robot.
 * Middle button always dollies (zoom).
 *
 * An armed pick mode overrides the left button entirely: a left-drag then has to
 * produce a pose, not move the camera. Mapping it to null (OrbitControls falls
 * through to its no-action default) rather than disabling the controls outright
 * keeps right-drag orbit and wheel zoom live, so the operator can still look
 * around while placing a pose.
 *
 * `touches` has to be set alongside `mouseButtons` and not instead of it:
 * OrbitControls keeps two entirely separate mapping tables and consults
 * `touches` for every pointer of `pointerType === "touch"`, so a mouse mapping
 * alone leaves a phone on the library defaults (ONE: ROTATE, TWO: DOLLY_PAN)
 * whatever mode the console is in. That is what made the viewport impossible to
 * pan by dragging on a tablet — one finger orbited in *both* modes, and there
 * was no gesture left that moved the view — and it also let a one-finger drag
 * swing the camera while a pick was armed, which the mouse mapping expressly
 * forbids.
 *
 * The touch table mirrors the mouse one rather than inventing a second
 * vocabulary: one finger does what the left button does, two fingers do what
 * the right button does plus pinch-zoom (there is no wheel to carry it). In
 * "focus" that second gesture is DOLLY_PAN rather than DOLLY_ROTATE only
 * because one finger already rotates there; with `enablePan` off the pan half
 * is inert, so it degrades to the pinch-zoom the mode needs.
 *
 * `zoomToCursor` tracks the mode for the same reason `enablePan` does. In "move"
 * the wheel has to close in on whatever is under the pointer, not on the orbit
 * target: OrbitControls' default dolly slides the camera straight down the
 * view axis, so the screen centre is the only thing zoom can ever approach, and
 * reaching a corner of a warehouse map costs a zoom-pan-zoom-pan crawl. The
 * gridmap editor already anchors its wheel at the cursor (`zoomAt` in
 * lib/map/view.ts), so this is also what makes the two views behave alike.
 *
 * In "focus" it stays off, and not just as a preference: zoom-to-cursor works by
 * shifting the *target* toward the pointer ray, and the render loop reassigns
 * `controls.target` to the robot pose every frame (see `stepPose`). The shift
 * would be overwritten a frame later, leaving the camera swung off-axis with the
 * robot snapping back to centre — a lurch per wheel notch. A locked target is
 * the whole point of focus mode, so zoom there belongs on the axis to the robot.
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

// Fallback world framing when no 2D map is available (e.g. a raw body_cloud
// render test with no map_server running). Points arrive near the LIO odom
// origin, so a modest span centred on the origin frames them sensibly.
export const DEFAULT_SPAN_M = 20;

/** The rectangle a scene was built around, in metres on the z=0 floor. */
export interface MapFrame {
  cx: number;
  cy: number;
  widthM: number;
  heightM: number;
}

/**
 * The view the viewport opens on: aimed at the map's centre from south of it
 * and above, far enough back that the whole extent is in the frame at a
 * three-quarter tilt.
 *
 * Written once and called twice — by the scene setup, and by the toolbar's
 * Recenter — so "back to the opening view" cannot drift from the opening
 * view. The framing is deliberately oblique rather than overhead: overhead is
 * what Top down is for, and a recenter that also flattened the view would take
 * away the depth an operator went looking for by orbiting.
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
 * Closest a zoom step may bring the camera to its target, in metres.
 *
 * Not the near plane: at that distance the floor under the target is already
 * clipped and the next step would put the camera through the target and flip
 * the view. Half a metre is well inside where the wheel stops being useful on
 * a robot-scale scene and keeps the step monotonic.
 */
export const MIN_DOLLY_M = 0.5;

/**
 * Move the camera one zoom step along its line to the target: `factor` above 1
 * closes in by that ratio, below 1 backs off.
 *
 * Expressed about the target and not as a shift of it, on purpose. In focus
 * mode the render loop pins `controls.target` to the robot every frame, so a
 * zoom that moved the target (the way zoom-to-cursor does) would be undone a
 * frame later; scaling the camera's offset from the target is the one form of
 * zoom both modes agree on, and it is also what OrbitControls' own dolly does
 * internally. That method is private, hence this.
 */
export function dollyStep(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  factor: number,
) {
  const offset = camera.position.clone().sub(controls.target);
  // A camera sitting on its target has no line to move along; leave it, rather
  // than normalise a zero vector into NaN and lose the view.
  if (offset.lengthSq() === 0) return;
  offset.setLength(Math.max(offset.length() / factor, MIN_DOLLY_M));
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

/**
 * How far south of the target an overhead camera is parked, as a fraction of its
 * height.
 *
 * A camera placed *exactly* above its target in a z-up world has its up vector
 * parallel to its view direction, which is undefined for both the projection and
 * OrbitControls' spherical maths — the view snaps to an arbitrary azimuth and
 * the first orbit drag flips it. About a degree off vertical costs nothing that
 * reads as tilt and pins map +y to the top of the screen, which is the
 * orientation the gridmap editor and every site plan use.
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
  // The vertical fov is the fixed one; the horizontal follows from the aspect,
  // so a wide, short map is framed by its width and a tall one by its height.
  const forHeight = heightM / 2 / Math.tan(halfFov);
  const forWidth = widthM / 2 / (Math.tan(halfFov) * camera.aspect);
  return Math.max(forHeight, forWidth) * TOP_DOWN_MARGIN;
}
