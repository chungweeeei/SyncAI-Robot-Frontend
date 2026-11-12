"use client";

import * as React from "react";

import { useRenameMap } from "@/hooks/use-map-actions";
import { MAP_NAME_RE } from "@/lib/map/name";

type RenameResult = NonNullable<ReturnType<typeof useRenameMap>["data"]>;

export interface MapRenameDraft {
  editing: boolean;
  /** The name as typed; `trimmed` is what would be sent. */
  draft: string;
  setDraft: (draft: string) => void;
  trimmed: string;
  /** `trimmed` passes the map name rule. */
  valid: boolean;
  /** `trimmed` is not the name the map already has. */
  changed: boolean;
  busy: boolean;
  /** The backend's sentence for a refused rename (taken, in use), verbatim. */
  error: string | null;
  /** Open the input on the current name, the last refusal forgotten. */
  begin: () => void;
  cancel: () => void;
  /**
   * Send the rename if the draft is valid and changed. `onRenamed` runs once
   * it lands, with the answer and the new name, after the input has closed.
   */
  submit: (onRenamed: (result: RenameResult, to: string) => void) => void;
}

/**
 * The inline rename of a map as both its faces run it — the Maps card's
 * Rename button and the editor's title: a draft opened on the current name,
 * held to the name rule, and sent through PATCH /api/v1/maps/{name}
 * (useRenameMap, which owns the cache consequences). What each face does
 * around it — what opens the input, what a landed rename leads to — stays
 * with the face.
 */
export function useMapRenameDraft(name: string): MapRenameDraft {
  const rename = useRenameMap();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);

  const trimmed = draft.trim();
  const valid = MAP_NAME_RE.test(trimmed);
  const changed = trimmed !== name;
  const busy = rename.isPending;

  const begin = () => {
    setDraft(name);
    rename.reset();
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    // Not while pending: `disabled` fires a blur in some browsers, and a reset
    // would detach the success handler of the rename in flight.
    if (!rename.isPending) rename.reset();
  };

  const submit = (onRenamed: (result: RenameResult, to: string) => void) => {
    if (!valid || !changed || busy) return;
    rename.mutate(
      { from: name, to: trimmed },
      {
        onSuccess: (result) => {
          setEditing(false);
          onRenamed(result, trimmed);
        },
      },
    );
  };

  return {
    editing,
    draft,
    setDraft,
    trimmed,
    valid,
    changed,
    busy,
    error: rename.error?.message ?? null,
    begin,
    cancel,
    submit,
  };
}
