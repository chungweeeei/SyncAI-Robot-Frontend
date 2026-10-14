// Wire format of both the live stream and GET /api/v1/maps/{name}/pointcloud
// (backend helpers/pointcloud.py, pack_xyz_f32), shared so the clouds overlay:
//   [uint32 point_count][float32 x, y, z] * point_count   (little-endian)

/** A decoded point-cloud frame: xyz triplets in the map frame. */
export interface PointCloudFrame {
  count: number;
  /** flat [x0, y0, z0, x1, y1, z1, ...] in map-frame metres */
  positions: Float32Array;
}
