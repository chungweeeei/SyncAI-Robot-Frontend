import { useQuery } from "@tanstack/react-query";

import { fetchMapImage } from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";

export type MapImageStatus = "loading" | "ok" | "error";

export interface UseMapImage {
  /** The decoded floor plan, or null while loading, on failure and with no name. */
  image: ImageBitmap | null;
  status: MapImageStatus;
}

/**
 * One map's floor plan raster, for drawing under the waypoint preview.
 *
 * A query rather than an `Image()` in the component: the same bytes are wanted
 * by every expanded MOVE row at once, and the cache is what makes that one
 * request and one decode instead of one per row. `staleTime: Infinity` because
 * the raster changes only through writes this console makes, and those hooks
 * invalidate or drop the entry themselves (see `queryKeys.mapImage`) — a
 * refetch on every mount would re-decode a multi-megapixel PNG each time a row
 * is unfolded, for an answer that cannot have changed.
 *
 * Unlike `useMapGrid`, which keeps its read out of the cache because a session
 * is mutable and has to be disposed, an ImageBitmap is immutable and safe to
 * hand to any number of readers. It is left to GC rather than `close()`d for
 * the same reason: no one owner could know it was the last reader.
 */
export function useMapImage(name: string | null): UseMapImage {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.mapImage(name ?? ""),
    queryFn: ({ signal }) => fetchMapImage(name ?? "", signal),
    enabled: name !== null,
    staleTime: Infinity,
  });

  if (name === null) return { image: null, status: "loading" };
  return {
    image: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
  };
}
