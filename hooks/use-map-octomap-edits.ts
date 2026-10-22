"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchMapOctomapEdits } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";

export type MapOctomapEditsStatus = "loading" | "ok" | "error";

export interface UseMapOctomapEdits {
  /** The patches as last saved, absolute keys, or null until the read answers. */
  fillKey: number[][] | null;
  status: MapOctomapEditsStatus;
  /** The backend's sentence, verbatim. */
  error: string | null;
}

/**
 * One map's saved ground patches: the editor's 3D view's starting record, and
 * what the dashboard draws into the 3D map until the robot has applied them
 * (`withGroundPatches`). Not polled: nothing
 * changes them on its own. `null` (not read yet) and `[]` (none) are
 * different facts, as for the zones: a save is the whole list, so taking
 * one for the other would erase the map's patches on the first Save.
 */
export function useMapOctomapEdits(name: string | null): UseMapOctomapEdits {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.mapOctomapEdits(name ?? ""),
    queryFn: ({ signal }) => fetchMapOctomapEdits(name ?? "", signal),
    enabled: name !== null,
  });
  return {
    fillKey: data?.fill_key ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
    error: error?.message ?? null,
  };
}
