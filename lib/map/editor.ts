// The floor plan editor's vocabulary: what a press can mean, the gesture in
// flight, and the state a frame is drawn from. In lib/ because lib/map/draw.ts
// reads it; the component still owns the state machine.

import { FREE, OCCUPIED, UNKNOWN, type Cell, type GridValue } from "@/lib/map/grid";
import type { ZoneAnchor, ZoneCornerRef, ZonePoint, ZonePolygon } from "@/lib/map/zone";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

export type EditTool = "brush" | "line" | "rect" | "pan";

/**
 * What a press means in vertex mode. A separate axis from EditTool (they share
 * only "pan"), so switching modes never lands on a tool that cannot exist
 * there, and each mode keeps its own tool across the toggle.
 */
export type VertexTool = "pan" | "place" | "select";

/**
 * What a press means with a forbidden zone chosen, a third axis for
 * VertexTool's reason. Shape adds corners and closes on the first
 * (lib/map/zone.ts); an open-barrier Line tool was deliberately left out.
 */
export type ZoneTool = "pan" | "shape";

/**
 * What a press on the canvas means: "grid" paints cells, "vertex" places and
 * aims vertices, "zone" collects zone corners. One canvas for all three,
 * because there is exactly one view transform (lib/map/view.ts).
 */
export type EditMode = "grid" | "vertex" | "zone";

/**
 * What a press on the map puts there: a cell value, a waypoint, or a forbidden
 * zone — the editor's first choice, which the rest of the toolbar follows.
 *
 * `null` (nothing chosen) is the opening state: only Pan, so an operator who
 * opened a map to look at it cannot mark it by accident.
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
 * The editor state a Draw choice puts the canvas in. `value` only for a paint
 * kind, so the paint byte, brush and tool survive a detour to waypoints.
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
 * A Draw button's swatch: the byte itself as a grey, since cells are blitted
 * literally (lib/map/render.ts), so it cannot drift from what a stroke paints.
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
   * Position plus heading in degrees. On an existing vertex the position is its
   * stored one, unchanged (see GridCanvas's handlePointerDown).
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
       * What a click (release inside the deadzone) selects, or null. Only a
       * left press with Pan armed in vertex mode sets it: right/middle/Space
       * pan must not change the selection.
       */
      pick: { id: string | null } | null;
    }
  /** A rubber band over the vertex layer. */
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
   * Placing or aiming a vertex. Like every gesture it lives in a ref, not
   * React state, so pointer-rate updates do not re-render the toolbar.
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
   * A press with Shape armed. A click adds a corner, closes the shape or
   * selects a zone; a drag pans the map, or moves the corner/handle the press
   * landed on.
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
      /** The corner the press landed on and where the drag has it; the shell hears on release. */
      corner: (ZoneCornerRef & { at: ZonePoint }) | null;
    };

/**
 * What a frame is drawn from: a narrow slice the component's props satisfy
 * structurally, so a draw function never sees a nonce, callback or session.
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
  /** The finished zone's corner the shape in flight is attached to (see mergeIntoZone). */
  zoneDraftAnchor: ZoneAnchor | null;
  /** The finished zones the operator pressed, the ones Remove would take. */
  selectedZoneIds: readonly string[];
}
