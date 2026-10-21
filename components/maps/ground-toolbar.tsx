"use client";

import {
  EraserIcon,
  MapPinPlusIcon,
  Rotate3dIcon,
  MaximizeIcon,
  PaintbrushIcon,
  Redo2Icon,
  SaveIcon,
  SunMediumIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { ToolButton, ToolDivider, ToolGroup, ToolStrip } from "@/components/console/tool-strip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GroundTool } from "@/components/maps/ground-canvas";
import { BRUSH_RADII_M } from "@/lib/map/ground-fill";

/*
 * The ground editor's one strip, built like the floor plan editor's: fit,
 * history, Save, then the tools — Orbit, Fill, Erase, Waypoint — and the
 * brush radius. Orbit first for the floor plan editor's reason: the strip
 * opens on it. History and Save are the patches' only: a waypoint is written
 * as it is placed, as on the dashboard.
 */

const RADIUS_ITEMS = BRUSH_RADII_M.map((radius) => ({
  value: `${radius}`,
  label: `${radius.toFixed(1)} m`,
}));

export function GroundToolBar({
  onFit,
  onZoomIn,
  onZoomOut,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dirty,
  saving,
  writeLock = null,
  onSave,
  tool,
  onToolChange,
  placeLock = null,
  radius,
  onRadiusChange,
  shading,
  onShadingChange,
  className,
}: {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dirty: boolean;
  saving: boolean;
  /** Why nothing may be written (a job drives on the map), or null. */
  writeLock?: string | null;
  onSave: () => void;
  tool: GroundTool;
  onToolChange: (tool: GroundTool) => void;
  /** Why no waypoint may be placed (a job drives on the map), or null. */
  placeLock?: string | null;
  /** Brush radius, metres; one of BRUSH_RADII_M. */
  radius: number;
  onRadiusChange: (radius: number) => void;
  /** Whether the 3D map is drawn with depth outlines (eye-dome lighting). */
  shading: boolean;
  onShadingChange: (shading: boolean) => void;
  className?: string;
}) {
  return (
    <ToolStrip label="Ground" compact className={className}>
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

      <ToolGroup label="History">
        <ToolButton label="Undo" hint="take back the last stroke" icon={Undo2Icon} disabled={!canUndo} onClick={onUndo} />
        <ToolButton label="Redo" hint="put it back" icon={Redo2Icon} disabled={!canRedo} onClick={onRedo} />
      </ToolGroup>

      <ToolDivider />

      <span className="relative flex">
        <ToolButton
          label="Save"
          hint={
            saving
              ? "saving…"
              : writeLock
                ? writeLock
                : dirty
                  ? "unsaved patches — record them on the robot"
                  : "nothing to save"
          }
          icon={SaveIcon}
          busy={saving}
          disabled={!dirty || saving || writeLock !== null}
          onClick={onSave}
        />
        {dirty && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-signal-caution"
          />
        )}
      </span>

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
          label="Fill"
          hint="paint floor into the holes under the brush, at the height of the floor around them; hold Shift to erase, right-drag to turn"
          icon={PaintbrushIcon}
          pressed={tool === "fill"}
          onClick={() => onToolChange("fill")}
        />
        <ToolButton
          label="Erase"
          hint="take your patches back out from under the brush"
          icon={EraserIcon}
          tone="caution"
          pressed={tool === "erase"}
          onClick={() => onToolChange("erase")}
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

      {(tool === "fill" || tool === "erase") && (
        <>
          <ToolDivider />
          <Select value={`${radius}`} onValueChange={(value) => onRadiusChange(Number(value))}>
            <SelectTrigger aria-label="Brush radius" size="sm" className="h-7 w-[5.5rem] pointer-coarse:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RADIUS_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </ToolStrip>
  );
}
