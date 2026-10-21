"use client";

import {
  MapPinPlusIcon,
  Rotate3dIcon,
  MaximizeIcon,
  SunMediumIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { ToolButton, ToolDivider, ToolGroup, ToolStrip } from "@/components/console/tool-strip";
import type { Map3dTool } from "@/components/maps/map-3d-canvas";

/*
 * The 3D map page's one strip, built like the floor plan editor's: the view
 * (fit, zoom, shading), then the tools — Orbit and Waypoint. Orbit first for
 * the floor plan editor's reason: the strip opens on it. No Save: a
 * waypoint is written as it is placed, as on the dashboard.
 */

export function Map3dToolBar({
  onFit,
  onZoomIn,
  onZoomOut,
  tool,
  onToolChange,
  placeLock = null,
  shading,
  onShadingChange,
  className,
}: {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  tool: Map3dTool;
  onToolChange: (tool: Map3dTool) => void;
  /** Why no waypoint may be placed (a job drives on the map), or null. */
  placeLock?: string | null;
  /** Whether the 3D map is drawn with depth outlines (eye-dome lighting). */
  shading: boolean;
  onShadingChange: (shading: boolean) => void;
  className?: string;
}) {
  return (
    <ToolStrip label="3D map" compact className={className}>
      <ToolButton label="Fit to view" hint="the whole map, centred" icon={MaximizeIcon} onClick={onFit} />
      <ToolGroup label="Zoom">
        <ToolButton label="Zoom in" hint="closer" icon={ZoomInIcon} onClick={onZoomIn} />
        <ToolButton label="Zoom out" hint="further" icon={ZoomOutIcon} onClick={onZoomOut} />
      </ToolGroup>
      <ToolButton
        label="Shading"
        hint="outline walls and steps by depth"
        icon={SunMediumIcon}
        pressed={shading}
        onClick={() => onShadingChange(!shading)}
      />

      <ToolDivider />

      <ToolGroup label="Tool">
        <ToolButton
          label="Orbit"
          hint="drag turns the map, right-drag pans, the wheel zooms"
          icon={Rotate3dIcon}
          pressed={tool === "orbit"}
          onClick={() => onToolChange("orbit")}
        />
        <ToolButton
          label="Waypoint"
          hint={placeLock ?? "press to place a waypoint, drag to aim it; right-drag to turn"}
          icon={MapPinPlusIcon}
          pressed={tool === "waypoint"}
          disabled={placeLock !== null}
          onClick={() => onToolChange(tool === "waypoint" ? "orbit" : "waypoint")}
        />
      </ToolGroup>
    </ToolStrip>
  );
}
