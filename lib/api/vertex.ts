// Client for the vertex half of the map router
// (src/syncai_backend/syncai_backend/interfaces/rest/routers/map.py).
//
// Separate from lib/api/map.ts even though both address /api/v1/maps/{name}/,
// because the two halves have nothing in common at the wire level: that file is
// entirely about the read/write asymmetry of the gridmap — a PNG in, raw cell
// bytes out, with a hand-rolled decode that must not be colour-managed — while
// this is plain JSON CRUD. Merging them would leave one file whose header has to
// explain both, and the binary rationale is the one that gets skimmed.
//
// The owning map is always in the URL and never in a body. The backend's request
// models deliberately have no `map_name` field, so a request cannot name a
// different map than the path it was posted to; this client keeps that property
// by taking `name` as its own first argument.

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { normalizeTheta } from "@/lib/angle";
import { z } from "zod";

import { MapVertexSchema } from "@/lib/types/map";
import type { MapVertex, VertexType } from "@/lib/types/map";

/** What the operator supplies; `id` and `map_name` come from the server/URL. */
export interface VertexDraft {
  name: string;
  type: VertexType;
  x: number;
  y: number;
  /** Degrees. Normalised to (-180, 180] on the way out. */
  theta: number;
}

/** Fields to change. Omitted ones are left alone by the backend's `exclude_unset`. */
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
 * Create several vertices in one request — the endpoint's own shape.
 *
 * The floor plan editor stages every waypoint placed before a Save and sends
 * them here together. The answer is read in the order sent: the editor swaps
 * each staged row's local id for the echo at the same index.
 */
export async function createVertices(
  name: string,
  drafts: readonly VertexDraft[],
): Promise<MapVertex[]> {
  // The echo is checked like any other read: it is the row as stored, and both
  // the editor and the dashboard splice it straight into their cache.
  const created = await requestJson<MapVertex[]>(vertexPath(name), {
    method: "POST",
    body: JSON.stringify(
      drafts.map((draft) => ({ ...draft, theta: normalizeTheta(draft.theta) })),
    ),
    schema: z.array(MapVertexSchema),
  });

  // As many out as went in. A response that does not hold that is the backend
  // having changed shape, and failing here beats pairing an echo with the
  // wrong staged row — or returning `undefined` typed as a MapVertex.
  if (created.length !== drafts.length) {
    throw new Error(
      "The robot saved the waypoints but did not send them all back. Reload the page to see them.",
    );
  }
  return created;
}

/**
 * Create one vertex: the dashboard places one per gesture and writes it at
 * once, so it is spared writing `[draft]` and `result[0]`.
 */
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

/**
 * Delete a vertex. The `{message}` envelope is dropped: it says nothing the
 * caller does not already know from the request having succeeded.
 */
export function deleteVertex(name: string, id: string): Promise<void> {
  return requestJson<void>(vertexPath(name, id), {
    method: "DELETE",
    parse: false,
  });
}
