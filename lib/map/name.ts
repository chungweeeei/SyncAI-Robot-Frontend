/**
 * Mirrors the backend's map name rule so a name field can refuse early; the
 * server still validates. Deliberately separate from lib/recording/name.ts:
 * the two catalogues may diverge.
 */
export const MAP_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** The rule in an operator's words, shown while a typed name breaks it. */
export const MAP_NAME_HINT =
  "Letters, digits, dot, dash and underscore only, up to 64 characters.";

/**
 * Why a run resumed from `resumedFrom` cannot be saved as `name`, or null. The
 * robot refuses a save back into the map it loaded — the save would empty
 * what the run is built on — so the field says it before the press.
 */
export function resumedSaveProblem(name: string, resumedFrom: string | null): string | null {
  if (resumedFrom === null || name !== resumedFrom) return null;
  return `${resumedFrom} is the map this run continues. Pick another name.`;
}
