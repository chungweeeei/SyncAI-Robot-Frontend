// What the floor plan editor's Undo and Redo step over: a stroke, or a
// waypoint edit. One stack for both, so Ctrl+Z takes back whatever the
// operator did last, whichever layer it was on.
//
// A waypoint edit is a snapshot of the whole staged list either side of it
// rather than an inverse operation. A map carries tens of stops, not
// millions of cells, so a copy costs a few kilobytes — and a snapshot has no
// inverse to get wrong for a band delete, a rename and a re-aim alike.

import { patchBytes, type GridPatch, type UndoStack } from "@/lib/map/patch";
import type { MapVertex } from "@/lib/types/map";

export type EditorEdit =
  | { kind: "grid"; patch: GridPatch }
  | { kind: "waypoints"; before: readonly MapVertex[]; after: readonly MapVertex[] };

/** A rough weight per stored row: an id, a name, a type and three numbers. */
const WAYPOINT_BYTES = 160;

export function editBytes(edit: EditorEdit): number {
  return edit.kind === "grid"
    ? patchBytes(edit.patch)
    : (edit.before.length + edit.after.length) * WAYPOINT_BYTES;
}

/**
 * Give every waypoint the history remembers the id a save just issued it.
 *
 * Without this, undoing past a save would bring back the staged row under its
 * local id, and the next Save would delete the stored row and create a copy
 * of it — the same stop on the map, under an id nothing else knows.
 */
export function remapWaypointIds(
  stack: UndoStack<EditorEdit>,
  ids: ReadonlyMap<string, string>,
): void {
  if (!ids.size) return;
  const remap = (list: readonly MapVertex[]) =>
    list.map((vertex) => {
      const id = ids.get(vertex.id);
      return id ? { ...vertex, id } : vertex;
    });
  for (const entries of [stack.undo, stack.redo]) {
    for (let index = 0; index < entries.length; index += 1) {
      const edit = entries[index];
      if (edit.kind !== "waypoints") continue;
      entries[index] = { ...edit, before: remap(edit.before), after: remap(edit.after) };
    }
  }
}
