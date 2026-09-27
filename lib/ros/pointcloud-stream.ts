import {
  createReconnectingSocket,
  type ReconnectingSocket,
} from "@/lib/ros/socket";
import type { PointCloudFrame } from "@/lib/types/pointcloud";
import type { StreamStatus } from "@/lib/types/stream";

/**
 * Decode a binary point-cloud frame: little-endian uint32 count + count*3
 * float32 xyz. The 4-byte header keeps the float payload 4-byte aligned so it
 * can be viewed without copying.
 */
export function decodePointCloud(buffer: ArrayBuffer): PointCloudFrame {
  const count = new DataView(buffer).getUint32(0, true);
  const positions = new Float32Array(buffer, 4, count * 3);
  return { count, positions };
}

export interface PointCloudStreamHandlers {
  onFrame: (frame: PointCloudFrame) => void;
  onStatus?: (status: StreamStatus) => void;
}

/**
 * Connect to the live body_cloud WebSocket and invoke ``onFrame`` for each
 * decoded frame. Reconnect and status handling come from
 * createReconnectingSocket — see it for why this stream and the telemetry one
 * are separate connections rather than one multiplexed socket.
 */
export function createPointCloudStream(
  handlers: PointCloudStreamHandlers,
  path = "/api/v1/robot/pointcloud/stream",
): ReconnectingSocket {
  return createReconnectingSocket(path, {
    binaryType: "arraybuffer",
    onStatus: handlers.onStatus,
    onMessage: (data) => {
      // Anything that is not a binary frame is not one of ours; skip it rather
      // than throwing inside the socket's onmessage.
      if (data instanceof ArrayBuffer) {
        handlers.onFrame(decodePointCloud(data));
      }
    },
  });
}
