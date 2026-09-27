import {
  createReconnectingSocket,
  type ReconnectingSocket,
} from "@/lib/ros/socket";
import type { PointCloudFrame } from "@/lib/types/pointcloud";
import type { StreamStatus } from "@/lib/types/stream";

/** Bytes of the little-endian uint32 point count that leads every frame. */
const HEADER_BYTES = 4;
/** Bytes per point: three float32s. */
const POINT_BYTES = 12;

/**
 * Decode a binary point-cloud frame: little-endian uint32 count + count*3
 * float32 xyz. The 4-byte header keeps the float payload 4-byte aligned so it
 * can be viewed without copying.
 *
 * Null for a buffer too short to hold its header, or shorter than the count
 * says. Both used to throw a RangeError from the typed-array constructor. On
 * the live stream that surfaced as an uncaught error inside the socket's
 * onmessage, breaking the socket module's promise to skip a malformed frame.
 * Returned rather than thrown so each caller decides what a short frame
 * means: the live stream drops it and waits for the next one, and a stored
 * map's download reports it. Trailing bytes past the last point are ignored.
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
      // Anything that is not a binary frame is not one of ours, and a binary
      // one that is cut short cannot be drawn; skip both rather than throwing
      // inside the socket's onmessage. The next frame is ~100 ms away.
      if (!(data instanceof ArrayBuffer)) return;
      const frame = decodePointCloud(data);
      if (frame) handlers.onFrame(frame);
    },
  });
}
