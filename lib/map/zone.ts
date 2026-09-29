/**
 * Forbidden zones: what one is, and the rules for drawing one on the floor
 * plan editor.
 *
 * The types live here rather than in lib/types/map.ts because no backend
 * endpoint exists for them yet — a zone is drawn in the editor, held in its
 * state and lost on reload. When the endpoint arrives the wire type moves to
 * lib/types/ beside MapVertex and this module keeps the rules, which is the
 * split every other map thing already has.
 *
 * Pure, and no Path2D: the drawing is lib/map/draw.ts's, so these rules can
 * be tested without a canvas.
 */

/** A corner of a zone, in the map frame (metres), like a vertex's position. */
export interface ZonePoint {
  x: number;
  y: number;
}

/** A closed polygon the robot must stay out of. Points in drawing order. */
export interface ZonePolygon {
  id: string;
  points: ZonePoint[];
}

/**
 * A shape needs three corners before it encloses anything: two points are a
 * line, and a line has no inside for the robot to be kept out of.
 */
export const MIN_ZONE_POINTS = 3;

export function canCloseZone(points: readonly ZonePoint[]): boolean {
  return points.length >= MIN_ZONE_POINTS;
}

/** What a press with Shape armed does. */
export type ZonePressVerdict =
  /** Add a corner where the press landed. */
  | "add"
  /** The press landed on the first corner: close the shape. */
  | "close"
  /** The press landed on the first corner too early to close; nothing happens. */
  | "ignore"
  /** No shape in flight and the press landed inside a finished zone: select it. */
  | "select";

export interface ZonePressInput {
  /** Corners of the shape in flight. */
  count: number;
  /** The first corner on screen, or null with none placed. */
  firstAt: { cx: number; cy: number } | null;
  press: { cx: number; cy: number };
  /** Slop around the first corner: a mouse's or a finger's. */
  radius: number;
  /** The press landed inside a finished zone. */
  onZone: boolean;
}

/**
 * Which of the four a press is.
 *
 * The first corner is hit-tested in screen pixels, for the same reason a
 * vertex marker is (see vertexAt in components/maps/grid-canvas.tsx): the dot
 * does not scale with the zoom, so a world-space radius would be unclickable
 * zoomed out and enormous zoomed in. The caller passes the radius, because
 * only it knows whether the press is a mouse or a finger.
 *
 * A press on the first corner closes the shape only once it *can* be a shape.
 * Before that it is ignored rather than added: a second corner on top of the
 * first is a degenerate edge that could never be closed, and adding it would
 * leave the operator with a shape that looks like two points and counts three.
 *
 * A finished zone is selected by pressing inside it, but only while no shape
 * is in flight: once a corner is down every press is the next corner, so a
 * shape can still be drawn across a zone that is already there. What cannot
 * be done is *starting* one inside a zone — the inside is already forbidden,
 * so nothing is lost.
 */
export function classifyZonePress(input: ZonePressInput): ZonePressVerdict {
  const { count, firstAt, press, radius, onZone } = input;
  if (count === 0) return onZone ? "select" : "add";
  if (!firstAt) return "add";
  const onFirst = Math.hypot(firstAt.cx - press.cx, firstAt.cy - press.cy) <= radius;
  if (!onFirst) return "add";
  return count >= MIN_ZONE_POINTS ? "close" : "ignore";
}

/**
 * Whether a map-frame point lies inside a polygon: the even-odd rule, by
 * casting a ray along +x and counting the edges it crosses.
 *
 * In metres rather than screen pixels, unlike the first corner: an area does
 * not have the dot's problem of vanishing with the zoom, and the map frame
 * needs no view to test against.
 */
export function pointInPolygon(points: readonly ZonePoint[], at: ZonePoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const crosses = a.y > at.y !== b.y > at.y;
    if (crosses && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The topmost zone under a map-frame point, or null. Last-to-first because
 * that is paint order reversed: where two overlap, the one drawn on top wins.
 */
export function zoneAt(zones: readonly ZonePolygon[], at: ZonePoint): ZonePolygon | null {
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    if (pointInPolygon(zones[i].points, at)) return zones[i];
  }
  return null;
}

/**
 * A fresh id for a zone this editor drew.
 *
 * A counter rather than crypto.randomUUID(): the console is served over plain
 * http on the robot's LAN, where that function does not exist (the same reason
 * lib/task/step.ts makes its own ids). The ids only have to be distinct within
 * one editor session — nothing stores them yet.
 */
let nextZoneId = 0;
export function newZoneId(): string {
  nextZoneId += 1;
  return `zone-${nextZoneId}`;
}
