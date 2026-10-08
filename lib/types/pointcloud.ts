// Types for the 3D point-cloud viewer. The wire format (both the live
// WebSocket stream and the static GET /api/v1/maps/{name}/pointcloud) is:
//   [uint32 point_count][float32 x, y, z] * point_count   (little-endian)
// See src/syncai_backend/.../helpers/pointcloud.py (pack_xyz_f32),
// routers/pointcloud.py for the live producer, and routers/map.py for the
// stored one — the two share the format so the clouds overlay.

/** A decoded point-cloud frame: xyz triplets in the map frame. */
export interface PointCloudFrame {
  /** number of points (positions.length / 3) */
  count: number;
  /** flat [x0, y0, z0, x1, y1, z1, ...] in map-frame metres */
  positions: Float32Array;
}

/**
 * The two layers of a stored map's 3D map, as the dashboard draws them. Here
 * rather than beside the hook that assembles it so `lib/scene/` can take it
 * without importing upward.
 */
export interface VoxelLayerFrames {
  /** The walkable floor: one point per cell the robot saw free at its feet. */
  road: PointCloudFrame;
  /** The walls and everything else solid, from the floor to head height. */
  occupied: PointCloudFrame;
}
