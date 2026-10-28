// The mapping run: mode switch, start, save, discard, and its state.

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

/** Modes an operator can switch *into*; MAINTENANCE ("no session up") is not one. */
export type SwitchableMode = "MANUAL" | "AUTO";

export interface SwitchModeResult {
  mode: SwitchableMode;
  /**
   * True when the stack (this backend included) is being rebuilt; false when
   * the robot was already in that mode.
   */
  switching: boolean;
  message: string;
}

const SwitchModeResultSchema: z.ZodType<SwitchModeResult> = z.object({
  mode: z.enum(["MANUAL", "AUTO"]),
  switching: z.boolean(),
  message: z.string(),
});

/**
 * Switch the operating mode. The one request that outlives its server: a real
 * switch kills the backend too, so the *usual* outcome is a network error.
 * Read that as "in progress" (useModeSwitch does) and watch `mode` in the
 * state poll. Only the no-op and a refusal actually answer.
 */
export function switchRobotMode(mode: SwitchableMode): Promise<SwitchModeResult> {
  return requestJson<SwitchModeResult>(apiUrl("/api/v1/robot/mode"), {
    method: "POST",
    body: JSON.stringify({ mode }),
    schema: SwitchModeResultSchema,
  });
}

export interface SaveMapResult {
  name: string;
  /** True on any 200. */
  has_pointcloud: boolean;
  /** Operator-facing; render verbatim. */
  message: string;
}

const SaveMapResultSchema: z.ZodType<SaveMapResult> = z.object({
  name: z.string(),
  has_pointcloud: z.boolean(),
  message: z.string(),
});

/**
 * Save the mapping run as a map — and end it; the next map needs another
 * `startMapping`. Slow (a ~20 MB scan is merged and written). The robot then
 * builds the map's 3D map from the scan, minutes later: the catalogue's
 * `octomap_status` says how that goes. Refused 502 outside Mapping, 409 for a
 * taken name, 409 `mapping_idle` for a run never started.
 */
export function saveMap(name: string): Promise<SaveMapResult> {
  return requestJson<SaveMapResult>(apiUrl("/api/v1/maps"), {
    method: "POST",
    body: JSON.stringify({ name }),
    schema: SaveMapResultSchema,
  });
}

export interface ResetMappingResult {
  /** True on any 200; a failure is a 502. */
  reset: boolean;
  /** Operator-facing; render verbatim. */
  message: string;
}

const ResetMappingResultSchema: z.ZodType<ResetMappingResult> = z.object({
  reset: z.boolean(),
  message: z.string(),
});

/**
 * Discard the unsaved run, irreversibly; no auto-save, since the usual case is
 * a run gone wrong. Unlike `switchRobotMode`, a network error is a real
 * failure. Nothing on disk changes.
 *
 * The robot must be STANDING STILL: an IMU initialisation re-runs, and one in
 * motion tilts the new map with no error anywhere. Only the confirmation copy
 * can say so.
 */
export function resetMappingRun(): Promise<ResetMappingResult> {
  return requestJson<ResetMappingResult>(apiUrl("/api/v1/mapping/reset"), {
    method: "POST",
    schema: ResetMappingResultSchema,
  });
}

/**
 * The run state as the backend last heard it. `unknown` is a real answer (any
 * navigating robot, or a mapping one just up or gone quiet), read as "offer
 * nothing".
 */
export type MappingRunState = "idle" | "mapping" | "resetting" | "unknown";

export interface MappingStatus {
  state: MappingRunState;
  /** 0 unless mapping. */
  key_poses: number;
  loop_closures: number;
}

const MappingStatusSchema: z.ZodType<MappingStatus> = z.object({
  state: z.enum(["idle", "mapping", "resetting", "unknown"]),
  key_poses: z.number().int().nonnegative(),
  loop_closures: z.number().int().nonnegative(),
});

/**
 * GET /api/v1/mapping. Latched on the backend, so a reload or second console
 * reads the same, with no local flag to go wrong.
 */
export function fetchMappingStatus(signal?: AbortSignal): Promise<MappingStatus> {
  return requestJson<MappingStatus>(apiUrl("/api/v1/mapping"), {
    signal,
    schema: MappingStatusSchema,
  });
}

export interface StartMappingResult {
  /** True on any 200; a failure is a 502 or 409. */
  started: boolean;
  /** Operator-facing; render verbatim. */
  message: string;
}

const StartMappingResultSchema: z.ZodType<StartMappingResult> = z.object({
  started: z.boolean(),
  message: z.string(),
});

/**
 * Begin a mapping run from where the robot stands. A Mapping session starts
 * idle, so the drive to the site's start is not mapped.
 *
 * 409 `mapping_running` while a run is on, 409 `mapping_busy` while a start
 * or reset settles, 502 in the wrong mode. A network error is a real failure.
 *
 * STANDING STILL until the live scan returns, as for `resetMappingRun`.
 */
export function startMapping(): Promise<StartMappingResult> {
  return requestJson<StartMappingResult>(apiUrl("/api/v1/mapping/start"), {
    method: "POST",
    schema: StartMappingResultSchema,
  });
}
