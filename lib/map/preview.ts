// The task editor's floor plan preview: the picture beside the waypoint picker
// that shows where each stop is, and the hit test that lets a click on it pick
// one. Pure like lib/map/draw.ts — the component owns the canvas, the pointer
// and the frame scheduling, this owns what a frame looks like and what a point
// on it means.
//
// It borrows the editor's vocabulary on purpose (fitView, drawMarker, the
// palette) rather than drawing its own dots: the operator learned what a
// waypoint looks like on the editor, and the preview's whole job is to be
// recognisably the same map.

import {
  VERTEX_DOT_RADIUS,
  drawMarker,
  vertexScreen,
  type Palette,
} from "@/lib/map/draw";
import { vertexGlyph } from "@/lib/map/vertex";
import { fitView, type Size, type View } from "@/lib/map/view";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

/**
 * How close, in CSS px, a pointer has to be to a marker's dot to be "on" it.
 *
 * Wider than the 4.5 px dot: on a preview the markers are the target, and a
 * ring that has to be hit exactly turns a click into a hunt. Narrower than the
 * 18 px arrow, so two stops a body length apart stay separately clickable.
 */
export const WAYPOINT_HIT_PX = 10;

/** Which markers the preview lights up, by vertex id. */
export interface PreviewMarks {
  /** The row's current pick — filled, in the command hue. */
  selectedId: string | null;
  /** The one under the pointer — the value about to be set, so the same hue. */
  hoveredId: string | null;
}

/**
 * Room kept around the map for the marks that hang off its edge, in CSS px.
 *
 * The editor fits the grid edge to edge because it can pan; the preview
 * cannot, so a stop placed against the map's boundary would lose its arrow
 * (18 px, any direction) or its caption (drawn up and to the right of the
 * dot, so the right and top need the most). A stop that cannot be told from
 * its neighbour by name defeats the purpose of the picture.
 */
export const PREVIEW_INSET = { top: 20, right: 48, bottom: 20, left: 20 } as const;

/** The whole map, fitted and centred inside the inset. Never zooms or pans. */
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
 * Which stops keep their name, given the order they matter in.
 *
 * At preview scale a real map puts stops a few pixels apart, and eleven-pixel
 * captions drawn for all of them become one unreadable smear — the opposite of
 * what the picture is for. So captions are placed greedily in priority order
 * and a candidate whose box would overlap one already placed is dropped to
 * its glyph. The caller passes the lit markers first, which is what makes the
 * pick and the hover always legible: they are placed before anything can be
 * in their way. `measure` is the text width, injected so the rule can be
 * tested without a canvas.
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
 * One frame: the well, the raster, its extent, then every marker.
 *
 * Every marker carries its name where there is room for it (see
 * `planCaptions`) — the operator is here because they forgot which stop is
 * which, and a glyph alone would send them back to hovering each one. The lit
 * markers are drawn last so they sit above their neighbours; between the two,
 * the hovered one goes on top, because it is the one the pointer is asking
 * about.
 *
 * `image` may be null while the raster loads or after it failed: the markers
 * are still drawn over the well, since where the stops are relative to each
 * other is most of the answer even without the walls.
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
    // Same rule as the editor: a filtered downscale keeps thin walls solid,
    // which at preview size (scale well under 1) is the only case there is.
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(image, view.ox, view.oy, w, h);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.extent;
  ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, w + 1, h + 1);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const lit = (vertex: MapVertex) =>
    vertex.id === marks.selectedId || vertex.id === marks.hoveredId;
  const hovered = vertices.filter(
    (vertex) => vertex.id === marks.hoveredId && vertex.id !== marks.selectedId,
  );
  const selected = vertices.filter((vertex) => vertex.id === marks.selectedId);
  const rest = vertices.filter((vertex) => !lit(vertex));
  const placed = new Map(
    vertices.map((vertex) => [vertex.id, vertexScreen(view, meta, vertex.x, vertex.y)]),
  );

  ctx.font = CAPTION_FONT;
  const captioned = planCaptions(
    [...hovered, ...selected, ...rest].map((vertex) => {
      const at = placed.get(vertex.id)!;
      return {
        id: vertex.id,
        cx: at.cx,
        cy: at.cy,
        caption: `${vertexGlyph(vertex.type)} · ${vertex.name}`,
      };
    }),
    (text) => ctx.measureText(text).width,
  );

  // Lit last, so they sit above their neighbours' strokes.
  for (const vertex of [...rest, ...selected, ...hovered]) {
    const at = placed.get(vertex.id)!;
    const emphasis = lit(vertex);
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: vertex.theta,
      colour: emphasis ? palette.cmd : palette.vertex,
      emphasis,
      glyph: vertexGlyph(vertex.type),
      label: captioned.has(vertex.id) ? vertex.name : null,
      dashed: false,
    });
  }

  ctx.restore();
}

/**
 * The stop under a container-local point, or null.
 *
 * Nearest dot within WAYPOINT_HIT_PX wins, so two stops whose hit discs overlap
 * are still both reachable — whichever the pointer is closer to. Measured
 * against the dot, not the arrow: the arrow says which way the robot will face,
 * and is not where anyone aims.
 */
export function waypointAt(
  view: View,
  meta: MapMetadata,
  vertices: readonly MapVertex[],
  cx: number,
  cy: number,
): MapVertex | null {
  let best: MapVertex | null = null;
  let bestDistance = WAYPOINT_HIT_PX;
  for (const vertex of vertices) {
    const at = vertexScreen(view, meta, vertex.x, vertex.y);
    const distance = Math.hypot(at.cx - cx, at.cy - cy);
    if (distance <= bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
}
