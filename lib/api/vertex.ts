// Waypoints: /api/v1/maps/{name}/vertices. Plain JSON CRUD, kept apart from
// lib/api/map.ts's binary floor plan round trip.
//
// The map is always in the URL, never in a body: the backend's models have no
// `map_name`, so a request cannot name a different map than its path.

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { normalizeTheta } from "@/lib/angle";
import { z } from "zod";

import { MapVertexSchema } from "@/lib/types/map";
import type { MapVertex, VertexType } from "@/lib/types/map";

/** What the operator supplies; `id` and `map_name` come from the server. */
export interface VertexDraft {
  name: string;
  type: VertexType;
  x: number;
  y: number;
  /** Degrees. Normalised to (-180, 180] on the way out. */
  theta: number;
  /** Ground height of its floor; omitted, the backend puts it at 0. */
  z?: number;
}

/** Omitted fields are left alone (`exclude_unset`). */
export type VertexChanges = Partial<VertexDraft>;

function vertexPath(name: string, id?: string): string {
  const base = `/api/v1/maps/${encodeURIComponent(name)}/vertices`;
  return apiUrl(id ? `${base}/${encodeURIComponent(id)}` : base);
}

export function listVertices(
  name: string,
  signal?: AbortSignal,
): Promise<MapVertex[]> {
  return requestJson<MapVertex[]>(vertexPath(name), {
    signal,
    schema: z.array(MapVertexSchema),
  });
}

/**
 * Create several vertices in one request. The echo is in the order sent: the
 * editor swaps each staged row's local id for the echo at the same index.
 */
export async function createVertices(
  name: string,
  drafts: readonly VertexDraft[],
): Promise<MapVertex[]> {
  const created = await requestJson<MapVertex[]>(vertexPath(name), {
    method: "POST",
    body: JSON.stringify(
      drafts.map((draft) => ({ ...draft, theta: normalizeTheta(draft.theta) })),
    ),
    schema: z.array(MapVertexSchema),
  });

  // As many out as went in, or an echo would pair with the wrong staged row.
  if (created.length !== drafts.length) {
    throw new Error(
      "The robot saved the waypoints but did not send them all back. Reload the page to see them.",
    );
  }
  return created;
}

export async function createVertex(
  name: string,
  draft: VertexDraft,
): Promise<MapVertex> {
  const [vertex] = await createVertices(name, [draft]);
  return vertex;
}

export function updateVertex(
  name: string,
  id: string,
  changes: VertexChanges,
): Promise<MapVertex> {
  return requestJson<MapVertex>(vertexPath(name, id), {
    method: "PUT",
    body: JSON.stringify(
      changes.theta === undefined
        ? changes
        : { ...changes, theta: normalizeTheta(changes.theta) },
    ),
    schema: MapVertexSchema,
  });
}

export function deleteVertex(name: string, id: string): Promise<void> {
  return requestJson<void>(vertexPath(name, id), {
    method: "DELETE",
    parse: false,
  });
}
