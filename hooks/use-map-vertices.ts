import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { writeState } from "@/lib/api/mutation-state";
import { queryKeys } from "@/lib/api/query-keys";
import {
  createVertex,
  deleteVertex,
  listVertices,
  updateVertex,
  type VertexChanges,
  type VertexDraft,
} from "@/lib/api/vertex";
import type { MapVertex } from "@/lib/types/map";

export type MapVerticesStatus = "loading" | "ok" | "error";

export interface UseMapVertices {
  vertices: MapVertex[];
  status: MapVerticesStatus;
  /** The load failure, or the most recent write failure. Rendered verbatim. */
  error: string | null;
  /** True while a create / update / delete is in flight. */
  busy: boolean;
  /** The created vertex, or null if the request failed (see `error`). */
  create: (draft: VertexDraft) => Promise<MapVertex | null>;
  update: (id: string, changes: VertexChanges) => Promise<MapVertex | null>;
  /** True when the row is gone. */
  remove: (id: string) => Promise<boolean>;
  clearError: () => void;
}

/**
 * One map's vertices, written through to the backend on every change.
 *
 * There is deliberately no local dirty state and no Save button, unlike the
 * gridmap this hook sits beside. A gridmap is one 2.4 MB file replaced whole, so
 * buffering it and writing once is the only sane shape; vertices are individual
 * rows with per-id PUT/DELETE, and staging a diff to replay later would invent a
 * partial-failure state — half the edits landed, the UI has to say which — for
 * no benefit on a robot LAN. Each action is one request, and `error` describes
 * the last one.
 *
 * The list lives in the query cache under the map's name. The key does two
 * jobs: it is the old `loaded.name === name` race guard (a response or a
 * write's echo that resolves after the editor moved to another map lands under
 * its own key and cannot patch the list now on screen), and it is shared with
 * useActiveMapVertices, so an edit made here is already current on the
 * dashboard — see lib/api/query-keys.ts.
 *
 * The three writes are TanStack mutations whose hook-level `onSuccess` splices
 * the cache (the response *is* the stored row, so a GET would cost a round trip
 * to learn nothing) and marks the two other keys a vertex change touches: the
 * catalogue's `vertex_count`, and the task templates whose MOVE steps resolve
 * against this vertex's pose. `create`/`update`/`remove` swallow the rejection
 * and return null/false because every caller is wired straight to an onClick —
 * a rethrow would be an unhandled rejection, and the panel reads the outcome
 * off `error` and the returned value.
 */
export function useMapVertices(name: string): UseMapVertices {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.mapVertices(name),
    queryFn: ({ signal }) => listVertices(name, signal),
  });

  /** Rewrite this map's cached list; a no-op until the load has answered. */
  const setVertices = React.useCallback(
    (next: (current: MapVertex[]) => MapVertex[]) => {
      queryClient.setQueryData<MapVertex[]>(
        queryKeys.mapVertices(name),
        (current) => (current ? next(current) : current),
      );
    },
    [queryClient, name],
  );

  const touchDependents = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (draft: VertexDraft) => createVertex(name, draft),
    onSuccess: (created) => {
      setVertices((current) => [...current, created]);
      touchDependents();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: VertexChanges }) =>
      updateVertex(name, id, changes),
    onSuccess: (updated, { id }) => {
      setVertices((current) =>
        current.map((vertex) => (vertex.id === id ? updated : vertex)),
      );
      touchDependents();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteVertex(name, id),
    onSuccess: (_result, id) => {
      setVertices((current) => current.filter((vertex) => vertex.id !== id));
      touchDependents();
    },
  });

  const { mutateAsync: createAsync } = createMutation;
  const { mutateAsync: updateAsync } = updateMutation;
  const { mutateAsync: removeAsync } = removeMutation;

  const create = React.useCallback(
    (draft: VertexDraft) => createAsync(draft).catch(() => null),
    [createAsync],
  );
  const update = React.useCallback(
    (id: string, changes: VertexChanges) =>
      updateAsync({ id, changes }).catch(() => null),
    [updateAsync],
  );
  const remove = React.useCallback(
    (id: string) =>
      removeAsync(id).then(
        () => true,
        () => false,
      ),
    [removeAsync],
  );

  const write = writeState([createMutation, updateMutation, removeMutation]);
  // `reset` is bound once per mutation observer, so this identity is stable —
  // which the editor relies on: it sits in the deps of callbacks handed to the
  // memoized GridCanvas.
  const { reset: resetCreate } = createMutation;
  const { reset: resetUpdate } = updateMutation;
  const { reset: resetRemove } = removeMutation;
  const clearError = React.useCallback(() => {
    resetCreate();
    resetUpdate();
    resetRemove();
  }, [resetCreate, resetUpdate, resetRemove]);

  return {
    vertices: query.data ?? [],
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
    // Shared slot preserved from before the migration: the panel has exactly
    // one place to put a sentence, and the two cases are never live at once (a
    // map whose list failed to load has no vertices to edit). The load half
    // clears itself — a successful refetch resets the query's error.
    error: write.error ?? query.error?.message ?? null,
    busy: write.busy,
    create,
    update,
    remove,
    clearError,
  };
}
