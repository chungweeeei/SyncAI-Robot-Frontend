"use client";

import { useQuery } from "@tanstack/react-query";

import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapEntry } from "@/hooks/use-maps";
import { queryKeys } from "@/lib/api/query-keys";
import { renderVoxelSnapshot } from "@/lib/scene/voxel-snapshot";

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
 * The tree is `useMapOctomap`'s entry, so the dashboard opened afterwards
 * finds it decoded. The still waits for the floors (a failed read counts as
 * none, which keeps the whole tree) because they are where each storey's
 * ceiling is cut, and is cached per tree version and floor levels with
 * `staleTime: Infinity`, as the tree is: neither changes under one key.
 */
export function useMapOctomapPreview(name: string | null): UseMapOctomapPreview {
  const entry = useMapEntry(name);
  const octomap = useMapOctomap(name);
  const { floors, ready, error: floorsError } = useMapFloors(
    name !== null && entry?.octomap_status === "ok" ? name : null,
  );
  const floorsKnown = ready || floorsError !== null;
  const levels = floors.map((floor) => floor.level).join(",");
  const voxels = octomap.voxels;

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.mapOctomapPreview(name ?? "", entry?.octomap_version ?? "", levels),
    queryFn: () => (voxels ? renderVoxelSnapshot(voxels, floors) : null),
    enabled: name !== null && voxels !== null && floorsKnown,
    staleTime: Infinity,
  });

  if (name === null || octomap.status === "idle") return { url: null, status: "idle" };
  if (octomap.status === "error" || isError) return { url: null, status: "error" };
  if (octomap.status === "loading" || !floorsKnown || isPending) {
    return { url: null, status: "loading" };
  }
  return data ? { url: data, status: "ok" } : { url: null, status: "error" };
}
