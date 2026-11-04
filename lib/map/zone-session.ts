// The forbidden zones an editor is changing, and the shape being drawn. What a press means stays the canvas's
// (classifyZonePress); this is what the editor does with the verdict.

import {
  canCloseZone,
  mergeIntoZone,
  newZoneId,
  sameZones,
  type ZoneAnchor,
  type ZoneCornerRef,
  type ZonePoint,
  type ZonePolygon,
} from "@/lib/map/zone";

export interface ZoneSession {
  /**
   * The zones as shown and edited. Null until the robot's list has been read:
   * a save is the whole list, so drawing over an unread one would erase every
   * zone the robot holds.
   */
  zones: ZonePolygon[] | null;
  /** The zones as last saved, which `zones` is measured against for dirty. */
  saved: ZonePolygon[] | null;
  /** The corners of the shape being drawn. */
  draft: ZonePoint[];
  /**
   * The finished zone's corner the shape in flight is attached to. Kept beside
   * the draft, not in it: the draft holds a copy of the corner, which goes
   * stale once that corner is dragged.
   */
  anchor: ZoneAnchor | null;
  /**
   * The last finished edit to the zones, for the editor's undo history: a
   * zone closed, merged, removed, or reshaped by a corner drag let go. A new
   * object per edit, so a reader can tell one from the next by identity.
   * Recorded here rather than by the caller so its `after` is the list the
   * edit produced, whatever React has rendered by then.
   */
  commit: ZoneCommit | null;
  /** The zones as a corner drag found them, until the drag is let go. */
  dragFrom: ZonePolygon[] | null;
}

/** A finished edit to the zones, as the list stood either side of it. */
export interface ZoneCommit {
  before: ZonePolygon[];
  after: ZonePolygon[];
}

export type ZoneSessionAction =
  /** The robot's list, read; taken only while none has been. */
  | { type: "load"; zones: ZonePolygon[] }
  | { type: "add"; point: ZonePoint }
  /** Attach the shape to a finished zone's corner, as its start or next corner. */
  | { type: "anchor"; zoneId: string; index: number }
  /** End an anchored shape on corner `target` of its zone (mergeIntoZone). */
  | { type: "merge"; target: number }
  /** A dragged corner, of the shape (`zoneId` null) or a finished zone. */
  | { type: "move"; corner: ZoneCornerRef; point: ZonePoint }
  /** A corner drag let go: the whole drag is one commit, not one per move. */
  | { type: "dragEnd" }
  /** Close the shape into a zone; `band` is the floor it forbids, if one. */
  | { type: "close"; band?: Pick<ZonePolygon, "z_min" | "z_max"> }
  /** Drop the shape in flight. */
  | { type: "drop" }
  /** Take back the shape's last corner. */
  | { type: "pop" }
  /** Take zones off the screen; Save is what deletes them on the robot. */
  | { type: "remove"; ids: readonly string[] }
  /** A Save landed: `zones` is what it sent. */
  | { type: "saved"; zones: ZonePolygon[] }
  /** Undo or Redo: the zones as they stood either side of an edit. */
  | { type: "replace"; zones: ZonePolygon[] };

export function initialZoneSession(zones: ZonePolygon[] | null): ZoneSession {
  return { zones, saved: zones, draft: [], anchor: null, commit: null, dragFrom: null };
}

const cleared = { draft: [] as ZonePoint[], anchor: null };

/** The edits that finish in one action; a corner drag finishes on `dragEnd`. */
const COMMITS: ReadonlySet<ZoneSessionAction["type"]> = new Set(["close", "merge", "remove"]);

export function zoneSessionReducer(
  state: ZoneSession,
  action: ZoneSessionAction,
): ZoneSession {
  const next = applyZoneAction(state, action);
  const { zones: before } = state;
  const { zones: after } = next;
  if (before === null || after === null || sameZones(before, after)) return next;
  if (COMMITS.has(action.type)) return { ...next, commit: { before, after } };
  if (action.type === "move" && next.dragFrom === null) return { ...next, dragFrom: before };
  return next;
}

function applyZoneAction(state: ZoneSession, action: ZoneSessionAction): ZoneSession {
  switch (action.type) {
    case "load":
      return state.zones === null ? initialZoneSession(action.zones) : state;

    case "add":
      return { ...state, draft: [...state.draft, action.point] };

    case "anchor": {
      // classifyZonePress offers an anchor only to an unanchored shape.
      if (state.anchor) return state;
      const point = state.zones
        ?.find((zone) => zone.id === action.zoneId)
        ?.points[action.index];
      if (!point) return state;
      return {
        ...state,
        draft: [...state.draft, point],
        anchor: { zoneId: action.zoneId, index: action.index, position: state.draft.length },
      };
    }

    case "merge": {
      const { anchor, zones } = state;
      if (!anchor || !zones) return state;
      const zone = zones.find((entry) => entry.id === anchor.zoneId);
      const merged = zone && mergeIntoZone(zone.points, state.draft, anchor, action.target);
      if (!merged) return state;
      return {
        ...state,
        ...cleared,
        // Under the zone's own id and floor band.
        zones: zones.map((entry) =>
          entry.id === anchor.zoneId ? { ...entry, points: merged } : entry,
        ),
      };
    }

    case "move": {
      const { corner, point } = action;
      // Out of range is a no-op, not an append: a Done or Remove mid-drag may
      // have taken the corner away.
      const moved = (points: ZonePoint[]) =>
        corner.index < points.length
          ? points.map((entry, i) => (i === corner.index ? point : entry))
          : points;
      if (corner.zoneId === null) return { ...state, draft: moved(state.draft) };
      if (!state.zones) return state;
      return {
        ...state,
        zones: state.zones.map((zone) =>
          zone.id === corner.zoneId ? { ...zone, points: moved(zone.points) } : zone,
        ),
      };
    }

    case "close": {
      if (!canCloseZoneSession(state) || !state.zones) return state;
      const zone: ZonePolygon = {
        id: newZoneId(state.zones),
        points: state.draft,
        ...action.band,
      };
      return { ...state, ...cleared, zones: [...state.zones, zone] };
    }

    case "drop":
      return state.draft.length === 0 && !state.anchor ? state : { ...state, ...cleared };

    case "pop": {
      if (state.draft.length === 0) return state;
      // Taking back the anchor's own copy lets the shape go of its zone.
      const anchor =
        state.anchor && state.anchor.position === state.draft.length - 1 ? null : state.anchor;
      return { ...state, draft: state.draft.slice(0, -1), anchor };
    }

    case "remove": {
      if (!state.zones) return state;
      const zones = state.zones.filter((zone) => !action.ids.includes(zone.id));
      // A shape anchored on a removed zone has nothing left to join.
      const orphaned = state.anchor !== null && action.ids.includes(state.anchor.zoneId);
      return orphaned ? { ...state, ...cleared, zones } : { ...state, zones };
    }

    case "saved":
      return { ...state, saved: action.zones };

    case "dragEnd": {
      const { dragFrom, zones } = state;
      if (dragFrom === null) return state;
      const moved = zones !== null && !sameZones(dragFrom, zones);
      return {
        ...state,
        dragFrom: null,
        commit: moved ? { before: dragFrom, after: zones } : state.commit,
      };
    }

    case "replace":
      // `saved` stays, so dirty still measures against the robot's list. The
      // shape in flight goes: its anchor may name a zone the step took away.
      return state.zones === null
        ? state
        : { ...state, ...cleared, zones: action.zones, dragFrom: null };
  }
}

/** Whether Save has zones to write. */
export function zoneSessionDirty({ zones, saved }: ZoneSession): boolean {
  return zones !== null && saved !== null && !sameZones(zones, saved);
}

/** Done and Enter close only an unanchored shape; an anchored one ends on its zone. */
export function canCloseZoneSession({ zones, draft, anchor }: ZoneSession): boolean {
  return zones !== null && anchor === null && canCloseZone(draft);
}
