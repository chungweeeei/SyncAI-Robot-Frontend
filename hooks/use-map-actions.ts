"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  activateMap,
  ConvertConflictError,
  convertMapGrid,
  deleteMap,
  renameMap,
  saveMapGrid,
} from "@/lib/api/map";
import { queryKeys } from "@/lib/api/query-keys";
import type { MapGrid } from "@/lib/map/grid";
import type { GridRecipe } from "@/lib/types/map";

/*
 * The writes against one map, one hook each, wrapping TanStack's useMutation.
 *
 * What a hook here owns is the request and its consequences for the cache:
 * which keys the response makes stale, and which entries it makes meaningless.
 * That used to be repeated in every card control alongside its own busy/error
 * state, which meant the answer to "who invalidates `taskTemplates` when a map
 * is renamed" was "nobody, because each control only knew about its own key".
 * Holding the invalidations next to the request is what makes that question
 * answerable in one place.
 *
 * What a hook here does NOT own is the UI reaction — closing a dialog, handing
 * the backend's sentence up to the library. Those go in the per-call
 * `mutate(vars, { onSuccess })`, which TanStack only fires while the caller is
 * still mounted; the hook-level `onSuccess` below fires regardless, so the
 * cache is corrected even when the response lands after the card is gone. The
 * invalidations are not awaited for the same reason: an awaited refetch would
 * unmount a deleted map's card before its own callback could run.
 */

/** PATCH /api/v1/maps/{name}. Variables are the old and the new name. */
export function useRenameMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => renameMap(from, to),
    onSuccess: (_result, { from }) => {
      // The per-map vertex cache is keyed by the old name and nothing will
      // read it again; drop it rather than let it sit until eviction.
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(from) });
      // The catalogue now lists the map under its new name; the refetch is
      // what replaces its card with one keyed on that name.
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // `templates_moved`: every template bound to the old name now carries
      // the new one, and the task console scopes its library on `map_name`.
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });
}

/** DELETE /api/v1/maps/{name}. */
export function useDeleteMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteMap(name),
    onSuccess: (_result, name) => {
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(name) });
      // The catalogue no longer lists the map; the refetch is what unmounts
      // its card. Templates need nothing: the backend refuses the delete while
      // any template is still bound (409 `template_bound`).
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
    },
  });
}

/** POST /api/v1/maps/{name}/activate — a live switch, no stack restart. */
export function useActivateMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => activateMap(name),
    onSuccess: (result, name) => {
      // `active` moved between two cards, and the dashboard reads the active
      // map's vertices — nothing else forces either refresh, because a live
      // swap (unlike the stack restart this replaced) drops no socket.
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mapVertices(name) });
      if (result.previous) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.mapVertices(result.previous),
        });
      }
      // `map_matches_active` flipped on every template: the ones scoped to the
      // new map are now dispatchable and the old map's are not.
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });
}

export interface ConvertMapGridVariables {
  name: string;
  recipe: GridRecipe;
  overwriteEdits: boolean;
}

/**
 * POST /api/v1/maps/{name}/grid/convert.
 *
 * The response only means "started". Invalidating the catalogue is what flips
 * the card to `grid_status: "converting"`, starts useMaps' poll, and carries
 * it through to `ok` or `failed` — the outcome never arrives here.
 */
export function useConvertMapGrid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, recipe, overwriteEdits }: ConvertMapGridVariables) =>
      convertMapGrid(name, { recipe, overwriteEdits }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
    },
  });
}

/**
 * The one convert refusal a control reacts to structurally: the grid holds
 * hand edits and the request did not say to overwrite them. Matched on the
 * stable `code`, never on the sentence, which exists to be reworded.
 */
export function isHandEditConflict(error: unknown): error is ConvertConflictError {
  return error instanceof ConvertConflictError && error.code === "gridmap_hand_edited";
}

/**
 * PUT /api/v1/maps/{name}/grid — the edited cell buffer, whole.
 *
 * The grid itself is deliberately not refetched: the caller's buffer *is* what
 * was written, byte for byte, and a reload would need a new GridSession and
 * throw away the operator's undo history as the reward for saving. Only the
 * catalogue is marked stale, for the `modified_at` and size its card shows.
 */
export function useSaveMapGrid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, grid }: { name: string; grid: MapGrid }) =>
      saveMapGrid(name, grid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
    },
  });
}
