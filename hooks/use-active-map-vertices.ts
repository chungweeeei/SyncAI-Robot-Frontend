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
  busy: boolean;
  /** The last write failure, rendered verbatim. */
  writeError: string | null;
  /** Move one vertex (position only). True when the row is stored. */
  moveVertex: (id: string, pose: PlanarPose) => Promise<boolean>;
  /** The created row, or null on failure or with no active map. */
  createVertex: (draft: VertexDraft) => Promise<MapVertex | null>;
  /** True when the row is gone. */
  removeVertex: (id: string) => Promise<boolean>;
  clearWriteError: () => void;
}

/**
 * The active map's vertices (useMapVertexList keyed by the loaded map) plus
 * the writes the dashboard may make.
 *
 * Placing writes live here because the dashboard is where *where* is visible:
 * a stop inside a wall is obvious over the live scan and invisible on the
 * editor's flat raster. Rename and retype stay in the editor.
 *
 * `writeError` is apart from `status`: a failed write must not make the layer
 * read as unloaded.
 */
export function useActiveMapVertices(): UseActiveMapVertices {
  const { map, status: mapsStatus } = useActiveMap();
  const name = map?.name ?? null;
  const queryClient = useQueryClient();
  const list = useMapVertexList(name);

  // The map name travels in the variables: a write landing after the active
  // map changed must patch the list it was made against.
  const move = useMutation({
    mutationFn: ({ map, id, pose }: { map: string; id: string; pose: PlanarPose }) =>
      updateVertex(map, id, { x: pose.x, y: pose.y, theta: pose.theta }),
    onSuccess: (updated, { map, id }) => {
      // The response is the stored row, so it is spliced rather than refetched.
      queryClient.setQueryData<MapVertex[]>(
        queryKeys.mapVertices(map),
        (current) =>
          current?.map((vertex) => (vertex.id === id ? updated : vertex)),
      );
      // Templates with a MOVE step on this vertex now resolve to the new pose.
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
      // The catalogue's vertex_count and the templates' resolution.
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
      // vertex_count, and templates with a MOVE step here now miss a vertex.
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

  // The catalogue first, so "no-map" means none loaded, not "not asked yet".
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
