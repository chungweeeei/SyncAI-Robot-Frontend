"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { resetMappingRun, saveMap } from "@/lib/api/mapping";
import { queryKeys } from "@/lib/api/query-keys";

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
    },
  });
}

/**
 * POST /api/v1/mapping/reset — discard the run in the robot's memory.
 *
 * Nothing on disk changes, so there is no cache to invalidate: the hook exists
 * so the page that confirms the reset does not also have to own the request.
 */
export function useResetMappingRun() {
  return useMutation({
    mutationFn: () => resetMappingRun(),
  });
}
