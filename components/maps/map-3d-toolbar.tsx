"use client";

import {
  BanIcon,
  EraserIcon,
  MapPinIcon,
  MapPinPlusIcon,
  MapPinXIcon,
  MaximizeIcon,
  MousePointerClickIcon,
  MoveIcon,
  PaintbrushIcon,
  PentagonIcon,
  Redo2Icon,
  Rotate3dIcon,
  SaveIcon,
  SunMediumIcon,
  Trash2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import {
  ToolButton,
  ToolDivider,
  ToolGroup,
  ToolStrip,
  type ToolIcon,
} from "@/components/console/tool-strip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Map3dTool } from "@/components/maps/map-3d-canvas";
import { BRUSH_RADII_M } from "@/lib/map/ground-fill";

/*
 * The 3D view's controls, as two strips along the top like the floor plan
 * editor's (grid-toolbar.tsx), so the two views of one map are worked the
 * same way: choose what to edit on the right, then the tool on the left.
 *
 * Right, **Draw**: what a press on the map works on — nothing, ground
 * patches, waypoints or forbidden zones — beside the zoom. Left: fit and
 * shading, history, Save, then Orbit and the tools the Draw choice allows.
 * Save sends the patches and the forbidden zones drawn, merged or moved,
 * as the floor plan's Save does, and the waypoints placed, moved or deleted;
 * History is the patches' only. A zone is written as it is removed, as on
 * the floor plan.
 */

/** What a press on the 3D map works on, once chosen in the Draw list. */
export type Map3dDrawKind = "ground" | "waypoint" | "zone";

const DRAW_KINDS: readonly { value: Map3dDrawKind; label: string; icon: ToolIcon }[] = [
  { value: "ground", label: "Ground patch", icon: PaintbrushIcon },
  { value: "waypoint", label: "Waypoint", icon: MapPinIcon },
  // The floor plan's sign for it: what the zone means, its shape is the operator's.
  { value: "zone", label: "Forbidden zone", icon: BanIcon },
];

/** "Nothing chosen": base-ui wants a string per item. */
const NONE = "none";

const DRAW_ITEMS = [
  { value: NONE, label: "No type" },
  ...DRAW_KINDS.map((kind) => ({ value: kind.value, label: kind.label })),
];

const RADIUS_ITEMS = BRUSH_RADII_M.map((radius) => ({
  value: `${radius}`,
  label: `${radius.toFixed(1)} m`,
}));

/**
 * The left strip. Orbit is always offered — with nothing chosen it is the
 * only tool, lit, so the strip still says what a drag does. The radius shows
 * only while a brush is armed.
 */
export function Map3dToolBar({
  onFit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dirty,
  saving,
  writeLock = null,
  onSave,
  drawKind,
  tool,
  onToolChange,
  placeLock = null,
  zoneLock = null,
  radius,
  onRadiusChange,
  shading,
  onShadingChange,
  className,
}: {
  onFit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dirty: boolean;
  saving: boolean;
  /** Why nothing may be written (a job drives on the map), or null. */
  writeLock?: string | null;
  onSave: () => void;
  drawKind: Map3dDrawKind | null;
  tool: Map3dTool;
  onToolChange: (tool: Map3dTool) => void;
  /** Why no waypoint may be placed or removed (a job drives on the map), or null. */
  placeLock?: string | null;
  /** Why no forbidden zone may be drawn or removed (a job, or the zones unread), or null. */
  zoneLock?: string | null;
  /** Brush radius, metres; one of BRUSH_RADII_M. */
  radius: number;
  onRadiusChange: (radius: number) => void;
  /** Whether the 3D map is drawn with depth outlines (eye-dome lighting). */
  shading: boolean;
  onShadingChange: (shading: boolean) => void;
  className?: string;
}) {
  return (
    <ToolStrip label="Editor" compact className={className}>
      <ToolButton label="Fit to view" hint="the whole map, centred" icon={MaximizeIcon} onClick={onFit} />
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
                  ? "unsaved changes — record them on the robot"
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
          hint={
            drawKind === null
              ? "drag turns the map; choose a type to edit it"
              : "drag turns the map, right-drag pans, the wheel zooms"
          }
          icon={Rotate3dIcon}
          pressed={tool === "orbit"}
          onClick={() => onToolChange("orbit")}
        />
        {drawKind === "ground" && (
          <>
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
          </>
        )}
        {drawKind === "waypoint" && (
          <>
            <ToolButton
              label="Place"
              hint={placeLock ?? "press to place a waypoint, drag to aim it; right-drag to turn"}
              icon={MapPinPlusIcon}
              pressed={tool === "waypoint"}
              disabled={placeLock !== null}
              onClick={() => onToolChange("waypoint")}
            />
            <ToolButton
              label="Move"
              hint={placeLock ?? "drag a waypoint to put it somewhere else; it keeps its heading"}
              icon={MoveIcon}
              pressed={tool === "move"}
              disabled={placeLock !== null}
              onClick={() => onToolChange("move")}
            />
            <ToolButton
              label="Select"
              hint="press waypoints to select them, then delete them together from the list"
              icon={MousePointerClickIcon}
              pressed={tool === "select"}
              onClick={() => onToolChange("select")}
            />
            <ToolButton
              label="Remove"
              hint={placeLock ?? "press a waypoint to delete it from the robot"}
              icon={MapPinXIcon}
              tone="caution"
              pressed={tool === "remove"}
              disabled={placeLock !== null}
              onClick={() => onToolChange("remove")}
            />
          </>
        )}
        {drawKind === "zone" && (
          <>
            {/* A pentagon, not a square, as on the floor plan: the shape is whatever the corners make. */}
            <ToolButton
              label="Shape"
              hint={
                zoneLock ??
                "tap three or more corners on the floor shown, then the first one again to close; start on a zone's corner and end on another of its corners to grow or cut it; drag a corner to move it; Enter closes, Backspace takes the last corner back"
              }
              icon={PentagonIcon}
              pressed={tool === "zone"}
              disabled={zoneLock !== null}
              onClick={() => onToolChange("zone")}
            />
            <ToolButton
              label="Remove zone"
              hint={zoneLock ?? "tap a forbidden zone to delete it from the robot"}
              icon={Trash2Icon}
              tone="caution"
              pressed={tool === "zoneRemove"}
              disabled={zoneLock !== null}
              onClick={() => onToolChange("zoneRemove")}
            />
          </>
        )}
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

/**
 * The right strip: what a press works on, and the zoom. A list, as on the
 * floor plan editor; "No type" is its own item so putting the choice down is
 * visible (Escape does the same).
 */
export function Map3dDrawBar({
  drawKind,
  onDrawKindChange,
  onZoomIn,
  onZoomOut,
  className,
}: {
  drawKind: Map3dDrawKind | null;
  onDrawKindChange: (kind: Map3dDrawKind | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  className?: string;
}) {
  return (
    <ToolStrip label="Draw" compact className={className}>
      <Select
        items={DRAW_ITEMS}
        value={drawKind ?? NONE}
        onValueChange={(next) => {
          if (next === null) return;
          onDrawKindChange(next === NONE ? null : (next as Map3dDrawKind));
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Draw"
          title="What a press on the map works on"
          className="min-w-32 rounded-sm text-[12px] pointer-coarse:min-h-8"
        >
          <SelectValue />
        </SelectTrigger>
        {/* alignItemWithTrigger off, as on the floor plan editor: the default
          * lined the chosen item up over the trigger and grew the list upward. */}
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">No type</span>
          </SelectItem>
          {DRAW_KINDS.map((kind) => (
            <SelectItem key={kind.value} value={kind.value}>
              <kind.icon className="size-3.5" />
              {kind.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ToolDivider />

      <ToolGroup label="Zoom">
        <ToolButton label="Zoom out" hint="further" icon={ZoomOutIcon} onClick={onZoomOut} />
        <ToolButton label="Zoom in" hint="closer" icon={ZoomInIcon} onClick={onZoomIn} />
      </ToolGroup>
    </ToolStrip>
  );
}
