/**
 * Mirrors the backend's recording name rule so Start can refuse early; the
 * server still validates. Strict because rosbag2 names split files after it.
 *
 * Equal to MAP_NAME_RE but deliberately not shared: the two routers may
 * loosen their rules independently.
 */
export const RECORDING_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** The rule in an operator's words. Its own copy, as the rule is. */
export const RECORDING_NAME_HINT =
  "Letters, digits, dot, dash and underscore only, up to 64 characters.";

/** Refused by the backend: `GET /api/v1/recordings/active` is its own route. */
export const RESERVED_RECORDING_NAME = "active";
