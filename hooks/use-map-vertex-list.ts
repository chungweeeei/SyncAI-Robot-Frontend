"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { listVertices } from "@/lib/api/vertex";
import type { MapVertex } from "@/lib/types/map";

export type MapVertexListStatus = "loading" | "ok" | "error" | "no-map";

export interface UseMapVertexList {
  /** Sorted by name. Empty unless `status` is "ok". */
  vertices: MapVertex[];
  status: MapVertexListStatus;
}

/**
 * One map's vertices, read-only, for a name that may not be known yet.
 *
 * The task editor reads whichever map the operator is authoring for — the
 * loaded one by default, any other on request — and the dashboard reads the
 * loaded one; both go through here. Deliberately not useMapVertices, which the
 * gridmap editor uses: that hook needs a name at first render, and a name that
 * arrives with the catalogue would fire a request at /api/v1/maps//vertices and
 * turn a normal first paint into a failure banner (`enabled` below is what
 * holds that request). It also exposes create / remove, and a task screen with
 * a vertex-delete in reach is an invitation.
 *
 * The cache entry is the same one the gridmap editor writes through (see
 * lib/api/query-keys.ts), so a stop placed there is current here the moment
 * it lands. There is no `refresh` for the same reason, and because the App
 * Router unmounts these pages on navigation, so a fresh mount refetches anyway.
 */
export function useMapVertexList(name: string | null): UseMapVertexList {
  const query = useQuery({
    queryKey: queryKeys.mapVertices(name ?? ""),
    queryFn: ({ signal }) => listVertices(name ?? "", signal),
    enabled: name !== null,
    // Sorted for the picker — the list endpoint answers in DB order, and a
    // dropdown whose order changes between mounts is unusable — but sorted in
    // `select`, per observer, so the shared cache entry keeps the editor's DB
    // order and its append-on-create semantics.
    select: sortByName,
  });

  return {
    vertices: query.data ?? [],
    status:
      name === null
        ? "no-map"
        : query.isPending
          ? "loading"
          : query.isError
            ? "error"
            : "ok",
  };
}

/** Module-level so `select` keeps one identity and the sort is not re-run per render. */
function sortByName(vertices: MapVertex[]): MapVertex[] {
  return [...vertices].sort((a, b) => a.name.localeCompare(b.name));
}
