import { useQuery } from "@tanstack/react-query";

import { useMapEntry } from "@/hooks/use-maps";
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
 * a refetch on every mount would re-decode a multi-megapixel PNG each time a
 * row is unfolded.
 *
 * What keeps that from caching a stale floor plan is the key. It carries the
 * catalogue's `modified_at` (the newest file in the map's directory) and its
 * `grid_status`, so any rewrite the catalogue can see retires the entry, by
 * whoever made it. It used to be keyed by name alone, which was only safe for
 * writes this console made: a conversion started elsewhere left the old raster
 * on screen until a reload.
 *
 * The status only separates two readable states that share a time, such as an
 * interrupted rebuild that left the old plan in place and a later one that
 * finished. It does not protect the case that looks like its reason: a
 * conversion that starts and ends within the second of the last read shows
 * "ok" on both sides, so the key is unchanged and the old bytes are kept.
 * What makes that safe in practice is that a conversion takes tens of
 * seconds, not the key.
 *
 * Nothing is fetched while the map converts. The file is being rewritten, so
 * any bytes read then are either the old plan or a partial one, and caching
 * either is what this hook used to get wrong. The preview draws its waypoints
 * without a floor plan until the conversion ends. Nothing is fetched for a map
 * with no floor plan either: there is no raster to read until one is built,
 * so the request could only earn a refusal.
 *
 * Unlike `useMapGrid`, which keeps its read out of the cache because a session
 * is mutable and has to be disposed, an ImageBitmap is immutable and safe to
 * hand to any number of readers. It is left to GC rather than `close()`d for
 * the same reason: no one owner could know it was the last reader.
 */
export function useMapImage(name: string | null): UseMapImage {
  const entry = useMapEntry(name);
  const readable = entry !== null && entry.grid !== null && entry.grid_status !== "converting";
  const version = entry ? `${entry.modified_at}/${entry.grid_status}` : "";

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.mapImage(name ?? "", version),
    queryFn: ({ signal }) => fetchMapImage(name ?? "", signal),
    enabled: name !== null && readable,
    staleTime: Infinity,
  });

  if (name === null || !readable) return { image: null, status: "loading" };
  return {
    image: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
  };
}
