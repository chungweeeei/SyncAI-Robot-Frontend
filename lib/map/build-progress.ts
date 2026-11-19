// A 3D map build's progress as the number a bar is drawn at.

/**
 * The highest percent a build still running is shown at. "Ready" is the
 * catalogue's `ok`, not a number: the robot's last steps (writing the files,
 * swapping them in) come after its count ends, and a bar full over a build
 * that then fails would have said something that was not true.
 */
const BUILDING_PERCENT_MAX = 99;

/**
 * `MapSummary.octomap_progress` (0 to 1) as a whole percent, or null when
 * there is no reading to draw — which is a bar without a value, not one at
 * zero: a build queued behind another map's has not started.
 *
 * Floored, so the number never runs ahead of the robot's own, and held
 * inside 0–99 whatever arrives.
 */
export function buildPercent(progress: number | null): number | null {
  if (progress === null || !Number.isFinite(progress)) return null;
  return Math.min(BUILDING_PERCENT_MAX, Math.max(0, Math.floor(progress * 100)));
}
