// Client for the map catalogue: GET /api/v1/maps and everything under
// /api/v1/maps/{name}/.
//
// The backend speaks snake_case and nests `origin` as an object; the app's
// MapMetadata is a tuple. The wire types below are the former, the exported
// functions return the latter, and the translation happens in one place so no
// component has to know the difference.
//
// There is no /api/v1/maps/{name}/gridmap: the grid arrives as the PNG from
// /image, which is the same cells losslessly encoded, a third smaller than the
// P5 on the wire, and decodable by the browser instead of by a parser we would
// have to write and keep tolerant of GIMP's `#` comment line.
//
// The write direction is asymmetric on purpose — `saveMapGrid` PUTs raw cell
// bytes rather than a PNG. Read needs a format the browser can decode; write
// needs no encoder at all, and the raw path cannot be colour-managed.

import { apiUrl } from "@/lib/api/config";
import { z } from "zod";

import { requestJson, requestRaw } from "@/lib/api/http";
import type { MapGrid } from "@/lib/map/grid";
import { decodePointCloud } from "@/lib/ros/pointcloud-stream";
import { GridStatusSchema, OctomapStatusSchema } from "@/lib/types/map";
import type {
  GridRecipe,
  GridStatus,
  MapSummary,
  OctomapLayer,
  OctomapStatus,
} from "@/lib/types/map";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

/** `GridInfoResponse` — note `origin` is {x, y, yaw}, not a tuple. */
interface WireGrid {
  resolution: number;
  origin: { x: number; y: number; yaw: number };
  width: number;
  height: number;
}

/** `MapSummaryResponse`. `thumbnail` is a path, not an absolute URL. */
interface WireSummary {
  name: string;
  active: boolean;
  grid: WireGrid | null;
  thumbnail: string | null;
  has_pointcloud: boolean;
  grid_status: GridStatus;
  grid_error: string | null;
  grid_converting: boolean;
  octomap_status: OctomapStatus;
  octomap_error: string | null;
  octomap_resolution: number | null;
  size_bytes: number;
  modified_at: string;
  vertex_count: number;
}

/**
 * The catalogue as it arrives, before `toSummary` folds the origin and
 * absolutises the thumbnail. Checked in this shape rather than after the fold,
 * so a failure names the field the backend actually sent.
 */
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
  octomap_status: OctomapStatusSchema,
  octomap_error: z.string().nullable(),
  octomap_resolution: z.number().nullable(),
  size_bytes: z.number(),
  modified_at: z.string(),
  vertex_count: z.number(),
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
    // Absolute, because <img src> on the card resolves against the *frontend's*
    // origin (:3001) and the backend answers on :3000.
    thumbnail: wire.thumbnail ? apiUrl(wire.thumbnail) : null,
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
 * `colorSpaceConversion: "none"` is load-bearing, not defensive. Canvas is RGBA
 * sRGB, and by default the browser is free to colour-manage a decoded image on
 * the way in — which for a greyscale PNG means the 205 that marks *unknown*
 * comes back as 204 or 206 and `classify` in lib/map/grid.ts reads a different
 * cell kind. It would still look like a map, which is exactly why it has to be
 * turned off here rather than noticed later.
 *
 * Row order needs no flip: the PNG carries the .pgm's rows in file order (row 0
 * is the top / max y), getImageData hands them back the same way, and that is
 * what MapGrid documents.
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
 * One map's editable grid, with the summary it belongs to.
 *
 * Two requests rather than one: the geometry lives in gridmap.yaml and the cells
 * in the .pgm, and the editor needs both. They are consistent because /image's
 * ETag is a hash of the same .pgm the summary's width/height were read from — if
 * a save lands between the two calls, the mismatch is visible rather than silent.
 *
 * Rejects for a name that is not in the catalogue and for a map that has no
 * gridmap yet; the editor turns both into a guard screen rather than opening on
 * an empty canvas.
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
 * The same PNG, decoded only to be drawn — the task editor's floor plan preview.
 *
 * None of `decodeGrid`'s flags apply: nothing reads a pixel back, so a colour-
 * managed 204 where the file says 205 is invisible, and an ImageBitmap is the
 * cheapest thing `drawImage` accepts. Returned as-is rather than wrapped in a
 * session because it is immutable, which is what lets the query cache share one
 * decode between every open MOVE row.
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
 * One stored map's scan, fetched once: its saved `map.pcd`, voxel-downsampled
 * server-side with the same numbers the live stream uses, so the two overlay.
 *
 * Here rather than beside the live stream in `lib/ros/`, where it used to sit:
 * it is a REST read, and living outside `lib/api/` is what let the viewport
 * call it straight from an effect without eslint noticing. The decoder stays
 * with the stream because the socket and this endpoint share one wire format.
 *
 * Through `requestRaw` so a refusal (no scan on disk, a map deleted under the
 * operator) is the backend's `{detail}` sentence rather than a status code.
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
  // A 2xx whose body is shorter than it says is a download cut off in
  // transit, not a refusal, so there is no backend sentence to show. This one
  // is written for the operator: the view renders it beside the layer toggle,
  // and turning the layer off and on is the retry.
  if (!frame) {
    throw new Error("The map scan arrived incomplete. Turn Map scan off and on to try again.");
  }
  return frame;
}

/**
 * One layer of a stored map's 3D map, fetched once — the robot's own
 * voxelisation of the save, already one point per cell, so unlike the scan
 * above the backend does not thin it.
 *
 * Same wire format and decoder as the scan; a separate route per layer so the
 * two are separate cache entries, and a refusal (still building: 409; not
 * built, failed or gone: 404) is the backend's sentence through `requestRaw`.
 */
export async function fetchMapOctomapLayer(
  name: string,
  layer: OctomapLayer,
  signal?: AbortSignal,
): Promise<PointCloudFrame> {
  const encoded = encodeURIComponent(name);
  const res = await requestRaw(apiUrl(`/api/v1/maps/${encoded}/octomap/${layer}`), {
    signal,
  });
  const frame = decodePointCloud(await res.arrayBuffer());
  // As for the scan: a short 2xx body is a download cut off in transit, and
  // the layer toggle is the retry.
  if (!frame) {
    throw new Error("The 3D map arrived incomplete. Turn 3D map off and on to try again.");
  }
  return frame;
}

/** `SaveGridmapResponse`. Every field is already the app's type. */
export interface SaveGridResult {
  name: string;
  /** Of the gridmap now on disk — the same tag /image will answer with. */
  etag: string;
  /** Whether this is the map the stack was launched with. */
  active: boolean;
  /** Whether the running map_server re-read it. False for any inactive map. */
  reloaded: boolean;
  /** Operator-facing sentence; render it verbatim. */
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
 * Persist an edited grid.
 *
 * The body is the cell buffer itself — `width * height` bytes, .pgm row order —
 * not a PNG and not base64 in JSON. It goes out with no copy and the backend
 * writes it into a P5 body verbatim, so nothing in the round trip can shift a
 * 205 to a 204 the way a colour-managed image path can (see `decodeGrid`, which
 * needed `colorSpaceConversion: "none"` for exactly that reason). ~1.6 MB per
 * save on a robot LAN, once per operator edit.
 *
 * `Content-Type` is set explicitly because a BufferSource body makes `fetch`
 * send none at all, and the endpoint's `Body(..., media_type=...)` needs it —
 * without it FastAPI falls back to parsing the bytes as JSON.
 *
 * Deliberately takes no `AbortSignal`, unlike everything else in this file:
 * aborting a PUT mid-flight is how you get a torn `gridmap.pgm`. If the operator
 * navigates away the write should still land; React 19 makes the orphaned
 * setState a no-op.
 *
 * Note `fetch` snapshots a BufferSource body synchronously at the call, so
 * painting during an in-flight save cannot corrupt the payload — but it does
 * mean the result describes the buffer as it was when Save was pressed, which is
 * what the editor's revision guard is for.
 */
export function saveMapGrid(
  name: string,
  grid: MapGrid,
): Promise<SaveGridResult> {
  return requestJson<SaveGridResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/grid`),
    {
      method: "PUT",
      // Explicit, so requestJson's JSON default stands down: the body is the
      // cell buffer and `Body(..., media_type=...)` on the endpoint needs the
      // type to match or FastAPI parses the bytes as JSON.
      headers: { "Content-Type": "application/octet-stream" },
      body: grid.data,
      schema: SaveGridResultSchema,
    },
  );
}

/**
 * The convert endpoint's two distinguishable 409s, by their stable `code`.
 *
 * "gridmap_hand_edited" is the one the UI reacts to structurally — it opens the
 * overwrite confirm and retries with `overwriteEdits` — so it must be matched on
 * the code, not on the detail sentence, which exists to be reworded.
 * "conversion_running" just renders as the error it is.
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

/** `ConvertGridResponse`, verbatim. */
export interface ConvertGridResult {
  name: string;
  /** The thread started; the grid appears later or never — poll the catalogue. */
  started: boolean;
  recipe: GridRecipe;
  /** Operator-facing sentence; render it verbatim. */
  message: string;
}

const ConvertGridResultSchema: z.ZodType<ConvertGridResult> = z.object({
  name: z.string(),
  started: z.boolean(),
  recipe: z.enum(["z-band", "traversability"]),
  message: z.string(),
});

/**
 * (Re)build a map's 2D gridmap from its map.pcd.
 *
 * Only `recipe` and the two flags are surfaced here: the endpoint also takes
 * per-band offsets, gap_fill_size and a debug switch, but those are
 * tune-with-the-intermediates-in-front-of-you parameters that stay curl/MCP
 * territory — a dropdown for them would invite guessing numbers the backend's
 * own comments say not to guess.
 *
 * The response only means "started": conversion runs in a background thread and
 * its status surface is the catalogue's `grid_status`, so callers invalidate the
 * maps query and let the poll carry the rest — including a failure, which lands
 * there as `"failed"` with the reason in `grid_error` rather than as a rejected
 * promise here.
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

/** `RenameMapResponse`, verbatim. */
export interface RenameMapResult {
  old_name: string;
  name: string;
  vertices_moved: number;
  templates_moved: number;
  /** Operator-facing sentence; render it verbatim. */
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
 * Rename a map: `map/<name>/` becomes `map/<newName>/` on the robot, and the
 * vertices and task templates bound to the old name follow it.
 *
 * Three refusals come back as 409s — `map_active` (the map the stack is
 * running on; the card never offers Rename for it, so seeing this means the
 * catalogue was stale), `conversion_running` and `name_taken` — plus a 400 for
 * a name the catalogue's rule rejects. None of them has a structured retry the
 * way the convert endpoint's `gridmap_hand_edited` does, so there is no error
 * class here: the backend's sentence is written to be shown, and the control
 * shows it.
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

/** `DeleteMapResponse`, verbatim. */
export interface DeleteMapResult {
  name: string;
  vertices_deleted: number;
  /** Operator-facing sentence; render it verbatim. */
  message: string;
}

const DeleteMapResultSchema: z.ZodType<DeleteMapResult> = z.object({
  name: z.string(),
  vertices_deleted: z.number(),
  message: z.string(),
});

/**
 * Delete a map: `map/<name>/` and the vertices bound to it go, together.
 *
 * Four refusals come back as 409s. Three are rename's — `map_active` (the card
 * never offers Delete for the running map, so seeing it means the catalogue was
 * stale) and `conversion_running` — plus `template_bound`, which is the only
 * one that asks the operator to do something rather than wait: a task template
 * still names this map, and a template bound to a map that is gone can neither
 * run nor be edited. As with `renameMap`, none of them has a structured retry,
 * so there is no error class; the backend's sentence names the templates and
 * the control shows it.
 *
 * Unlike the vertex and task-template deletes, this one parses its body: the
 * card unmounts on success, so the sentence and the vertex count are the only
 * record of what happened and the library renders them in the card's place.
 */
export function deleteMap(name: string): Promise<DeleteMapResult> {
  return requestJson<DeleteMapResult>(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}`),
    { method: "DELETE", schema: DeleteMapResultSchema },
  );
}

/**
 * The 409s the Switch-map control reacts to structurally rather than just
 * showing.
 *
 * Unlike `renameMap`/`deleteMap`, whose refusals all reduce to "read this
 * sentence", a switch is refused for reasons that are *temporary* in different
 * ways, and the control words its retry affordance from the code: a conversion
 * or a running task clears on its own, a missing gridmap needs the operator to
 * go and build one, and `stack_not_ready` usually means the robot is in mapping
 * mode — a different page. The sentence is still what gets rendered; the code is
 * what decides whether anything is offered alongside it.
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

/** `ActivateMapResponse`, verbatim. */
export interface ActivateMapResult {
  name: string;
  /** The map the robot was on, if it was on one. */
  previous: string | null;
  /** False when it was already active — the no-op, not a failure. */
  switched: boolean;
  /**
   * Whether the localizer's registration converged in the seconds after the
   * swap. `false` means "not yet" (it retries indefinitely), `null` means it
   * could not be asked. Do not substitute `localization_valid` from telemetry:
   * that is TF-presence only and reads true against a map the robot was never
   * localized in.
   */
  localized: boolean | null;
  /** Operator-facing sentence; render it verbatim. */
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
 * Switch the robot onto another map, live.
 *
 * The verb the maps library lacked for most of its life. It re-points the
 * running localizer and map_server and rewrites `[map] name` in the instance
 * INI, so the swap holds now *and* survives a restart — which is also why it is
 * what lifts the `map_active` refusal on Rename and Delete.
 *
 * Two things the caller has to carry into its UI. The robot's pose is reset to
 * the map origin, because a pose measured in the old map's frame means nothing
 * in the new one; and a 200 does not mean the robot knows where it is — read
 * `localized`, and expect to tell the operator to set an initial pose.
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

/** The two archive formats `/export` writes. The console only ever asks for zip. */
export type MapArchiveFormat = "zip" | "tar.gz";

/**
 * Export a map: `map/<name>/` and its vertices, as one archive the robot can
 * import again.
 *
 * `requestRaw`, because the answer is the archive itself and not JSON. Note
 * the caller names the file: the backend does set `Content-Disposition`, but
 * the console is cross-origin to it and the CORS policy exposes only
 * `Location`, so `res.headers.get("Content-Disposition")` reads null in the
 * browser. `exportFilename` in lib/map/archive.ts mirrors what the header
 * would have said.
 *
 * Refused 409 `conversion_running` while the floor plan is being rebuilt —
 * the archive would be torn — and 404 for a name the catalogue does not
 * know. The map in use *can* be exported: reading the directory disturbs
 * nothing the stack holds open.
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

/** `ImportMapResponse`, verbatim. */
export interface ImportMapResult {
  /** The map directory the archive became. */
  name: string;
  /** True when a map of that name existed and was replaced. */
  replaced: boolean;
  files: number;
  bytes: number;
  vertices_created: number;
  /** The replaced map's vertices, or rows orphaned by an earlier hand delete. */
  vertices_deleted: number;
  /** Operator-facing sentence; render it verbatim. */
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
 * Import a map from an archive `exportMap` (or another robot's) produced.
 *
 * The body is the archive's bytes as `application/octet-stream`, not a
 * multipart form: the backend ships no multipart parser and sniffs zip
 * against tar.gz from the first bytes, so there is no format to declare.
 * As with `saveMapGrid`, the explicit `Content-Type` is what stands
 * requestJson's JSON default down.
 *
 * `name` is optional and overrides the one written into the archive's
 * manifest; left out, the map lands under the name it was exported as. **A
 * map of that name is replaced**, not refused and not renamed — the import is
 * subject to the same 409s as a delete (`map_active`, `conversion_running`,
 * `template_bound`), plus `disk_low` when the archive would not fit. None of
 * them has a structured retry, so there is no error class; the control shows
 * the backend's sentence. The answer is parsed because `name` picks which
 * per-map cache entries the hook drops.
 *
 * The `signal` is the operator's Cancel and nothing else. The backend stages
 * the import and commits it whole, so a body cut short lands nothing on the
 * robot — which is what makes an explicit cancel safe to offer. It is still
 * not wired to an effect cleanup: a navigation should not be what decides
 * whether a 40 MB upload the operator started lands, so `useImportMap` holds
 * the controller and fires it only from the dialog's button. One window the
 * signal cannot close: a body that had already arrived whole may still be
 * committed after the console stopped listening, which is why a cancel also
 * refetches the catalogue.
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
