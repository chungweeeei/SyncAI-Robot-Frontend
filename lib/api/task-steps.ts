// The step catalogue: /api/v1/task_steps. Its own module rather than a fetcher
// in task.ts, because the catalogue's schema lives with its domain
// (lib/task/catalogue.ts), which reads step.ts, which reads task.ts — the
// fetcher there would close that loop and hand step.ts a half-loaded module.

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { StepCatalogueSchema, type StepCatalogue } from "@/lib/task/catalogue";

/**
 * The steps a job is built from, as the robot describes them. Changes only
 * with the robot's software.
 */
export function fetchStepCatalogue(signal?: AbortSignal): Promise<StepCatalogue> {
  return requestJson<StepCatalogue>(apiUrl("/api/v1/task_steps"), {
    signal,
    schema: StepCatalogueSchema,
  });
}
