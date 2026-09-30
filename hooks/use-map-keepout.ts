"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchKeepout } from "@/lib/api/keepout";
import { queryKeys } from "@/lib/api/query-keys";
import type { ZonePolygon } from "@/lib/types/map";

export type MapKeepoutStatus = "loading" | "ok" | "error";

export interface UseMapKeepout {
  /** The zones as last saved, or null until (and unless) the read answers. */
  zones: ZonePolygon[] | null;
  status: MapKeepoutStatus;
  /** The backend's sentence when the read failed; render it verbatim. */
  error: string | null;
}

/**
 * One map's forbidden zones: what the floor plan editor starts from, and
 * what the dashboard draws on the floor. Null reads nothing — the dashboard
 * before the robot has a map.
 *
 * Not polled: nothing on the robot changes the zones on its own, and both
 * readers read them once per mount (see queryKeys.mapKeepout). The editor's
 * save writes its answer into the same entry, so a dashboard mounted after it
 * draws the new zones; one already open when another console saves does not
 * see them until it is opened again.
 * `null` before the answer and `[]` in it are different facts, and the
 * difference is load-bearing: a save is the whole list, so an editor that
 * took "not read yet" for "none" would erase the map's zones on its first
 * Save. The status is what keeps them apart.
 */
export function useMapKeepout(name: string | null): UseMapKeepout {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.mapKeepout(name ?? ""),
    queryFn: ({ signal }) => fetchKeepout(name ?? "", signal),
    enabled: name !== null,
  });
  return {
    zones: data?.zones ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
    error: error?.message ?? null,
  };
}
