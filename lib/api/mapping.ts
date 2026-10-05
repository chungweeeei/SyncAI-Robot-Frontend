// Client for the mapping-run surface: switching the operating mode, starting
// a run, saving the map it built, discarding it, and reading where it stands.
// (backend: POST /api/v1/robot/mode in routers/robot.py; POST /api/v1/maps,
//  POST /api/v1/mapping/start, POST /api/v1/mapping/reset and
//  GET /api/v1/mapping in routers/map.py)

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

/**
 * The modes an operator can switch *into*. MAINTENANCE is reported by
 * `RobotState.mode` but is not a target — it means "no session is up", which is
 * not a state you ask for.
 */
export type SwitchableMode = "MANUAL" | "AUTO";

export interface SwitchModeResult {
  mode: SwitchableMode;
  /**
   * True when the switch was dispatched and the stack — including the backend
   * serving this API — is being torn down and rebuilt. False means the robot
   * was already in the requested mode and nothing happened.
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
 * Ask sys_manager to switch the operating mode (which byobu session is up).
 *
 * The one request that outlives its server: a real switch kills the byobu
 * session the backend is a pane of, so the *usual* outcome is a network error —
 * the connection drops before the response is written. Callers must read that
 * as "switch in progress", not failure (useModeSwitch does), and poll
 * GET /api/v1/robot/state until `mode` reports the target. The responses that
 * do arrive are the quick cases: the no-op (`switching: false`) and an
 * HTTP-level refusal.
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
  /** True on any 200 — pgo wrote map.pcd. */
  has_pointcloud: boolean;
  /**
   * Whether the pcd → gridmap conversion was started in the background. The
   * map lists with `grid: null` until it finishes; if it never does (or this
   * is false), the conversion is a by-hand run of the backend's
   * `syncai_backend.helpers.pcd_to_gridmap` on the robot.
   */
  grid_pending: boolean;
  /** Operator-facing sentence; render it verbatim. */
  message: string;
}

const SaveMapResultSchema: z.ZodType<SaveMapResult> = z.object({
  name: z.string(),
  has_pointcloud: z.boolean(),
  grid_pending: z.boolean(),
  message: z.string(),
});

/**
 * Save the current mapping run as `map/<name>/` on the robot — and end it.
 *
 * Only meaningful in MANUAL mode: pgo is the sole holder of the run's
 * keyframes and the sole serialiser, so in AUTO this is a 502 whose `detail`
 * says exactly that. The other operator-facing refusals are a 409 for a taken
 * name, a 409 `mapping_idle` for a run that was never started (see
 * `startMapping`) and pgo's own "NO POSES!" for one that has not banked a
 * keyframe yet. The call can take a while — the robot is merging and writing
 * a ~20 MB cloud.
 *
 * On success the run is over: pgo goes idle, frees its keyframes and clears
 * the "map so far" layer itself, and the next map needs another
 * `startMapping`. The `message` says so; render it verbatim.
 */
export function saveMap(name: string): Promise<SaveMapResult> {
  return requestJson<SaveMapResult>(apiUrl("/api/v1/maps"), {
    method: "POST",
    body: JSON.stringify({ name }),
    schema: SaveMapResultSchema,
  });
}

export interface ResetMappingResult {
  /** True on any 200 — pgo dropped its keyframes. A failure is a 502. */
  reset: boolean;
  /** Operator-facing sentence; render it verbatim. */
  message: string;
}

const ResetMappingResultSchema: z.ZodType<ResetMappingResult> = z.object({
  reset: z.boolean(),
  message: z.string(),
});

/**
 * Discard the run in the robot's memory and start a new map.
 *
 * The counterpart to `saveMap`, and irreversible: pgo holds the keyframes in
 * RAM, so whatever has not been saved is gone. Saving is a separate call on
 * purpose — the common use is abandoning a run that went wrong early, where an
 * automatic save would only litter the catalogue.
 *
 * Unlike `switchRobotMode` above, this request does NOT outlive its server:
 * nothing is torn down, the backend answers normally, and a network error here
 * is a real failure rather than a switch in progress. Treat it as one.
 *
 * Nothing on disk changes, so there is no map-catalogue cache to invalidate.
 *
 * The robot must be STANDING STILL when this lands: the LIO front end re-runs a
 * static, gravity-aligning IMU initialisation, and one done in motion tilts the
 * new map permanently with no error anywhere. The confirmation copy is the only
 * thing that can say so.
 */
export function resetMappingRun(): Promise<ResetMappingResult> {
  return requestJson<ResetMappingResult>(apiUrl("/api/v1/mapping/reset"), {
    method: "POST",
    schema: ResetMappingResultSchema,
  });
}

/**
 * pgo's run state, as the backend last heard it.
 *
 * `unknown` is a real answer, not an error: it is what every navigating robot
 * says (pgo exists only in a mapping session), and what a mapping robot says
 * for the first second after pgo comes up or once it has gone quiet. The
 * console treats it as "do not offer anything", the same way it treats a
 * missing state frame.
 */
export type MappingRunState = "idle" | "mapping" | "resetting" | "unknown";

export interface MappingStatus {
  state: MappingRunState;
  /** Keyframes in the robot's graph; 0 unless mapping. */
  key_poses: number;
  /** Loop closures the graph has accepted. */
  loop_closures: number;
}

const MappingStatusSchema: z.ZodType<MappingStatus> = z.object({
  state: z.enum(["idle", "mapping", "resetting", "unknown"]),
  key_poses: z.number().int().nonnegative(),
  loop_closures: z.number().int().nonnegative(),
});

/**
 * Where the mapping run stands: GET /api/v1/mapping.
 *
 * Read from a latched ROS topic on the backend, so it answers after a page
 * reload and from a second console alike — which is what lets the rail show
 * "press Start" or "mapping · N keyframes" without a local flag that would be
 * wrong the moment another tab pressed a button.
 */
export function fetchMappingStatus(signal?: AbortSignal): Promise<MappingStatus> {
  return requestJson<MappingStatus>(apiUrl("/api/v1/mapping"), {
    signal,
    schema: MappingStatusSchema,
  });
}

export interface StartMappingResult {
  /** True on any 200 — pgo is building a map. A failure is a 502 or a 409. */
  started: boolean;
  /** Operator-facing sentence; render it verbatim. */
  message: string;
}

const StartMappingResultSchema: z.ZodType<StartMappingResult> = z.object({
  started: z.boolean(),
  message: z.string(),
});

/**
 * Begin a mapping run: POST /api/v1/mapping/start.
 *
 * A mapping session comes up with pgo idle and banking nothing, so the drive
 * from wherever the robot was switched on to the site's starting point is not
 * part of any map. This is what starts one, from where the robot stands; a
 * successful `saveMap` ends it, and the next map needs this call again.
 *
 * Refusals are the backend's sentences: 409 `mapping_running` while a run is
 * already on (save it, or discard it with `resetMappingRun`), 409
 * `mapping_busy` for the seconds a start or reset takes, and the wrong-mode
 * 502. Like `resetMappingRun`, this request does NOT outlive its server —
 * nothing is torn down — so a network error here is a real failure.
 *
 * The robot must be STANDING STILL when this lands and until the live scan
 * returns: the LIO front end re-runs a static, gravity-aligning IMU
 * initialisation, and one done in motion tilts the whole map with no error
 * anywhere. The control's caption is what says so.
 */
export function startMapping(): Promise<StartMappingResult> {
  return requestJson<StartMappingResult>(apiUrl("/api/v1/mapping/start"), {
    method: "POST",
    schema: StartMappingResultSchema,
  });
}
