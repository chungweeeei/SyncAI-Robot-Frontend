import { describe, expect, it, vi } from "vitest";

import { decodeTelemetryFrame } from "@/lib/ros/telemetry-stream";
import type { PlannedPath } from "@/lib/types/robot";

describe("decodeTelemetryFrame", () => {
  it("hands a dock's approach to its own handler, not the route's", () => {
    // Two slots on the backend and two on the screen: a dock's clear must
    // never erase the route, nor the route's clear the dock's approach.
    const onPath = vi.fn();
    const onDockPath = vi.fn();
    decodeTelemetryFrame(
      JSON.stringify({ type: "dock_path", points: [[1, 2], [1.5, 2.25]], stamp: 20 }),
      { onPath, onDockPath },
    );

    expect(onPath).not.toHaveBeenCalled();
    expect(onDockPath).toHaveBeenCalledOnce();
    const [{ points, stamp }] = onDockPath.mock.calls[0]!;
    // On the ground floor, as the route's triples: a dock is on the floor plan.
    expect(Array.from(points)).toEqual([1, 2, 0, 1.5, 2.25, 0]);
    expect(stamp).toBe(20);
  });

  it("passes an empty approach through as the clear", () => {
    const onDockPath = vi.fn();
    decodeTelemetryFrame(JSON.stringify({ type: "dock_path", points: [], stamp: 21 }), {
      onDockPath,
    });

    expect(onDockPath.mock.calls[0]![0].points).toHaveLength(0);
  });

  it("skips a malformed frame or an unknown type without throwing", () => {
    // The socket outlives any one frame; a backend newer than this console
    // may add a type, and that must not reach a handler or kill the stream.
    const onPath = vi.fn();
    expect(() => decodeTelemetryFrame("{", { onPath })).not.toThrow();
    decodeTelemetryFrame(JSON.stringify({ type: "battery", level: 0.5 }), { onPath });
    expect(onPath).not.toHaveBeenCalled();
  });
});

describe("a route frame", () => {
  /** The route the stream hands up for one `path` frame. */
  function received(points: unknown): PlannedPath | undefined {
    let path: PlannedPath | undefined;
    decodeTelemetryFrame(JSON.stringify({ type: "path", points, stamp: 7 }), {
      onPath: (p) => (path = p),
    });
    return path;
  }

  it("hands a route up as flat [x, y, z] triples", () => {
    const path = received([[0, 0, 0], [1, 2, 3]]);
    expect(Array.from(path!.points)).toEqual([0, 0, 0, 1, 2, 3]);
    expect(path!.stamp).toBe(7);
  });

  it("puts a route from a backend before z on the ground floor", () => {
    const path = received([[0, 0], [1, 2]]);
    expect(Array.from(path!.points)).toEqual([0, 0, 0, 1, 2, 0]);
  });

  it("hands an empty route up as the clear it is", () => {
    expect(received([])!.points.length).toBe(0);
  });
});
