"use client";

import { useMapVertexWrites, type UseMapVertexWrites } from "@/hooks/use-map-vertex-writes";
import { useActiveMap } from "@/hooks/use-maps";
import type { MapVertexListStatus } from "@/hooks/use-map-vertex-list";

export type ActiveVerticesStatus = MapVertexListStatus;

export interface UseActiveMapVertices extends UseMapVertexWrites {
  /** The active map's directory name, or null when the robot has none loaded. */
  mapName: string | null;
}

/**
 * The active map's vertices and the dashboard's writes to them: the map-keyed
 * hook (useMapVertexWrites) pointed at whichever map the robot has loaded.
 */
export function useActiveMapVertices(): UseActiveMapVertices {
  const { map, status: mapsStatus } = useActiveMap();
  const writes = useMapVertexWrites(map?.name ?? null);

  // The catalogue first, so "no-map" means none loaded, not "not asked yet".
  const status: ActiveVerticesStatus =
    mapsStatus === "loading" ? "loading" : mapsStatus === "error" ? "error" : writes.status;

  return { ...writes, status };
}
