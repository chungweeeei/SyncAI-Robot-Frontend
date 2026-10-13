import { useQuery } from "@tanstack/react-query";

import { fetchMapPointCloud } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

export type MapPointCloudStatus = "idle" | "loading" | "ok" | "error";

export interface UseMapPointCloud {
  cloud: PointCloudFrame | null;
  status: MapPointCloudStatus;
  /** The backend's sentence when the read was refused, verbatim. */
  error: string | null;
}

/**
 * One stored map's scan, for the dashboard's "Map scan" layer. Null leaves it
 * unfetched (the layer is off), so nobody pays for the download unasked.
 *
 * `staleTime: Infinity`: a scan does not change in place and the writes that
 * retire it drop the entry (see `queryKeys.mapPointCloud`). An error is not
 * cached, so toggling the layer is the retry. The Float32Array goes to
 * three.js uncopied — safe because nothing writes it — and is left to GC.
 */
export function useMapPointCloud(name: string | null): UseMapPointCloud {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.mapPointCloud(name ?? ""),
    queryFn: ({ signal }) => fetchMapPointCloud(name ?? "", signal),
    enabled: name !== null,
    staleTime: Infinity,
  });

  if (name === null) return { cloud: null, status: "idle", error: null };
  if (error) return { cloud: null, status: "error", error: error.message };
  return {
    cloud: data ?? null,
    status: isPending ? "loading" : "ok",
    error: null,
  };
}
