"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchKeepout } from "@/lib/api/keepout";
import { queryKeys } from "@/lib/api/query-keys";
import { readStatus } from "@/lib/api/read-state";
import type { ZonePolygon } from "@/lib/types/map";
import type { ReadStatus } from "@/lib/types/read";

export type MapKeepoutStatus = ReadStatus;

export interface UseMapKeepout {
  /** The zones as last saved, or null until the read answers. */
  zones: ZonePolygon[] | null;
  status: MapKeepoutStatus;
  /** The backend's sentence, verbatim. */
  error: string | null;
}

/**
 * One map's forbidden zones, for the map editor and the dashboard. Not
 * polled: nothing changes them on its own (see queryKeys.mapKeepout).
 *
 * `null` (not read yet) and `[]` (none) are different facts, and load-bearing:
 * a save is the whole list, so taking one for the other would erase the map's
 * zones on the first Save.
 */
export function useMapKeepout(name: string | null): UseMapKeepout {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.mapKeepout(name ?? ""),
    queryFn: ({ signal }) => fetchKeepout(name ?? "", signal),
    enabled: name !== null,
  });
  return {
    zones: data?.zones ?? null,
    status: readStatus({ isPending, isError }),
    error: error?.message ?? null,
  };
}
