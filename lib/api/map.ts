// The map catalogue: /api/v1/maps and everything under /api/v1/maps/{name}/.

import { apiUrl } from "@/lib/api/config";
import { z } from "zod";

import { readBlob, requestJson, requestRaw } from "@/lib/api/http";
import { decodeOctomapBt } from "@/lib/map/octree";
import { decodePointCloud } from "@/lib/ros/pointcloud-stream";
import { OctomapStatusSchema } from "@/lib/types/map";
import type { MapFloor, MapSummary, OctomapStatus } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

/**
 * The `octomap_*` fields are optional on the wire only: a backend from before
 * the 3D map existed sends none, and the robots run whichever branch of each
 * repo is checked out, so the console reads "no 3D map" rather than refusing
 * the whole catalogue. Keys a backend still sends beyond these (an older
 * one's floor plan fields) are stripped by the schema.
 */
interface WireSummary {
  name: string;
  active: boolean;
  has_pointcloud: boolean;
  size_bytes: number;
  modified_at: string;
  vertex_count: number;
  octomap_status?: OctomapStatus;
  octomap_error?: string | null;
  octomap_version?: string | null;
  octomap_resolution?: number | null;
}

/** Checked before `toSummary`, so a failure names the field the backend sent. */
const WireSummarySchema: z.ZodType<WireSummary> = z.object({
  name: z.string(),
  active: z.boolean(),
  has_pointcloud: z.boolean(),
  size_bytes: z.number(),
  modified_at: z.string(),
  vertex_count: z.number(),
  octomap_status: OctomapStatusSchema.optional(),
  octomap_error: z.string().nullable().optional(),
  octomap_version: z.string().nullable().optional(),
  octomap_resolution: z.number().nullable().optional(),
});

function toSummary(wire: WireSummary): MapSummary {
  return {
    name: wire.name,
    active: wire.active,
    has_pointcloud: wire.has_pointcloud,
    size_bytes: wire.size_bytes,
    modified_at: wire.modified_at,
    vertex_count: wire.vertex_count,
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
 * `name_taken`, or 400 for a bad name — none with a
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
 * Delete a map and its waypoints. 409 `map_active` or `template_bound` (a template still names it); no error class, as for rename.
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
 * The switch's 409 codes. Each is temporary in a different way (needs a 3D
 * map built, clears by itself, needs Navigation mode, needs a robot that can
 * plan in 3D), so the code decides what is offered beside the rendered
 * sentence.
 */
export type ActivateConflictCode =
  | "octomap_missing"
  | "pointcloud_missing"
  | "ini_not_writable"
  | "task_running"
  | "tasks_unknown"
  | "stack_not_ready"
  | "planner_3d_unavailable";

const ACTIVATE_CONFLICT_CODES: readonly string[] = [
  "octomap_missing",
  "pointcloud_missing",
  "ini_not_writable",
  "task_running",
  "tasks_unknown",
  "stack_not_ready",
  "planner_3d_unavailable",
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
 * The active map can be exported.
 *
 * The robot builds the whole archive before it answers, then streams it with
 * its `Content-Length`, so `onProgress` (a fraction, 0–1) covers the transfer
 * only: it is first called once the archive is built, and the wait before
 * that has no total to measure against.
 */
export async function exportMap(
  name: string,
  format: MapArchiveFormat = "zip",
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const res = await requestRaw(
    apiUrl(`/api/v1/maps/${encodeURIComponent(name)}/export?format=${format}`),
  );
  return readBlob(res, onProgress);
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
