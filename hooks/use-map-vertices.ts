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
  /** The backend's sentence for the write that failed, verbatim. */
  failure: string | null;
}

export interface UseMapVertices {
  /** The rows as the robot holds them — the editor's `saved`, not its screen. */
  vertices: MapVertex[];
  status: MapVerticesStatus;
  error: string | null;
  /**
   * Send a staged plan. Never rejects: a save that stops halfway is an
   * ordinary outcome here, and the editor needs what landed either way.
   */
  save: (plan: VertexSavePlan) => Promise<VertexSaveOutcome>;
}

/**
 * One map's vertices for the floor plan editor, which stages every change and
 * writes them on Save, so a layout reaches the robot as one decision.
 *
 * A Save is sent in series — deletes (freeing names), then updates, then one
 * batch create — stopping at the first refusal, so the outcome is a clean
 * prefix the editor folds back in (rebaseVertices). That is why `save`
 * resolves with what landed rather than rejecting.
 *
 * The entry is shared with useActiveMapVertices; what landed is spliced in
 * (the responses are the stored rows), and `vertex_count` and the templates'
 * MOVE resolution are invalidated.
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

  // `mutateAsync` is stable, so `save` keeps its identity for the editor's deps.
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
