"use client";

import {
  BanIcon,
  BrushIcon,
  CheckIcon,
  HandIcon,
  MapPinIcon,
  MapPinPlusIcon,
  MaximizeIcon,
  PentagonIcon,
  Redo2Icon,
  SaveIcon,
  SlashIcon,
  SquareDashedMousePointerIcon,
  SquareIcon,
  Trash2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { TONE_TEXT, overlayPanel, type Tone } from "@/components/console/instrument";
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
import { cn } from "@/lib/utils";
import { BRUSH_SIZES } from "@/lib/map/grid";
import {
  drawSwatch,
  isPaintKind,
  type DrawKind,
  type EditTool,
  type PaintKind,
  type VertexTool,
  type ZoneTool,
} from "@/lib/map/editor";

/*
 * The floor plan editor's controls, as two strips along the top of the canvas
 * built from components/console/tool-strip.tsx, like the dashboard viewport.
 *
 * Right, **Draw**: what a press on the map means — nothing, Wall, Floor,
 * Unknown, Waypoint or Forbidden zone — beside the zoom. Left, **Editor**: fit,
 * history, Save, then the tools the Draw choice allows, led by Pan.
 *
 * The left strip holds only buttons: a read-only mark of the chosen kind there
 * read as a broken button.
 */

/**
 * One armable tool. Both tool rows are icons: silhouettes make the armed tool
 * legible at a glance, which matters because it is the difference between
 * dragging the map and painting on it. `label` is the accessible name and
 * tooltip, and is printed under the icon for a finger.
 */
interface ToolOption<T extends string> {
  value: T;
  label: string;
  /** The rest of the tooltip, after the label: what a press will do. */
  hint: string;
  icon: ToolIcon;
}

/*
 * Pan first: it is what the editor opens in (DEFAULT_TOOL), so the lit
 * segment rests at the start of the row. Line is a slash, since a dash reads
 * as minus / "remove".
 */
const TOOLS: readonly ToolOption<EditTool>[] = [
  { value: "pan", label: "Pan", hint: "drag the map", icon: HandIcon },
  { value: "brush", label: "Brush", hint: "paint cells freehand", icon: BrushIcon },
  { value: "line", label: "Line", hint: "drag a straight stroke", icon: SlashIcon },
  { value: "rect", label: "Rect", hint: "drag a filled rectangle", icon: SquareIcon },
];

/** Vertex mode's counterpart to TOOLS. Pan leads, for the same reason. */
const VERTEX_TOOLS: readonly ToolOption<VertexTool>[] = [
  { value: "pan", label: "Pan", hint: "drag the map", icon: HandIcon },
  { value: "place", label: "Place", hint: "press the map to add a waypoint", icon: MapPinPlusIcon },
  {
    value: "select",
    label: "Select",
    hint: "drag a box over waypoints; Shift-click or tap one to add it",
    icon: SquareDashedMousePointerIcon,
  },
];

/** Zone mode's. A pentagon, not a square: the shape is whatever the corners make. */
const ZONE_TOOLS: readonly ToolOption<ZoneTool>[] = [
  { value: "pan", label: "Pan", hint: "drag the map", icon: HandIcon },
  {
    value: "shape",
    label: "Shape",
    hint: "press three or more corners, then press the first one again to close; press a finished zone to select it",
    icon: PentagonIcon,
  },
];

/**
 * A paint kind's glyph: a square of its cells' grey, showing the result.
 * Bordered so near-white Floor doesn't vanish on the light panel.
 */
function swatchIcon(kind: PaintKind): ToolIcon {
  function Swatch({ className }: { className?: string }) {
    return (
      <span
        aria-hidden
        className={cn("block rounded-[2px] border border-foreground/40", className)}
        style={{ background: drawSwatch(kind), width: "0.875rem", height: "0.875rem" }}
      />
    );
  }
  return Swatch;
}

const DRAW_KINDS: readonly {
  value: DrawKind;
  label: string;
  icon: ToolIcon;
}[] = [
  { value: "wall", label: "Wall", icon: swatchIcon("wall") },
  { value: "floor", label: "Floor", icon: swatchIcon("floor") },
  { value: "unknown", label: "Unknown", icon: swatchIcon("unknown") },
  { value: "waypoint", label: "Waypoint", icon: MapPinIcon },
  // The "not here" sign: what the zone means, since its shape is the operator's.
  { value: "zone", label: "Forbidden zone", icon: BanIcon },
];

const SIZE_ITEMS = BRUSH_SIZES.map((size) => ({
  value: `${size}`,
  label: `${size} cell${size === 1 ? "" : "s"}`,
}));

/**
 * What the last save did, as a state rather than an event: "not saved" and
 * "saved but the robot is still on the old map" are rendered in place, since
 * anything that auto-dismisses would dismiss the one message that matters.
 */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  /** Written to disk. `reloaded` is whether the running stack picked it up. */
  | { kind: "saved"; active: boolean; reloaded: boolean; message: string }
  | { kind: "failed"; message: string };

/**
 * What a save wrote. One Save writes whichever have changes, and each reports
 * in its own note, since any can land while another fails.
 */
export type SaveSubject = "grid" | "zones" | "zonesRemoved" | "waypoints";

const SAVE_COPY: Record<
  SaveSubject,
  { failed: string; reloaded: string; saved: string; stale: string }
> = {
  grid: {
    failed: "Not saved",
    reloaded: "Saved · map reloaded",
    saved: "Saved",
    stale: "Saved to disk — the robot is still using the old map.",
  },
  zones: {
    failed: "Forbidden zones not saved",
    reloaded: "Forbidden zones saved · in force now",
    saved: "Forbidden zones saved",
    stale: "Forbidden zones saved — the robot is still keeping to the old ones.",
  },
  // Remove writes at once; "saved" would imply the other edits went with it.
  zonesRemoved: {
    failed: "Forbidden zone not removed",
    reloaded: "Removed · in force now",
    saved: "Removed",
    stale: "Removed — the robot is still keeping to the old zones.",
  },
  // A waypoint write has no reload to report; the note carries what it wrote.
  waypoints: {
    failed: "Waypoints not saved",
    reloaded: "Waypoints saved",
    saved: "Waypoints saved",
    stale: "Waypoints saved",
  },
};

/**
 * `active` keeps this from crying wolf: `reloaded: false` is benign for a map
 * the robot isn't running and serious for the one it is. Zones answer in the
 * same two fields.
 */
function saveNote(
  save: SaveState,
  subject: SaveSubject,
): { tone: Tone; headline: string; detail?: string; alert: boolean } | null {
  const copy = SAVE_COPY[subject];
  if (save.kind === "failed") {
    return { tone: "warn", headline: copy.failed, detail: save.message, alert: true };
  }
  if (save.kind !== "saved") return null;
  if (save.reloaded) {
    return { tone: "live", headline: copy.reloaded, alert: false };
  }
  if (!save.active) {
    return { tone: "neutral", headline: copy.saved, detail: save.message, alert: false };
  }
  return {
    tone: "caution",
    headline: copy.stale,
    detail: save.message,
    alert: false,
  };
}


/** "Nothing chosen": base-ui wants a string per item. */
const NONE = "none";

const DRAW_ITEMS = [
  { value: NONE, label: "No type" },
  ...DRAW_KINDS.map((kind) => ({ value: kind.value, label: kind.label })),
];

/**
 * The left strip: acting on the work, then drawing on it. Fit leads (the
 * first thing reached for when lost in a zoom); Save shows its state by being
 * greyed or carrying a caution dot.
 *
 * Pan is always offered — with nothing chosen it is the only tool, lit, so
 * the strip still says what a drag does. Size shows only for Brush and Line.
 */
export function EditorToolBar({
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
  vertexTool,
  onVertexToolChange,
  zoneTool,
  onZoneToolChange,
  canCloseZone,
  onCloseZone,
  selectedZones,
  zoneWriting,
  removingZones,
  onRemoveZone,
  brush,
  onBrushChange,
  className,
}: {
  onFit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Anything unsaved: cells, zones, waypoints, or any mix. */
  dirty: boolean;
  /** A write of any of them is in flight. */
  saving: boolean;
  /** Why nothing may be written (a job is driving on the map), or null. Holds Save and Remove. */
  writeLock?: string | null;
  onSave: () => void;
  drawKind: DrawKind | null;
  tool: EditTool;
  onToolChange: (tool: EditTool) => void;
  vertexTool: VertexTool;
  onVertexToolChange: (tool: VertexTool) => void;
  zoneTool: ZoneTool;
  onZoneToolChange: (tool: ZoneTool) => void;
  /** The shape in flight has enough corners for Done to close it. */
  canCloseZone: boolean;
  onCloseZone: () => void;
  /** How many finished zones are selected for Remove to take. */
  selectedZones: number;
  /** A zone write — Save's or Remove's — is in flight; Remove waits for it. */
  zoneWriting: boolean;
  /** The write in flight is a Remove (the spinner's cue). */
  removingZones: boolean;
  onRemoveZone: () => void;
  brush: number;
  onBrushChange: (brush: number) => void;
  className?: string;
}) {
  const painting = isPaintKind(drawKind);
  const sized = painting && (tool === "brush" || tool === "line");
  const panPressed =
    drawKind === null ||
    (drawKind === "waypoint"
      ? vertexTool === "pan"
      : drawKind === "zone"
        ? zoneTool === "pan"
        : tool === "pan");

  return (
    <ToolStrip label="Editor" compact className={className}>
      <ToolButton label="Fit to view" hint="the whole floor plan, centred" icon={MaximizeIcon} onClick={onFit} />

      <ToolDivider />

      <ToolGroup label="History">
        <ToolButton label="Undo" hint="take back the last edit" icon={Undo2Icon} disabled={!canUndo} onClick={onUndo} />
        <ToolButton label="Redo" hint="put it back" icon={Redo2Icon} disabled={!canRedo} onClick={onRedo} />
      </ToolGroup>

      <ToolDivider />

      {/* The unsaved dot is for the eye; the hint and enabled state carry it
        * to a screen reader. */}
      <span className="relative flex">
        <ToolButton
          label="Save"
          hint={
            saving
              ? "saving…"
              : writeLock
                ? writeLock
                : dirty
                  ? "unsaved changes — write them to the robot"
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
          label="Pan"
          hint={drawKind === null ? "drag the map; choose a type to edit it" : "drag the map"}
          icon={HandIcon}
          pressed={panPressed}
          onClick={() => {
            if (drawKind === "waypoint") onVertexToolChange("pan");
            else if (drawKind === "zone") onZoneToolChange("pan");
            else onToolChange("pan");
          }}
        />
        {painting &&
          TOOLS.filter((option) => option.value !== "pan").map((option) => (
            <ToolButton
              key={option.value}
              label={option.label}
              hint={option.hint}
              icon={option.icon}
              pressed={tool === option.value}
              onClick={() => onToolChange(option.value)}
            />
          ))}
        {drawKind === "waypoint" &&
          VERTEX_TOOLS.filter((option) => option.value !== "pan").map((option) => (
            <ToolButton
              key={option.value}
              label={option.label}
              hint={option.hint}
              icon={option.icon}
              pressed={vertexTool === option.value}
              onClick={() => onVertexToolChange(option.value)}
            />
          ))}
        {drawKind === "zone" && (
          <>
            {ZONE_TOOLS.filter((option) => option.value !== "pan").map((option) => (
              <ToolButton
                key={option.value}
                label={option.label}
                hint={option.hint}
                icon={option.icon}
                pressed={zoneTool === option.value}
                onClick={() => onZoneToolChange(option.value)}
              />
            ))}
            {/* Done belongs to the shape in flight, so it sits beside the tool;
              * it is also how a finger (no Enter key) closes a shape whose
              * first corner is under a panel. */}
            <ToolButton
              label="Done"
              hint={canCloseZone ? "close the shape" : "needs three corners first"}
              icon={CheckIcon}
              disabled={!canCloseZone}
              onClick={onCloseZone}
            />
            {/* Removes every selected zone, off the robot too, without Save —
              * the touch form of Delete / Backspace. */}
            <ToolButton
              label="Remove"
              hint={
                selectedZones === 0
                  ? "press a zone with Shape armed to select it, Shift-press to select more"
                  : selectedZones === 1
                    ? "remove the selected zone from the robot"
                    : `remove the ${selectedZones} selected zones from the robot`
              }
              icon={Trash2Icon}
              tone="caution"
              busy={removingZones}
              disabled={selectedZones === 0 || zoneWriting || writeLock !== null}
              onClick={onRemoveZone}
            />
          </>
        )}
      </ToolGroup>

      {/* Cells across, from fixed sizes rather than a slider: knowing it is
        * exactly 7 cells is worth more than continuous control. */}
      {sized && (
        <Select
          items={SIZE_ITEMS}
          value={`${brush}`}
          onValueChange={(next) => {
            if (next) onBrushChange(Number(next));
          }}
        >
          {/* 32 px under a finger, matching the compact buttons beside it. */}
          <SelectTrigger
            size="sm"
            aria-label="Brush size"
            title="Brush size — how many cells across a stroke is"
            className="ml-0.5 rounded-sm text-[12px] pointer-coarse:min-h-8"
          >
            {/* The bare number below sm, by request: "7 cells" pushed the
              * strip to a second row on a phone. */}
            <SelectValue>
              {(value: string | null) =>
                value === null ? null : (
                  <>
                    {value}
                    {/* A margin, not a leading space: flex drops it. */}
                    <span className="ml-1 max-sm:hidden">
                      {value === "1" ? "cell" : "cells"}
                    </span>
                  </>
                )
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SIZE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </ToolStrip>
  );
}

/**
 * The right strip: what a press puts on the map, and the zoom. A list since
 * it is one of six choices changed rarely; "No type" is its own item so
 * putting the choice down is visible (Escape does the same).
 */
export function EditorDrawBar({
  drawKind,
  onDrawKindChange,
  zonesLocked = false,
  onZoomIn,
  onZoomOut,
  className,
}: {
  drawKind: DrawKind | null;
  onDrawKindChange: (kind: DrawKind | null) => void;
  /**
   * The map's saved zones couldn't be read, so Forbidden zone is not
   * choosable: a zone saved now would replace the robot's whole list.
   */
  zonesLocked?: boolean;
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
          onDrawKindChange(next === NONE ? null : (next as DrawKind));
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Draw"
          title="What a press on the map puts there"
          className="min-w-32 rounded-sm text-[12px] pointer-coarse:min-h-8"
        >
          <SelectValue />
        </SelectTrigger>
        {/* alignItemWithTrigger off: the default lined the chosen item up over
          * the trigger, so the list grew upward off the map. */}
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">No type</span>
          </SelectItem>
          {DRAW_KINDS.map((kind) => (
            <SelectItem
              key={kind.value}
              value={kind.value}
              disabled={zonesLocked && kind.value === "zone"}
            >
              <kind.icon className="size-3.5" />
              {kind.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ToolDivider />

      {/* At the outer edge, as on the dashboard; besides wheel and pinch. */}
      <ToolGroup label="Zoom">
        <ToolButton label="Zoom out" hint="one step back" icon={ZoomOutIcon} onClick={onZoomOut} />
        <ToolButton label="Zoom in" hint="one step closer" icon={ZoomInIcon} onClick={onZoomIn} />
      </ToolGroup>
    </ToolStrip>
  );
}

/** What the last save did, under the right strip, until the buffer moves on (see SaveState). */
export function SaveNote({
  save,
  subject = "grid",
  className,
}: {
  save: SaveState;
  subject?: SaveSubject;
  className?: string;
}) {
  const note = saveNote(save, subject);
  if (!note) return null;
  return (
    <p
      role={note.alert ? "alert" : "status"}
      className={cn(
        overlayPanel,
        "px-2 py-1.5 text-[11px] leading-tight",
        note.tone === "neutral" ? "text-muted-foreground" : TONE_TEXT[note.tone],
        className,
      )}
    >
      {note.headline}
      {note.detail && <span className="mt-0.5 block text-muted-foreground">{note.detail}</span>}
    </p>
  );
}

/*
 * No hint line, by request. The gestures still work: right- and middle-drag
 * pan in every mode, Space pans while held, Escape puts the Draw choice down,
 * 0 fits, scroll zooms.
 */
