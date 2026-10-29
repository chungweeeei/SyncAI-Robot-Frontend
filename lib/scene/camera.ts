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
 * `zoomToCursor` is on in "move" so the wheel closes in on the pointer. It is off in "focus" because it works by shifting
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

// Fallback framing with no 3D map up, around the robot (see fallbackFrame).
export const DEFAULT_SPAN_M = 20;

/** The rectangle a scene was built around, in metres on the z=0 floor. */
export interface MapFrame {
  cx: number;
  cy: number;
  widthM: number;
  heightM: number;
}

/**
 * The box a view frames with no 3D map to frame: DEFAULT_SPAN_M around the
 * robot, or around the origin before it has reported. Not the origin always:
 * the scan is drawn in the frame the pose is, which in Navigation is the
 * loaded map's, where the robot can stand tens of metres from the origin —
 * only a mapping run starts it there.
 */
export function fallbackFrame(robot: { x: number; y: number } | null): MapFrame {
  return {
    cx: robot?.x ?? 0,
    cy: robot?.y ?? 0,
    widthM: DEFAULT_SPAN_M,
    heightM: DEFAULT_SPAN_M,
  };
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
  /** The height the view looks at: the floor on show's lift (see liftView). */
  z = 0,
) {
  fitDollyRange(controls, frame);
  const span = Math.max(frame.widthM, frame.heightM);
  camera.position.set(frame.cx, frame.cy - span * 0.6, z + span * 0.8);
  controls.target.set(frame.cx, frame.cy, z);
  controls.update();
}

/** How long a floor switch takes to carry the view to the new floor, ms. */
export const FLOOR_LIFT_MS = 400;

/**
 * Carry the whole view up or down by `dz` metres: the camera and what it
 * orbits about together, so the angle, the zoom and the spot looked at stay
 * as the operator left them. A floor switch done this way puts the new
 * floor where the old one was on screen, as a lift does, where moving only
 * the band left 2F floating three metres over a pivot on the ground floor.
 */
export function liftView(camera: THREE.PerspectiveCamera, controls: OrbitControls, dz: number) {
  camera.position.z += dz;
  controls.target.z += dz;
}

/** Ease in and out over `[0, 1]`, cubic: a lift that starts and stops gently. */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/**
 * Closest a zoom step may bring the camera to its target, in metres. Not the
 * near plane, where the next step would pass through the target and flip the view.
 */
export const MIN_DOLLY_M = 0.5;

/**
 * How far out the wheel may take the camera, in map spans: past every
 * framing (an overhead view of a map on a phone held upright is under two).
 */
export const MAX_DOLLY_SPANS = 4;

/**
 * Bound the wheel and the pinch to a map's scale. OrbitControls scales the
 * distance to the target by a fixed ratio a notch and clamps it to
 * `[minDistance, maxDistance]`, which default to 0 and Infinity: a distance
 * that only approaches 0 never stops, so every notch past where the view
 * stopped changing was one more to scroll back. Clamped, a notch at either
 * end does nothing, and the first one the other way moves the camera.
 *
 * The nearest is `MIN_DOLLY_M`, the zoom buttons' own stop, or a quarter of
 * a map smaller than two metres so its framing is not already the stop; the
 * farthest is MAX_DOLLY_SPANS of the map, or of the fallback box. Every
 * framing calls this with the box it frames, so no framing is clamped short.
 */
export function fitDollyRange(controls: OrbitControls, frame: MapFrame) {
  const span = Math.max(frame.widthM, frame.heightM, 0);
  controls.minDistance = Math.min(MIN_DOLLY_M, span / 4);
  controls.maxDistance = Math.max(MAX_DOLLY_SPANS * span, DEFAULT_SPAN_M);
}

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

/** The heights a side-on view frames when there is no 3D map to measure: ground to head. */
export const FRONT_DEFAULT_Z: { lo: number; hi: number } = { lo: -0.5, hi: 2 };

/**
 * Look at the map level from the south, along +y: storeys stack as bands,
 * which no view from above can show. `frame` sets the width and where the
 * camera stands, `z` the heights it must fit. The camera stands back from
 * the near edge of the box, not from its centre, so what is nearest is
 * framed too; the target sits in the box's middle so an orbit from here
 * turns about the map rather than its front wall.
 */
export function frontView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  frame: MapFrame,
  z: { lo: number; hi: number },
) {
  fitDollyRange(controls, frame);
  const cz = (z.lo + z.hi) / 2;
  const distance = overheadDistance(camera, frame.widthM, z.hi - z.lo);
  controls.target.set(frame.cx, frame.cy, cz);
  camera.position.set(frame.cx, frame.cy - frame.heightM / 2 - distance, cz);
  controls.update();
}

/**
 * The same side-on view about a target that must stay put (focus mode's
 * robot): level with it, due south, at the distance the operator zoomed to.
 */
export function frontViewAround(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const distance = camera.position.distanceTo(controls.target);
  camera.position.set(controls.target.x, controls.target.y - distance, controls.target.z);
  controls.update();
}

/**
 * The 3D view's controls. With no tool armed the primary button orbits
 * (nothing here aims a goal, unlike the dashboard), right-drag pans, one
 * finger orbits and two pan and pinch. With a brush or Waypoint armed the
 * primary button and one finger are the tool's, so OrbitControls is told to
 * ignore them; right-drag still orbits, the middle button pans, and two
 * fingers still pan and pinch. The wheel zooms to the cursor either way.
 */
export function applyMap3dControls(controls: OrbitControls, armed: boolean) {
  controls.enablePan = true;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = armed
    ? { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = {
    ONE: armed ? null : THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
}

/**
 * The 3D view's opening view: `frameMap`'s three-quarter view, with the
 * target on the floor the shown heights mostly stand on rather than at z=0.
 * The middle of the screen is then the middle of the map on that floor,
 * which is where a press there paints.
 */
export function frameGround(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  frame: MapFrame,
  floorZ: number,
) {
  fitDollyRange(controls, frame);
  const span = Math.max(frame.widthM, frame.heightM);
  const place = () => {
    camera.position.set(frame.cx, frame.cy - span * 0.6, floorZ + span * 0.8);
    controls.target.set(frame.cx, frame.cy, floorZ);
  };
  // A drag that just ended leaves damping's leftover turn in the controls,
  // which would carry the camera off the framing over the next second. One
  // undamped update spends it, then the framing is set again on top.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  place();
  controls.update();
  place();
  controls.update();
  controls.enableDamping = damping;
}
