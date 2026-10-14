"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  activateMap,
  ConvertConflictError,
  convertMapGrid,
  deleteMap,
  exportMap,
  importMap,
  renameMap,
  saveMapGrid,
} from "@/lib/api/map";
import { saveKeepout } from "@/lib/api/keepout";
import { queryKeys } from "@/lib/api/query-keys";
import { downloadBlob } from "@/lib/download";
import { exportFilename } from "@/lib/map/archive";
import type { MapGrid } from "@/lib/map/grid";
import type { GridRecipe, ZonePolygon } from "@/lib/types/map";

/*
 * The writes against one map. Each hook owns the request and every cache key
 * its response affects, so cross-key invalidations live in one place rather
 * than in whichever card control happened to know about its own key.
 *
 * UI reactions go in the per-call `mutate(vars, { onSuccess })`, which only
 * fires while the caller is mounted; the hook-level `onSuccess` always fires.
 * Invalidations are not awaited: an awaited refetch would unmount a deleted
 * map's card before its own callback ran.
 */

/** PATCH /api/v1/maps/{name}. Variables are the old and the new name. */
export function useRenameMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => renameMap(from, to),
    onSuccess: (_result, { from }) => {
      // Per-map caches keyed by the old name will never be read again.
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapKeepout(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapOctomap(from) });
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
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapKeepout(name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapOctomap(name) });
      // Templates need nothing: the backend refuses the delete while any
      // template is still bound (409 `template_bound`).
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
      // `active` moved between two cards and the dashboard reads the active
      // map's vertices; a live swap drops no socket, so nothing else refreshes.
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mapVertices(name) });
      if (result.previous) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.mapVertices(result.previous),
        });
      }
      // `map_matches_active` flipped on every template.
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
      // The keepout answer carries `active` too, and it moved with the switch.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mapKeepout(name) });
      if (result.previous) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.mapKeepout(result.previous) });
      }
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
    onSuccess: (_result, { name }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // Dropped, not invalidated: an immediate refetch would race the
      // conversion and cache the old raster as fresh.
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(name) });
    },
  });
}

/**
 * The grid holds hand edits and the request did not say to overwrite them.
 * Matched on the stable `code`, never on the sentence.
 */
export function isHandEditConflict(error: unknown): error is ConvertConflictError {
  return error instanceof ConvertConflictError && error.code === "gridmap_hand_edited";
}

/**
 * PUT /api/v1/maps/{name}/grid — the edited cell buffer, whole.
 *
 * The grid is not refetched: the caller's buffer is what was written, and a
 * reload would need a new GridSession and lose the undo history. The catalogue
 * (`modified_at`, size) and the task editor's preview raster go stale.
 */
export function useSaveMapGrid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, grid }: { name: string; grid: MapGrid }) =>
      saveMapGrid(name, grid),
    onSuccess: (_result, { name }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mapImage(name) });
    },
  });
}

/**
 * PUT /api/v1/maps/{name}/keepout — the map's forbidden zones, whole.
 *
 * The answer is the next zone read, so it is written into the cache. The
 * catalogue goes stale for its `modified_at`; neither raster includes zones.
 */
export function useSaveMapKeepout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, zones }: { name: string; zones: readonly ZonePolygon[] }) =>
      saveKeepout(name, zones),
    onSuccess: (result, { name }) => {
      queryClient.setQueryData(queryKeys.mapKeepout(name), {
        name: result.name,
        zones: result.zones,
        active: result.active,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
    },
  });
}

/**
 * GET /api/v1/maps/{name}/export, then download the archive.
 *
 * A mutation, not a query: the archive is built per click and never cached,
 * and the control wants `isPending` and the 409 sentence. The download is the
 * hook-level consequence so a card that unmounted mid-transfer still delivers.
 */
export function useExportMap() {
  return useMutation({
    mutationFn: ({ name }: { name: string }) => exportMap(name),
    onSuccess: (archive, { name }) => downloadBlob(archive, exportFilename(name)),
  });
}

export interface ImportMapVariables {
  archive: Blob;
  /** Overrides the name inside the archive; undefined keeps it. */
  name?: string;
}

/**
 * POST /api/v1/maps/import, with `cancel` to abort the upload in flight.
 *
 * The controller is a ref in the hook, not tied to an unmount (see the
 * fetcher's note on why a navigation never decides whether an upload lands).
 * The DOM's abort sentence is reworded for operators. A cancel refetches the
 * catalogue: a body that already arrived whole may still be committed.
 */
export function useImportMap() {
  const queryClient = useQueryClient();
  const controller = React.useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: ({ archive, name }: ImportMapVariables) => {
      const own = new AbortController();
      controller.current = own;
      return importMap(archive, name, own.signal)
        .catch((cause: unknown) => {
          if (own.signal.aborted) throw new Error("Import canceled.");
          throw cause;
        })
        .finally(() => {
          // Only its own: a retry right after a cancel already put its
          // controller here.
          if (controller.current === own) controller.current = null;
        });
    },
    onSuccess: (result) => {
      // Keyed by the answer's `name`: the manifest names the map when the field
      // was left empty. A replaced map makes every per-map entry stale.
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapKeepout(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapOctomap(result.name) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // Not `taskTemplates`: the backend refuses to replace a map any template
      // still targets (409 `template_bound`).
    },
  });
  const cancel = React.useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
  }, [queryClient]);
  return { ...mutation, cancel };
}
