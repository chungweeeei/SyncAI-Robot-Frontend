"use client";

import * as React from "react";

import { createPointCloudStream, type PointCloudChannel } from "@/lib/ros/pointcloud-stream";
import type { PointCloudFrame } from "@/lib/types/pointcloud";
import type { StreamStatus } from "@/lib/types/stream";

/**
 * A scan stream for as long as `channel` is set: one socket per caller, the
 * reconnection owned by the stream, as with useTelemetry.
 *
 * Frames are handed to `onFrame` and never put in state: at ~10 Hz and a few
 * hundred KB each, the caller writes them straight into its preallocated
 * buffers. The handlers are read through refs, so a new closure each render
 * never bounces the socket — only a change of channel does.
 */
export function usePointCloudStream(
  channel: PointCloudChannel | null,
  onFrame: (frame: PointCloudFrame) => void,
  onStatus?: (status: StreamStatus) => void,
): void {
  const frameRef = React.useRef(onFrame);
  const statusRef = React.useRef(onStatus);
  React.useLayoutEffect(() => {
    frameRef.current = onFrame;
    statusRef.current = onStatus;
  });

  React.useEffect(() => {
    if (channel === null) return;
    const stream = createPointCloudStream(
      {
        onFrame: (frame) => frameRef.current(frame),
        onStatus: (status) => statusRef.current?.(status),
      },
      channel,
    );
    return () => stream.close();
  }, [channel]);
}
