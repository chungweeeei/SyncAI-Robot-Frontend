import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReconnectingSocketOptions } from "@/lib/ros/socket";

/**
 * A frame is [uint32 count][float32 x, y, z] * count. The rule these hold is
 * the socket module's promise: a malformed frame is skipped, never thrown out
 * of onmessage, and a stored map's short download is an error with a sentence.
 */

let captured: ReconnectingSocketOptions | null = null;
vi.mock("@/lib/ros/socket", () => ({
  createReconnectingSocket: (_path: string, opts: ReconnectingSocketOptions) => {
    captured = opts;
    return { close: () => {} };
  },
}));

const { createPointCloudStream, decodePointCloud } = await import(
  "@/lib/ros/pointcloud-stream"
);

/** A well-formed frame holding these points. */
function frame(points: [number, number, number][], extraBytes = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(4 + points.length * 12 + extraBytes);
  new DataView(buffer).setUint32(0, points.length, true);
  new Float32Array(buffer, 4, points.length * 3).set(points.flat());
  return buffer;
}

describe("decodePointCloud", () => {
  it("reads the points a frame says it holds", () => {
    const decoded = decodePointCloud(frame([[1, 2, 3], [4, 5, 6]]));
    expect(decoded?.count).toBe(2);
    expect(Array.from(decoded!.positions)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("views the buffer rather than copying it", () => {
    const buffer = frame([[1, 2, 3]]);
    expect(decodePointCloud(buffer)?.positions.buffer).toBe(buffer);
  });

  it("accepts an empty cloud", () => {
    expect(decodePointCloud(frame([]))).toEqual({
      count: 0,
      positions: new Float32Array(0),
    });
  });

  it("refuses a buffer too short for its header", () => {
    expect(decodePointCloud(new ArrayBuffer(3))).toBeNull();
  });

  it("refuses a frame shorter than its count says", () => {
    const whole = frame([[1, 2, 3], [4, 5, 6]]);
    expect(decodePointCloud(whole.slice(0, whole.byteLength - 1))).toBeNull();
  });

  it("ignores bytes past the last point", () => {
    expect(decodePointCloud(frame([[1, 2, 3]], 8))?.count).toBe(1);
  });
});

describe("createPointCloudStream", () => {
  it("drops a short frame without throwing and keeps delivering", () => {
    const onFrame = vi.fn();
    createPointCloudStream({ onFrame });
    const whole = frame([[1, 2, 3]]);

    expect(() => captured!.onMessage(whole.slice(0, 6))).not.toThrow();
    expect(onFrame).not.toHaveBeenCalled();

    captured!.onMessage(whole);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("skips a text frame", () => {
    const onFrame = vi.fn();
    createPointCloudStream({ onFrame });
    expect(() => captured!.onMessage("not a cloud")).not.toThrow();
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe("fetchMapPointCloud", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says the scan arrived incomplete when the body is short", async () => {
    const whole = frame([[1, 2, 3]]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(whole.slice(0, 10), { status: 200 })),
    );
    const { fetchMapPointCloud } = await import("@/lib/api/map");
    await expect(fetchMapPointCloud("dp2f")).rejects.toThrow(
      "The map scan arrived incomplete.",
    );
  });
});
