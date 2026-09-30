// The gridmap editor's vocabulary: what a press can mean, what a gesture is in
// flight, and the slice of editor state a frame is drawn from.
//
// Here rather than in components/maps/grid-canvas.tsx because lib/map/draw.ts
// reads these, and a drawing module that imports a component's props type is
// the layering arrow pointing backwards. The component still owns the state
// machine; this owns the words it is written in.

import { FREE, OCCUPIED, UNKNOWN, type Cell, type GridValue } from "@/lib/map/grid";
import type { ZoneAnchor, ZoneCornerRef, ZonePoint, ZonePolygon } from "@/lib/map/zone";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

export type EditTool = "brush" | "line" | "rect" | "pan";

/**
 * What a press means in vertex mode, the counterpart to EditTool in grid mode.
 *
 * A separate axis rather than three more members of EditTool, because the two
 * sets share only "pan" and nothing carries over: an operator who left Brush
 * armed and switched to vertex mode would otherwise arrive holding a tool that
 * cannot exist there, and the shell would have to translate anyway. Two states
 * also mean the mode toggle does not disturb either one — which is what lets
 * grid mode keep the brush it had while vertex mode keeps its own resting Pan.
 */
export type VertexTool = "pan" | "place" | "select";

/**
 * What a press means with a forbidden zone chosen: the third tool axis, for
 * VertexTool's reason — it shares only Pan with the other two, and a separate
 * state is what lets every Draw choice land on its own resting Pan.
 *
 * Shape is the only tool that draws: a press adds a corner, and the shape
 * closes on its first corner (see lib/map/zone.ts). A Line tool — an open
 * barrier the robot must not cross — was deliberately left out of this
 * version, so the axis is two members and not three.
 */
export type ZoneTool = "pan" | "shape";

/**
 * What a press on the canvas means.
 *
 * "grid" paints cells; "vertex" places and aims map vertices and never touches
 * the cell buffer; "zone" collects the corners of a forbidden zone and touches
 * neither. All three share one canvas rather than getting one each because
 * lib/map/view.ts's rule is that there is exactly one view transform and every
 * handler reads the same one — a second layer would have to be handed
 * `viewRef`, which is the one thing GridCanvas does not expose.
 */
export type EditMode = "grid" | "vertex" | "zone";

/**
 * What the operator has chosen to put on the floor plan: one of the three cell
 * values, waypoints, or a forbidden zone.
 *
 * The editor's first choice, and the one the rest of its toolbar follows from.
 * It folds together two controls that used to be separate — a Grid / Waypoints
 * mode switch and a Paint row — because they were one question asked twice:
 * "what does a press on the map put there?" Painting Floor and placing a
 * waypoint are both answers to it, and a mode switch that had to be flipped
 * before the answer could be given was a step with nothing in it.
 *
 * `null` is a real state, and the one the editor opens in: nothing is chosen,
 * only Pan is offered, and a press on the map can only move the view. The same
 * reasoning as DEFAULT_TOOL, one step further — an operator who opened a map
 * to look at it cannot mark it by accident.
 */
export type DrawKind = "wall" | "floor" | "unknown" | "waypoint" | "zone";

/** The kinds that paint cells — the ones with a byte and a swatch. */
export type PaintKind = Exclude<DrawKind, "waypoint" | "zone">;

/** The byte each paint kind writes. Wall is an obstacle, Floor is free space. */
const DRAW_VALUE: Record<PaintKind, GridValue> = {
  wall: OCCUPIED,
  floor: FREE,
  unknown: UNKNOWN,
};

export function isPaintKind(kind: DrawKind | null): kind is PaintKind {
  return kind !== null && kind in DRAW_VALUE;
}

/**
 * The editor state a Draw choice puts the canvas in.
 *
 * `value` is present only for a paint kind; for waypoints, zones and nothing
 * the current paint byte is left alone, so picking Wall again later finds the
 * brush size and tool the operator left. `panOnly` is the resting state's rule:
 * with nothing chosen, Pan is the only tool there is.
 */
export function editStateOf(kind: DrawKind | null): {
  mode: EditMode;
  value?: GridValue;
  panOnly: boolean;
} {
  if (kind === "waypoint") return { mode: "vertex", panOnly: false };
  if (kind === "zone") return { mode: "zone", panOnly: false };
  if (kind === null) return { mode: "grid", panOnly: true };
  return { mode: "grid", value: DRAW_VALUE[kind], panOnly: false };
}

/**
 * The CSS colour a cell of this value is drawn in on the floor plan, for the
 * Draw buttons' swatches. The bytes are blitted literally as greys (see
 * lib/map/render.ts), so the swatch is the byte itself and cannot drift from
 * what a stroke will look like.
 */
export function drawSwatch(kind: PaintKind): string {
  const byte = DRAW_VALUE[kind];
  return `rgb(${byte} ${byte} ${byte})`;
}

/** What a completed vertex gesture produced. */
export interface VertexGesture {
  /** The vertex the press landed on, or null for a press on bare map. */
  id: string | null;
  /**
   * Position plus heading in degrees. For a press on an existing vertex the
   * position is that vertex's stored one, echoed back unchanged — see
   * GridCanvas's handlePointerDown on why the press point is not used there.
   */
  pose: PlanarPose;
}

export interface CellProbe {
  col: number;
  row: number;
  /** The byte under the cursor, so the status bar never needs the buffer. */
  byte: number;
}

export type Gesture =
  | { kind: "paint"; pointerId: number; last: Cell }
  | { kind: "shape"; pointerId: number; anchor: Cell; head: Cell }
  | {
      kind: "pan";
      pointerId: number;
      cx: number;
      cy: number;
      /** Press point, so release can tell a drag from a click. */
      ox: number;
      oy: number;
      /**
       * What a click — a release that never left the deadzone — should select,
       * or null when this pan resolves nothing. Only a left press with Pan armed
       * in vertex mode sets it: right/middle/Space pan work in every tool and
       * must not double as a way to change the selection.
       */
      pick: { id: string | null } | null;
    }
  /**
   * A rubber band over the vertex layer. Held in the ref like every other
   * gesture, for the same reason: it updates at pointer rate and the draw path
   * reads it directly, so pushing the rectangle through React state would
   * re-render the toolbar on every mouse move.
   */
  | {
      kind: "marquee";
      pointerId: number;
      /** Press point and current point, both container-local CSS px. */
      ox: number;
      oy: number;
      cx: number;
      cy: number;
      /** Shift was held: add to the selection rather than replace it. */
      additive: boolean;
    }
  /**
   * Placing or aiming a vertex. `theta` is held here rather than pushed to the
   * shell on every move: GridCanvas is memoized precisely so a gesture at
   * pointer rate cannot re-render the toolbar, and the draw path already reads
   * in-flight gesture state (drawPreview in lib/map/draw.ts does the same for a
   * line/rect).
   */
  | {
      kind: "vertex";
      pointerId: number;
      /** The vertex being aimed, or null when placing a new one. */
      id: string | null;
      /** Map frame, fixed for the whole gesture. */
      wx: number;
      wy: number;
      /** Press point in container-local CSS px, for the deadzone and the angle. */
      cx: number;
      cy: number;
      theta: number;
    }
  /**
   * A press with Shape armed. A release that never left the deadzone is a
   * click, which is what adds a corner, closes the shape or selects a zone —
   * the same click/drag split `pan.pick` makes, as a kind of its own because
   * it never picks a waypoint and `pan` must not learn a second nullable
   * payload. What the drag does depends on where the press landed: on bare
   * map it moves the map like `pan`; on a corner of the shape in flight, or
   * a handle of the selected finished zone, it moves that corner, so a
   * shape can be adjusted while it is drawn and after.
   */
  | {
      kind: "point";
      pointerId: number;
      /** Press point, so release can tell a drag from a click. */
      ox: number;
      oy: number;
      /** Last point, for the pan delta. */
      cx: number;
      cy: number;
      /** What the click does, decided at the press (classifyZonePress). */
      click:
        | { kind: "add"; point: ZonePoint }
        | { kind: "close" }
        /** Select this zone — added to the selection when `additive`. */
        | { kind: "select"; id: string; additive: boolean }
        /** Attach the shape to this finished zone's corner, or end it there. */
        | { kind: "anchor"; corner: ZoneCornerRef }
        | { kind: "merge"; corner: ZoneCornerRef }
        | { kind: "none" };
      /**
       * The corner the press landed on, and where the drag has carried it so
       * far. Held here rather than pushed to the shell on every move, for
       * `vertex.theta`'s reason: the draw path reads it at pointer rate and
       * the shell hears about it once, on release.
       */
      corner: (ZoneCornerRef & { at: ZonePoint }) | null;
    };

/**
 * What a frame is drawn from.
 *
 * Deliberately a narrow slice rather than GridCanvasProps: a draw function has
 * no business reading a nonce, a callback or a session. The component's props
 * satisfy this structurally, so nothing has to be threaded by hand.
 */
export interface DrawState {
  mode: EditMode;
  tool: EditTool;
  value: GridValue;
  brush: number;
  spacePan: boolean;
  vertices: MapVertex[];
  draft: PlanarPose | null;
  selectedIds: readonly string[];
  zoneTool: ZoneTool;
  /** Finished zones, drawn in every mode like the vertices. */
  zones: readonly ZonePolygon[];
  /** The corners of the shape in flight, oldest first. */
  zoneDraft: readonly ZonePoint[];
  /**
   * The finished zone's corner the shape in flight is attached to, when it
   * is: one of its corners is then that zone's, and another of that zone's
   * corners is where it ends (see mergeIntoZone in lib/map/zone.ts).
   */
  zoneDraftAnchor: ZoneAnchor | null;
  /** The finished zones the operator pressed, the ones Remove would take. */
  selectedZoneIds: readonly string[];
}
