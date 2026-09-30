// Client for the forbidden-zone half of the map router: GET and PUT
// /api/v1/maps/{name}/keepout.
//
// Its own file for the reason lib/api/vertex.ts is one: plain JSON with
// nothing in common with the gridmap's binary round trip in lib/api/map.ts.
//
// The zones travel as polygons in map-frame metres, and only that way. The
// mask the planner actually reads is rasterised from them on the robot, in the
// gridmap's exact geometry, so the two files agree cell for cell; the console
// never sends or reads the mask itself. A GET therefore answers what was last
// *saved through this API* — a mask drawn any other way reads as no zones, and
// the next save replaces it.

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { z } from "zod";

import { ZonePolygonSchema } from "@/lib/types/map";
import type { ZonePolygon } from "@/lib/types/map";

/** `KeepoutResponse`, verbatim. */
export interface MapKeepout {
  name: string;
  zones: ZonePolygon[];
  /** Whether this is the map the stack is running on. */
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
   * Whether the running planner re-read the zones. False for any map that is
   * not the active one — nothing to reload — and for an active map whose
   * reload failed, which is the case worth telling the operator about.
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
 * Replace the map's zones with `zones`, whole.
 *
 * The whole list, not a diff: the endpoint has no per-zone verbs, and an
 * empty list is how every zone is cleared. So a caller that sends before it
 * has read the map's zones erases them — which is why the editor will not
 * let a zone be drawn until the read has answered.
 *
 * No `AbortSignal`, saveMapGrid's reason: the robot writes three files and
 * reloads the planner, and leaving the page must not tear that.
 */
export function saveKeepout(name: string, zones: readonly ZonePolygon[]): Promise<SaveKeepoutResult> {
  return requestJson<SaveKeepoutResult>(keepoutPath(name), {
    method: "PUT",
    // Only the two fields the backend models; an editor-side field added to
    // ZonePolygon later must not ride along into a 422.
    body: JSON.stringify({
      zones: zones.map(({ id, points }) => ({ id, points: points.map(({ x, y }) => ({ x, y })) })),
    }),
    schema: SaveKeepoutResultSchema,
  });
}
