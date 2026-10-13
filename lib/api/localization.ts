import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

export interface AutoLocalizeResult {
  /** True on any 200 — a failure is a 502 or a 409, never a 200 with false. */
  localized: boolean;
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
  /** (position, heading) candidates scored. */
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
 * Find the robot on the loaded map with no hint: POST /api/v1/localization/auto.
 *
 * Unlike `setInitialPose` this answers: the request is held until the robot
 * has matched and settled, or given up (up to ~15 s), so a 200 means
 * localized. 409 while a job or another search runs, 502 for whatever the
 * robot reports; a failure leaves the position as it was.
 */
export function autoLocalize(): Promise<AutoLocalizeResult> {
  return requestJson<AutoLocalizeResult>(apiUrl("/api/v1/localization/auto"), {
    method: "POST",
    schema: AutoLocalizeResultSchema,
  });
}
