"use client";

import {
  BoxIcon,
  EraserIcon,
  MapIcon,
  HandIcon,
  MaximizeIcon,
  PaintbrushIcon,
  Redo2Icon,
  SaveIcon,
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

export type GroundView = "2d" | "3d";

/*
 * The ground editor's one strip, built like the floor plan editor's: fit,
 * history, Save, then the tools — Pan, Fill, Erase — and the brush radius.
 * Pan first for the floor plan editor's reason: the strip opens on it.
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
  radius,
  onRadiusChange,
  view,
  onViewChange,
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
  /** Brush radius, metres; one of BRUSH_RADII_M. */
  radius: number;
  onRadiusChange: (radius: number) => void;
  /** From above, to paint on, or in 3D, to look around. */
  view: GroundView;
  onViewChange: (view: GroundView) => void;
  className?: string;
}) {
  // The brush paints on the view from above; in 3D the tools wait for it.
  const paintLock = view === "3d" ? "switch to 2D to paint" : null;
  return (
    <ToolStrip label="Ground" compact className={className}>
      <ToolGroup label="View">
        <ToolButton label="2D" hint="from above — where the brush paints" icon={MapIcon} pressed={view === "2d"} onClick={() => onViewChange("2d")} />
        <ToolButton label="3D" hint="look around: drag orbits, right-drag pans" icon={BoxIcon} pressed={view === "3d"} onClick={() => onViewChange("3d")} />
      </ToolGroup>

      <ToolDivider />

      <ToolButton label="Fit to view" hint="the whole map, centred" icon={MaximizeIcon} onClick={onFit} />
      <ToolGroup label="Zoom">
        <ToolButton label="Zoom in" hint="closer" icon={ZoomInIcon} onClick={onZoomIn} />
        <ToolButton label="Zoom out" hint="further" icon={ZoomOutIcon} onClick={onZoomOut} />
      </ToolGroup>

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
        <ToolButton label="Pan" hint={paintLock ?? "drag the map"} icon={HandIcon} pressed={view === "2d" && tool === "pan"} disabled={paintLock !== null} onClick={() => onToolChange("pan")} />
        <ToolButton
          label="Fill"
          hint={
            paintLock ??
            "paint floor into the holes under the brush, at the height of the floor around them; hold Shift to erase"
          }
          icon={PaintbrushIcon}
          pressed={view === "2d" && tool === "fill"}
          disabled={paintLock !== null}
          onClick={() => onToolChange("fill")}
        />
        <ToolButton
          label="Erase"
          hint={paintLock ?? "take your patches back out from under the brush"}
          icon={EraserIcon}
          tone="caution"
          pressed={view === "2d" && tool === "erase"}
          disabled={paintLock !== null}
          onClick={() => onToolChange("erase")}
        />
      </ToolGroup>

      {view === "2d" && tool !== "pan" && (
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
