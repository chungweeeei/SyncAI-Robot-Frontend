"use client";

import { LOCAL_STEP_CATALOGUE, type StepCatalogue } from "@/lib/task/catalogue";

/**
 * The steps the robot can take, for the task editor's menus and forms.
 *
 * Local today, in the shape the backend's catalogue endpoint is to answer
 * with (lib/task/catalogue.ts). Every component reads it here and never
 * imports the constant, so that endpoint lands as a query in this hook alone.
 */
export function useStepCatalogue(): StepCatalogue {
  return LOCAL_STEP_CATALOGUE;
}
