"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useMapVertexList, type MapVertexListStatus } from "@/hooks/use-map-vertex-list";
import { useActiveMap } from "@/hooks/use-maps";
import { queryKeys } from "@/lib/api/query-keys";
import { createVertex, deleteVertex, updateVertex, type VertexDraft } from "@/lib/api/vertex";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

export type ActiveVerticesStatus = MapVertexListStatus;

export interface UseActiveMapVertices {
  /** The active map's directory name, or null when the robot has none loaded. */
  mapName: string | null;
  /** Sorted by name. Empty unless `status` is "ok". */
  vertices: MapVertex[];
  status: ActiveVerticesStatus;
  /** True while a re-place or a create write is in flight. */
  busy: boolean;
  /** The last write failure, or null. Rendered verbatim. */
  writeError: string | null;
  /**
   * Move one vertex to a new pose. True when the row is stored.
   *
   * Position only — name and type are not writable here (see the note on this
   * hook about why the rest of the CRUD surface stays out of it).
   */
  moveVertex: (id: string, pose: PlanarPose) => Promise<boolean>;
  /**
   * Store a new vertex on the active map. The created row, or null when the
   * request failed (see `writeError`) or there is no active map to put it on.
   */
  createVertex: (draft: VertexDraft) => Promise<MapVertex | null>;
  /** Delete one vertex from the active map. True when the row is gone. */
  removeVertex: (id: string) => Promise<boolean>;
  clearWriteError: () => void;
}

/**
 * The active map's vertices: the markers the dashboard draws on the floor, and
 * — through `moveVertex`, `createVertex` and `removeVertex` — what it may
 * write.
 *
 * The list itself is useMapVertexList, keyed by the loaded map's name; this
 * hook adds where that name comes from and the writes. (The task editor used
 * to read through here too, and now reads useMapVertexList directly with
 * whichever map it is authoring for.)
 *
 * Both writes are about *where* a stop is, and both exist because the dashboard
 * is where that is visible: a stop drawn half a metre inside a wall is obvious
 * with the live cloud drawn over it and invisible on the editor's flat raster,
 * and the spot an operator wants a new stop at is the one they are looking at
 * on the same view. Requiring a trip to another screen for either would mean
 * placing from the one view that cannot see the problem. Delete joined them
 * by request, from the same dialog a tap on a stop opens: the stop that is in
 * a wall is also the one you want gone. Rename and retype stay in the editor.
 *
 * `writeError` is separate from `status` rather than shared the way
 * useMapVertices shares its `error`: here the two really can be live at once —
 * the list loads fine and a write fails — and a failed write must not make the
 * layer read as unloaded.
 */
export function useActiveMapVertices(): UseActiveMapVertices {
  const { map, status: mapsStatus } = useActiveMap();
  const name = map?.name ?? null;
  const queryClient = useQueryClient();
  const list = useMapVertexList(name);

  // The map name travels in the variables rather than being read from the
  // closure: a write that lands after the active map changed must patch the
  // list it was made against — the keyed cache is the old `loaded.name === name`
  // guard, and it only works if the key is the one the request used.
  const move = useMutation({
    mutationFn: ({ map, id, pose }: { map: string; id: string; pose: PlanarPose }) =>
      updateVertex(map, id, { x: pose.x, y: pose.y, theta: pose.theta }),
    onSuccess: (updated, { map, id }) => {
      // Patched into the cache from the row the server echoes back, for the
      // same reason useMapVertices splices: the response *is* the stored row,
      // so a GET would cost a round trip to learn nothing.
      queryClient.setQueryData<MapVertex[]>(
        queryKeys.mapVertices(map),
        (current) =>
          current?.map((vertex) => (vertex.id === id ? updated : vertex)),
      );
      // Every template with a MOVE step on this vertex now resolves to the new
      // pose server-side; the library's rows say so once re-read.
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });

  const create = useMutation({
    mutationFn: ({ map, draft }: { map: string; draft: VertexDraft }) =>
      createVertex(map, draft),
    onSuccess: (created, { map }) => {
      queryClient.setQueryData<MapVertex[]>(
        queryKeys.mapVertices(map),
        (current) => (current ? [...current, created] : current),
      );
      // The same two keys useMapVertices marks on a create: the catalogue's
      // vertex_count, and the templates whose step pickers list this map's
      // stops.
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });

  const remove = useMutation({
    mutationFn: ({ map, id }: { map: string; id: string }) => deleteVertex(map, id),
    onSuccess: (_result, { map, id }) => {
      queryClient.setQueryData<MapVertex[]>(
        queryKeys.mapVertices(map),
        (current) => current?.filter((vertex) => vertex.id !== id),
      );
      // vertex_count on the catalogue, and every template with a MOVE step on
      // this stop now has a missing vertex — the same two keys a create marks.
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });

  const { mutateAsync: moveAsync, reset: resetMove } = move;
  const { mutateAsync: createAsync, reset: resetCreate } = create;
  const { mutateAsync: removeAsync, reset: resetRemove } = remove;

  const moveVertex = React.useCallback(
    (id: string, pose: PlanarPose) => {
      if (!name) return Promise.resolve(false);
      return moveAsync({ map: name, id, pose }).then(
        () => true,
        () => false,
      );
    },
    [name, moveAsync],
  );

  const createOnActiveMap = React.useCallback(
    (draft: VertexDraft) => {
      if (!name) return Promise.resolve(null);
      return createAsync({ map: name, draft }).catch(() => null);
    },
    [name, createAsync],
  );

  const removeOnActiveMap = React.useCallback(
    (id: string) => {
      if (!name) return Promise.resolve(false);
      return removeAsync({ map: name, id }).then(
        () => true,
        () => false,
      );
    },
    [name, removeAsync],
  );

  const clearWriteError = React.useCallback(() => {
    resetMove();
    resetCreate();
    resetRemove();
  }, [resetMove, resetCreate, resetRemove]);

  // The catalogue's own state first: until it answers there is no name, and
  // "no-map" must mean the robot has none loaded, not that we have not asked.
  const status: ActiveVerticesStatus =
    mapsStatus === "loading" ? "loading" : mapsStatus === "error" ? "error" : list.status;

  return {
    mapName: name,
    vertices: list.vertices,
    status,
    busy: move.isPending || create.isPending || remove.isPending,
    writeError:
      move.error?.message ?? create.error?.message ?? remove.error?.message ?? null,
    moveVertex,
    createVertex: createOnActiveMap,
    removeVertex: removeOnActiveMap,
    clearWriteError,
  };
}
