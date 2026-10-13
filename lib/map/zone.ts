/**
 * Forbidden zones: the rules for drawing one on the floor plan editor. The
 * shape types live in lib/types/map.ts and are re-exported so the editor
 * takes rules and types from one place. No Path2D, so this is testable
 * without a canvas; the drawing is lib/map/draw.ts's.
 */

import type { ZonePoint, ZonePolygon } from "@/lib/types/map";

export type { ZonePoint, ZonePolygon };

/**
 * A corner the pointer can pick up: one of the shape in flight (`zoneId`
 * null) or of a finished zone. One drag serves both.
 */
export interface ZoneCornerRef {
  zoneId: string | null;
  index: number;
}

/**
 * Where a shape in flight is attached to a finished zone. The copy of the
 * zone's corner is not always first: a shape started on bare map can reach a
 * zone later, and the corners before it count too (see mergeIntoZone).
 */
export interface ZoneAnchor {
  zoneId: string;
  index: number;
  /** Index into the shape in flight of the corner that is the zone's. */
  position: number;
}

/** Two points are a line, and a line has no inside to keep the robot out of. */
export const MIN_ZONE_POINTS = 3;

export function canCloseZone(points: readonly ZonePoint[]): boolean {
  return points.length >= MIN_ZONE_POINTS;
}

/**
 * The corner of the shape in flight under a press, or null.
 *
 * Hit-tested in screen pixels because the dot does not scale with the zoom.
 * The caller passes the radius since only it knows mouse from finger. The
 * nearest wins, so a corner dropped on top of another can still be picked up.
 */
export function cornerAt(
  corners: readonly { cx: number; cy: number }[],
  press: { cx: number; cy: number },
  radius: number,
): number | null {
  let best: number | null = null;
  let bestDist = radius;
  corners.forEach((corner, index) => {
    const dist = Math.hypot(corner.cx - press.cx, corner.cy - press.cy);
    if (dist <= bestDist) {
      best = index;
      bestDist = dist;
    }
  });
  return best;
}

/** What a *click* with Shape armed does — a press that is released in place. */
export type ZonePressVerdict =
  /** Add a corner where the press landed. */
  | "add"
  /** The press landed on the first corner: close the shape. */
  | "close"
  /**
   * A click on this corner means nothing (first corner too early to close,
   * a later one, or a handle too early to merge); a drag from it moves it.
   */
  | "ignore"
  /** No shape in flight and the press landed inside a finished zone: select it. */
  | "select"
  /** No shape in flight, press on a finished zone's corner: start a shape anchored there. */
  | "anchor"
  /**
   * Anchored shape, press on another corner of its zone: the corners drawn
   * since the anchor replace the zone's edge between the two.
   */
  | "merge";

export interface ZonePressInput {
  /** Corners of the shape in flight, the anchor included when there is one. */
  count: number;
  /** The shape in flight started on a finished zone's corner. */
  anchored: boolean;
  /** The corner of the shape in flight the press landed on (see cornerAt). */
  corner: number | null;
  /** The press landed inside a finished zone. */
  onZone: boolean;
  /** Shift held, or a finger: the press edits the selection, never a first corner. */
  additive: boolean;
  /**
   * The press landed on a finished zone's corner handle — any zone's until
   * anchored, then only its own zone's, the anchor itself excepted.
   */
  onHandle: boolean;
}

/**
 * Which of the six a click is.
 *
 * A press on a corner is never a new corner: a duplicate dot is a degenerate
 * edge (or a shape that looks like four points and counts five). It is kept
 * for the drag instead, so a shape can be adjusted mid-draw. The exception is
 * the first corner once the shape can close.
 *
 * A finished zone is selected only while no shape is in flight; after the
 * first corner every press is the next corner, so a shape can cross a zone.
 * Starting one inside a zone is lost, but that area is already forbidden.
 * Shift (or a finger) adds to the selection, and a miss keeps it instead of
 * starting a shape.
 *
 * A finished zone's corner anchors a shape; a click on another corner of the
 * same zone merges it (mergeIntoZone). A merge needs a corner of its own, or
 * it would just straighten an edge, which is a corner drag's job. An anchored
 * shape belongs to its zone, so it never offers `close`.
 */
export function classifyZonePress(input: ZonePressInput): ZonePressVerdict {
  const { count, anchored, corner, onZone, additive, onHandle } = input;
  if (count === 0) {
    if (onHandle) return "anchor";
    if (onZone) return "select";
    return additive ? "ignore" : "add";
  }
  if (corner !== null) {
    return corner === 0 && !anchored && count >= MIN_ZONE_POINTS ? "close" : "ignore";
  }
  if (onHandle) return !anchored ? "anchor" : count >= 2 ? "merge" : "ignore";
  return "add";
}

/** Twice the signed area of a polygon, by the shoelace formula. */
function doubledArea(points: readonly ZonePoint[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return sum;
}

/**
 * Replace the stretch of a zone's edge between two corners with new corners.
 *
 * Of the two arcs between `from` and `to`, the one kept is whichever leaves
 * the larger zone: an outward bump grows it, an inward cut removes the
 * smaller piece. A rule on drawing direction instead would make the same
 * shape mean two things depending on the starting corner.
 *
 * `inserted` runs from `from` towards `to`, excluding both. The result starts
 * at `from` and reuses the zone's own corner objects where kept.
 */
export function reshapeZone(
  points: readonly ZonePoint[],
  from: number,
  to: number,
  inserted: readonly ZonePoint[],
): ZonePoint[] {
  const n = points.length;
  if (from === to || n < MIN_ZONE_POINTS) return [...points];
  // Walk from `to` back round to `from`, both ends included, one way or the
  // other; the run then bridges `from` to `to` again.
  const arc = (step: 1 | -1) => {
    const kept: ZonePoint[] = [];
    for (let i = to; ; i = (i + step + n) % n) {
      kept.push(points[i]);
      if (i === from) break;
    }
    return kept;
  };
  const forward = [...inserted, ...arc(1)];
  const backward = [...inserted, ...arc(-1)];
  return Math.abs(doubledArea(forward)) >= Math.abs(doubledArea(backward)) ? forward : backward;
}

/**
 * Merge an anchored shape into its zone, ending on the zone's corner `target`.
 *
 * The corners after the anchor run anchor → target; those before it run
 * target → anchor. Each goes through reshapeZone. A shape with both keeps the
 * larger result and drops the other rather than guessing.
 *
 * Null when the shape has no corner of its own or the target is the anchor.
 */
export function mergeIntoZone(
  points: readonly ZonePoint[],
  draft: readonly ZonePoint[],
  anchor: { index: number; position: number },
  target: number,
): ZonePoint[] | null {
  if (target === anchor.index) return null;
  const after = draft.slice(anchor.position + 1);
  const before = draft.slice(0, anchor.position);
  const candidates: ZonePoint[][] = [];
  if (after.length) candidates.push(reshapeZone(points, anchor.index, target, after));
  if (before.length) candidates.push(reshapeZone(points, target, anchor.index, before));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, ring) =>
    Math.abs(doubledArea(ring)) > Math.abs(doubledArea(best)) ? ring : best,
  );
}

/**
 * Even-odd point-in-polygon test, in map metres: an area does not vanish with
 * the zoom the way a corner dot does, so no view is needed.
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

/** The topmost zone under a point, or null: reverse paint order, so the one on top wins. */
export function zoneAt(zones: readonly ZonePolygon[], at: ZonePoint): ZonePolygon | null {
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    if (pointInPolygon(zones[i].points, at)) return zones[i];
  }
  return null;
}

/**
 * A fresh zone id, distinct from every zone in `taken`.
 *
 * Not crypto.randomUUID(), which does not exist over the robot's plain http.
 * Not a session counter either: loaded zones carry ids from earlier sessions,
 * and the backend refuses a list with a duplicate id.
 */
export function newZoneId(taken: readonly ZonePolygon[]): string {
  const used = new Set(taken.map((zone) => zone.id));
  let n = taken.length + 1;
  while (used.has(`zone-${n}`)) n += 1;
  return `zone-${n}`;
}

/**
 * Whether two zone lists would save the same (ids, order, corners). Compared
 * by value so a corner dragged away and back, or a mere selection, does not
 * mark the editor dirty.
 */
export function sameZones(a: readonly ZonePolygon[], b: readonly ZonePolygon[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((zone, i) => {
    const other = b[i];
    return (
      zone.id === other.id &&
      zone.points.length === other.points.length &&
      zone.points.every((point, j) => point.x === other.points[j].x && point.y === other.points[j].y)
    );
  });
}

/** A zone taken out of a list, with where it stood, so it can be put back. */
export interface RemovedZone {
  zone: ZonePolygon;
  index: number;
}

/**
 * `list` without the zones in `ids`, plus those zones and their positions.
 * Remove applies it to both the screen and the last-saved list, so only those
 * zones are deleted on the robot and unsaved edits do not ride along.
 */
export function withoutZones(
  list: readonly ZonePolygon[],
  ids: readonly string[],
): { kept: ZonePolygon[]; removed: RemovedZone[] } {
  const kept: ZonePolygon[] = [];
  const removed: RemovedZone[] = [];
  list.forEach((zone, index) => {
    if (ids.includes(zone.id)) removed.push({ zone, index });
    else kept.push(zone);
  });
  return { kept, removed };
}

/**
 * Put back zones a refused remove took off the screen, at their old
 * positions: sameZones compares in order, so a clean editor must stay clean.
 * A zone already in the list is not doubled.
 */
export function restoreZones(
  list: readonly ZonePolygon[],
  removed: readonly RemovedZone[],
): ZonePolygon[] {
  const next = [...list];
  for (const { zone, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (next.some((entry) => entry.id === zone.id)) continue;
    next.splice(Math.min(index, next.length), 0, zone);
  }
  return next;
}
