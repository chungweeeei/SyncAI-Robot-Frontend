// Client for finding the robot on the loaded map without a hint.
// (backend: POST /api/v1/localization/auto in routers/map.py)

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

export interface AutoLocalizeResult {
  /** True on any 200 — a failure is a 502 or a 409, never a 200 with false. */
  localized: boolean;
  /** The backend's summary of the match. */
  message: string;
  /** Map frame, metres. */
  x: number;
  y: number;
  z: number;
  /** Heading in degrees, map frame. */
  theta: number;
  /** Mean squared distance of the match, m². Smaller is tighter. */
  fitness: number;
  /** Share of the live scan that lies on the map after alignment, 0–1. */
  inlier_ratio: number;
  /** How many (position, heading) candidates were scored. */
  candidates: number;
}

const AutoLocalizeResultSchema: z.ZodType<AutoLocalizeResult> = z.object({
  localized: z.boolean(),
  message: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  theta: z.number(),
  fitness: z.number(),
  inlier_ratio: z.number(),
  candidates: z.number(),
});

/**
 * Find where the robot stands on the loaded map with no hint from anyone:
 * POST /api/v1/localization/auto.
 *
 * The other way out of a lost pose besides dragging an initial pose — for a
 * robot carried somewhere, or switched on away from where it was told it
 * starts. Unlike `setInitialPose` this one *answers*: the request is held
 * until the robot has either matched its surroundings against the map and
 * settled there, or given up (up to ~15 s), so a 200 means localized.
 *
 * Refusals are the backend's sentences: 409 while a job runs or a search is
 * already under way, and 502 for everything the robot itself says — not in
 * Navigation mode, a map saved without the data this needs, surroundings that
 * look alike in two places, or no match that held. A failure leaves the
 * robot's position exactly as it was.
 */
export function autoLocalize(): Promise<AutoLocalizeResult> {
  return requestJson<AutoLocalizeResult>(apiUrl("/api/v1/localization/auto"), {
    method: "POST",
    schema: AutoLocalizeResultSchema,
  });
}
