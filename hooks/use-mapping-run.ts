"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchMappingStatus,
  resetMappingRun,
  saveMap,
  startMapping,
  type MappingStatus,
} from "@/lib/api/mapping";
import { mapScopedKeys, queryKeys } from "@/lib/api/query-keys";
import { readStatus } from "@/lib/api/read-state";
import type { ReadStatus } from "@/lib/types/read";

/** The same cadence as the robot-state poll it is read beside. */
const RUN_POLL_MS = 1000;

export interface UseMappingStatus {
  /** The latest answer, or null before the first one. */
  run: MappingStatus | null;
  status: ReadStatus;
}

/**
 * GET /api/v1/mapping — where the run stands. `enabled` is "the robot reports
 * Mapping and this screen is open", the only time the answer is not `unknown`
 * or changes on its own. Off means not fetched at all, so a mode switch's
 * outage logs no failed reads.
 */
export function useMappingStatus(enabled: boolean): UseMappingStatus {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.mappingStatus,
    queryFn: ({ signal }) => fetchMappingStatus(signal),
    enabled,
    refetchInterval: enabled ? RUN_POLL_MS : false,
  });

  return {
    run: data ?? null,
    status: readStatus({ isPending, isError }),
  };
}

/**
 * POST /api/v1/mapping/start. The response is a receipt, so the status is
 * invalidated, not written: it travels a latched channel every console reads.
 */
export function useStartMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => startMapping(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mappingStatus });
    },
  });
}

/**
 * POST /api/v1/maps — save the current run. The 3D map's build arrives
 * through the catalogue, which is what `useMapBuild` watches.
 */
export function useSaveMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name }: { name: string }) => saveMap(name),
    onSuccess: (_result, { name }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // A save ends the run.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mappingStatus });
      // A save into a name replaces the map under it: the scan, the tree
      // (deleted first, rebuilt minutes later), the ground patches painted
      // on the old tree and the floors detected from the old walk. Every
      // entry of that name is dropped rather than a list kept here by hand,
      // which is how one went missing; nothing on this screen reads any of
      // them, and what the backend kept (the waypoints) is read again.
      for (const queryKey of mapScopedKeys(name)) queryClient.removeQueries({ queryKey });
    },
  });
}

/**
 * POST /api/v1/mapping/reset — discard the run in the robot's memory. Nothing
 * on disk changes, so only the run status is invalidated.
 */
export function useResetMappingRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetMappingRun(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mappingStatus });
    },
  });
}
