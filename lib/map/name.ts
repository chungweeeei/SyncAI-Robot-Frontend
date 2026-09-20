/**
 * Mirrors the backend catalogue's name rule, so a Save or Rename field can
 * refuse a bad name before a request goes out. The server still validates —
 * this is a convenience, not the boundary.
 *
 * Here rather than in lib/api/mapping.ts, where it was first written, because
 * the only readers are three name fields and none of them wants the REST
 * client: a form importing a fetcher module to reach a regex is the layering
 * break CLAUDE.md names. The same rule applies to a recording's name; see
 * lib/recording/name.ts, which is deliberately a separate constant because the
 * two catalogues are free to diverge.
 */
export const MAP_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
