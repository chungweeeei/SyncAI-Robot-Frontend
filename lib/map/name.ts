/**
 * Mirrors the backend's map name rule so a name field can refuse early; the
 * server still validates. Deliberately separate from lib/recording/name.ts:
 * the two catalogues may diverge.
 */
export const MAP_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** The rule in an operator's words, shown while a typed name breaks it. */
export const MAP_NAME_HINT =
  "Letters, digits, dot, dash and underscore only, up to 64 characters.";
