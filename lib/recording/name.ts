/**
 * Mirrors the backend catalogue's name rule so the Start button can refuse a
 * bad name before a request goes out. The server still validates — this is a
 * convenience, not the boundary. rosbag2 names its split files after the
 * directory, which is why the rule is this strict.
 *
 * Identical to MAP_NAME_RE today and deliberately not shared with it: the two
 * catalogues are different backend routers and either is free to loosen its
 * rule without the other following. See lib/map/name.ts.
 */
export const RECORDING_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The one name the backend refuses outright, because `GET
 * /api/v1/recordings/active` is its own route and a directory called that could
 * never be read back.
 */
export const RESERVED_RECORDING_NAME = "active";
