/**
 * A step's `error_msg` as an operator reads it.
 *
 * A failed navigation reaches the console three sentences deep: the backend's
 * wrapper (`move ended in aborted: `), the robot's own sentence for the
 * planner's code (`Planning failed: the goal is inside a keepout zone`), and
 * the planner's diagnostics in parentheses (cell counts, radii, column dumps).
 * Only the middle one is for an operator, and it still says "keepout". So the
 * robot's sentences this console knows are said in the house words, and
 * anything else loses only the wrapper — an unknown sentence shown whole beats
 * one guessed at. The record (the history export) keeps the raw text.
 */

/** `_move_failure`'s prefix in the backend, for each nav step's label. */
const WRAPPER = /^(?:move|patrol) ended in aborted: /;

/**
 * The robot's planning sentences (the task runner's table, keyed by
 * ComputePathToPose's error code), matched by prefix because the detail in
 * parentheses follows them.
 */
const KNOWN: readonly (readonly [prefix: string, said: string])[] = [
  ["Planning failed: the goal is inside a keepout zone", "The goal is inside a forbidden zone."],
  ["Planning failed: the robot stands inside a keepout zone", "The robot is standing inside a forbidden zone."],
  ["Planning failed: the goal is outside the map", "The goal is outside the map."],
  ["Planning failed: the robot is outside the map", "The robot is outside the map."],
  ["Planning failed: no free ground at the goal", "There is no free ground at the goal."],
  ["Planning failed: no free ground where the robot stands", "There is no free ground where the robot stands."],
  ["Planning failed: the way to the goal is closed", "There is no way through to the goal."],
  ["Planning failed: the search for a path ran out of time", "No route to the goal was found in time."],
  ["Planning failed: the goal is on ground no stair connects", "No stair connects the robot's floor to the goal."],
  ["Planning failed: no map is loaded", "No map is loaded."],
  ["Planning failed: the map is still loading", "The map is still loading."],
  ["Planning failed: no robot pose", "The robot does not know where it is."],
  ["Planning failed: the route has no waypoints", "The route has no waypoints."],
  // The backend's own, for an abort with code 0.
  ["navigation did not start", "Navigation did not start. Another one may still be running."],
];

/** A group's other steps, closed because one failed: the id is not a word. */
const SIBLING_FAILED = /^Canceled: step \S+ failed$/;

export function stepFailureText(errorMsg: string): string {
  if (SIBLING_FAILED.test(errorMsg)) return "Canceled because a step beside it failed.";
  const sentence = errorMsg.replace(WRAPPER, "");
  const known = KNOWN.find(([prefix]) => sentence.startsWith(prefix));
  if (known) return known[1];
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
