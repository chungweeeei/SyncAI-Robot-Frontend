// The floor plan editor's one Undo stack over strokes and waypoint edits, so
// Ctrl+Z takes back whatever came last. A waypoint edit is a snapshot of the
// whole list (a few KB), so there is no inverse operation to get wrong.

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
 * Give every waypoint in the history the id a save just issued it, or undoing
 * past a save would revive the local id and the next Save would duplicate it.
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
