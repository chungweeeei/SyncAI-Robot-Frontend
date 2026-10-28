"use client";

import * as React from "react";

import { useSaveMapKeepout } from "@/hooks/use-map-actions";
import { withoutZones, type ZoneCornerRef, type ZonePoint, type ZonePolygon } from "@/lib/map/zone";
import {
  canCloseZoneSession,
  initialZoneSession,
  zoneSessionDirty,
  zoneSessionReducer,
  type ZoneSession,
} from "@/lib/map/zone-session";
import type { SaveKeepoutResult } from "@/lib/api/keepout";

/** The last zone write, for the editor's note. */
export type ZoneSaveNote =
  | { kind: "idle" }
  | { kind: "saving" }
  /** `reloaded` is whether the running planner picked the zones up. */
  | { kind: "saved"; active: boolean; reloaded: boolean; message: string }
  | { kind: "failed"; message: string };

const IDLE: ZoneSaveNote = { kind: "idle" };

const savedNote = (result: SaveKeepoutResult): ZoneSaveNote => ({
  kind: "saved",
  active: result.active,
  reloaded: result.reloaded,
  message: result.message,
});

export interface UseZoneEditing extends ZoneSession {
  dirty: boolean;
  canClose: boolean;
  note: ZoneSaveNote;
  /** Which press `note` reports on: Save, or a Remove, which writes at once. */
  action: "save" | "remove";
  /**
   * One zone write at a time: Save and Remove each send a whole list the
   * other did not see, so the second to land would undo the first.
   */
  writing: boolean;
  addCorner: (point: ZonePoint) => void;
  anchorOn: (corner: { zoneId: string; index: number }) => void;
  mergeOn: (target: number) => void;
  moveCorner: (corner: ZoneCornerRef, point: ZonePoint) => void;
  closeShape: (band?: Pick<ZonePolygon, "z_min" | "z_max">) => void;
  dropShape: () => void;
  popCorner: () => void;
  /** Write the zones as shown, when they differ from the saved list. */
  save: () => void;
  /**
   * Remove zones, on the robot at once (no Save). Sends the *last saved*
   * list minus these, not the screen's: a remove only deletes, so unsaved
   * zone edits stay for Save, and a zone never saved sends nothing. Taken off
   * screen before the answer (a planner reload can take seconds) and put
   * back on a refusal, so the map never hides a zone the planner keeps.
   */
  remove: (ids: readonly string[]) => void;
}

/**
 * The forbidden zones an editor is changing, for both map editors. Zones wait
 * for Save rather than writing through: the endpoint takes the whole list and
 * the planner reloads on each write, so a write per dragged corner would
 * reload it dozens of times. Only finished zones are saved.
 *
 * `read` is the robot's list, or null while unread or unreadable, which keeps
 * `zones` null and every write refused. The first list read is taken once.
 *
 * `clearNoteOnEdit` puts a finished save's note away at the next edit to a
 * zone.
 */
export function useZoneEditing(
  name: string,
  read: ZonePolygon[] | null,
  { clearNoteOnEdit = false }: { clearNoteOnEdit?: boolean } = {},
): UseZoneEditing {
  const [state, dispatch] = React.useReducer(zoneSessionReducer, read, initialZoneSession);
  if (state.zones === null && read !== null) dispatch({ type: "load", zones: read });

  const [note, setNote] = React.useState<ZoneSaveNote>(IDLE);
  const [action, setAction] = React.useState<"save" | "remove">("save");
  // `mutate` alone: bound once per observer, so the callbacks keep their identity.
  const { mutate } = useSaveMapKeepout();
  const writing = note.kind === "saving";
  const dirty = zoneSessionDirty(state);

  const edited = React.useCallback(() => {
    if (clearNoteOnEdit) setNote((current) => (current.kind === "saving" ? current : IDLE));
  }, [clearNoteOnEdit]);

  const addCorner = React.useCallback(
    (point: ZonePoint) => {
      dispatch({ type: "add", point });
      edited();
    },
    [edited],
  );
  const anchorOn = React.useCallback(
    ({ zoneId, index }: { zoneId: string; index: number }) => {
      dispatch({ type: "anchor", zoneId, index });
      edited();
    },
    [edited],
  );
  const mergeOn = React.useCallback(
    (target: number) => {
      dispatch({ type: "merge", target });
      edited();
    },
    [edited],
  );
  const moveCorner = React.useCallback(
    (corner: ZoneCornerRef, point: ZonePoint) => {
      dispatch({ type: "move", corner, point });
      if (corner.zoneId !== null) edited();
    },
    [edited],
  );
  const closeShape = React.useCallback(
    (band?: Pick<ZonePolygon, "z_min" | "z_max">) => {
      dispatch({ type: "close", band });
      edited();
    },
    [edited],
  );
  const dropShape = React.useCallback(() => dispatch({ type: "drop" }), []);
  const popCorner = React.useCallback(() => dispatch({ type: "pop" }), []);

  const { zones, saved } = state;

  const save = React.useCallback(() => {
    if (writing || !dirty || zones === null) return;
    // The list as of the press becomes the saved one, so a corner dragged
    // mid-request is still unsaved after, by comparison.
    const sent = zones;
    setAction("save");
    setNote({ kind: "saving" });
    mutate(
      { name, zones: sent },
      {
        onSuccess: (result) => {
          dispatch({ type: "saved", zones: sent });
          setNote(savedNote(result));
        },
        onError: (cause) => setNote({ kind: "failed", message: cause.message }),
      },
    );
  }, [writing, dirty, zones, mutate, name]);

  const remove = React.useCallback(
    (ids: readonly string[]) => {
      if (writing || ids.length === 0 || zones === null || saved === null) return;
      const { removed } = withoutZones(zones, ids);
      dispatch({ type: "remove", ids });
      const remote = withoutZones(saved, ids);
      if (remote.removed.length === 0) return;
      setAction("remove");
      setNote({ kind: "saving" });
      mutate(
        { name, zones: remote.kept },
        {
          onSuccess: (result) => {
            dispatch({ type: "savedRemoval", ids });
            setNote(savedNote(result));
          },
          onError: (cause) => {
            dispatch({ type: "restore", removed });
            setNote({ kind: "failed", message: cause.message });
          },
        },
      );
    },
    [writing, zones, saved, mutate, name],
  );

  return {
    ...state,
    dirty,
    canClose: canCloseZoneSession(state),
    note,
    action,
    writing,
    addCorner,
    anchorOn,
    mergeOn,
    moveCorner,
    closeShape,
    dropShape,
    popCorner,
    save,
    remove,
  };
}
