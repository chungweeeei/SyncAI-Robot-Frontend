import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchMapOctomapLayer } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { VoxelLayerFrames } from "@/lib/types/pointcloud";

export type MapOctomapStatus = "idle" | "loading" | "ok" | "error";

export interface UseMapOctomap {
  /** Both decoded layers, or null until both have arrived. */
  layers: VoxelLayerFrames | null;
  status: MapOctomapStatus;
  /** The backend's own sentence when either read was refused, verbatim. */
  error: string | null;
}

/**
 * One stored map's 3D map, for the dashboard's "3D map" layer. Pass null to
 * leave it unfetched — the layer off, or a map whose build is not `ok` — so a
 * map nobody asks to see in 3D costs no download.
 *
 * Two queries, one per layer, read as one: the dashboard offers a single
 * toggle (the operator asks for "the 3D map", not for a file), but keeping
 * the entries separate leaves a second toggle a one-line change if the walls
 * and the floor are ever wanted apart. `useMapPointCloud`'s cache policy
 * applies to both: `staleTime: Infinity`, an error is not cached, and turning
 * the layer off and on is the retry.
 */
export function useMapOctomap(name: string | null): UseMapOctomap {
  const road = useQuery({
    queryKey: queryKeys.mapOctomap(name ?? "", "road"),
    queryFn: ({ signal }) => fetchMapOctomapLayer(name ?? "", "road", signal),
    enabled: name !== null,
    staleTime: Infinity,
  });
  const occupied = useQuery({
    queryKey: queryKeys.mapOctomap(name ?? "", "occupied"),
    queryFn: ({ signal }) => fetchMapOctomapLayer(name ?? "", "occupied", signal),
    enabled: name !== null,
    staleTime: Infinity,
  });

  // Memoised on the two frames: the viewport rebuilds the layer whenever this
  // object changes identity, and a fresh literal every render would rebuild
  // it on every telemetry-driven re-render of the dashboard.
  const layers = React.useMemo(
    () =>
      road.data && occupied.data ? { road: road.data, occupied: occupied.data } : null,
    [road.data, occupied.data],
  );

  if (name === null) return { layers: null, status: "idle", error: null };
  const error = road.error ?? occupied.error;
  if (error) return { layers: null, status: "error", error: error.message };
  return {
    layers,
    status: road.isPending || occupied.isPending ? "loading" : "ok",
    error: null,
  };
}
