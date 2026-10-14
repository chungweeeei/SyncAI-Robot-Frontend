import {
  createReconnectingSocket,
  type ReconnectingSocket,
} from "@/lib/ros/socket";
import type { PointCloudFrame } from "@/lib/types/pointcloud";
import type { StreamStatus } from "@/lib/types/stream";

const HEADER_BYTES = 4;
const POINT_BYTES = 12;

/**
 * Decode a point-cloud frame (lib/types/pointcloud.ts). The 4-byte header keeps
 * the floats aligned, so they are viewed without copying.
 *
 * Null for a frame shorter than its header or its count says, rather than a
 * RangeError: the live stream drops it, a stored map's download reports it.
 * Trailing bytes are ignored.
 */
export function decodePointCloud(buffer: ArrayBuffer): PointCloudFrame | null {
  if (buffer.byteLength < HEADER_BYTES) return null;
  const count = new DataView(buffer).getUint32(0, true);
  if (buffer.byteLength < HEADER_BYTES + count * POINT_BYTES) return null;
  const positions = new Float32Array(buffer, HEADER_BYTES, count * 3);
  return { count, positions };
}

export interface PointCloudStreamHandlers {
  onFrame: (frame: PointCloudFrame) => void;
  onStatus?: (status: StreamStatus) => void;
}

/**
 * The live scan stream. Separate from telemetry on purpose; see
 * createReconnectingSocket.
 */
export function createPointCloudStream(
  handlers: PointCloudStreamHandlers,
  path = "/api/v1/robot/pointcloud/stream",
): ReconnectingSocket {
  return createReconnectingSocket(path, {
    binaryType: "arraybuffer",
    onStatus: handlers.onStatus,
    onMessage: (data) => {
      // Skip a non-binary or short frame; the next one is ~100 ms away.
      if (!(data instanceof ArrayBuffer)) return;
      const frame = decodePointCloud(data);
      if (frame) handlers.onFrame(frame);
    },
  });
}
