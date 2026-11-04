"use client";

import * as React from "react";

import { useSaveMapKeepout } from "@/hooks/use-map-actions";
import type { ZoneCornerRef, ZonePoint, ZonePolygon } from "@/lib/map/zone";
import {
  canCloseZoneSession,
  initialZoneSession,
  zoneSessionDirty,
  zoneSessionReducer,
  type ZoneCommit,
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
  /** A Save in flight; a second would send a list the first did not see. */
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
   * Take zones off the screen, staged for Save like every other zone edit:
   * the robot keeps them until Save sends the list without them.
   */
  remove: (ids: readonly string[]) => void;
  /** A corner drag let go: the whole drag is one undo step. */
  endCornerDrag: () => void;
  /** Undo or Redo: put the zones back as a commit recorded them. */
  replace: (zones: ZonePolygon[]) => void;
}

/**
 * The forbidden zones the map editor is changing. Zones wait for Save rather
 * than writing through, a removal included: the endpoint takes the whole
 * list and the planner reloads on each write, so a write per dragged corner
 * would reload it dozens of times, and a removal the operator cannot take
 * back before Save opened an area to the robot on one mistaken tap. Only
 * finished zones are saved.
 *
 * `read` is the robot's list, or null while unread or unreadable, which keeps
 * `zones` null and every write refused. The first list read is taken once.
 *
 * `clearNoteOnEdit` puts a finished save's note away at the next edit to a
 * zone. `onCommit` hears each finished edit to the zones once (the session's
 * `commit`), for the editor's undo history.
 */
export function useZoneEditing(
  name: string,
  read: ZonePolygon[] | null,
  {
    clearNoteOnEdit = false,
    onCommit,
  }: { clearNoteOnEdit?: boolean; onCommit?: (commit: ZoneCommit) => void } = {},
): UseZoneEditing {
  const [state, dispatch] = React.useReducer(zoneSessionReducer, read, initialZoneSession);
  if (state.zones === null && read !== null) dispatch({ type: "load", zones: read });

  // Each commit is handed on once, by identity: a new `onCommit` re-runs the
  // effect, and must not record the same edit twice.
  const heardRef = React.useRef<ZoneCommit | null>(null);
  React.useEffect(() => {
    const { commit } = state;
    if (commit === null || commit === heardRef.current) return;
    heardRef.current = commit;
    onCommit?.(commit);
  }, [state, onCommit]);

  const [note, setNote] = React.useState<ZoneSaveNote>(IDLE);
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
  const remove = React.useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      dispatch({ type: "remove", ids });
      edited();
    },
    [edited],
  );
  const endCornerDrag = React.useCallback(() => dispatch({ type: "dragEnd" }), []);
  const replace = React.useCallback(
    (zones: ZonePolygon[]) => {
      dispatch({ type: "replace", zones });
      edited();
    },
    [edited],
  );
  const dropShape = React.useCallback(() => dispatch({ type: "drop" }), []);
  const popCorner = React.useCallback(() => dispatch({ type: "pop" }), []);

  const { zones } = state;

  const save = React.useCallback(() => {
    if (writing || !dirty || zones === null) return;
    // The list as of the press becomes the saved one, so a corner dragged
    // mid-request is still unsaved after, by comparison.
    const sent = zones;
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

  return {
    ...state,
    dirty,
    canClose: canCloseZoneSession(state),
    note,
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
    endCornerDrag,
    replace,
  };
}
