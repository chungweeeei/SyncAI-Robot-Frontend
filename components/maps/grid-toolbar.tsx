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
 * The floor plan editor's controls, as two strips along the top of the canvas —
 * the dashboard viewport's arrangement, from the same primitives
 * (components/console/tool-strip.tsx).
 *
 * They used to be one card at top-left that grew row by row: a Grid / Waypoints
 * mode switch, a tool row, a Paint row, a Size row, then history, zoom and
 * Save. Every choice was a labelled row of the same weight.
 *
 * Right, **Draw**: the one choice that decides what a press on the map means —
 * nothing (where the editor opens), Wall, Floor, Unknown, Waypoint or Forbidden
 * zone — as a list, beside the zoom at the outer edge. Left, **Editor**: everything that
 * acts on the work — fit the view, history, Save — and then the tools the Draw
 * choice allows, led by Pan, which is always there.
 *
 * The left strip holds nothing but buttons. A read-only mark of the chosen kind
 * used to stand between Pan and that kind's tools; it was removed because an
 * icon the same size and in the same row as its neighbours reads as a button
 * that does not work. The Draw list names the choice, which is where it is made.
 */

/**
 * One armable tool: what it is worth, what it does, and the shape it wears.
 *
 * Both tool rows are icons, and for the same reason. Four or five verbs of
 * similar length and similar shape, set in the same condensed caps as every
 * other label in a 224 px panel, are a row of grey text that has to be read
 * before it can be used; a hand, a brush, a stroke and a square are four
 * silhouettes, and which one is armed is legible from the shape alone. That
 * matters most here, because the armed tool is the whole difference between
 * dragging the map and painting on it — the trade that DEFAULT_TOOL and
 * DEFAULT_VERTEX_TOOL exist to make safe.
 *
 * `label` is not lost by that: it is the accessible name and half the tooltip,
 * and a finger reads it printed under the icon. Nothing here is icon-only.
 */
interface ToolOption<T extends string> {
  value: T;
  label: string;
  /** The rest of the tooltip, after the label: what a press will do. */
  hint: string;
  icon: ToolIcon;
}

/*
 * Pan is first because it is what the editor opens in (see DEFAULT_TOOL in
 * map-grid-editor.tsx). The row reads left-to-right as "here is where you
 * start, here is what you can arm", and leaving Pan in the trailing slot it
 * used to occupy would put the lit segment at the far end of the row on load —
 * which reads as an odd leftover setting rather than a deliberate resting state.
 *
 * Line is a slash rather than a dash: a horizontal bar is the minus glyph and
 * reads as "remove", which is the one thing no tool on this row does.
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

/**
 * Zone mode's. A pentagon rather than Rect's square, because the shape is
 * whatever the operator's corners make it, and a square would promise the
 * one thing this tool does not draw.
 */
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
 * A paint kind's glyph: a square of the grey its cells are drawn in, so the
 * button shows the result rather than a metaphor for it. Bordered, because
 * Floor is near-white and would vanish on the light panel without one.
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
  // The "not here" sign: what the zone means, since its shape is the
  // operator's to draw.
  { value: "zone", label: "Forbidden zone", icon: BanIcon },
];

const SIZE_ITEMS = BRUSH_SIZES.map((size) => ({
  value: `${size}`,
  label: `${size} cell${size === 1 ? "" : "s"}`,
}));

/**
 * What the last save attempt did, as a state rather than an event.
 *
 * The two things an operator must not miss — "not saved" and "saved but the
 * robot is still on the old map" — are properties of the editor as it stands,
 * so they are rendered in place next to the Unsaved chip. A toast is the wrong
 * container for them (and there is none in this app): anything that
 * auto-dismisses is guaranteed to dismiss the one message that matters.
 */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  /** Written to disk. `reloaded` is whether the running stack picked it up. */
  | { kind: "saved"; active: boolean; reloaded: boolean; message: string }
  | { kind: "failed"; message: string };

/**
 * `active` is what keeps this from crying wolf: `reloaded: false` covers both
 * "this isn't the map the stack is running, so of course nothing reloaded"
 * (benign, and shouting at it teaches operators to ignore the shout) and "it IS
 * the running map and load_map failed" (the case this whole surface exists for).
 */
function saveNote(
  save: SaveState,
): { tone: Tone; headline: string; detail?: string; alert: boolean } | null {
  if (save.kind === "failed") {
    return { tone: "warn", headline: "Not saved", detail: save.message, alert: true };
  }
  if (save.kind !== "saved") return null;
  if (save.reloaded) {
    return { tone: "live", headline: "Saved · map reloaded", alert: false };
  }
  if (!save.active) {
    return { tone: "neutral", headline: "Saved", detail: save.message, alert: false };
  }
  return {
    tone: "caution",
    headline: "Saved to disk — the robot is still using the old map.",
    detail: save.message,
    alert: false,
  };
}


/** The list's value for "nothing chosen": base-ui wants a string per item. */
const NONE = "none";

const DRAW_ITEMS = [
  { value: NONE, label: "No type" },
  ...DRAW_KINDS.map((kind) => ({ value: kind.value, label: kind.label })),
];

/**
 * The left strip: acting on the work, then drawing on it.
 *
 * Fit leads, because "put the whole floor plan back in front of me" is the
 * first thing reached for after getting lost in a zoom. Save is an icon here
 * like its neighbours; what it cannot say by shape it says by state — greyed
 * with nothing to save, and a caution dot while there is.
 *
 * Pan is always offered, whatever is chosen, and with nothing chosen it is the
 * only tool, lit, so the strip still says what a drag does. Size follows only
 * while it means something: Brush and Line lay down a stroke that wide, Rect
 * fills its box whatever the size.
 */
export function EditorToolBar({
  onFit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dirty,
  save,
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
  canRemoveZone,
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
  dirty: boolean;
  save: SaveState;
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
  /** A finished zone is selected for Remove to take. */
  canRemoveZone: boolean;
  onRemoveZone: () => void;
  brush: number;
  onBrushChange: (brush: number) => void;
  className?: string;
}) {
  const painting = isPaintKind(drawKind);
  const sized = painting && (tool === "brush" || tool === "line");
  const saving = save.kind === "saving";
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
        <ToolButton label="Undo" hint="take back the last stroke" icon={Undo2Icon} disabled={!canUndo} onClick={onUndo} />
        <ToolButton label="Redo" hint="put it back" icon={Redo2Icon} disabled={!canRedo} onClick={onRedo} />
      </ToolGroup>

      <ToolDivider />

      {/* The dot is the old Unsaved chip, shrunk to fit an icon strip. It is
        * decoration for the eye; the button's own hint and its enabled state
        * carry the same fact to a screen reader. */}
      <span className="relative flex">
        <ToolButton
          label="Save"
          hint={saving ? "saving…" : dirty ? "unsaved changes — write them to the robot" : "nothing to save"}
          icon={SaveIcon}
          busy={saving}
          disabled={!dirty || saving}
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
            {/* The one one-shot action in the Tool group, unlike Fit and
              * Save at the strip's head: it belongs to the shape in flight,
              * so it sits beside the tool that makes one. It is also how a
              * finger, which has no Enter key, closes a shape whose first
              * corner has ended up under a panel. */}
            <ToolButton
              label="Done"
              hint={canCloseZone ? "close the shape" : "needs three corners first"}
              icon={CheckIcon}
              disabled={!canCloseZone}
              onClick={onCloseZone}
            />
            {/* Remove is the zone's only edit: a mis-drawn shape is redrawn,
              * not reshaped. Delete and Backspace do the same from the
              * keyboard; this is the button a finger has. */}
            <ToolButton
              label="Remove"
              hint={canRemoveZone ? "remove the selected zone" : "press a zone with Shape armed to select it"}
              icon={Trash2Icon}
              tone="caution"
              disabled={!canRemoveZone}
              onClick={onRemoveZone}
            />
          </>
        )}
      </ToolGroup>

      {/* Cells, not pixels — the number is the count of cells across, which is
        * what you are actually deciding about. A list of the fixed sizes
        * rather than a slider: knowing you are painting exactly 7 cells is
        * worth more here than continuous control. */}
      {sized && (
        <Select
          items={SIZE_ITEMS}
          value={`${brush}`}
          onValueChange={(next) => {
            if (next) onBrushChange(Number(next));
          }}
        >
          {/* 32 px under a finger, the height of the compact buttons beside
            * it, so the strip does not grow by the one control that is taller. */}
          <SelectTrigger
            size="sm"
            aria-label="Brush size"
            title="Brush size — how many cells across a stroke is"
            className="ml-0.5 rounded-sm text-[12px] pointer-coarse:min-h-8"
          >
            {/* The bare number below sm, by request: "7 cells" was the one
              * control that pushed the strip to a second row on a phone, and
              * the trigger's name and the open list still say what it counts. */}
            <SelectValue>
              {(value: string | null) =>
                value === null ? null : (
                  <>
                    {value}
                    {/* A margin, not a leading space: SelectValue is a flex
                      * row, and a flex item's leading space is dropped. */}
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
 * The right strip: what a press puts on the map, and the zoom.
 *
 * A list rather than a row of buttons because it is one choice among six and
 * changed rarely compared with the tools, so it can cost a click to open;
 * "No type" is an item of its own, so putting the choice down is as visible as
 * picking one (Escape does the same). Each item wears the mark the left strip
 * will show for it.
 */
export function EditorDrawBar({
  drawKind,
  onDrawKindChange,
  onZoomIn,
  onZoomOut,
  className,
}: {
  drawKind: DrawKind | null;
  onDrawKindChange: (kind: DrawKind | null) => void;
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
        <SelectContent>
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

      {/* At the strip's outer edge, as on the dashboard. Zoom is otherwise the
        * wheel and, on a phone, the pinch; one press is a step to count. */}
      <ToolGroup label="Zoom">
        <ToolButton label="Zoom out" hint="one step back" icon={ZoomOutIcon} onClick={onZoomOut} />
        <ToolButton label="Zoom in" hint="one step closer" icon={ZoomInIcon} onClick={onZoomIn} />
      </ToolGroup>
    </ToolStrip>
  );
}

/**
 * What the last save did, under the right strip — in place and until the
 * buffer moves on, for the reason SaveState gives.
 */
export function SaveNote({ save, className }: { save: SaveState; className?: string }) {
  const note = saveNote(save);
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
 * The keyboard/mouse hint line that used to close the old card was removed on
 * request, and stays removed. The gestures it documented are all still live —
 * right-drag and middle-drag pan in every mode, Space pans while held, Escape
 * puts the Draw choice down, 0 fits, scroll zooms.
 */
