import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  createVertices,
  deleteVertex,
  listVertices,
  updateVertex,
} from "@/lib/api/vertex";
import type { VertexSaveLanded, VertexSavePlan } from "@/lib/map/vertex-stage";
import type { MapVertex } from "@/lib/types/map";

export type MapVerticesStatus = "loading" | "ok" | "error";

/** What one Save did: everything that landed, and why it stopped, if it did. */
export interface VertexSaveOutcome {
  landed: VertexSaveLanded;
  /** The backend's sentence for the write that failed, or null. Verbatim. */
  failure: string | null;
}

export interface UseMapVertices {
  /** The rows as the robot holds them — the editor's `saved`, not its screen. */
  vertices: MapVertex[];
  status: MapVerticesStatus;
  /** Why the list could not be read. Rendered verbatim. */
  error: string | null;
  /**
   * Send a staged plan. Never rejects: a save that stops halfway is an
   * ordinary outcome here, and the editor needs what landed either way.
   */
  save: (plan: VertexSavePlan) => Promise<VertexSaveOutcome>;
}

/**
 * One map's vertices, for the floor plan editor, which stages every change and
 * writes them on Save — the same Save, and the same reason, as the forbidden
 * zones beside them: a run of stops is laid out as one piece of work, and an
 * operator who places five, renames two and drops one wants that to reach the
 * robot as one decision rather than eight. The dashboard's own create still
 * writes at once (useActiveMapVertices); it has no Save to wait for.
 *
 * The backend has a batch create but per-id PUT and DELETE, so a Save is up to
 * three kinds of request, sent in series: deletes, then updates, then one
 * create. Deletes first so a name freed by one is free for the rename or the
 * new stop that wants it. In series, and stopping at the first refusal, so the
 * outcome is a clean prefix — what landed and what did not — which the editor
 * folds into its two lists (rebaseVertices) to leave the rest lit for a retry.
 * That partial-failure state is the cost of staging, and it is why `save`
 * resolves with what landed rather than rejecting: a rejection would lose it.
 *
 * The list lives in the query cache under the map's name, shared with
 * useActiveMapVertices, so a save is current on the dashboard at once — see
 * lib/api/query-keys.ts. The hook-level `onSuccess` writes whatever landed
 * into that entry (the responses *are* the stored rows, so a GET would cost a
 * round trip to learn nothing) and marks the two other keys a vertex change
 * touches: the catalogue's `vertex_count`, and the task templates whose MOVE
 * steps resolve against these poses.
 */
export function useMapVertices(name: string): UseMapVertices {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.mapVertices(name),
    queryFn: ({ signal }) => listVertices(name, signal),
  });

  const saveMutation = useMutation({
    mutationFn: async (plan: VertexSavePlan): Promise<VertexSaveOutcome> => {
      const landed: VertexSaveLanded = { deleted: [], updated: [], created: [] };
      try {
        for (const id of plan.deletes) {
          await deleteVertex(name, id);
          landed.deleted.push(id);
        }
        for (const { id, changes } of plan.updates) {
          landed.updated.push(await updateVertex(name, id, changes));
        }
        if (plan.creates.length) {
          const echoes = await createVertices(
            name,
            plan.creates.map(({ draft }) => draft),
          );
          plan.creates.forEach(({ localId }, index) => {
            landed.created.push({ localId, vertex: echoes[index] });
          });
        }
        return { landed, failure: null };
      } catch (cause) {
        return {
          landed,
          failure: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    onSuccess: ({ landed }) => {
      const wrote =
        landed.deleted.length + landed.updated.length + landed.created.length;
      if (!wrote) return;
      const deleted = new Set(landed.deleted);
      const updated = new Map(landed.updated.map((vertex) => [vertex.id, vertex]));
      queryClient.setQueryData<MapVertex[]>(
        queryKeys.mapVertices(name),
        (current) =>
          current && [
            ...current
              .filter((vertex) => !deleted.has(vertex.id))
              .map((vertex) => updated.get(vertex.id) ?? vertex),
            ...landed.created.map(({ vertex }) => vertex),
          ],
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });

  // `mutateAsync` is bound once per observer, so `save` keeps its identity —
  // the editor's onSave lists it in its deps.
  const { mutateAsync } = saveMutation;
  const save = React.useCallback(
    (plan: VertexSavePlan) => mutateAsync(plan),
    [mutateAsync],
  );

  return {
    vertices: query.data ?? [],
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
    error: query.error?.message ?? null,
    save,
  };
}
