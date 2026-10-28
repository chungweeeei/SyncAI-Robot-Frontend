// The task editor's route marks: where each stop is and which steps go
// there, drawn over its 3D map (lib/scene/route-marks.ts places them). Pure
// like lib/map/draw.ts, whose markers and palette it draws with.

import {
  MARKER_HALO,
  VERTEX_DOT_RADIUS,
  drawMarker,
  type Palette,
} from "@/lib/map/draw";
import type { MapVertex } from "@/lib/types/map";

/** The route's legs, thin enough to leave the markers and walls legible. */
const ROUTE_LINE_PX = 2;

/** The highlight's ring, clear of the marker's own halo. */
const HIGHLIGHT_RING_RADIUS = VERTEX_DOT_RADIUS + 5;

/** A caption candidate: where the marker's `G · name` text would sit. */
export interface CaptionCandidate {
  id: string;
  cx: number;
  cy: number;
  caption: string;
}

/** The caption font drawMarker uses, so a measurement here matches its draw. */
export const CAPTION_FONT = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
const CAPTION_HEIGHT = 11;
/** Breathing room between two captions before they count as touching. */
const CAPTION_GAP = 2;

/**
 * Which stops keep their name. Zoomed out, captions would smear together,
 * so they are placed greedily in priority order (the caller passes lit markers
 * first) and one overlapping an earlier box drops to its glyph. `measure` is
 * injected so this is testable without a canvas.
 */
export function planCaptions(
  candidates: readonly CaptionCandidate[],
  measure: (text: string) => number,
): Set<string> {
  const kept = new Set<string>();
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const { id, cx, cy, caption } of candidates) {
    // The same offset drawMarker uses: up and to the right of the dot.
    const x0 = cx + VERTEX_DOT_RADIUS + 4;
    const y1 = cy - VERTEX_DOT_RADIUS - 4;
    const box = { x0, y0: y1 - CAPTION_HEIGHT, x1: x0 + measure(caption), y1 };
    const collides = placed.some(
      (other) =>
        box.x0 < other.x1 + CAPTION_GAP &&
        box.x1 + CAPTION_GAP > other.x0 &&
        box.y0 < other.y1 + CAPTION_GAP &&
        box.y1 + CAPTION_GAP > other.y0,
    );
    if (collides) continue;
    placed.push(box);
    kept.add(id);
  }
  return kept;
}

/** Where a stop is drawn, CSS px, and its heading as the screen shows it. */
export interface PlacedStop {
  cx: number;
  cy: number;
  /** Degrees CCW from screen right, drawMarker's convention. */
  theta: number;
}

/**
 * The stops themselves, at wherever the caller put them on screen: the 3D
 * view's projection (lib/scene/route-marks.ts). A stop not in `placed` is not drawn.
 * The job's stops are lit and drawn last, the earliest stop on top, and
 * named first where captions would collide (`planCaptions`). `highlight`
 * rings one waypoint under everything, so its own marker stays legible.
 */
export function drawStops(
  ctx: CanvasRenderingContext2D,
  vertices: readonly MapVertex[],
  placed: ReadonlyMap<string, PlacedStop>,
  steps: ReadonlyMap<string, readonly number[]>,
  palette: Palette,
  highlight: string | null = null,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const shown = vertices.filter((vertex) => placed.has(vertex.id));
  const ordinals = (vertex: MapVertex) => steps.get(vertex.id) ?? [];
  // Lit stops by the first step that reaches them, latest first, so that in
  // the draw order below (rest, then lit) step 1 lands on top of them all.
  const lit = shown
    .filter((vertex) => ordinals(vertex).length > 0)
    .sort((a, b) => ordinals(b)[0] - ordinals(a)[0]);
  const rest = shown.filter((vertex) => ordinals(vertex).length === 0);
  // The name alone, with no type glyph and no stop numbers: next to a dozen
  // other captions, "M · lobby · stop 1" was three words to read past for
  // one. Which waypoints the job goes to is the lit colour and the route.
  const label = (vertex: MapVertex) => vertex.name;

  ctx.font = CAPTION_FONT;
  // Captions are placed lit first, earliest step first: the stops the job
  // goes to must stay legible whatever is around them.
  const captioned = planCaptions(
    [...[...lit].reverse(), ...rest].map((vertex) => {
      const at = placed.get(vertex.id)!;
      return {
        id: vertex.id,
        cx: at.cx,
        cy: at.cy,
        caption: label(vertex),
      };
    }),
    (text) => ctx.measureText(text).width,
  );

  const ringed = highlight === null ? undefined : placed.get(highlight);
  if (ringed) {
    ctx.beginPath();
    ctx.arc(ringed.cx, ringed.cy, HIGHLIGHT_RING_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = palette.cmd;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.cmd;
    ctx.stroke();
  }

  for (const vertex of [...rest, ...lit]) {
    const at = placed.get(vertex.id)!;
    const emphasis = ordinals(vertex).length > 0;
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: at.theta,
      colour: emphasis ? palette.cmd : palette.vertex,
      emphasis,
      glyph: null,
      label: captioned.has(vertex.id) ? label(vertex) : null,
      dashed: false,
    });
  }

  ctx.restore();
}

/**
 * The job's legs, stop to stop. Straight lines, not the planner's path: the
 * order is what this answers, and a line through a wall says nothing about
 * where the robot will really walk. An id with no stop (deleted, or on a
 * floor not shown) is skipped.
 */
export function drawRoute(
  ctx: CanvasRenderingContext2D,
  route: readonly string[],
  placed: ReadonlyMap<string, { cx: number; cy: number }>,
  colour: string,
): void {
  const path = new Path2D();
  let started = false;
  for (const id of route) {
    const at = placed.get(id);
    if (!at) continue;
    if (started) path.lineTo(at.cx, at.cy);
    else path.moveTo(at.cx, at.cy);
    started = true;
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Over a halo, as a marker is: a bare line vanished over the 3D map's
  // height colours.
  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = ROUTE_LINE_PX + 2;
  ctx.stroke(path);
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = ROUTE_LINE_PX;
  ctx.stroke(path);
  ctx.restore();
}
