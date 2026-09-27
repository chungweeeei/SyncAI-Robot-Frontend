import { useQuery } from "@tanstack/react-query";

import { useMapEntry } from "@/hooks/use-maps";
import { fetchMapPointCloud } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

export type MapPointCloudStatus = "idle" | "loading" | "ok" | "error";

export interface UseMapPointCloud {
  /** The decoded scan, or null while idle, loading or failed. */
  cloud: PointCloudFrame | null;
  status: MapPointCloudStatus;
  /** The backend's own sentence when the read was refused, verbatim. */
  error: string | null;
}

/**
 * One stored map's scan, for the dashboard's "Map scan" layer. Pass null to
 * leave it unfetched, which is what the layer being off means: weak clients
 * never pay for the download unless someone asks to see it.
 *
 * A query rather than a fetch in the viewport's effect, which is where it used
 * to be: a refusal there went to `console.error` and nowhere else, so the
 * operator saw the toggle lit over an empty floor with nothing saying why.
 * Here the refusal is `error`, and the view can put it beside the toggle.
 *
 * `staleTime: Infinity` because the key carries the catalogue's `modified_at`,
 * so a scan rewritten by anyone, including another console's mapping save, is
 * a new key rather than a stale entry (see `queryKeys.mapPointCloud`). It
 * waits for the catalogue to name the map before fetching, which the view
 * already does to decide whether to offer the layer at all. An error is not
 * cached as an answer: with no data the query is stale, so turning the layer
 * off and on again is the retry.
 *
 * The frame's Float32Array is handed straight to three.js as a buffer
 * attribute, which references it rather than copying. That is safe to share
 * because nothing writes to it, and it is left to GC for the same reason
 * `useMapImage` leaves its bitmap: no one reader knows it was the last.
 */
export function useMapPointCloud(name: string | null): UseMapPointCloud {
  const entry = useMapEntry(name);
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.mapPointCloud(name ?? "", entry?.modified_at ?? ""),
    queryFn: ({ signal }) => fetchMapPointCloud(name ?? "", signal),
    enabled: name !== null && entry !== null,
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
