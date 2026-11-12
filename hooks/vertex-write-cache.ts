import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import type { MapVertex } from "@/lib/types/map";

/** The stored rows a vertex write left behind, as the backend echoed them. */
export interface VertexWrites {
  deleted?: readonly string[];
  updated?: readonly MapVertex[];
  created?: readonly MapVertex[];
}

/**
 * The cache consequences of writing a map's vertices, for both doors: the
 * dashboard, which writes one at a time, and the editor's staged Save.
 *
 * The responses are the stored rows, so `mapVertices(map)` is spliced rather
 * than refetched — the entry both screens read. The catalogue is invalidated
 * for its `vertex_count` and the map's modified time, and the templates
 * because a MOVE step on a vertex resolves to its pose, or to MISSING once
 * it is gone.
 */
export function applyVertexWrites(
  queryClient: QueryClient,
  map: string,
  { deleted = [], updated = [], created = [] }: VertexWrites,
): void {
  if (deleted.length + updated.length + created.length === 0) return;
  const gone = new Set(deleted);
  const moved = new Map(updated.map((vertex) => [vertex.id, vertex]));
  queryClient.setQueryData<MapVertex[]>(
    queryKeys.mapVertices(map),
    (current) =>
      current && [
        ...current
          .filter((vertex) => !gone.has(vertex.id))
          .map((vertex) => moved.get(vertex.id) ?? vertex),
        ...created,
      ],
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
  void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
}
