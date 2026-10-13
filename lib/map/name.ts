/**
 * Mirrors the backend's map name rule so a name field can refuse early; the
 * server still validates. Deliberately separate from lib/recording/name.ts:
 * the two catalogues may diverge.
 */
export const MAP_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
