// The map catalogue: /api/v1/maps and everything under /api/v1/maps/{name}/.
// The wire nests `origin` as an object; it is folded into MapMetadata's tuple
// here, once.
//
// Asymmetric on purpose: the floor plan is read as the /image PNG (lossless,
// smaller, browser-decodable) but written as raw cell bytes, which need no
// encoder and cannot be colour-managed.

import { apiUrl } from "@/lib/api/config";
import { z } from "zod";

import { requestJson, requestRaw } from "@/lib/api/http";
import type { MapGrid } from "@/lib/map/grid";
import { decodeOctomapBt } from "@/lib/map/octree";
import { decodePointCloud } from "@/lib/ros/pointcloud-stream";
import { GridStatusSchema } from "@/lib/types/map";
import type { GridRecipe, GridStatus, MapFloor, MapSummary } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

interface WireGrid {
  resolution: number;
  origin: { x: number; y: number; yaw: number };
  width: number;
  height: number;
}

/**
 * `thumbnail` is a path, not an absolute URL. The `octomap_*` fields are
 * optional on the wire only: a backend from before the 3D map existed sends
 * none, and the robots run whichever branch of each repo is checked out, so
 * the console reads "no 3D map" rather than refusing the whole catalogue.
 */
interface WireSummary {
  name: string;
  active: boolean;
  grid: WireGrid | null;
  thumbnail: string | null;
  has_pointcloud: boolean;
  grid_status: GridStatus;
  grid_error: string | null;
  grid_converting: boolean;
  size_bytes: number;
  modified_at: string;
  vertex_count: number;
  octomap_status?: GridStatus;
  octomap_error?: string | null;
  octomap_version?: string | null;
  octomap_resolution?: number | null;
}

/** Checked before `toSummary`, so a failure names the field the backend sent. */
const WireSummarySchema: z.ZodType<WireSummary> = z.object({
  name: z.string(),
  active: z.boolean(),
  grid: z
    .object({
      resolution: z.number(),
      origin: z.object({ x: z.number(), y: z.number(), yaw: z.number() }),
      width: z.number(),
      height: z.number(),
    })
    .nullable(),
  thumbnail: z.string().nullable(),
  has_pointcloud: z.boolean(),
  grid_status: GridStatusSchema,
  grid_error: z.string().nullable(),
  grid_converting: z.boolean(),
  size_bytes: z.number(),
  modified_at: z.string(),
  vertex_count: z.number(),
  octomap_status: GridStatusSchema.optional(),
  octomap_error: z.string().nullable().optional(),
  octomap_version: z.string().nullable().optional(),
  octomap_resolution: z.number().nullable().optional(),
});

function toSummary(wire: WireSummary): MapSummary {
  return {
    ...wire,
    grid: wire.grid
      ? {
          resolution: wire.grid.resolution,
          origin: [wire.grid.origin.x, wire.grid.origin.y, wire.grid.origin.yaw],
          width: wire.grid.width,
          height: wire.grid.height,
        }
      : null,
    // Absolute: <img src> would resolve against :3001, not the backend's :3000.
    thumbnail: wire.thumbnail ? apiUrl(wire.thumbnail) : null,
    octomap_status: wire.octomap_status ?? "none",
    octomap_error: wire.octomap_error ?? null,
    octomap_version: wire.octomap_version ?? null,
    octomap_resolution: wire.octomap_resolution ?? null,
  };
}

export async function fetchMaps(signal?: AbortSignal): Promise<MapSummary[]> {
  const wire = await requestJson<WireSummary[]>(apiUrl("/api/v1/maps"), {
    signal,
    schema: z.array(WireSummarySchema),
  });
  return wire.map(toSummary);
}

export interface MapGridResponse {
  summary: MapSummary;
  grid: MapGrid;
}

/**
 * Decode the map PNG back to one byte per cell.
 *
 * `colorSpaceConversion: "none"` is load-bearing: colour management turns the
 * 205 that marks *unknown* into 204 or 206, a different cell kind that still
 * looks like a map. Rows need no flip (row 0 is the top in both).
 */
async function decodeGrid(blob: Blob): Promise<MapGrid> {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });

  try {
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not decode the map image (no 2D context).");
    ctx.drawImage(bitmap, 0, 0);

    const rgba = ctx.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    // Greyscale source, so r === g === b; one channel is the cell value.
    for (let i = 0; i < data.length; i += 1) data[i] = rgba[i * 4];

    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

/**
 * One map's editable grid with its summary: two requests, since geometry and
 * cells are separate files. Rejects for an unknown map or one with no floor
 * plan yet; the editor shows a guard screen for both.
 */
export async function fetchMapGrid(
  name: string,
  signal?: AbortSignal,
): Promise<MapGridResponse> {
  const encoded = encodeURIComponent(name);

  const summary = toSummary(
    await requestJson<WireSummary>(apiUrl(`/api/v1/maps/${encoded}`), {
      signal,
      schema: WireSummarySchema,
    }),
  );
  if (!summary.grid) {
    throw new Error(
      `"${name}" has no floor plan yet. Build one from the map's card on the Maps screen first.`,
    );
  }

  const image = await requestRaw(apiUrl(`/api/v1/maps/${encoded}/image`), {
    signal,
  });
  return { summary, grid: await decodeGrid(await image.blob()) };
}

/**
 * The same PNG, decoded only to be drawn (the task editor's preview), so
 * `decodeGrid`'s flags do not apply. Immutable, so the cache can share it.
 */
export async function fetchMapImage(
  name: string,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  const encoded = encodeURIComponent(name);
  const image = await requestRaw(apiUrl(`/api/v1/maps/${encoded}/image`), {
    signal,
  });
  return createImageBitmap(await image.blob());
}

/**
 * A stored map's scan, downsampled server-side like the live stream so the
 * two overlay. Same wire format as the stream, hence its decoder.
 */
export async function fetchMapPointCloud(
  name: string,
  signal?: AbortSignal,
): Promise<PointCloudFrame> {
  const encoded = encodeURIComponent(name);
  const res = await requestRaw(apiUrl(`/api/v1/maps/${encoded}/pointcloud`), {
    signal,
  });
  const frame = decodePointCloud(await res.arrayBuffer());
  // A 2xx cut short in transit has no backend sentence, so this one is
  // written for the operator; toggling the layer is the retry.
  if (!frame) {
    throw new Error("The map scan arrived incomplete. Turn Map scan off and on to try again.");
  }
  return frame;
}

/**
 * A stored map's 3D map, the robot's occupancy tree served byte for byte and
 * decoded here (lib/map/octree.ts). A refusal is the backend's sentence; a
 * body that is not a tree, or was cut short, is the decoder's — written for
 * the operator, since a truncated 2xx has no sentence of its own.
 */
export async function fetchMapOctomap(
  name: string,
  signal?: AbortSignal,
): Promise<OccupiedVoxels> {
  const encoded = encodeURIComponent(name);
  const res = await requestRaw(apiUrl(`/api/v1/maps/${encoded}/octomap`), {
    signal,
  });
  return decodeOctomapBt(await res.arrayBuffer());
}

/** `OctomapEditsResponse`, verbatim: the ground patches saved for a map. */
export interface MapOctomapEdits {
  name: string;
  /** Cell edge the keys index, null with none saved. */
  res: number | null;
  /** Absolute OcTree keys `[kx, ky, kz]`, one per column; `[]` with none saved. */
  fill_key: number[][];
  created_at: string | null;
}

const MapOctomapEditsSchema: z.ZodType<MapOctomapEdits> = z.object({
  name: z.string(),
  res: z.number().nullable(),
  fill_key: z.array(z.array(z.number())),
  created_at: z.string().nullable(),
});

function octomapEditsPath(name: string): string {
  return apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/octomap/edits`);
}

export function fetchMapOctomapEdits(
  name: string,
  signal?: AbortSignal,
): Promise<MapOctomapEdits> {
  return requestJson<MapOctomapEdits>(octomapEditsPath(name), {
    signal,
    schema: MapOctomapEditsSchema,
  });
}

/** `SaveOctomapEditsResponse`, verbatim. */
export interface SaveOctomapEditsResult {
  name: string;
  count: number;
  /** Operator-facing; render verbatim. Says the patches wait to be applied. */
  message: string;
}

const SaveOctomapEditsResultSchema: z.ZodType<SaveOctomapEditsResult> = z.object({
  name: z.string(),
  count: z.number(),
  message: z.string(),
});

/**
 * Replace the map's ground patches, whole (an empty list clears them). A
 * record on the robot, not a change to its 3D map: the robot's own tool
 * applies it, which the backend's sentence says. 409 `task_running` while a
 * job drives on the map, `octomap_converting` while the tree is being built.
 *
 * No `AbortSignal`, for `saveKeepout`'s reason.
 */
export function saveMapOctomapEdits(
  name: string,
  fillKey: readonly (readonly number[])[],
): Promise<SaveOctomapEditsResult> {
  return requestJson<SaveOctomapEditsResult>(octomapEditsPath(name), {
    method: "PUT",
    body: JSON.stringify({ fill_key: fillKey.map((key) => [key[0], key[1], key[2]]) }),
    schema: SaveOctomapEditsResultSchema,
  });
}

/** `MapFloorsResponse`, verbatim: the storeys a map spans. */
export interface MapFloors {
  name: string;
  /** The floors to show, lowest first: the saved list, else the detected one. `[]` is one storey. */
  floors: MapFloor[];
  /** What the robot's walk while mapping says, whatever is saved. */
  detected: MapFloor[];
  /** Whether `floors` is a saved list. */
  saved: boolean;
}

const MapFloorSchema: z.ZodType<MapFloor> = z.object({
  name: z.string(),
  level: z.number(),
});

const MapFloorsSchema: z.ZodType<MapFloors> = z.object({
  name: z.string(),
  floors: z.array(MapFloorSchema),
  detected: z.array(MapFloorSchema),
  saved: z.boolean(),
});

function floorsPath(name: string): string {
  return apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/floors`);
}

export function fetchMapFloors(name: string, signal?: AbortSignal): Promise<MapFloors> {
  return requestJson<MapFloors>(floorsPath(name), { signal, schema: MapFloorsSchema });
}

/** `SaveMapFloorsResponse`, verbatim. */
export interface SaveMapFloorsResult {
  name: string;
  /** What was saved, lowest first and trimmed: the list the next read answers. */
  floors: MapFloor[];
  /** Operator-facing; render verbatim. */
  message: string;
}

const SaveMapFloorsResultSchema: z.ZodType<SaveMapFloorsResult> = z.object({
  name: z.string(),
  floors: z.array(MapFloorSchema),
  message: z.string(),
});

/**
 * Replace the map's floors, whole (`[]` saves one storey). Display-only on
 * the robot's side too, so no job holds it. No `AbortSignal`, for
 * `saveKeepout`'s reason.
 */
export function saveMapFloors(
  name: string,
  floors: readonly MapFloor[],
): Promise<SaveMapFloorsResult> {
  return requestJson<SaveMapFloorsResult>(floorsPath(name), {
    method: "PUT",
    body: JSON.stringify({
      floors: floors.map((floor) => ({ name: floor.name, level: floor.level })),
    }),
    schema: SaveMapFloorsResultSchema,
  });
}

export interface SaveGridResult {
  name: string;
  /** The tag /image will now answer with. */
  etag: string;
  active: boolean;
  /** Whether the running stack re-read it. False for any inactive map. */
  reloaded: boolean;
  /** Operator-facing; render verbatim. */
  message: string;
}

const SaveGridResultSchema: z.ZodType<SaveGridResult> = z.object({
  name: z.string(),
  etag: z.string(),
  active: z.boolean(),
  reloaded: z.boolean(),
  message: z.string(),
});

/**
 * Persist an edited grid as the raw cell buffer, written verbatim, so no 205
 * can shift the way a colour-managed image would (see `decodeGrid`).
 *
 * No `AbortSignal`: an aborted PUT tears the file, so a navigation must not.
 * `fetch` snapshots the body at the call, so painting mid-save is safe; the
 * result describes the buffer as of Save, which the editor's revision guard
 * accounts for.
 */
export function saveMapGrid(
  name: string,
  grid: MapGrid,
): Promise<SaveGridResult> {
  return requestJson<SaveGridResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/grid`),
    {
      method: "PUT",
      // Explicit, or FastAPI parses the bytes as JSON.
      headers: { "Content-Type": "application/octet-stream" },
      body: grid.data,
      schema: SaveGridResultSchema,
    },
  );
}

/**
 * The convert endpoint's 409 codes. `gridmap_hand_edited` opens the overwrite
 * confirm, so it is matched on the code, never the reword-able sentence.
 */
export type ConvertConflictCode = "conversion_running" | "gridmap_hand_edited";

export class ConvertConflictError extends Error {
  code: ConvertConflictCode;

  constructor(message: string, code: ConvertConflictCode) {
    super(message);
    this.name = "ConvertConflictError";
    this.code = code;
  }
}

export interface ConvertGridResult {
  name: string;
  /** Started only; the catalogue says how it ends. */
  started: boolean;
  recipe: GridRecipe;
  /** Operator-facing; render verbatim. */
  message: string;
}

const ConvertGridResultSchema: z.ZodType<ConvertGridResult> = z.object({
  name: z.string(),
  started: z.boolean(),
  recipe: z.enum(["z-band", "traversability"]),
  message: z.string(),
});

/**
 * (Re)build a map's floor plan from its scan. The endpoint's tuning knobs are
 * left out on purpose; they are not for guessing from a dropdown.
 *
 * The answer only means "started": the outcome, failure included, arrives as
 * the catalogue's `grid_status` / `grid_error`.
 */
export function convertMapGrid(
  name: string,
  opts: { recipe: GridRecipe; overwriteEdits?: boolean; reason?: string },
): Promise<ConvertGridResult> {
  return requestJson<ConvertGridResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/grid/convert`),
    {
      method: "POST",
      body: JSON.stringify({
        recipe: opts.recipe,
        overwrite_edits: opts.overwriteEdits ?? false,
        ...(opts.reason ? { reason: opts.reason } : {}),
      }),
      schema: ConvertGridResultSchema,
      mapError: ({ detail, code }, res) =>
        res.status === 409 &&
        (code === "conversion_running" || code === "gridmap_hand_edited")
          ? new ConvertConflictError(detail, code)
          : undefined,
    },
  );
}

export interface RenameMapResult {
  old_name: string;
  name: string;
  vertices_moved: number;
  templates_moved: number;
  /** Operator-facing; render verbatim. */
  message: string;
}

const RenameMapResultSchema: z.ZodType<RenameMapResult> = z.object({
  old_name: z.string(),
  name: z.string(),
  vertices_moved: z.number(),
  templates_moved: z.number(),
  message: z.string(),
});

/**
 * Rename a map; its waypoints and templates follow. 409 `map_active`,
 * `conversion_running`, `name_taken`, or 400 for a bad name — none with a
 * structured retry, so no error class.
 */
export function renameMap(
  name: string,
  newName: string,
): Promise<RenameMapResult> {
  return requestJson<RenameMapResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}`),
    {
      method: "PATCH",
      body: JSON.stringify({ name: newName }),
      schema: RenameMapResultSchema,
    },
  );
}

export interface DeleteMapResult {
  name: string;
  vertices_deleted: number;
  /** Operator-facing; render verbatim. */
  message: string;
}

const DeleteMapResultSchema: z.ZodType<DeleteMapResult> = z.object({
  name: z.string(),
  vertices_deleted: z.number(),
  message: z.string(),
});

/**
 * Delete a map and its waypoints. 409 `map_active`, `conversion_running`, or
 * `template_bound` (a template still names it); no error class, as for rename.
 *
 * The body is parsed: the card unmounts, so its sentence is the only record.
 */
export function deleteMap(name: string): Promise<DeleteMapResult> {
  return requestJson<DeleteMapResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}`),
    { method: "DELETE", schema: DeleteMapResultSchema },
  );
}

/**
 * The switch's 409 codes. Each is temporary in a different way (clears by
 * itself, needs a floor plan built, needs Navigation mode), so the code decides
 * what is offered beside the rendered sentence.
 */
export type ActivateConflictCode =
  | "conversion_running"
  | "grid_missing"
  | "pointcloud_missing"
  | "ini_not_writable"
  | "task_running"
  | "tasks_unknown"
  | "stack_not_ready";

const ACTIVATE_CONFLICT_CODES: readonly string[] = [
  "conversion_running",
  "grid_missing",
  "pointcloud_missing",
  "ini_not_writable",
  "task_running",
  "tasks_unknown",
  "stack_not_ready",
];

export class ActivateConflictError extends Error {
  code: ActivateConflictCode;

  constructor(message: string, code: ActivateConflictCode) {
    super(message);
    this.name = "ActivateConflictError";
    this.code = code;
  }
}

export interface ActivateMapResult {
  name: string;
  previous: string | null;
  /** False when already active: a no-op, not a failure. */
  switched: boolean;
  /**
   * Whether localization converged after the swap: `false` is "not yet",
   * `null` "could not ask". Not `localization_valid`, which reads true
   * against a map the robot was never localized in.
   */
  localized: boolean | null;
  /** Operator-facing; render verbatim. */
  message: string;
}

const ActivateMapResultSchema: z.ZodType<ActivateMapResult> = z.object({
  name: z.string(),
  previous: z.string().nullable(),
  switched: z.boolean(),
  localized: z.boolean().nullable(),
  message: z.string(),
});

/**
 * Switch the robot onto another map, live and across a restart.
 *
 * The pose resets to the map origin (the old frame means nothing here), and a
 * 200 does not mean localized: read `localized` and expect to ask for an
 * initial pose.
 */
export function activateMap(name: string): Promise<ActivateMapResult> {
  return requestJson<ActivateMapResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/activate`),
    {
      method: "POST",
      schema: ActivateMapResultSchema,
      mapError: ({ detail, code }, res) =>
        res.status === 409 && code && ACTIVATE_CONFLICT_CODES.includes(code)
          ? new ActivateConflictError(detail, code as ActivateConflictCode)
          : undefined,
    },
  );
}

/** The console only asks for zip. */
export type MapArchiveFormat = "zip" | "tar.gz";

/**
 * Export a map and its waypoints as an importable archive. The caller names
 * the file: CORS exposes only `Location`, so `Content-Disposition` reads null
 * (see `exportFilename` in lib/map/archive.ts).
 *
 * 409 `conversion_running` (the archive would be torn). The active map can be
 * exported.
 */
export async function exportMap(
  name: string,
  format: MapArchiveFormat = "zip",
): Promise<Blob> {
  const res = await requestRaw(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/export?format=${format}`),
  );
  return res.blob();
}

export interface ImportMapResult {
  name: string;
  /** A map of that name existed and was replaced. */
  replaced: boolean;
  files: number;
  bytes: number;
  vertices_created: number;
  /** The replaced map's waypoints, or rows orphaned earlier. */
  vertices_deleted: number;
  /** Operator-facing; render verbatim. */
  message: string;
}

const ImportMapResultSchema: z.ZodType<ImportMapResult> = z.object({
  name: z.string(),
  replaced: z.boolean(),
  files: z.number(),
  bytes: z.number(),
  vertices_created: z.number(),
  vertices_deleted: z.number(),
  message: z.string(),
});

/**
 * Import a map archive as raw octet-stream (the backend sniffs the format and
 * has no multipart parser). `name` overrides the manifest's. **A map of that
 * name is replaced**; 409s as for delete, plus `disk_low`.
 *
 * The `signal` is the operator's Cancel only, never a navigation. The import
 * commits whole, so a cut body lands nothing — but one that already arrived
 * may still commit, which is why a cancel also refetches the catalogue.
 */
export function importMap(
  archive: Blob,
  name?: string,
  signal?: AbortSignal,
): Promise<ImportMapResult> {
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  return requestJson<ImportMapResult>(apiUrl(`/api/v1/maps/import${query}`), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: archive,
    signal,
    schema: ImportMapResultSchema,
  });
}
