// What a pointer gesture means on the two map surfaces, as rules rather than
// handlers: which gesture a press starts, when a drag is a drag rather than a
// click, which way a drag aims, and what a rubber band selects.
//
// The canvases keep everything that touches a canvas, a cell buffer, pointer
// capture or React. What is here is the decision each of those acts on, pure
// so vitest can hold it. Most of it used to be inline in grid-canvas.tsx's
// pointer handlers, and the heading rule was written twice, once in each
// canvas, with deadzones that had drifted to 8 px and 10 px.

import type { EditMode, EditTool, VertexTool } from "@/lib/map/editor";

/**
 * Screen distance, in CSS px, below which a press that moved is still a
 * click. One number for both map surfaces and every use on them: whether a
 * drag aims a heading, whether a Pan-tool press picks a waypoint, and whether
 * a rubber band opened. Screen pixels rather than metres, because a metric
 * threshold would be huge at the far end of a perspective view and tiny up
 * close.
 */
export const DRAG_DEADZONE_PX = 10;

/**
 * How much one press of a toolbar's Zoom in / Zoom out changes the view, on
 * both map surfaces: the floor plan editor scales its view transform by it,
 * the 3D viewport scales the camera's distance to its target by it. One number
 * so a step feels the same size whichever map the operator is looking at;
 * √2 so two presses are exactly one doubling, which is where the wheel and the
 * pinch already land after a comfortable nudge.
 */
export const ZOOM_STEP_FACTOR = Math.SQRT2;

/** How far one pixel of wheel travel zooms, as an exponent; see wheelZoomFactor. */
const ZOOM_PER_PX = 0.0015;
/** One wheel "line" (Firefox's deltaMode 1) in px. */
const WHEEL_LINE_PX = 16;

/**
 * How much a wheel event zooms the view it landed on, on both map surfaces.
 *
 * deltaMode 1 is lines (Firefox) and 2 is pages; a raw deltaY would zoom ~16x
 * per notch there, so each unit is turned into pixels first — a page being
 * the height of the surface, which the caller passes. Exponential rather than
 * 1 + k·delta so zoom is multiplicative: N notches up then N down returns to
 * the same scale, which is what makes a wheel feel like a dial and not a
 * spring.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const unit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? pageHeight : 1;
  return Math.exp(-deltaY * unit * ZOOM_PER_PX);
}

/** Whether a pointer that went from one screen point to another dragged. */
export function isDrag(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= DRAG_DEADZONE_PX;
}

/**
 * The heading, in degrees, of a displacement in the map frame (ROS: x right,
 * y up, counter-clockwise positive), or null for no displacement.
 *
 * Null rather than 0, because a zero vector has no direction and 0° is a
 * claim. The caller keeps whatever heading it had. The floor plan editor
 * passes a screen delta with y negated, since canvas rows grow downward. The
 * 3D viewport passes a world delta raycast from the floor, because its camera
 * can look from any azimuth and screen-right is not world +x.
 */
export function headingDegrees(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** What a press on the floor plan editor starts. */
export type PressIntent =
  /** Drag the view. */
  | "pan"
  /** Add or remove the pressed waypoint from the selection, and nothing else. */
  | "toggle"
  /** Draw a rubber band over the waypoints. */
  | "marquee"
  /** Place a waypoint, or re-aim the pressed one. */
  | "aim"
  /** Paint cells with the armed brush, line or rectangle. */
  | "stroke";

export interface PressInput {
  /** `PointerEvent.button`: 0 left, 1 middle, 2 right. */
  button: number;
  /** Space is held, which turns any press into a pan. */
  spacePan: boolean;
  /** The press is a finger, which has no Shift. */
  touch: boolean;
  shiftKey: boolean;
  mode: EditMode;
  tool: EditTool;
  vertexTool: VertexTool;
  /** The press landed on a waypoint marker. */
  onVertex: boolean;
}

/**
 * Which gesture a press starts.
 *
 * Both modes open with Pan armed, and arming a brush or a waypoint tool is
 * what claims the left button. Right and middle pan regardless, so the
 * operator never has to disarm to reach another part of the map, and Space
 * pans with any button. Each mode reads its own tool and ignores the other's,
 * which keeps the mode toggle from carrying an armed tool across.
 *
 * With Select armed, Shift on a marker toggles it and arms nothing, and a
 * press on bare map starts a rubber band. A finger has no Shift, so under
 * Select a plain tap on a marker toggles it too — re-aiming is still there
 * under Pan and Place, which is where a finger does it. A plain mouse press
 * on a marker re-aims it under either waypoint tool, so fixing a heading
 * does not depend on which tool is held. With Place armed, bare map places
 * a new waypoint; the caller still has to check the press landed on the grid.
 */
export function classifyPress(input: PressInput): PressIntent {
  const { button, spacePan, shiftKey, touch, mode, tool, vertexTool, onVertex } = input;
  const panning =
    button === 1 ||
    button === 2 ||
    spacePan ||
    (mode === "grid" && tool === "pan") ||
    (mode === "vertex" && vertexTool === "pan");
  if (panning) return "pan";
  if (mode === "grid") return "stroke";
  if (vertexTool === "select") {
    if (onVertex && (shiftKey || touch)) return "toggle";
    if (!onVertex) return "marquee";
  }
  return "aim";
}

/**
 * Whether a pan press doubles as a waypoint pick when it turns out to be a
 * click. Only a plain left press with Pan armed in waypoint mode does: right,
 * middle and Space pan work under every tool, and must not also change the
 * selection.
 */
export function panPicks(input: Pick<PressInput, "button" | "spacePan" | "mode" | "vertexTool">): boolean {
  return (
    input.mode === "vertex" &&
    input.vertexTool === "pan" &&
    input.button === 0 &&
    !input.spacePan
  );
}

/** A rubber band's extent in screen px, whichever corner it was dragged from. */
export interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function bandBetween(ox: number, oy: number, cx: number, cy: number): Band {
  return {
    left: Math.min(ox, cx),
    right: Math.max(ox, cx),
    top: Math.min(oy, cy),
    bottom: Math.max(oy, cy),
  };
}

/**
 * Whether a band never opened, which makes it a click on bare map. Both
 * sides have to stay inside the deadzone: a long thin band is a real
 * selection of the markers along it.
 */
export function bandIsClick(band: Band): boolean {
  return (
    band.right - band.left < DRAG_DEADZONE_PX &&
    band.bottom - band.top < DRAG_DEADZONE_PX
  );
}

/**
 * The ids of the markers whose centres lie inside the band, edges included.
 * Centres, not hit radii: a waypoint is a pose with no extent, so "inside the
 * rectangle" is the only test that matches what the operator drew around.
 */
export function idsInBand(
  band: Band,
  markers: Iterable<{ id: string; cx: number; cy: number }>,
): string[] {
  const ids: string[] = [];
  for (const marker of markers) {
    if (
      marker.cx >= band.left &&
      marker.cx <= band.right &&
      marker.cy >= band.top &&
      marker.cy <= band.bottom
    ) {
      ids.push(marker.id);
    }
  }
  return ids;
}
