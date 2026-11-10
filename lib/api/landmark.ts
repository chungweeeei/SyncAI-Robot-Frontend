import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

export interface ChargerDetectResult {
  /** The loaded map the pose is on. */
  map: string;
  /** Map frame, metres. */
  x: number;
  y: number;
  /**
   * The ground height to store on the waypoint, as the robot measured it:
   * written as is, never looked up again under the point.
   */
  z: number;
  /** Heading in degrees, map frame, like a waypoint's. */
  theta: number;
  /** Height of the charger's mark, metres. */
  marker_z: number;
  /** Sightings in a row that agreed. */
  consecutive: number;
  /** Seconds since the last sighting. */
  age: number;
  reprojection_error_px: number;
}

const ChargerDetectResultSchema: z.ZodType<ChargerDetectResult> = z.object({
  map: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  theta: z.number(),
  marker_z: z.number(),
  consecutive: z.number(),
  age: z.number(),
  reprojection_error_px: z.number(),
});

/** The refusals the endpoint names; the sentence beside each is the backend's. */
export type ChargerDetectCode =
  | "no_map_loaded"
  | "not_localized"
  | "detect_running"
  | "landmark_not_detected"
  | "unknown_landmark";

const CHARGER_DETECT_CODES: readonly string[] = [
  "no_map_loaded",
  "not_localized",
  "detect_running",
  "landmark_not_detected",
  "unknown_landmark",
];

/**
 * A refusal with its reason. `landmark_not_detected` is the one an operator
 * fixes on the spot, by turning the robot to face the charger.
 */
export class ChargerDetectError extends Error {
  code: ChargerDetectCode;

  constructor(message: string, code: ChargerDetectCode) {
    super(message);
    this.name = "ChargerDetectError";
    this.code = code;
  }
}

/**
 * The robot's own budget for a look is ~9 s at worst (its detector's wait, the
 * search, the last call). Past this, no answer is coming.
 */
export const CHARGER_DETECT_TIMEOUT_MS = 15_000;

/**
 * No answer at all: the robot was not reached, or the wait ran out. Unlike a
 * refusal there is nothing to read and nothing to try again against, so the
 * caller lets go of the dialog it held for the look.
 */
export class ChargerDetectNoResponseError extends Error {
  constructor() {
    super("The robot did not answer.");
    this.name = "ChargerDetectNoResponseError";
  }
}

/** `fetch` rejects with a TypeError off the network, a DOMException on abort. */
function isNoResponse(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

/**
 * Find the charger with the robot's camera: POST /api/v1/landmarks/detect.
 *
 * Held until the robot has a steady sighting or gives up (up to ~8 s), so a
 * 200 is a measured pose on the loaded map. 409 with a code when there is no
 * map, no fix, a search already running or no charger in view; 502 when the
 * robot cannot look at all. Nothing is stored: the caller decides what the
 * pose becomes.
 *
 * The robot ends its own wait; `CHARGER_DETECT_TIMEOUT_MS` is for the robot
 * that never answers, which throws `ChargerDetectNoResponseError` like a
 * request that never reached it.
 */
export async function detectCharger(): Promise<ChargerDetectResult> {
  try {
    return await requestCharger();
  } catch (error) {
    throw isNoResponse(error) ? new ChargerDetectNoResponseError() : error;
  }
}

function requestCharger(): Promise<ChargerDetectResult> {
  return requestJson<ChargerDetectResult>(apiUrl("/api/v1/landmarks/detect"), {
    method: "POST",
    signal: AbortSignal.timeout(CHARGER_DETECT_TIMEOUT_MS),
    // No `landmark_id`: the robot's default is the charger.
    body: JSON.stringify({}),
    schema: ChargerDetectResultSchema,
    mapError: ({ detail, code }) =>
      code && CHARGER_DETECT_CODES.includes(code)
        ? new ChargerDetectError(detail, code as ChargerDetectCode)
        : undefined,
  });
}
