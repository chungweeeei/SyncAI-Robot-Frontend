"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useMapVertexList, type MapVertexListStatus } from "@/hooks/use-map-vertex-list";
import { useActiveMap } from "@/hooks/use-maps";
import { queryKeys } from "@/lib/api/query-keys";
import { updateVertex } from "@/lib/api/vertex";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

export type ActiveVerticesStatus = MapVertexListStatus;

export interface UseActiveMapVertices {
  /** The active map's directory name, or null when the robot has none loaded. */
  mapName: string | null;
  /** Sorted by name. Empty unless `status` is "ok". */
  vertices: MapVertex[];
  status: ActiveVerticesStatus;
  /** True while a re-place write is in flight. */
  busy: boolean;
  /** The last re-place failure, or null. Rendered verbatim. */
  writeError: string | null;
  /**
   * Move one vertex to a new pose. True when the row is stored.
   *
   * Position only — name and type are not writable here (see the note on this
   * hook about why the rest of the CRUD surface stays out of it).
   */
  moveVertex: (id: string, pose: PlanarPose) => Promise<boolean>;
  clearWriteError: () => void;
}

/**
 * The active map's vertices: the markers the dashboard draws on the floor, and
 * — through `moveVertex` — the one field it may write.
 *
 * The list itself is useMapVertexList, keyed by the loaded map's name; this
 * hook adds where that name comes from and the one write. (The task editor
 * used to read through here too, and now reads useMapVertexList directly with
 * whichever map it is authoring for.)
 *
 * Position is the exception, and only because the dashboard is where the mistake
 * is *visible*: a stop drawn half a metre inside a wall is obvious with the live
 * cloud drawn over it and invisible on the editor's flat raster, so requiring a
 * trip to another screen to nudge it would mean fixing it from the one view that
 * cannot see the problem. Name and type are not part of that argument and stay
 * where the rest of the CRUD lives.
 *
 * `writeError` is separate from `status` rather than shared the way
 * useMapVertices shares its `error`: here the two really can be live at once —
 * the list loads fine and a re-place fails — and a failed write must not make
 * the layer read as unloaded.
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

  const { mutateAsync: moveAsync, reset: resetMove } = move;

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

  const clearWriteError = React.useCallback(() => resetMove(), [resetMove]);

  // The catalogue's own state first: until it answers there is no name, and
  // "no-map" must mean the robot has none loaded, not that we have not asked.
  const status: ActiveVerticesStatus =
    mapsStatus === "loading" ? "loading" : mapsStatus === "error" ? "error" : list.status;

  return {
    mapName: name,
    vertices: list.vertices,
    status,
    busy: move.isPending,
    writeError: move.error?.message ?? null,
    moveVertex,
    clearWriteError,
  };
}
