"use client";

import {
  BrushIcon,
  HandIcon,
  MapPinIcon,
  MapPinPlusIcon,
  MaximizeIcon,
  Redo2Icon,
  SlashIcon,
  SquareDashedMousePointerIcon,
  SquareIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { Chip, TONE_TEXT, overlayPanel, type Tone } from "@/components/console/instrument";
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
import { drawSwatch, type DrawKind, type EditTool, type VertexTool } from "@/lib/map/editor";

/*
 * The floor plan editor's controls, as two strips along the top of the canvas —
 * the dashboard viewport's arrangement, from the same primitives
 * (components/console/tool-strip.tsx).
 *
 * They used to be one card at top-left that grew row by row: a Grid / Waypoints
 * mode switch, a tool row, a Paint row, a Size row, then history, zoom and
 * Save. Every choice was a labelled row of the same weight, so the one that
 * decides what a press on the map *means* sat among the ones that only tune
 * it. The strips put that choice first.
 *
 * Left, **Draw**: what goes on the map — Wall, Floor, Unknown or Waypoint, or
 * nothing, which is where the editor opens — and then the tools that choice
 * allows. Right, **Editor**: what is done to the work as a whole — history,
 * Save, what is drawn, and the zoom at the outer edge as on the dashboard.
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
 * A paint kind's glyph: a square of the grey its cells are drawn in, so the
 * button shows the result rather than a metaphor for it. Bordered, because
 * Floor is near-white and would vanish on the light panel without one.
 */
function swatchIcon(kind: Exclude<DrawKind, "waypoint">): ToolIcon {
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
  hint: string;
  icon: ToolIcon;
}[] = [
  { value: "wall", label: "Wall", hint: "paint where the robot cannot go", icon: swatchIcon("wall") },
  { value: "floor", label: "Floor", hint: "paint where the robot can go", icon: swatchIcon("floor") },
  { value: "unknown", label: "Unknown", hint: "paint what was never seen", icon: swatchIcon("unknown") },
  { value: "waypoint", label: "Waypoint", hint: "place and edit waypoints", icon: MapPinIcon },
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

/**
 * The left strip: what a press on the map puts there, then how.
 *
 * Pressing the lit Draw button again puts it down, back to nothing chosen —
 * the same toggle the dashboard's pose tools use, and the same thing Escape
 * does. With nothing chosen the Tool group is Pan alone, lit, so the strip
 * still says what a drag does rather than going blank.
 *
 * Size sits after the tools and only while it means something: Brush and Line
 * lay down a stroke that wide, Rect fills its box whatever the size, and a
 * control that changes nothing is one an operator learns to distrust.
 */
export function EditorDrawBar({
  drawKind,
  onDrawKindChange,
  tool,
  onToolChange,
  vertexTool,
  onVertexToolChange,
  brush,
  onBrushChange,
  className,
}: {
  drawKind: DrawKind | null;
  onDrawKindChange: (kind: DrawKind | null) => void;
  tool: EditTool;
  onToolChange: (tool: EditTool) => void;
  vertexTool: VertexTool;
  onVertexToolChange: (tool: VertexTool) => void;
  brush: number;
  onBrushChange: (brush: number) => void;
  className?: string;
}) {
  const painting = drawKind !== null && drawKind !== "waypoint";
  const sized = painting && (tool === "brush" || tool === "line");

  return (
    <ToolStrip label="Draw" className={className}>
      <ToolGroup label="Draw">
        {DRAW_KINDS.map((kind) => (
          <span key={kind.value} className="contents">
            {/* Waypoints are not a cell value, so they sit apart from the
              * three that are. */}
            {kind.value === "waypoint" && <ToolDivider />}
            <ToolButton
              label={kind.label}
              hint={kind.hint}
              icon={kind.icon}
              pressed={drawKind === kind.value}
              onClick={() => onDrawKindChange(drawKind === kind.value ? null : kind.value)}
            />
          </span>
        ))}
      </ToolGroup>

      <ToolDivider />

      <ToolGroup label="Tool">
        {drawKind === null ? (
          <ToolButton
            label="Pan"
            hint="drag the map; choose what to draw to edit it"
            icon={HandIcon}
            pressed
            onClick={() => {}}
          />
        ) : drawKind === "waypoint" ? (
          VERTEX_TOOLS.map((option) => (
            <ToolButton
              key={option.value}
              label={option.label}
              hint={option.hint}
              icon={option.icon}
              pressed={vertexTool === option.value}
              onClick={() => onVertexToolChange(option.value)}
            />
          ))
        ) : (
          TOOLS.map((option) => (
            <ToolButton
              key={option.value}
              label={option.label}
              hint={option.hint}
              icon={option.icon}
              pressed={tool === option.value}
              onClick={() => onToolChange(option.value)}
            />
          ))
        )}
      </ToolGroup>

      {/* Cells, not pixels — the number is the count of cells across, which is
        * what you are actually deciding about. A list of the fixed sizes
        * rather than a slider: knowing you are painting exactly 7 cells is
        * worth more here than continuous control. `items` is what makes the
        * trigger show the label rather than the bare number. */}
      {sized && (
        <Select
          items={SIZE_ITEMS}
          value={`${brush}`}
          onValueChange={(next) => {
            if (next) onBrushChange(Number(next));
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Brush size"
            title="Brush size — how many cells across a stroke is"
            className="ml-0.5 rounded-sm text-[12px] pointer-coarse:min-h-10"
          >
            <SelectValue />
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
 * The right strip: what is done to the work as a whole, whatever is being drawn.
 *
 * Save stays whatever the Draw choice is, deliberately: the grid can be dirty
 * while waypoints are being placed, and hiding Save because the choice moved
 * is how unsaved cells get lost. It carries its words, unlike its neighbours,
 * because it is the one press here that writes to the robot.
 *
 * The Waypoints layer is the dashboard's layer toggle, for the editor's one
 * layer: on by default, hidden to paint under markers that are in the way,
 * and held on — pressed and greyed — while Waypoint is the Draw choice,
 * because placing or selecting stops you cannot see is not a thing to offer.
 * Like the dashboard's, it is left out on a map with no waypoints.
 */
export function EditorActionBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dirty,
  save,
  onSave,
  hasVertices,
  showVertices,
  verticesLocked,
  onToggleVertices,
  onFit,
  onZoomIn,
  onZoomOut,
  className,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dirty: boolean;
  save: SaveState;
  onSave: () => void;
  hasVertices: boolean;
  showVertices: boolean;
  /** Waypoint is the Draw choice, so the layer cannot be hidden. */
  verticesLocked: boolean;
  onToggleVertices: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  className?: string;
}) {
  const shown = showVertices || verticesLocked;
  return (
    <ToolStrip label="Editor" className={className}>
      <ToolGroup label="History">
        <ToolButton label="Undo" hint="take back the last stroke" icon={Undo2Icon} disabled={!canUndo} onClick={onUndo} />
        <ToolButton label="Redo" hint="put it back" icon={Redo2Icon} disabled={!canRedo} onClick={onRedo} />
      </ToolGroup>

      <ToolDivider />

      {dirty && <Chip tone="caution">Unsaved</Chip>}
      <button
        type="button"
        disabled={!dirty || save.kind === "saving"}
        onClick={onSave}
        className="instrument-label h-7 rounded-sm border border-signal-cmd/50 bg-signal-cmd/12 px-2.5 text-signal-cmd transition-colors hover:bg-signal-cmd/20 pointer-coarse:min-h-10 disabled:border-hairline disabled:bg-transparent disabled:text-muted-foreground"
      >
        {save.kind === "saving" ? "Saving…" : "Save"}
      </button>

      {hasVertices && (
        <>
          <ToolDivider />
          <ToolGroup label="Layers">
            <ToolButton
              label="Waypoints"
              hint={
                verticesLocked
                  ? "shown while placing waypoints"
                  : shown
                    ? "shown — press to hide"
                    : "hidden — press to show"
              }
              icon={MapPinIcon}
              pressed={shown}
              disabled={verticesLocked}
              onClick={onToggleVertices}
            />
          </ToolGroup>
        </>
      )}

      <ToolDivider />

      {/* Last, at the strip's outer edge, as on the dashboard. Zoom is
        * otherwise the wheel and, on a phone, the pinch; one press is a step
        * the operator can count. */}
      <ToolGroup label="Zoom">
        <ToolButton label="Fit to view" hint="the whole floor plan" icon={MaximizeIcon} onClick={onFit} />
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
