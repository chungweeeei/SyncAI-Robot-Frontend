import { useQuery } from "@tanstack/react-query";

import { useMapEntry } from "@/hooks/use-maps";
import { fetchMapOctomap } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { OccupiedVoxels } from "@/lib/types/octree";

export type MapOctomapStatus = "idle" | "loading" | "ok" | "error";

export interface UseMapOctomap {
  /** The decoded tree, or null until it has arrived. */
  voxels: OccupiedVoxels | null;
  status: MapOctomapStatus;
  /** The backend's sentence when the read was refused, verbatim; else the decoder's. */
  error: string | null;
}

/**
 * One stored map's 3D map, for the dashboard's "3D map" layer and the ground
 * editor. Pass null to leave it unfetched — the layer off, a map whose tree
 * is not `ok` — so a map nobody asks to see in 3D costs no download and no
 * decode.
 *
 * `useMapPointCloud`'s cache policy, with `useMapImage`'s key: `staleTime:
 * Infinity` because the bytes never change under one version, and the
 * catalogue's `octomap_version` in the key so a tree replaced on the robot
 * retires the entry. Nothing is fetched until the catalogue says `ok`: the
 * backend answers 404 or 409 with the reason otherwise, and the Maps screen
 * is where those states are said. An error is not cached, so turning the
 * layer off and on is the retry. The decode runs inside the query, once per
 * version, on the main thread: tens of milliseconds for a million cells on a
 * laptop (the robot's 7 M-node tree decodes in ~55 ms), so the download is
 * the wait, not the decode.
 */
export function useMapOctomap(name: string | null): UseMapOctomap {
  const entry = useMapEntry(name);
  const readable = entry !== null && entry.octomap_status === "ok";
  const version = entry?.octomap_version ?? "";

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.mapOctomap(name ?? "", version),
    queryFn: ({ signal }) => fetchMapOctomap(name ?? "", signal),
    enabled: name !== null && readable,
    staleTime: Infinity,
  });

  if (name === null || !readable) return { voxels: null, status: "idle", error: null };
  if (error) return { voxels: null, status: "error", error: error.message };
  return {
    voxels: data ?? null,
    status: isPending ? "loading" : "ok",
    error: null,
  };
}
