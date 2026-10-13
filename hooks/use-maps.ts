import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchMaps } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { MapSummary } from "@/lib/types/map";

export type MapsStatus = "loading" | "ok" | "error";

/**
 * Catalogue re-read interval while a floor plan conversion runs (tens of
 * seconds). There is no push channel for a conversion finishing, and a poll
 * also survives a reload where a one-shot event would not.
 */
const CONVERTING_POLL_MS = 2000;

/**
 * The poll policy for every observer of the maps query; it switches itself off
 * with the last running conversion. Shared so the poll cannot depend on which
 * of the two hooks below happens to be mounted.
 */
function pollWhileConverting(
  maps: MapSummary[] | undefined,
): number | false {
  return maps?.some((map) => map.grid_status === "converting")
    ? CONVERTING_POLL_MS
    : false;
}

export interface UseMaps {
  /** Latest successfully fetched catalogue, or null before the first success. */
  maps: MapSummary[] | null;
  /** A transient error keeps the last good `maps`, as in useRobotState. */
  status: MapsStatus;
  refresh: () => void;
}

/**
 * The map catalogue, through the shared query cache.
 *
 * Polled only while a conversion runs — the one server-side process that
 * changes the catalogue on its own. Otherwise it changes only on a deliberate
 * save or convert, and a fresh mount refetches (staleTime 0).
 */
export function useMaps(): UseMaps {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.maps,
    queryFn: ({ signal }) => fetchMaps(signal),
    refetchInterval: (query) => pollWhileConverting(query.state.data),
  });

  // Invalidate rather than refetch(): the entry is shared by every observer.
  const refresh = React.useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.maps }),
    [queryClient],
  );

  return {
    maps: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
    refresh,
  };
}

/**
 * One map's catalogue entry, or null (no name, no answer yet, not listed).
 * The per-map file caches read their version from it; as another observer of
 * the same query it inherits the converting poll.
 */
export function useMapEntry(name: string | null): MapSummary | null {
  const { maps } = useMaps();
  return React.useMemo(
    () => (name === null ? null : (maps?.find((map) => map.name === name) ?? null)),
    [maps, name],
  );
}

/**
 * The map the running stack loaded, or null until the catalogue answers. The
 * server-derived `active` flag is the only source; never parse
 * `RobotState.map`'s path.
 *
 * A live switch drops no socket, so nothing refetches on its own: a switch
 * made here invalidates the key, and the status strip calls `refresh()` when
 * the robot's 1 Hz report of its map changes (a switch from another console).
 */
export function useActiveMap(): { map: MapSummary | null; status: MapsStatus } {
  const { maps, status } = useMaps();
  const map = React.useMemo(
    () => maps?.find((entry) => entry.active) ?? null,
    [maps],
  );
  return { map, status };
}

/**
 * Watch the floor plan conversion of a map this screen just saved.
 *
 * The same query entry as useMaps (there is no per-map endpoint), so it shares
 * the request and the conversion poll. Disabled until a name is passed, so the
 * mapping screen fetches no catalogue before a save. Null means "nothing to
 * say yet".
 */
export function useMapConversion(name: string | null): MapSummary | null {
  const { data } = useQuery({
    queryKey: queryKeys.maps,
    queryFn: ({ signal }) => fetchMaps(signal),
    refetchInterval: (query) => pollWhileConverting(query.state.data),
    enabled: name !== null,
  });

  return React.useMemo(
    () => (name === null ? null : data?.find((entry) => entry.name === name) ?? null),
    [data, name],
  );
}
