// The gesture rules both map surfaces share: which gesture a press starts, when
// a drag is a drag, which way it aims, and what a rubber band selects. Pure, so
// both canvases use one copy (they once had deadzones drifting to 8 and 10 px).

import type { EditMode, EditTool, VertexTool, ZoneTool } from "@/lib/map/editor";

/**
 * CSS px below which a press that moved is still a click, for every use on
 * both surfaces. Screen px, not metres, which would vary with perspective.
 */
export const DRAG_DEADZONE_PX = 10;

/**
 * One toolbar Zoom in / out step on both surfaces (view scale in 2D, camera
 * distance in 3D). √2 so two presses are exactly one doubling.
 */
export const ZOOM_STEP_FACTOR = Math.SQRT2;

/** How far one pixel of wheel travel zooms, as an exponent; see wheelZoomFactor. */
const ZOOM_PER_PX = 0.0015;
/** One wheel "line" (Firefox's deltaMode 1) in px. */
const WHEEL_LINE_PX = 16;

/**
 * How much a wheel event zooms, on both surfaces.
 *
 * Line (Firefox) and page deltas are converted to px first, or a notch would
 * zoom ~16x; a page is the surface height the caller passes. Exponential, so
 * N notches up then N down returns to the same scale.
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
 * The heading in degrees of a map-frame displacement (x right, y up, CCW
 * positive), or null for none — a zero vector has no direction, so the caller
 * keeps its heading. The editor passes a screen delta with y negated; the 3D
 * viewport a floor-raycast world delta, since its camera can face any way.
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
  | "stroke"
  /** Add a corner to the forbidden zone in flight, or close it. */
  | "point";

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
  zoneTool: ZoneTool;
  /** The press landed on a waypoint marker. */
  onVertex: boolean;
}

/**
 * Which gesture a press starts.
 *
 * An armed tool claims the left button; right, middle and Space always pan,
 * so the operator never has to disarm to move the map. Each mode reads only
 * its own tool.
 *
 * Under Select, Shift on a marker toggles it and bare map starts a rubber
 * band; a finger has no Shift, so a tap toggles too (a finger re-aims under
 * Pan or Place). A plain mouse press on a marker re-aims it under either
 * waypoint tool. Under Place, bare map places a waypoint; the caller checks
 * it landed on the grid.
 *
 * Under Shape every press is a point; whether it adds or closes is
 * classifyZonePress's question, asked by the canvas because it needs the view.
 */
export function classifyPress(input: PressInput): PressIntent {
  const { button, spacePan, shiftKey, touch, mode, tool, vertexTool, zoneTool, onVertex } = input;
  const panning =
    button === 1 ||
    button === 2 ||
    spacePan ||
    (mode === "grid" && tool === "pan") ||
    (mode === "vertex" && vertexTool === "pan") ||
    (mode === "zone" && zoneTool === "pan");
  if (panning) return "pan";
  if (mode === "grid") return "stroke";
  if (mode === "zone") return "point";
  if (vertexTool === "select") {
    if (onVertex && (shiftKey || touch)) return "toggle";
    if (!onVertex) return "marquee";
  }
  return "aim";
}

/**
 * Whether a pan press that turns out a click picks a waypoint: only a plain
 * left press with Pan armed in waypoint mode, so right/middle/Space pan never
 * change the selection.
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

/** Whether a band never opened (a click): both sides inside the deadzone, since a thin band is a real selection. */
export function bandIsClick(band: Band): boolean {
  return (
    band.right - band.left < DRAG_DEADZONE_PX &&
    band.bottom - band.top < DRAG_DEADZONE_PX
  );
}

/** Ids of the markers whose centres lie inside the band, edges included; a waypoint has no extent. */
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
