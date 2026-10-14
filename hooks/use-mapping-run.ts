"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchMappingStatus,
  resetMappingRun,
  saveMap,
  startMapping,
  type MappingStatus,
} from "@/lib/api/mapping";
import { queryKeys } from "@/lib/api/query-keys";

/** The same cadence as the robot-state poll it is read beside. */
const RUN_POLL_MS = 1000;

export interface UseMappingStatus {
  /** The latest answer, or null before the first one. */
  run: MappingStatus | null;
  status: "loading" | "ok" | "error";
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
    status: isPending ? "loading" : isError ? "error" : "ok",
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
 * POST /api/v1/maps — save the current run. The conversion's outcome arrives
 * through the catalogue, which is what `useMapConversion` watches.
 */
export function useSaveMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => saveMap(name),
    onSuccess: (_result, name) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // A save ends the run.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mappingStatus });
      // A save over an existing name replaces its floor plan once converted.
      // Dropped, not invalidated: the new bytes are not there yet.
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(name) });
      // Dropped: nothing on this screen reads the scan.
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(name) });
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
