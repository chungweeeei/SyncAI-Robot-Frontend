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

/** The run-status poll's tick: the same cadence as the robot-state poll it is read beside. */
const RUN_POLL_MS = 1000;

export interface UseMappingStatus {
  /** The latest answer, or null before the first one. */
  run: MappingStatus | null;
  status: "loading" | "ok" | "error";
}

/**
 * GET /api/v1/mapping — where the run stands, polled while it can move.
 *
 * `enabled` is "the robot reports Mapping and this screen is open": that is
 * the only time the answer is anything but `unknown`, and the only time it
 * changes on its own (keyframes bank as the robot drives). Off, the query is
 * not fetched at all rather than fetched once and parked, so a navigating
 * robot costs nothing and a mode switch's outage logs no failed reads.
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
 * POST /api/v1/mapping/start — begin the run.
 *
 * The response is a receipt, not the status, so the status is invalidated
 * rather than written: the next poll answers `mapping` from the same latched
 * topic every other console reads, and the rail switches on that.
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
 * POST /api/v1/maps — save the run the current mapping session has built.
 *
 * The response says whether the pcd → gridmap conversion was started; the
 * conversion's *outcome* arrives through the catalogue, so invalidating it is
 * what gets `useMapConversion` its first reading and what makes the new map
 * appear on the Maps screen without a manual refresh.
 */
export function useSaveMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => saveMap(name),
    onSuccess: (_result, name) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // A save ends the run: pgo goes idle, and the rail's Start control is
      // what should light up next, not Save again.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mappingStatus });
      // A save under a name that already exists replaces that map's floor
      // plan once its conversion lands; a raster decoded from the old one must
      // not outlive the file. Dropped, not invalidated, for the same reason as
      // the convert hook: the new bytes are not there yet.
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(name) });
      // The same save writes that map's scan. Dropped rather than invalidated:
      // nothing on the mapping screen shows it, so there is no reader to
      // refetch into, and the dashboard's next toggle reads the new file.
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(name) });
    },
  });
}

/**
 * POST /api/v1/mapping/reset — discard the run in the robot's memory.
 *
 * Nothing on disk changes, so there is no catalogue cache to invalidate; the
 * run status is, because its keyframe count drops to zero and the readout
 * should say so without waiting a tick.
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
