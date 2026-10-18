"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchMapFloors } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { MapFloor } from "@/lib/types/map";

export interface UseMapFloors {
  /** The floors to offer, lowest first; `[]` for one storey or until the read answers. */
  floors: MapFloor[];
  /** What the robot's walk says, for Use detected. */
  detected: MapFloor[];
  /** Whether `floors` is an operator's list rather than the detected one. */
  saved: boolean;
  /** True once the read has answered; an editor seeds from it only then. */
  ready: boolean;
  /** The backend's sentence, verbatim. */
  error: string | null;
}

const NONE: MapFloor[] = [];

/**
 * One map's floors. Not polled: only a save or a new mapping run changes
 * them, and both drop or write the key. A failed read leaves the map whole
 * rather than blocking anything, since the floors only choose what is shown.
 */
export function useMapFloors(name: string | null): UseMapFloors {
  const { data, isSuccess, error } = useQuery({
    queryKey: queryKeys.mapFloors(name ?? ""),
    queryFn: ({ signal }) => fetchMapFloors(name ?? "", signal),
    enabled: name !== null,
  });
  return {
    floors: data?.floors ?? NONE,
    detected: data?.detected ?? NONE,
    saved: data?.saved ?? false,
    ready: isSuccess,
    error: error?.message ?? null,
  };
}
