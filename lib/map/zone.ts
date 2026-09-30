/**
 * Forbidden zones: the rules for drawing one on the floor plan editor.
 *
 * What a zone *is* — ZonePoint and ZonePolygon — is the backend's shape and
 * lives in lib/types/map.ts beside MapVertex; it is re-exported here so the
 * editor can take the rules and the words from one place. This module keeps
 * the rules, which is the split every other map thing already has.
 *
 * Pure, and no Path2D: the drawing is lib/map/draw.ts's, so these rules can
 * be tested without a canvas.
 */

import type { ZonePoint, ZonePolygon } from "@/lib/types/map";

export type { ZonePoint, ZonePolygon };

/**
 * A corner the pointer can pick up and move: one of the shape in flight
 * (`zoneId` null) or one of a finished zone. The same drag serves both, so
 * one name says which polygon the index counts into.
 */
export interface ZoneCornerRef {
  zoneId: string | null;
  index: number;
}

/**
 * Where a shape in flight is attached to a finished zone: which corner of
 * which zone, and where in the shape's own corner list the copy of that
 * corner sits. The copy is not always first — a shape started on bare map
 * can reach a zone's corner later, and the corners before it are as much a
 * part of the run as the ones after (see mergeIntoZone).
 */
export interface ZoneAnchor {
  zoneId: string;
  index: number;
  /** Index into the shape in flight of the corner that is the zone's. */
  position: number;
}

/**
 * A shape needs three corners before it encloses anything: two points are a
 * line, and a line has no inside for the robot to be kept out of.
 */
export const MIN_ZONE_POINTS = 3;

export function canCloseZone(points: readonly ZonePoint[]): boolean {
  return points.length >= MIN_ZONE_POINTS;
}

/**
 * The corner of the shape in flight under a press, or null.
 *
 * Hit-tested in screen pixels, for the same reason a vertex marker is (see
 * vertexAt in components/maps/grid-canvas.tsx): the dot does not scale with
 * the zoom, so a world-space radius would be unclickable zoomed out and
 * enormous zoomed in. The caller passes the radius, because only it knows
 * whether the press is a mouse or a finger. The nearest wins where two dots
 * overlap, so a corner dropped almost on top of another can still be picked
 * back up.
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
   * The press landed on a corner and a click there means nothing: the first
   * corner too early to close, any later one, or a handle too early to
   * merge. A drag from the same press moves the corner instead, which is the
   * caller's to carry out.
   */
  | "ignore"
  /** No shape in flight and the press landed inside a finished zone: select it. */
  | "select"
  /**
   * No shape in flight and the press landed on a finished zone's corner:
   * start a shape there, anchored to that zone (see reshapeZone).
   */
  | "anchor"
  /**
   * An anchored shape in flight and the press landed on another corner of
   * its zone: the corners drawn since the anchor replace the zone's edge
   * between the two.
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
  /**
   * Shift was held, or the press is a finger: the press is about the
   * selection, adding to it or taking from it, and never a first corner.
   */
  additive: boolean;
  /**
   * The press landed on a finished zone's corner handle — any zone's until
   * the shape is anchored, then its own zone's, the anchor corner excepted
   * (that one is a `corner` of the shape).
   */
  onHandle: boolean;
}

/**
 * Which of the six a click is.
 *
 * A press on a corner is never a new corner: a second dot on top of the first
 * is a degenerate edge that could never be closed, and one on top of any other
 * would leave the operator with a shape that looks like four points and counts
 * five. The press is kept for the drag instead — a corner already placed is
 * picked up and moved, so a shape can be adjusted while it is being drawn
 * rather than dropped and redrawn. A click on the first corner is the one
 * exception, and only once the shape *can* close.
 *
 * A finished zone is selected by pressing inside it, but only while no shape
 * is in flight: once a corner is down every press is the next corner, so a
 * shape can still be drawn across a zone that is already there. What cannot
 * be done is *starting* one inside a zone — the inside is already forbidden,
 * so nothing is lost. With Shift held (or under a finger, which has no
 * Shift) the press adds the zone to the selection instead of replacing it,
 * and a miss onto bare map keeps the selection rather than starting a
 * shape: an operator holding Shift is choosing zones, not drawing one.
 *
 * A finished zone's corner is where a zone grows from. A click on one
 * anchors the shape there — as its first corner, or as the next one of a
 * shape already under way that has reached the zone; a click on another
 * corner of the same zone ends it, and the shape's own corners replace that
 * stretch of the zone's edge (mergeIntoZone). The merge needs at least one
 * corner of its own: the anchor and the target alone would only replace an
 * edge with a straight line, which is a corner drag's job. An anchored
 * shape never closes on itself — it belongs to the zone now, so `close` is
 * not offered.
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
 * Replace the stretch of a zone's edge between two of its corners with a
 * run of new corners.
 *
 * The ring between `from` and `to` has two arcs, and either could be the one
 * the operator meant to redraw. The one kept is whichever leaves the larger
 * zone, which is the reading that matches the gesture nine times in ten: a
 * bump drawn outward grows the zone, and the arc it replaces is the short
 * edge it bypassed. Drawing inward shrinks a zone, and the larger of the two
 * results is then the zone with the smaller piece cut away — which is what
 * a cut is for. The alternative, a rule on the drawing direction, would
 * make the same shape mean two things depending on which corner the
 * operator happened to start at.
 *
 * `inserted` is the run in drawing order from `from` towards `to`, with
 * neither corner in it. The result starts at `from`, so the zone keeps its
 * corner order readable, and the corners in it are the zone's own objects
 * where they were kept.
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
 * Merge a shape in flight into the zone it is anchored to, ending on the
 * zone's corner `target`.
 *
 * The shape's corners split at the anchor into the ones drawn after it and
 * the ones drawn before it. Either set is a run from one corner of the zone
 * to the other — after the anchor it runs anchor → target, before it the
 * shape's ring runs target → (its start) → anchor — and each goes through
 * reshapeZone on its own. A shape usually has only one of the two: started
 * on the zone it has corners after the anchor, started on bare map and
 * closed onto the zone it has them before. One that has both bulges out on
 * both sides of the chord between the two corners, and the larger result
 * is kept, reshapeZone's own rule one level up; the other run is dropped
 * rather than guessed at.
 *
 * Null when there is nothing to merge: the shape has no corner of its own,
 * or the target is the anchor.
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
 * A fresh id for a zone this editor drew, distinct from every zone in `taken`.
 *
 * Not crypto.randomUUID(): the console is served over plain http on the
 * robot's LAN, where that function does not exist (the same reason
 * lib/task/step.ts makes its own ids). And not a bare session counter, which
 * it used to be while nothing stored a zone: the zones loaded from the robot
 * carry ids an earlier session handed out, the backend keeps an id as it was
 * sent, and refuses a list in which one appears twice — so the next id has to
 * step over every id already on the map, not only over this session's.
 */
export function newZoneId(taken: readonly ZonePolygon[]): string {
  const used = new Set(taken.map((zone) => zone.id));
  let n = taken.length + 1;
  while (used.has(`zone-${n}`)) n += 1;
  return `zone-${n}`;
}

/**
 * Whether two zone lists would save as the same thing: same zones, same
 * order, same corners. What the editor's zone half of `dirty` is measured
 * with, against the list last loaded or saved — by value rather than by
 * identity, so a corner dragged away and back, or a click that selected a
 * zone without moving it, does not light Save for a write that changes
 * nothing on the robot.
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
 * `list` without the zones whose ids are in `ids`, and those zones with
 * their positions. Remove applies this twice: to the zones on screen, and to
 * the list last saved, which is what goes to the robot — so a remove deletes
 * those zones there and nothing else, and zones drawn or reshaped since the
 * last Save stay unsaved rather than riding along.
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
 * Put zones a refused remove took off the screen back where they stood.
 *
 * Back at their old positions, not appended, because the Save dot compares
 * lists in order (sameZones): a refused remove on a clean editor has to
 * leave it clean. A zone already back in the list — the operator drew over
 * the gap under the same id, which cannot happen today — is not doubled.
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
