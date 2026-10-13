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
 * One map's vertices, read-only, for a name that may not be known yet (the
 * task editor and the dashboard). Not useMapVertices: that needs a name at
 * first render, and carries writes a task screen should not have in reach.
 * The cache entry is the floor plan editor's, so its saves are current here.
 */
export function useMapVertexList(name: string | null): UseMapVertexList {
  const query = useQuery({
    queryKey: queryKeys.mapVertices(name ?? ""),
    queryFn: ({ signal }) => listVertices(name ?? "", signal),
    enabled: name !== null,
    // Sorted in `select`, per observer, so the shared entry keeps DB order and
    // the editor's append-on-create.
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

/** Module-level so `select` keeps one identity. */
function sortByName(vertices: MapVertex[]): MapVertex[] {
  return [...vertices].sort((a, b) => a.name.localeCompare(b.name));
}
