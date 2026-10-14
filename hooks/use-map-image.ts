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
 * A query so every expanded MOVE row shares one request and one decode;
 * `staleTime: Infinity` so unfolding a row does not re-decode the PNG.
 *
 * The key carries the catalogue's `modified_at` and `grid_status`, so a
 * rewrite by any console retires the entry. The status only separates two
 * readable states sharing a time; a conversion inside one second of the last
 * read would keep the old bytes, which is safe only because conversions take
 * tens of seconds.
 *
 * Nothing is fetched while the map converts (the bytes would be old or
 * partial) or before it has a floor plan. An ImageBitmap is immutable, so
 * unlike `useMapGrid` it can be shared, and is left to GC since no one owner
 * knows it is the last reader.
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
