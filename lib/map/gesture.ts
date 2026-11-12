// The gesture rules every canvas shares: when a drag is a drag, which way it
// aims, and how far a toolbar zoom goes. Pure, so every surface uses one copy (two
// once had deadzones drifting to 8 and 10 px).

import type { PlanarPose } from "@/lib/types/robot";

/**
 * CSS px below which a press that moved is still a click, for every use on
 * every surface. Screen px, not metres, which would vary with perspective.
 */
export const DRAG_DEADZONE_PX = 10;

/**
 * One toolbar Zoom in / out step (camera distance). √2 so two presses are exactly one doubling.
 */
export const ZOOM_STEP_FACTOR = Math.SQRT2;

/** Whether a pointer that went from one screen point to another dragged. */
export function isDrag(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= DRAG_DEADZONE_PX;
}

/**
 * The heading in degrees of a map-frame displacement (x right, y up, CCW
 * positive), or null for none — a zero vector has no direction, so the caller
 * keeps its heading. A 3D view passes a floor-raycast world delta, since its
 * camera can face any way.
 */
export function headingDegrees(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** A press planted on the ground: the pointer that made it, where, and where on screen. */
export interface PlaceAnchor {
  pointerId: number;
  /** Map-frame metres. */
  wx: number;
  wy: number;
  /** CSS px, which the aim's deadzone is measured in: metres vary with depth. */
  cx: number;
  cy: number;
}

/** A pose being placed: the dashboard's goal, initial pose and waypoint, the editor's Place. */
export interface PlaceState {
  /** Set once a press has planted the pose; until then it may be carried. */
  anchor: PlaceAnchor | null;
  /** The pose the draft marker shows, or null for none. */
  draft: PlanarPose | null;
  /** Whether the draft follows the bare pointer rather than standing where it was pressed. */
  carrying: boolean;
}

export const PLACE_IDLE: PlaceState = { anchor: null, draft: null, carrying: false };

/** Where a pointer meets the ground a pose is placed on, or null off it. */
export type PlaceCast = () => { wx: number; wy: number } | null;

export type PlaceEvent =
  | {
      type: "press";
      pointerId: number;
      primary: boolean;
      cx: number;
      cy: number;
      cast: PlaceCast;
      /** The heading a draft starts at when there is none to keep. */
      seedTheta: number;
    }
  | {
      type: "move";
      pointerId: number;
      primary: boolean;
      cx: number;
      cy: number;
      cast: PlaceCast;
      /**
       * Where the pointer is for aiming a planted pose, when that is looser
       * than where one may stand (a heading may point off the map). `cast`
       * when omitted.
       */
      aim?: PlaceCast;
      seedTheta: number;
      /**
       * Whether the pose rides under the pointer before a press. Not for a
       * goal, where a trailing arrow would read as a goal already set.
       */
      carries: boolean;
    }
  | { type: "release"; pointerId: number }
  /** A second finger, a cancelled pointer, a tool disarmed: never a commit. */
  | { type: "abandon" }
  /** The pointer left the view: a carried pose goes, a planted one stays. */
  | { type: "leave" };

/**
 * The placing gesture every 3D view shares: the pose is carried under the
 * pointer, a press plants it, a drag past the deadzone only aims it, and
 * only the lift of the pointer that planted it commits. A second press is a
 * pinch's second finger and abandons the pose, because only a deliberate
 * release may send the robot anywhere. The casts stay the caller's: which
 * ground, and what counts as off the map, differ by view.
 */
export function placeGesture(
  state: PlaceState,
  event: PlaceEvent,
): { state: PlaceState; commit: PlanarPose | null } {
  const stay = { state, commit: null };
  const seed = (fallback: number) => state.draft?.theta ?? fallback;
  switch (event.type) {
    case "press": {
      if (state.anchor || !event.primary) return { state: PLACE_IDLE, commit: null };
      const hit = event.cast();
      if (!hit) return stay;
      return {
        state: {
          anchor: { ...hit, pointerId: event.pointerId, cx: event.cx, cy: event.cy },
          // The carried heading is kept, so a plain click does not snap to 0°.
          draft: { x: hit.wx, y: hit.wy, theta: seed(event.seedTheta) },
          carrying: false,
        },
        commit: null,
      };
    }
    case "move": {
      if (!event.primary) return stay;
      const { anchor } = state;
      if (!anchor) {
        if (!event.carries) return stay;
        const hit = event.cast();
        if (!hit) return { state: { ...state, draft: null }, commit: null };
        return {
          state: {
            anchor: null,
            draft: { x: hit.wx, y: hit.wy, theta: seed(event.seedTheta) },
            carrying: true,
          },
          commit: null,
        };
      }
      if (anchor.pointerId !== event.pointerId) return stay;
      // Planted: the drag only aims, past the shared deadzone.
      let theta = seed(event.seedTheta);
      if (isDrag(anchor.cx, anchor.cy, event.cx, event.cy)) {
        // World-space, not the screen delta: the camera may face any azimuth.
        const hit = (event.aim ?? event.cast)();
        if (hit) theta = headingDegrees(hit.wx - anchor.wx, hit.wy - anchor.wy) ?? theta;
      }
      return {
        state: { ...state, draft: { x: anchor.wx, y: anchor.wy, theta } },
        commit: null,
      };
    }
    case "release":
      if (!state.anchor || state.anchor.pointerId !== event.pointerId) return stay;
      return { state: PLACE_IDLE, commit: state.draft };
    case "abandon":
      return { state: PLACE_IDLE, commit: null };
    case "leave":
      return state.anchor ? stay : { state: PLACE_IDLE, commit: null };
  }
}
