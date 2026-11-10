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
 * Find the charger with the robot's camera: POST /api/v1/landmarks/detect.
 *
 * Held until the robot has a steady sighting or gives up (up to ~8 s), so a
 * 200 is a measured pose on the loaded map. 409 with a code when there is no
 * map, no fix, a search already running or no charger in view; 502 when the
 * robot cannot look at all. Nothing is stored: the caller decides what the
 * pose becomes.
 *
 * No client timeout: the helper has none, and the backend's own budget is
 * what ends the wait.
 */
export function detectCharger(): Promise<ChargerDetectResult> {
  return requestJson<ChargerDetectResult>(apiUrl("/api/v1/landmarks/detect"), {
    method: "POST",
    // No `landmark_id`: the robot's default is the charger.
    body: JSON.stringify({}),
    schema: ChargerDetectResultSchema,
    mapError: ({ detail, code }) =>
      code && CHARGER_DETECT_CODES.includes(code)
        ? new ChargerDetectError(detail, code as ChargerDetectCode)
        : undefined,
  });
}
