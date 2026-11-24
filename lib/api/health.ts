import * as z from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

/**
 * What the console reads off the backend's liveness answer: the one route
 * beside the sign-in that needs no token. The rest of the body is for the
 * container's health check and is not read here.
 */
export interface Health {
  /**
   * Which kind of robot this is (`g23`, `m20`); see `RobotState.robot_model`.
   * Absent from a backend older than the field.
   */
  robot_model?: string;
}

const HealthSchema: z.ZodType<Health> = z.object({
  robot_model: z.string().optional(),
});

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return requestJson<Health>(apiUrl("/health"), { signal, schema: HealthSchema });
}
