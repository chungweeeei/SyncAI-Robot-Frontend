"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchStepCatalogue } from "@/lib/api/task-steps";
import { queryKeys } from "@/lib/api/query-keys";
import { LOCAL_STEP_CATALOGUE, type StepCatalogue } from "@/lib/task/catalogue";

/**
 * The steps the robot can take, for the task editor's menus and forms: the
 * robot's own answer (GET /api/v1/task_steps), read once a session since only
 * a software update changes it.
 *
 * Until it answers, and on a robot from before the endpoint, the editor works
 * from the local copy of today's steps (lib/task/catalogue.ts) rather than
 * opening on empty menus: the backend still validates every save, so the
 * worst a stale copy costs is a refusal in the backend's own words.
 */
export function useStepCatalogue(): StepCatalogue {
  const { data } = useQuery({
    queryKey: queryKeys.taskSteps,
    queryFn: ({ signal }) => fetchStepCatalogue(signal),
    staleTime: Infinity,
  });
  return data ?? LOCAL_STEP_CATALOGUE;
}
