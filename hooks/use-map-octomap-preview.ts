"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapEntry } from "@/hooks/use-maps";
import { queryKeys } from "@/lib/api/query-keys";

const PREVIEW_GC_MS = 60 * 60 * 1000;

export type MapOctomapPreviewStatus = "idle" | "loading" | "ok" | "error";

export interface UseMapOctomapPreview {
  /** The still as a data URL, or null until drawn (and for a tree with nothing to draw). */
  url: string | null;
  status: MapOctomapPreviewStatus;
}

/**
 * The Maps card's still of one map's 3D map. Pass null to leave it alone —
 * a card still off screen, a map whose tree is not `ok` — so a list of maps
 * downloads only the trees an operator scrolls to.
 *
 * The tree is `useMapOctomap`'s entry, observed only until the still is
 * drawn. The still waits for the floors (a failed read counts as
 * none, which keeps the whole tree) because they are where each storey's
 * ceiling is cut, and is cached per tree version and floor levels with
 * `staleTime: Infinity`, as the tree is: neither changes under one key.
 */
export function useMapOctomapPreview(name: string | null): UseMapOctomapPreview {
  const entry = useMapEntry(name);
  const version = entry?.octomap_version ?? "";
  const { floors, ready, error: floorsError } = useMapFloors(
    name !== null && entry?.octomap_status === "ok" ? name : null,
  );
  const floorsKnown = ready || floorsError !== null;
  const levels = floors.map((floor) => floor.level).join(",");
  const queryKey = queryKeys.mapOctomapPreview(name ?? "", version, levels);

  // A card that has its still lets go of the tree: observing it for the
  // length of the screen held every scrolled-past map's decoded cells
  // (megabytes each) for nothing. Read off the cache, not this hook's own
  // query, so the tree is not asked for and then dropped on the render after
  // a still that was already there.
  const queryClient = useQueryClient();
  const drawn = queryClient.getQueryState(queryKey)?.data !== undefined;
  const octomap = useMapOctomap(drawn ? null : name);
  const voxels = octomap.voxels;

  const { data, isPending, isError } = useQuery({
    queryKey,
    // The renderer is imported here, not at the top: it is the only thing on
    // the Maps screen that needs the 3D library, and only once a card with a
    // 3D map nears the screen.
    queryFn: async () => {
      if (!voxels) return null;
      const { renderVoxelSnapshot } = await import("@/lib/scene/voxel-snapshot");
      return renderVoxelSnapshot(voxels, floors);
    },
    enabled: name !== null && voxels !== null && floorsKnown,
    staleTime: Infinity,
    // Long, where the default five minutes dropped every still on a walk to
    // another screen: redrawing one is a download, a decode and a GPU
    // context, and a data URL is small beside the tree it was drawn from.
    gcTime: PREVIEW_GC_MS,
  });

  if (name === null) return { url: null, status: "idle" };
  if (data) return { url: data, status: "ok" };
  if (entry === null || entry.octomap_status !== "ok") return { url: null, status: "idle" };
  if (octomap.status === "error" || isError) return { url: null, status: "error" };
  if (octomap.status === "loading" || !floorsKnown || isPending) {
    return { url: null, status: "loading" };
  }
  return { url: null, status: "error" };
}
