"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { useMapImage } from "@/hooks/use-map-image";
import { PALETTES } from "@/lib/map/draw";
import { drawWaypointPreview, previewView, waypointAt } from "@/lib/map/preview";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";
import { cn } from "@/lib/utils";

export interface WaypointPreviewProps {
  mapName: string;
  meta: MapMetadata;
  vertices: MapVertex[];
  /** The row's current pick, lit on the map; null when nothing is picked. */
  selectedId: string | null;
  disabled: boolean;
  onPick: (vertex: MapVertex) => void;
}

/**
 * The floor plan beside a MOVE row's waypoint picker.
 *
 * It exists because a name in a dropdown is not a place: by the time an
 * operator is composing a job they have forgotten which of `dock`, `v2` and
 * `room-a` is the one by the lift, and the only other way to find out was to
 * leave for the map editor. Every stop is drawn with its name, the row's pick
 * is lit, and a click on a marker picks it.
 *
 * The click is a mouse convenience, not the control: the Select next to it is
 * the keyboard and screen-reader path, which is why this is a `role="img"`
 * with a description and not a button. Drawing on change with one rAF, no
 * persistent loop — the same economy as the editor canvas, for the same reason
 * (this console can be running on the robot's own Jetson).
 */
export function WaypointPreview({
  mapName,
  meta,
  vertices,
  selectedId,
  disabled,
  onPick,
}: WaypointPreviewProps) {
  const { image } = useMapImage(mapName);
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef(0);
  // State, not a ref: the cursor and the accessible name branch on it, and it
  // only changes when the pointer crosses a marker's edge, not per move.
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  // What a frame needs, read at draw time so the draw callback stays stable
  // and a prop change does not rebuild the ResizeObserver below. Written in
  // the same effect that asks for the frame, so a resize between renders
  // still draws the latest values.
  const frameRef = React.useRef({ image, meta, vertices, selectedId, hoveredId, theme });

  const draw = React.useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const bounds = container.getBoundingClientRect();
    // A zero rect gives fitView scale 0; skip the frame rather than draw NaN.
    if (bounds.width < 1 || bounds.height < 1) return;
    const rect = { width: bounds.width, height: bounds.height };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(rect.width * dpr);
    const bh = Math.round(rect.height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // DPR here and nowhere else, so the hit test below works in the CSS pixels
    // the pointer event reports.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const frame = frameRef.current;
    drawWaypointPreview(
      ctx,
      rect,
      previewView(rect, frame.meta),
      frame.image,
      frame.meta,
      frame.vertices,
      { selectedId: frame.selectedId, hoveredId: frame.hoveredId },
      PALETTES[frame.theme],
    );
  }, []);

  const requestDraw = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  React.useEffect(() => {
    frameRef.current = { image, meta, vertices, selectedId, hoveredId, theme };
    requestDraw();
  }, [requestDraw, image, meta, vertices, selectedId, hoveredId, theme]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(requestDraw);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [requestDraw]);

  const stopAt = (event: React.PointerEvent | React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const rect = { width: bounds.width, height: bounds.height };
    if (rect.width < 1 || rect.height < 1) return null;
    return waypointAt(
      previewView(rect, meta),
      meta,
      vertices,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
  };

  const selectedName = vertices.find((vertex) => vertex.id === selectedId)?.name;
  const description = `Floor plan of ${mapName} with ${vertices.length} ${
    vertices.length === 1 ? "waypoint" : "waypoints"
  }${selectedName ? `; ${selectedName} is picked` : ""}.`;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-52 w-full overflow-hidden rounded-sm border border-hairline",
        hoveredId && !disabled && "cursor-pointer",
      )}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={description}
        className="block size-full"
        onPointerMove={(event) => {
          if (disabled) return;
          setHoveredId(stopAt(event)?.id ?? null);
        }}
        onPointerLeave={() => setHoveredId(null)}
        onClick={(event) => {
          if (disabled) return;
          const vertex = stopAt(event);
          if (vertex) onPick(vertex);
        }}
      />
    </div>
  );
}
