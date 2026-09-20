// The gridmap editor's vocabulary: what a press can mean, what a gesture is in
// flight, and the slice of editor state a frame is drawn from.
//
// Here rather than in components/maps/grid-canvas.tsx because lib/map/draw.ts
// reads these, and a drawing module that imports a component's props type is
// the layering arrow pointing backwards. The component still owns the state
// machine; this owns the words it is written in.

import type { Cell, GridValue } from "@/lib/map/grid";
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
 * What a press on the canvas means.
 *
 * "grid" paints cells; "vertex" places and aims map vertices and never touches
 * the cell buffer. The two share one canvas rather than getting one each
 * because lib/map/view.ts's rule is that there is exactly one view transform
 * and every handler reads the same one — a second layer would have to be handed
 * `viewRef`, which is the one thing GridCanvas does not expose.
 */
export type EditMode = "grid" | "vertex";

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
}
