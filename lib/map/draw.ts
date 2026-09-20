// The gridmap editor's 2D drawing, lifted out of components/maps/grid-canvas.tsx.
//
// Every function here is `(ctx, view, …) -> void` and touches no React: the
// component owns the buffer, the gestures and the frame scheduling, this owns
// what a frame looks like. See CLAUDE.md > Layering.
//
// The shared signal hues come from lib/theme/signal.ts, the same module the 3D
// scene reads; only the hues this editor adds — the well, the map extent, the
// cell grid and the vertex mark — are written out below.

import type { CellSink } from "@/lib/map/grid";
import { stampLine } from "@/lib/map/grid";
import type { CellProbe, DrawState, Gesture } from "@/lib/map/editor";
import type { GridSession } from "@/lib/map/session";
import { vertexGlyph } from "@/lib/map/vertex";
import { SIGNAL, cssHex } from "@/lib/theme/signal";
import {
  gridToScreen,
  screenToGrid,
  worldToGrid,
  type View,
} from "@/lib/map/view";
import type { MapMetadata, PlanarPose } from "@/lib/types/robot";

export interface Palette {
  /** The area outside the map. */
  well: string;
  /** Hairline around the grid extent. */
  extent: string;
  /** Cell gridlines at high zoom. */
  cellGrid: string;
  /** Brush outline and shape preview — a commanded value the operator set. */
  cmd: string;
  /**
   * Stored map vertices. One hue for all five types (see lib/map/vertex.ts on
   * why the type is a glyph and not a colour), and not one of the signal hues:
   * a saved vertex is neither measured nor commanded nor faulted, so borrowing
   * a signal colour for it would weaken the ones that do mean something. The
   * *draft* vertex uses `cmd`, like every other value the operator is setting.
   */
  vertex: string;
  /**
   * The robot's own footprint. `signal-live` by the console's rule — it is a
   * measured, valid value, the one thing on this canvas that is neither stored
   * nor being commanded — which is also what keeps it from being read as a
   * vertex at a glance.
   */
  live: string;
}

/*
 * Only the chrome drawn *over* the grid follows the theme. The grid itself never
 * does: a gridmap is white free space and near-black obstacles in night mode too
 * (see lib/map/render.ts on why the bytes are blitted literally), so a marker
 * picked to look right against the dark panel would be invisible where it is
 * actually drawn. Hues are the globals.css signal values — `signal-cmd` for the
 * brush and previews, because they show a value the operator is about to commit.
 */
export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    well: cssHex(SIGNAL.light.elevated),
    extent: "#8b9aa5",
    cellGrid: "#b9c6ce",
    cmd: cssHex(SIGNAL.light.cmd),
    vertex: "#2f4a58",
    live: cssHex(SIGNAL.light.live),
  },
  dark: {
    well: "#22282c",
    extent: "#5c6a74",
    cellGrid: "#3a444b",
    cmd: cssHex(SIGNAL.dark.cmd),
    vertex: "#a8bcc7",
    live: cssHex(SIGNAL.dark.live),
  },
};

/**
 * Drawn under every marker and label before the coloured shape.
 *
 * A vertex sits on cells the grid renders literally — white where the floor is
 * free, near-black where it is not (see lib/map/render.ts) — so no single hue is
 * legible everywhere a vertex can be placed. A translucent light halo behind the
 * mark is what makes the dark light-theme marker readable on top of an obstacle,
 * and it is drawn rather than themed because the *grid* under it never follows
 * the theme.
 */
export const MARKER_HALO = "rgba(255, 255, 255, 0.85)";

/** Above this many preview cells, outline the shape instead of filling cells. */
export const PREVIEW_CELL_LIMIT = 4000;

/** Smallest on-screen brush ring, so a 1-cell brush stays findable zoomed out. */
export const MIN_RING_PX = 6;

/*
 * Vertex markers are sized in CSS pixels and do NOT scale with zoom, which is
 * the opposite of the brush ring. The ring scales because it has to be honest
 * about how many cells a click will paint; a vertex is a single pose, so scaling
 * it would only make it vanish at fit view — the zoom level where an operator is
 * most likely to be looking for it.
 */
export const VERTEX_DOT_RADIUS = 4.5;
export const VERTEX_ARROW_PX = 18;

/*
 * The robot's footprint, in metres, drawn to scale — the opposite choice from the
 * vertex markers above, and for the opposite reason: a vertex is a pose and has
 * no size, while "will this stop fit" is most of what the operator is asking when
 * they look at where the robot is standing. Full extents from the global
 * costmap's half-extents (planner_server_params.yaml, 0.35 x 0.22), which is the
 * shape the planner actually reasons with — note it disagrees with the local
 * costmap's (0.28 x 0.20); that drift is flagged in the package READMEs, and this
 * marker is a picture, not a clearance guarantee.
 */
export const ROBOT_LENGTH_M = 0.7;
export const ROBOT_WIDTH_M = 0.44;

/**
 * Smallest the footprint is ever drawn, measured along the robot's length.
 *
 * Same idea as MIN_RING_PX: at fit scale on the 1602x1502 maps a 0.7 m robot is
 * about 7 px, and the one thing this marker must never do is be untraceable at
 * the zoom where you are looking for it. The aspect ratio is held, so below this
 * size the shape stops being to scale and becomes a glyph — which is honest, in
 * that at 7 px nothing could be read as a clearance anyway.
 */
export const MIN_ROBOT_LENGTH_PX = 14;

export function drawCellGrid(
  ctx: CanvasRenderingContext2D,
  view: View,
  rect: { width: number; height: number },
  grid: { width: number; height: number },
  palette: Palette,
): void {
  // Only the visible cell range: at scale 32 on a 1602-wide map, iterating every
  // column would be 1600 strokes for the ~30 on screen.
  const from = screenToGrid(view, 0, 0);
  const to = screenToGrid(view, rect.width, rect.height);
  const colFrom = Math.max(Math.ceil(from.px), 0);
  const colTo = Math.min(Math.floor(to.px), grid.width);
  const rowFrom = Math.max(Math.ceil(from.py), 0);
  const rowTo = Math.min(Math.floor(to.py), grid.height);

  ctx.strokeStyle = palette.cellGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = colFrom; col <= colTo; col += 1) {
    const x = Math.round(gridToScreen(view, col, 0).cx) + 0.5;
    ctx.moveTo(x, Math.max(view.oy, 0));
    ctx.lineTo(x, Math.min(view.oy + grid.height * view.scale, rect.height));
  }
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const y = Math.round(gridToScreen(view, 0, row).cy) + 0.5;
    ctx.moveTo(Math.max(view.ox, 0), y);
    ctx.lineTo(Math.min(view.ox + grid.width * view.scale, rect.width), y);
  }
  ctx.stroke();
}

/**
 * The in-progress line or rect.
 *
 * A line's preview is rasterized by the *same* stampLine that will commit it, into
 * a collector sink rather than the buffer — so the cells highlighted and the cells
 * painted cannot disagree. Approximating it with ctx.lineWidth is the tempting
 * shortcut and it is a lie: at high zoom the operator would paint cells they were
 * never shown. A rect is exempt because its cell set *is* a screen rectangle.
 */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  view: View,
  session: GridSession,
  gesture: Gesture | null,
  props: DrawState,
  palette: Palette,
): void {
  if (!gesture || gesture.kind !== "shape") return;
  const { anchor, head } = gesture;
  const { grid } = session;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = palette.cmd;

  if (props.tool === "rect") {
    const colFrom = Math.min(anchor.col, head.col);
    const rowFrom = Math.min(anchor.row, head.row);
    const cols = Math.abs(head.col - anchor.col) + 1;
    const rows = Math.abs(head.row - anchor.row) + 1;
    const { cx, cy } = gridToScreen(view, colFrom, rowFrom);
    ctx.fillRect(cx, cy, cols * view.scale, rows * view.scale);
    ctx.restore();
    return;
  }

  const cells: number[] = [];
  let overflow = false;
  const collect: CellSink = (index) => {
    if (cells.length >= PREVIEW_CELL_LIMIT) {
      overflow = true;
      return;
    }
    cells.push(index);
  };
  stampLine(grid, anchor, head, props.brush, props.value, collect);

  if (overflow) {
    // Zoomed far out, where individual cells are sub-pixel anyway.
    const a = gridToScreen(view, anchor.col + 0.5, anchor.row + 0.5);
    const b = gridToScreen(view, head.col + 0.5, head.row + 0.5);
    ctx.strokeStyle = palette.cmd;
    ctx.lineWidth = Math.max(props.brush * view.scale, 1);
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const size = Math.max(view.scale, 1);
  for (const index of cells) {
    const col = index % grid.width;
    const row = (index - col) / grid.width;
    const { cx, cy } = gridToScreen(view, col, row);
    ctx.fillRect(cx, cy, size, size);
  }
  ctx.restore();
}

/**
 * The brush footprint, drawn at `brush * scale` CSS px.
 *
 * Brush size is in cells, which is right for a grid editor but surprising on
 * screen: a size-31 brush covers a huge area zoomed out and a small one zoomed in.
 * Scaling the ring is what keeps it honest about what a click will paint.
 */
export function drawBrushRing(
  ctx: CanvasRenderingContext2D,
  view: View,
  gesture: Gesture | null,
  hover: CellProbe | null,
  props: DrawState,
  palette: Palette,
): void {
  // Nothing is being painted in vertex mode, so a footprint would be a promise
  // about cells that no press there will touch.
  if (props.mode === "vertex") return;
  if (!hover || props.tool === "pan" || props.spacePan) return;
  if (gesture?.kind === "pan") return;

  const diameter = props.tool === "rect" ? 1 : props.brush;
  const { cx, cy } = gridToScreen(view, hover.col + 0.5, hover.row + 0.5);
  const size = Math.max(diameter * view.scale, MIN_RING_PX);

  ctx.strokeStyle = palette.cmd;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(cx - size / 2) + 0.5,
    Math.round(cy - size / 2) + 0.5,
    size,
    size,
  );
}

/** A map-frame pose in container-local CSS pixels, via the one view transform. */
export function vertexScreen(view: View, meta: MapMetadata, wx: number, wy: number) {
  const { px, py } = worldToGrid(wx, wy, meta);
  return gridToScreen(view, px, py);
}

/**
 * The vertex layer: stored vertices, the staged draft, and the one being aimed.
 *
 * Drawn in every mode, not only in vertex mode. Where the vertices are is
 * information a grid edit needs too — repainting a wall that a CHARGER stop sits
 * against is exactly when you want to see it — and hiding them would make the
 * mode switch feel like it loaded different data rather than changed what a
 * press does.
 */
export function drawVertices(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  gesture: Gesture | null,
  props: DrawState,
  palette: Palette,
): void {
  const aiming = gesture?.kind === "vertex" ? gesture : null;
  // Rebuilt per frame rather than kept in the shell: a Set handed down as a prop
  // would be a new identity every render and defeat this component's memo, and
  // the selection is at most a few dozen ids.
  const selected = new Set(props.selectedIds);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const vertex of props.vertices) {
    // Mid-gesture the aimed vertex follows the pointer rather than its stored
    // heading; committing is the panel's job, so the row itself has not moved.
    const live = aiming?.id === vertex.id;
    const lit = live || selected.has(vertex.id);
    const at = vertexScreen(view, meta, vertex.x, vertex.y);
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: live ? aiming.theta : vertex.theta,
      colour: lit ? palette.cmd : palette.vertex,
      emphasis: lit,
      glyph: vertexGlyph(vertex.type),
      label: vertex.name,
      dashed: false,
    });
  }

  // A draft is drawn last and dashed: it is the one mark on screen that is not
  // in the database yet, and dashing says so without needing a second hue —
  // `cmd` already means "a value the operator is setting", the same as the brush
  // ring it shares the canvas with.
  const draft = aiming && aiming.id === null ? { ...aiming, x: aiming.wx, y: aiming.wy } : props.draft;
  if (draft) {
    const at = vertexScreen(view, meta, draft.x, draft.y);
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: draft.theta,
      colour: palette.cmd,
      emphasis: true,
      glyph: null,
      label: null,
      dashed: true,
    });
  }

  ctx.restore();
}

/**
 * The rubber band, while one is being dragged.
 *
 * Drawn in `cmd` like the brush ring and the draft marker, because it is the
 * same kind of thing: a value the operator is in the middle of setting. The wash
 * is faint on purpose — the band's whole job is to let you see which markers are
 * about to be caught, and a solid fill would hide the ones under it.
 */
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  gesture: Gesture | null,
  palette: Palette,
): void {
  if (!gesture || gesture.kind !== "marquee") return;

  const x = Math.min(gesture.ox, gesture.cx);
  const y = Math.min(gesture.oy, gesture.cy);
  const width = Math.abs(gesture.cx - gesture.ox);
  const height = Math.abs(gesture.cy - gesture.oy);

  ctx.save();
  ctx.fillStyle = palette.cmd;
  ctx.globalAlpha = 0.1;
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = palette.cmd;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  // Half-pixel offset, like the extent hairline: without it a 1 px stroke lands
  // across two device rows and reads as a grey smear rather than a line.
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width), Math.round(height));
  ctx.restore();
}

/**
 * The robot where it is standing right now: its footprint, pointed at its heading.
 *
 * A footprint outline rather than another ring-and-arrow marker, because it has to
 * be distinguishable from the vertices at a glance in a place where it will often
 * be sitting on top of one — the operator's usual reason for opening this screen
 * with the robot live is to mark the spot it is parked on. Shape, hue and size all
 * say "not a vertex": the vertices are pointed rings in the neutral vertex hue at a
 * fixed pixel size, this is a body in `live` green that grows with the zoom.
 *
 * The nose is part of the outline rather than a separate arrow so that the whole
 * mark is one shape — at the zoom levels where the body is only a dozen pixels
 * across, a detached arrowhead reads as a second object.
 */
export function drawRobot(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  pose: PlanarPose,
  palette: Palette,
): void {
  const at = vertexScreen(view, meta, pose.x, pose.y);
  // px per metre: cells per metre from the map, screen px per cell from the view.
  const pxPerM = view.scale / meta.resolution;
  const length = Math.max(ROBOT_LENGTH_M * pxPerM, MIN_ROBOT_LENGTH_PX);
  const width = length * (ROBOT_WIDTH_M / ROBOT_LENGTH_M);
  const halfLength = length / 2;
  const halfWidth = width / 2;

  ctx.save();
  ctx.translate(at.cx, at.cy);
  // Negated: the pose is CCW from +x in the map frame and screen y grows downward,
  // the same flip worldToGrid does for position.
  ctx.rotate(-(pose.theta * Math.PI) / 180);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  // Body pointing down +x (i.e. +x is now "up the heading"): a rectangle whose
  // front edge is pulled out to a nose. The nose eats a fifth of the length, so a
  // square-on view still reads as a rectangle rather than as an arrow.
  const nose = halfLength * 0.4;
  const body = new Path2D();
  body.moveTo(halfLength, 0);
  body.lineTo(halfLength - nose, -halfWidth);
  body.lineTo(-halfLength, -halfWidth);
  body.lineTo(-halfLength, halfWidth);
  body.lineTo(halfLength - nose, halfWidth);
  body.closePath();

  // Haloed first, like every other mark here: the grid beneath is blitted
  // literally, so neither hue is legible over both free space and obstacles.
  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = 3.5;
  ctx.stroke(body);

  // A wash rather than a solid fill: this is the one mark that covers cells
  // instead of pointing at one, and an operator has to be able to see the
  // obstacle it is parked against through it.
  ctx.fillStyle = palette.live;
  ctx.globalAlpha = 0.22;
  ctx.fill(body);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = palette.live;
  ctx.lineWidth = 1.5;
  ctx.stroke(body);

  ctx.restore();
}

export interface MarkerSpec {
  cx: number;
  cy: number;
  /** Degrees, CCW from +x in the map frame. */
  theta: number;
  colour: string;
  /** Thicker ring and a filled centre — the selected or in-flight vertex. */
  emphasis: boolean;
  glyph: string | null;
  label: string | null;
  dashed: boolean;
}

/**
 * One marker: a ring, a heading arrow, and a `G · name` caption.
 *
 * Every stroke is laid down twice — once in MARKER_HALO at +2 px width, then in
 * the marker colour. Without it a light-theme marker disappears into an obstacle
 * and a dark-theme one disappears into free space, because the grid beneath is
 * blitted literally and does not follow the theme.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, spec: MarkerSpec): void {
  const { cx, cy, colour, emphasis, dashed } = spec;
  const radians = (spec.theta * Math.PI) / 180;
  // Screen y grows downward, map y grows upward — the same flip worldToGrid does.
  const tipX = cx + Math.cos(radians) * VERTEX_ARROW_PX;
  const tipY = cy - Math.sin(radians) * VERTEX_ARROW_PX;

  const shape = new Path2D();
  shape.moveTo(cx + VERTEX_DOT_RADIUS, cy);
  shape.arc(cx, cy, VERTEX_DOT_RADIUS, 0, Math.PI * 2);
  const arrow = new Path2D();
  arrow.moveTo(cx, cy);
  arrow.lineTo(tipX, tipY);
  // Two barbs at ±150° off the heading, so the head reads as an arrow at 18 px.
  for (const offset of [Math.PI * 0.83, -Math.PI * 0.83]) {
    arrow.moveTo(tipX, tipY);
    arrow.lineTo(
      tipX + Math.cos(radians + offset) * 6,
      tipY - Math.sin(radians + offset) * 6,
    );
  }

  const width = emphasis ? 2 : 1.5;

  ctx.setLineDash([]);
  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = width + 2;
  ctx.stroke(shape);
  ctx.stroke(arrow);

  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([3, 2]);
  ctx.stroke(shape);
  ctx.setLineDash([]);
  ctx.stroke(arrow);

  if (emphasis && !dashed) {
    ctx.fillStyle = colour;
    ctx.fill(shape);
  }

  const caption = [spec.glyph, spec.label].filter(Boolean).join(" · ");
  if (!caption) return;

  // Offset up-right of the dot so the caption never sits under the arrow when
  // the heading points right, which is the default for a click without a drag.
  const tx = cx + VERTEX_DOT_RADIUS + 4;
  const ty = cy - VERTEX_DOT_RADIUS - 4;
  ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3;
  ctx.strokeStyle = MARKER_HALO;
  ctx.strokeText(caption, tx, ty);
  ctx.fillStyle = colour;
  ctx.fillText(caption, tx, ty);
}
