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
/** The leg of the stop the editor points at. */
const ROUTE_FOCUS_LINE_PX = 3.5;
/** Every other leg while a card is hovered: there, but out of the way. */
const ROUTE_UNFOCUSED_ALPHA = 0.45;

/**
 * How far a leg sits to the right of the straight line between its stops,
 * per lane: far enough that a walk out and back read as two lines, near
 * enough that the first lane still leaves from its marker's ring.
 */
export const LANE_PX = 5;
/** A leg shorter than this on screen has no room for its chevron. */
export const CHEVRON_MIN_LEG_PX = 28;
/** The chevron's barbs, back from its tip. */
const CHEVRON_PX = 6;

/** The end of the job: a second ring outside the last stop's marker. */
const END_RING_RADIUS = VERTEX_DOT_RADIUS + 3.5;

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
 * `end` is where the job ends, ringed twice: on a route that comes back
 * through a stop, the arrows alone make the reader trace the whole line to
 * find which of its visits is the last.
 */
export function drawStops(
  ctx: CanvasRenderingContext2D,
  vertices: readonly MapVertex[],
  placed: ReadonlyMap<string, PlacedStop>,
  steps: ReadonlyMap<string, readonly number[]>,
  palette: Palette,
  highlight: string | null = null,
  end: string | null = null,
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

  const ending = end === null ? undefined : placed.get(end);
  if (ending) {
    ctx.beginPath();
    ctx.arc(ending.cx, ending.cy, END_RING_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = palette.cmd;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

/** One point of the route: the stop's row and the waypoint it goes to. */
export interface RoutePoint {
  key: number;
  vertexId: string;
}

/** A leg as drawn, CSS px, already moved into its lane. */
export interface PlannedLeg {
  /** The row of the stop this leg walks to. */
  arrive: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 for the first walk between two stops this way, 1 for the next, … */
  lane: number;
}

/**
 * The job's legs on screen. Each sits to the right of the line between its
 * stops, as the robot would keep right: a walk back the way it came runs on
 * the other side of the one that went, so A → B → C → B shows the return
 * instead of drawing it over the walk out. A walk repeated the same way takes
 * the next lane out. A leg with either end not on screen (another floor,
 * behind the camera) is left out rather than joined across the gap, which
 * would draw a walk that never happens.
 */
export function planLegs(
  route: readonly RoutePoint[],
  placed: ReadonlyMap<string, { cx: number; cy: number }>,
): PlannedLeg[] {
  const legs: PlannedLeg[] = [];
  const walked = new Map<string, number>();
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1]!;
    const to = route[index]!;
    const a = placed.get(from.vertexId);
    const b = placed.get(to.vertexId);
    if (!a || !b) continue;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const length = Math.hypot(dx, dy);
    // Two waypoints on the same pixel have no direction to be right of.
    if (length < 1) continue;
    const pair = `${from.vertexId}\u0000${to.vertexId}`;
    const lane = walked.get(pair) ?? 0;
    walked.set(pair, lane + 1);
    // Right of travel with screen y growing downward: (-dy, dx).
    const shift = (LANE_PX * (lane + 1)) / length;
    const ox = -dy * shift;
    const oy = dx * shift;
    legs.push({
      arrive: to.key,
      x0: a.cx + ox,
      y0: a.cy + oy,
      x1: b.cx + ox,
      y1: b.cy + oy,
      lane,
    });
  }
  return legs;
}

/** Whether a leg is long enough on screen to carry its chevron. */
export function legHasChevron(leg: PlannedLeg): boolean {
  return Math.hypot(leg.x1 - leg.x0, leg.y1 - leg.y0) >= CHEVRON_MIN_LEG_PX;
}

function legPath(leg: PlannedLeg): Path2D {
  const path = new Path2D();
  path.moveTo(leg.x0, leg.y0);
  path.lineTo(leg.x1, leg.y1);
  if (!legHasChevron(leg)) return path;
  const dx = leg.x1 - leg.x0;
  const dy = leg.y1 - leg.y0;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  // Tip just past the middle, so the chevron is centred on the leg.
  const tipX = (leg.x0 + leg.x1) / 2 + ux * (CHEVRON_PX / 2);
  const tipY = (leg.y0 + leg.y1) / 2 + uy * (CHEVRON_PX / 2);
  // Each barb goes back along the leg and out to one side of it.
  for (const side of [1, -1]) {
    path.moveTo(
      tipX - (ux + uy * side) * CHEVRON_PX,
      tipY - (uy - ux * side) * CHEVRON_PX,
    );
    path.lineTo(tipX, tipY);
  }
  return path;
}

/**
 * The job's legs, stop to stop, each with a chevron for its direction.
 * Straight lines, not the planner's path: the order is what this answers,
 * and a line through a wall says nothing about where the robot will really
 * walk. `focus` is the row of the stop the editor points at: its leg is
 * drawn bold, so a stop the job visits twice can be told by the walk into
 * it. With `fade` the rest fade too — for a hovered card, a glance; not for
 * the selected stop, which every added stop becomes and which would keep
 * the route dim for the whole build. A focus with no leg on screen (the
 * first stop, a stop on another floor) fades nothing.
 */
export function drawRoute(
  ctx: CanvasRenderingContext2D,
  route: readonly RoutePoint[],
  placed: ReadonlyMap<string, { cx: number; cy: number }>,
  colour: string,
  focus: number | null = null,
  fade = false,
): void {
  const legs = planLegs(route, placed);
  const focused = legs.find((leg) => leg.arrive === focus) ?? null;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // The focused leg last, so it crosses over the faded ones.
  for (const leg of focused ? [...legs.filter((each) => each !== focused), focused] : legs) {
    const path = legPath(leg);
    const bold = leg === focused;
    const width = bold ? ROUTE_FOCUS_LINE_PX : ROUTE_LINE_PX;
    ctx.globalAlpha = focused && fade && !bold ? ROUTE_UNFOCUSED_ALPHA : 1;
    // Over a halo, as a marker is: a bare line vanished over the 3D map's
    // height colours.
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = width + 2;
    ctx.stroke(path);
    ctx.strokeStyle = colour;
    ctx.globalAlpha *= bold ? 1 : 0.85;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
  ctx.restore();
}
