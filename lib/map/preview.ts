// The task editor's floor plan: the picture the Steps group opens over the
// step list, showing where each stop is and which steps of the job go there.
// Pure like lib/map/draw.ts — the component owns the canvas, the pointer, the
// view transform and the frame scheduling; this owns what a frame looks like.
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

/** Which markers the preview lights up, and what it says about them. */
export interface PreviewMarks {
  /**
   * Vertex id → the 1-based numbers of the job's MOVE steps that go there,
   * in job order (lib/task/step.ts stepWaypointOrdinals). A stop with an
   * entry is filled in the command hue and captioned with those numbers.
   */
  steps: ReadonlyMap<string, readonly number[]>;
}

/**
 * Room kept around the map for the marks that hang off its edge, in CSS px.
 *
 * The editor fits the grid edge to edge; the preview opens inside this inset
 * so a stop placed against the map's boundary keeps its arrow (18 px, any
 * direction) and its caption (drawn up and to the right of the dot, so the
 * right and top need the most) on screen at the first look. The preview can
 * pan now, so the inset is no longer the only way to those marks — but the
 * first look is the one most operators stop at, and a stop that cannot be
 * told from its neighbour by name defeats the purpose of the picture.
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
 * A lit marker's caption: its name and the steps that go to it.
 *
 * "dock · steps 1, 4" rather than a bare "dock", because the map is open to
 * answer "where does this job go, and in what order" — and the row numbers
 * are how the step list names them, so the map speaks the same way. drawMarker
 * puts the glyph in front itself.
 */
export function stepCaption(name: string, ordinals: readonly number[]): string {
  if (!ordinals.length) return name;
  return `${name} · ${ordinals.length === 1 ? "step" : "steps"} ${ordinals.join(", ")}`;
}

/**
 * One frame: the well, the raster, its extent, then every marker.
 *
 * Every marker carries its name where there is room for it (see
 * `planCaptions`) — the operator is here because they forgot which stop is
 * which, and a glyph alone would send them back to the editor. The job's own
 * stops are lit, captioned with their step numbers, and drawn last so they
 * sit above their neighbours; among them the earliest step goes on top, since
 * it is the one the robot reaches first.
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

  const ordinals = (vertex: MapVertex) => marks.steps.get(vertex.id) ?? [];
  // Lit stops by the first step that reaches them, latest first, so that in
  // the draw order below (rest, then lit) step 1 lands on top of them all.
  const lit = vertices
    .filter((vertex) => ordinals(vertex).length > 0)
    .sort((a, b) => ordinals(b)[0] - ordinals(a)[0]);
  const rest = vertices.filter((vertex) => ordinals(vertex).length === 0);
  const placed = new Map(
    vertices.map((vertex) => [vertex.id, vertexScreen(view, meta, vertex.x, vertex.y)]),
  );
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
      theta: vertex.theta,
      colour: emphasis ? palette.cmd : palette.vertex,
      emphasis,
      glyph: vertexGlyph(vertex.type),
      label: captioned.has(vertex.id) ? label(vertex) : null,
      dashed: false,
    });
  }

  ctx.restore();
}
