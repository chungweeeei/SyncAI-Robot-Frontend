import type { SaveMapOptions } from "@/lib/api/mapping";

/**
 * What the save dialog offers to build from a finished run, and the one rule
 * it keeps. The backend refuses a save that builds neither (400
 * `nothing_to_build`), and the dialog holds Save first: the refusal would
 * arrive after the operator thought the map was safe, and a save is the run's
 * only way out of the robot's memory.
 */

/**
 * The floor plan alone, as every save was before the choice existed: it is
 * ready in under a minute, while the 3D map takes minutes and most of the
 * robot's memory, so building it is the operator's act rather than a default.
 */
export const DEFAULT_SAVE_OUTPUTS: SaveMapOptions = { grid: true, octomap: false };

/** At least one of the two, or the map that comes out cannot be loaded. */
export function saveOutputsValid(outputs: SaveMapOptions): boolean {
  return outputs.grid || outputs.octomap;
}

export const SAVE_OUTPUTS_NEEDED = "Choose at least one to build.";
