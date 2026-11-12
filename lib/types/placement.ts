import type { PlacedPose } from "@/lib/types/robot";

/**
 * One waypoint placement awaiting a name. The create dialog's form remounts
 * per `key`, so a typed name never carries to the next stop; Use robot
 * position and Detect charger keep the key and the name.
 */
export interface Placement {
  key: number;
  /** With the ground height of the floor it was placed on. */
  pose: PlacedPose;
  /**
   * The pose is the charger's as the robot measured it. Part of the placement
   * rather than of the request, so it is gone the moment the pose is anything
   * else.
   */
  detected?: boolean;
  /**
   * Placed with Add charger: the type is Charger from the start and stays
   * so. The pose is still the press's until a source replaces it.
   */
  charger?: boolean;
}
