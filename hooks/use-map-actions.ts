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
      // The per-map vertex, raster, scan and 3D map caches are keyed by the old name and
      // nothing will read them again; drop them rather than let them sit
      // until eviction.
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(from) });
      queryClient.removeQueries({ queryKey: queryKeys.mapOctomap(from) });
      // The zones moved with the directory; the new name reads them afresh.
      queryClient.removeQueries({ queryKey: queryKeys.mapKeepout(from) });
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
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapOctomap(name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapKeepout(name) });
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
      // The conversion is about to replace the .pgm the preview raster was
      // decoded from. Dropped rather than invalidated: an immediate refetch
      // would race the conversion and cache the *old* bytes as fresh; the next
      // mount after the catalogue reports `ok` reads the new ones.
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(name) });
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
 * throw away the operator's undo history as the reward for saving. The
 * catalogue is marked stale, for the `modified_at` and size its card shows,
 * and so is the preview raster the task editor draws from the same file.
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
 * The answer *is* the next value of the zone read, so it is written into
 * the cache rather than refetched. The catalogue is marked stale because
 * the save writes files into the map's directory, which moves the
 * `modified_at` its card shows. Neither raster is touched: the zones are a
 * file of their own, and the floor plan and the scan do not include them.
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
 * GET /api/v1/maps/{name}/export, then hand the archive to the operator's
 * machine.
 *
 * A read wrapped in useMutation rather than useQuery: the archive is built for
 * one click and is never the cached state of anything, and what the control
 * wants from it is exactly a mutation's surface — `isPending` while the robot
 * zips tens of megabytes, and the 409 sentence when the floor plan is still
 * being rebuilt. The download is the hook-level consequence, not the per-call
 * one, so a card that re-rendered away mid-transfer still delivers the file.
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
 * POST /api/v1/maps/import, plus the one mutation here that can be called off.
 *
 * `cancel` aborts the upload in flight. The controller lives in a ref rather
 * than in the component because it is the hook that knows which request is
 * current, and because it must *not* be tied to an unmount: the fetcher's
 * note explains why a navigation never decides whether an upload lands. The
 * abort is reworded before it reaches the mutation's `error`, since the DOM's
 * own sentence is not written for an operator. A cancel is also a cache
 * consequence, which is why the refetch sits beside it and not in the dialog:
 * a body that had already arrived whole may still be committed by the robot,
 * and the catalogue is the only place that would show it.
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
          // Only its own: a cancel followed at once by a retry has already
          // put the retry's controller here, and this settle must not drop it.
          if (controller.current === own) controller.current = null;
        });
    },
    onSuccess: (result) => {
      // Keyed by the answer's `name`, not the variable: the archive's manifest
      // names the map when the operator left the field empty. When the import
      // replaced a map every file and every vertex under that name is new, so
      // the per-map entries are stale rather than merely old; when it did not,
      // there is nothing under the name to drop and this is a no-op.
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapImage(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapPointCloud(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapOctomap(result.name) });
      queryClient.removeQueries({ queryKey: queryKeys.mapKeepout(result.name) });
      // The catalogue has a new (or rewritten) row; the refetch mounts its card.
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // Not `taskTemplates`: the backend refuses to replace a map any template
      // still targets (409 `template_bound`), so a success never changes what
      // a template resolves to.
    },
  });
  const cancel = React.useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
  }, [queryClient]);
  return { ...mutation, cancel };
}
