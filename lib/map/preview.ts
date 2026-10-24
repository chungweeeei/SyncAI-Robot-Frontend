// The task editor's floor plan preview: where each stop is and which steps go
// there. Pure like lib/map/draw.ts, and drawn with the editor's own markers and
// palette so it is recognisably the same map.

import {
  MARKER_HALO,
  VERTEX_DOT_RADIUS,
  drawMarker,
  vertexScreen,
  type Palette,
} from "@/lib/map/draw";
import { stagingPose } from "@/lib/map/dock";
import { vertexGlyph } from "@/lib/map/vertex";
import { fitView, type Size, type View } from "@/lib/map/view";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

/** Which markers the preview lights up, and what it says about them. */
export interface PreviewMarks {
  /**
   * Vertex id → the 1-based numbers of the job's waypoint steps that go there,
   * in job order (lib/task/step.ts stepWaypointOrdinals). A stop with an
   * entry is filled in the command hue and captioned with those numbers.
   */
  steps: ReadonlyMap<string, readonly number[]>;
  /**
   * Vertex ids a Dock row is picked on (stepDockVertices). Each gets its
   * approach point drawn and joined to it: the robot goes there first, and no
   * row says so.
   */
  docks?: ReadonlySet<string>;
  /**
   * The waypoint ids in the order the job visits them (stepRoute), joined
   * leg by leg, so the map reads as a route and a stop added by a tap shows
   * where it falls in it.
   */
  route?: readonly string[];
}

/** The route's legs, thin enough to leave the markers and walls legible. */
const ROUTE_LINE_PX = 2;

/** The approach point's ring, smaller than a stop's dot so it never reads as one. */
const STAGING_RING_RADIUS = 3;

/**
 * Room around the map, in CSS px, so a stop on the boundary keeps its arrow and
 * caption (up and right of the dot, hence the wider right) on screen at first
 * look, which is the look most operators stop at.
 */
export const PREVIEW_INSET = { top: 20, right: 48, bottom: 20, left: 20 } as const;

/**
 * The whole map, fitted and centred inside the inset: the view the preview
 * opens at, comes back to on Fit, and cannot zoom out past (its `scale` is the
 * floor the component hands `zoomAt`).
 */
export function previewView(rect: Size, meta: MapMetadata): View {
  const inner = {
    width: Math.max(1, rect.width - PREVIEW_INSET.left - PREVIEW_INSET.right),
    height: Math.max(1, rect.height - PREVIEW_INSET.top - PREVIEW_INSET.bottom),
  };
  const view = fitView(inner, { width: meta.width, height: meta.height });
  return {
    scale: view.scale,
    ox: view.ox + PREVIEW_INSET.left,
    oy: view.oy + PREVIEW_INSET.top,
  };
}

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
 * Which stops keep their name. At preview scale captions would smear together,
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

/**
 * A lit marker's caption, "dock · steps 1, 4", numbered the way the step list
 * is. drawMarker adds the glyph.
 */
export function stepCaption(name: string, ordinals: readonly number[]): string {
  if (!ordinals.length) return name;
  return `${name} · ${ordinals.length === 1 ? "step" : "steps"} ${ordinals.join(", ")}`;
}

/**
 * One frame: the well, the raster, its extent, then every marker, named where
 * there is room (`planCaptions`). The job's stops are lit and drawn last, the
 * earliest step on top.
 *
 * `image` may be null (loading or failed); the markers are still drawn, since
 * their relative positions are most of the answer.
 */
export function drawWaypointPreview(
  ctx: CanvasRenderingContext2D,
  rect: Size,
  view: View,
  image: ImageBitmap | null,
  meta: MapMetadata,
  vertices: readonly MapVertex[],
  marks: PreviewMarks,
  palette: Palette,
): void {
  ctx.fillStyle = palette.well;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const w = meta.width * view.scale;
  const h = meta.height * view.scale;
  if (image) {
    // As in the editor: a filtered downscale keeps thin walls solid.
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(image, view.ox, view.oy, w, h);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.extent;
  ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, w + 1, h + 1);

  const placed = new Map(
    vertices.map((vertex) => [
      vertex.id,
      { ...vertexScreen(view, meta, vertex.x, vertex.y), theta: vertex.theta },
    ]),
  );

  // Under everything else: a leg is context, the stops are the answer.
  if (marks.route && marks.route.length > 1) {
    drawRoute(ctx, marks.route, placed, palette.cmd);
  }

  // Under the markers: the leg ends at the dot, which must stay on top.
  for (const vertex of vertices) {
    if (!marks.docks?.has(vertex.id)) continue;
    drawApproach(ctx, view, meta, vertex, placed.get(vertex.id)!, palette.cmd);
  }

  drawStops(ctx, vertices, placed, marks.steps, palette);
}

/** Where a stop is drawn, CSS px, and its heading as the screen shows it. */
export interface PlacedStop {
  cx: number;
  cy: number;
  /** Degrees CCW from screen right, drawMarker's convention. */
  theta: number;
}

/**
 * The stops themselves, at wherever the caller put them on screen: the floor
 * plan's transform, or the 3D view's projection (lib/scene/route-marks.ts),
 * so both surfaces draw the same marks. A stop not in `placed` is not drawn.
 * The job's stops are lit and drawn last, the earliest step on top, and
 * named first where captions would collide (`planCaptions`).
 */
export function drawStops(
  ctx: CanvasRenderingContext2D,
  vertices: readonly MapVertex[],
  placed: ReadonlyMap<string, PlacedStop>,
  steps: ReadonlyMap<string, readonly number[]>,
  palette: Palette,
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
  const label = (vertex: MapVertex) => stepCaption(vertex.name, ordinals(vertex));

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
        caption: `${vertexGlyph(vertex.type)} · ${label(vertex)}`,
      };
    }),
    (text) => ctx.measureText(text).width,
  );

  for (const vertex of [...rest, ...lit]) {
    const at = placed.get(vertex.id)!;
    const emphasis = ordinals(vertex).length > 0;
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: at.theta,
      colour: emphasis ? palette.cmd : palette.vertex,
      emphasis,
      glyph: vertexGlyph(vertex.type),
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
  // height colours and over a floor plan's black walls alike.
  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = ROUTE_LINE_PX + 2;
  ctx.stroke(path);
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = ROUTE_LINE_PX;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * A dock's last metre: a ring at the approach point and a dashed line from it
 * to the dock's dot, the straight walk the robot makes once it gets there.
 */
function drawApproach(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  dock: MapVertex,
  at: { cx: number; cy: number },
  colour: string,
): void {
  const stage = stagingPose(dock);
  const from = vertexScreen(view, meta, stage.x, stage.y);
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(from.cx, from.cy);
  ctx.lineTo(at.cx, at.cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(from.cx, from.cy, STAGING_RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
