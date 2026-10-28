// Forbidden zones: GET and PUT /api/v1/maps/{name}/keepout.
//
// Zones travel only as polygons in map-frame metres (keepout.json beside the
// map's octomap.bt), which the robot's 3D planner reads. A map with no 3D map
// has nowhere to put them: the PUT answers 404.

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { z } from "zod";

import { ZonePolygonSchema } from "@/lib/types/map";
import type { ZonePolygon } from "@/lib/types/map";

/** `KeepoutResponse`, verbatim. */
export interface MapKeepout {
  name: string;
  zones: ZonePolygon[];
  /** Whether this is the map the robot is running on. */
  active: boolean;
}

const MapKeepoutSchema: z.ZodType<MapKeepout> = z.object({
  name: z.string(),
  zones: z.array(ZonePolygonSchema),
  active: z.boolean(),
});

/** `SaveKeepoutResponse`, verbatim. */
export interface SaveKeepoutResult {
  name: string;
  /** The zones as stored. Ids are the ones sent, since every zone carries one. */
  zones: ZonePolygon[];
  active: boolean;
  /**
   * Whether the running 3D planner re-read the zones. False for an inactive
   * map, and for an active one whose reload failed (worth telling the
   * operator).
   */
  reloaded: boolean;
  /** Operator-facing sentence; render it verbatim. */
  message: string;
}

const SaveKeepoutResultSchema: z.ZodType<SaveKeepoutResult> = z.object({
  name: z.string(),
  zones: z.array(ZonePolygonSchema),
  active: z.boolean(),
  reloaded: z.boolean(),
  message: z.string(),
});

function keepoutPath(name: string): string {
  return apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/keepout`);
}

export function fetchKeepout(name: string, signal?: AbortSignal): Promise<MapKeepout> {
  return requestJson<MapKeepout>(keepoutPath(name), { signal, schema: MapKeepoutSchema });
}

/**
 * Replace the map's zones, whole (an empty list clears them). A caller that
 * sends before reading erases them, which is why the editor waits for the read.
 *
 * No `AbortSignal`: leaving the page must not tear the robot's write and
 * planner reload.
 */
export function saveKeepout(name: string, zones: readonly ZonePolygon[]): Promise<SaveKeepoutResult> {
  return requestJson<SaveKeepoutResult>(keepoutPath(name), {
    method: "PUT",
    // Only the fields the backend models, so an editor-side field cannot 422.
    // The name and the floor band go back as they came: dropping them would
    // widen a 3D map's zone to every storey (see ZonePolygon).
    body: JSON.stringify({
      zones: zones.map(({ id, points, name, z_min, z_max }) => ({
        id,
        points: points.map(({ x, y }) => ({ x, y })),
        name: name ?? null,
        z_min: z_min ?? null,
        z_max: z_max ?? null,
      })),
    }),
    schema: SaveKeepoutResultSchema,
  });
}
