// The robot's 3D map as the console holds it: the occupied voxels of the
// OcTree the backend serves byte for byte (GET /api/v1/maps/{name}/octomap,
// decoded by lib/map/octree.ts). Here rather than beside the decoder so
// lib/scene/ can draw it without importing from lib/map/.

/**
 * An OcTree key is 16 bits per axis with the map origin at its midpoint: a
 * voxel's centre along an axis is `(key - OCTREE_KEY_ORIGIN + 0.5) * res`.
 * The ground editor saves keys in this absolute form, which is what the
 * robot's edit tool indexes the tree with.
 */
export const OCTREE_KEY_ORIGIN = 32768;

export interface OccupiedVoxels {
  /** Cell edge, metres. */
  res: number;
  /**
   * The absolute key of the box corner every key below is relative to — the
   * lowest occupied key on each axis — so a column is `kx + ky * size[0]`
   * and the whole map fits a `Uint16Array`.
   */
  keyMin: [number, number, number];
  /** The box's extent in cells, each axis. */
  size: [number, number, number];
  /** `count` triples of (kx, ky, kz) relative to `keyMin`, in tree order. */
  keys: Uint16Array;
  count: number;
  /** The tree's leaves as met while decoding, what the robot's build reports. */
  leaves: { occupied: number; free: number };
}
