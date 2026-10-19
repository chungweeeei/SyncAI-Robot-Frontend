"use client";

import * as React from "react";
import { ChevronDownIcon, LocateFixedIcon, SearchIcon, Trash2Icon } from "lucide-react";

import { Chip, Readout, overlayPanel } from "@/components/console/instrument";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VertexChanges } from "@/lib/api/vertex";
import { VERTEX_TYPES, vertexGlyph } from "@/lib/map/vertex";
import { cn } from "@/lib/utils";
import type { MapVertex, VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * The waypoint layer's operator surface: place, name, classify, re-aim,
 * delete. It floats on the viewport (top right; the toolbar and GridStatus
 * own the left corners) so the readback sits beside the gesture on the map.
 *
 * Presentation only: Create, Apply and Delete change the shell's staged list,
 * each undoable, and nothing reaches the robot until the toolbar's Save (see
 * hooks/use-map-vertices.ts). `pendingIds` marks the unsaved rows.
 */

const TYPE_OPTIONS = VERTEX_TYPES.map(({ value, label }) => ({ value, label }));

export interface VertexPanelProps {
  vertices: MapVertex[];
  status: "loading" | "ok" | "error";
  /** Why the list cannot be edited. Rendered verbatim. */
  error: string | null;
  /** A save is in flight; holds the staging controls until it answers. */
  busy: boolean;
  /**
   * The list couldn't be loaded, so nothing may be staged against it. A job on
   * the map does *not* set this — that holds Save, and staging goes on.
   */
  locked?: boolean;
  /** Rows Save would write — placed or changed since the last save. */
  pendingIds: ReadonlySet<string>;

  /** The type the next placed vertex gets. */
  type: VertexType;
  onTypeChange: (type: VertexType) => void;

  /** A staged, uncreated vertex. Mutually exclusive with `selected` in practice. */
  draft: PlanarPose | null;
  /** The subject of the editing form: the selection, when it holds exactly one. */
  selected: MapVertex | null;
  /**
   * Everything the Select tool's band highlighted. At one entry the form shows;
   * at more, the band block, since only Delete means anything across a set.
   */
  selectedIds: readonly string[];
  /**
   * An unwritten re-aim of `selected`, from a drag on its marker. Moves live
   * elsewhere — see `stagedPose` in MapGridEditor.
   */
  stagedPose: PlanarPose | null;

  /** Where the robot is standing on this map, or null when it cannot be used. */
  robotPose: PlanarPose | null;
  /** Why `robotPose` is null. Shown under the disabled control; see useRobotMapPose. */
  robotPoseReason: string | null;
  /** Stage a draft at `robotPose`. Only called while it is non-null. */
  onUseRobotPose: () => void;

  onSelect: (id: string | null) => void;
  onCancelDraft: () => void;
  /** Drop the band selection without touching anything on the map. */
  onClearSelection: () => void;
  onCreate: (name: string, type: VertexType) => void;
  /** Stage the form's changes on the selected row. */
  onApply: (changes: VertexChanges) => void;
  /** Deletes everything in `selectedIds` — one vertex from the form, or a band. */
  onDelete: () => void;
  className?: string;
}

export function VertexPanel(props: VertexPanelProps) {
  const { vertices, status, error, draft, selected, selectedIds, className } = props;
  const band = selectedIds.length > 1;
  /**
   * Whether the waypoint list is open. Shut by default, by request: dozens of
   * rows would cover the canvas, and the header keeps the count. Held here so
   * it survives opening and closing a row.
   */
  const [listOpen, setListOpen] = React.useState(false);
  const listView = !draft && !band && !selected;
  const listId = React.useId();

  const count =
    status === "loading" ? (
      <Chip>Loading</Chip>
    ) : (
      <Chip tone={vertices.length ? "neutral" : "caution"}>{vertices.length}</Chip>
    );

  return (
    <div className={cn(overlayPanel, "flex w-60 flex-col gap-2 p-2.5", className)}>
      {listView && vertices.length > 0 ? (
        <button
          type="button"
          aria-expanded={listOpen}
          aria-controls={listId}
          onClick={() => setListOpen((open) => !open)}
          className="-mx-1 flex h-5 items-center justify-between gap-2 rounded-sm px-1 transition-colors pointer-coarse:min-h-10 hover:bg-elevated"
        >
          <span className="instrument-label text-muted-foreground">Waypoints</span>
          <span className="flex items-center gap-1">
            {count}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                listOpen && "rotate-180",
              )}
            />
          </span>
        </button>
      ) : (
        <div className="flex h-4 items-center justify-between gap-2">
          <span className="instrument-label text-muted-foreground">Waypoints</span>
          {count}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      {draft ? (
        // Keyed so the name field remounts per draft rather than being cleared
        // in an effect; re-dragging the same draft keeps the typed name.
        <VertexForm
          key="draft"
          kind="create"
          pose={draft}
          // What the shell stages it at: the floor plan has no floors.
          z={0}
          initialName=""
          initialType={props.type}
          busy={props.busy}
          locked={props.locked}
          onTypeChange={props.onTypeChange}
          onSubmit={(name, type) => props.onCreate(name, type)}
          onCancel={props.onCancelDraft}
        />
      ) : band ? (
        <BandBlock
          vertices={vertices}
          selectedIds={selectedIds}
          pendingIds={props.pendingIds}
          busy={props.busy}
          locked={props.locked}
          onSelect={props.onSelect}
          onClear={props.onClearSelection}
          onDelete={props.onDelete}
        />
      ) : selected ? (
        <>
        <VertexForm
          key={selected.id}
          kind="edit"
          pose={props.stagedPose ?? selected}
          // A move here re-aims and re-places in plan only; the height stays.
          z={selected.z}
          moved={props.stagedPose !== null}
          initialName={selected.name}
          initialType={selected.type}
          busy={props.busy}
          locked={props.locked}
          onSubmit={(name, type) => {
            const changes: VertexChanges = {};
            if (name !== selected.name) changes.name = name;
            if (type !== selected.type) changes.type = type;
            if (props.stagedPose) {
              changes.x = props.stagedPose.x;
              changes.y = props.stagedPose.y;
              changes.theta = props.stagedPose.theta;
            }
            props.onApply(changes);
          }}
          onCancel={() => props.onSelect(null)}
          onDelete={props.onDelete}
        />
        {/* No list under the form, by request: the panel is about the one
         * waypoint; Close brings the list back. */}
        </>
      ) : (
        <>
          {/* One row, by request: the next waypoint's type (a list — five
            * segments plus a button won't fit 240 px) and Use robot position,
            * for a spot marked by driving there (a dock, a doorway). It stages
            * a draft like a press on the map, so naming stays one flow and a
            * mis-press is a Cancel. */}
          <div>
            <div className="flex items-center gap-1.5">
              <Select
                items={TYPE_OPTIONS}
                value={props.type}
                onValueChange={(next) => {
                  if (next) props.onTypeChange(next);
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Waypoint type"
                  title="The type the next waypoint is placed as"
                  className="min-w-0 flex-1 rounded-sm text-[12px] pointer-coarse:min-h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERTEX_TYPES.map((spec) => (
                    <SelectItem key={spec.value} value={spec.value}>
                      <span className="flex items-baseline gap-2">
                        {spec.label}
                        <span className="text-xs text-muted-foreground">{spec.hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                disabled={!props.robotPose || props.busy}
                onClick={props.onUseRobotPose}
                title="Place a waypoint where the robot is standing"
                className="instrument-label flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors pointer-coarse:min-h-10 hover:bg-elevated hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              >
                <LocateFixedIcon className="size-3.5" aria-hidden />
                Use robot position
              </button>
            </div>
            {!props.robotPose && props.robotPoseReason && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {props.robotPoseReason}
              </p>
            )}
          </div>

          {vertices.length === 0 ? (
            status === "ok" && (
              <p className="text-[11px] leading-tight text-muted-foreground">
                No waypoints on this map yet.
              </p>
            )
          ) : (
            listOpen && (
              <div id={listId}>
                <VertexList
                  vertices={vertices}
                  selectedIds={selectedIds}
                  pendingIds={props.pendingIds}
                  onSelect={props.onSelect}
                  empty={null}
                />
              </div>
            )
          )}

          {/* No how-to line, by request: the tools carry names and tooltips. */}
        </>
      )}
    </div>
  );
}

/**
 * What a band selection can do, which is delete. Not a cut-down VertexForm:
 * a name, type or heading over a set would need a "mixed" state or would
 * flatten them all onto one keystroke.
 */
function BandBlock({
  vertices,
  selectedIds,
  pendingIds,
  busy,
  locked = false,
  onSelect,
  onClear,
  onDelete,
}: {
  vertices: MapVertex[];
  selectedIds: readonly string[];
  pendingIds: ReadonlySet<string>;
  busy: boolean;
  locked?: boolean;
  onSelect: (id: string) => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const count = selectedIds.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="instrument-label text-signal-cmd">{count} selected</span>
        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="instrument-label rounded-sm border border-hairline px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <VertexList
        vertices={vertices}
        selectedIds={selectedIds}
        pendingIds={pendingIds}
        onSelect={onSelect}
        empty={null}
      />

      <button
        type="button"
        disabled={busy || locked || count === 0}
        // No confirm: staged, Undo brings the band back.
        onClick={onDelete}
        className="instrument-label flex h-7 items-center justify-center gap-1.5 rounded-sm border border-signal-warn/50 text-signal-warn transition-colors hover:bg-signal-warn/12 disabled:opacity-50"
      >
        <Trash2Icon className="size-3.5" aria-hidden />
        Delete {count}
      </button>
    </div>
  );
}

function VertexList({
  vertices,
  selectedIds,
  pendingIds,
  onSelect,
  empty,
}: {
  vertices: MapVertex[];
  /** Every highlighted row, so a band lights all of its members here too. */
  selectedIds: readonly string[];
  /** Rows Save would write, marked with the toolbar Save's caution dot. */
  pendingIds: ReadonlySet<string>;
  /** Picking a row always narrows to that one vertex, band or not. */
  onSelect: (id: string) => void;
  empty: string | null;
}) {
  const [filter, setFilter] = React.useState("");
  if (!vertices.length) {
    return empty ? (
      <p className="text-[11px] leading-tight text-muted-foreground">{empty}</p>
    ) : null;
  }

  // By name, case-folded: typing "Dock" should find "dock-a".
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? vertices.filter((vertex) => vertex.name.toLowerCase().includes(needle))
    : vertices;

  return (
    <div className="border-t border-hairline pt-1.5">
      <div className="relative mb-1">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Filter waypoints"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name"
          className="h-7 rounded-sm pl-6 md:text-[12px]"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-1 py-0.5 text-[11px] leading-tight text-muted-foreground">
          No waypoint matches.
        </p>
      ) : (
        // Five rows, by request, then its own scroll so a long list can't grow
        // the panel past the viewport. 114 px = five 22 px rows + four 1 px gaps.
        <ul className="max-h-[114px] space-y-px overflow-y-auto">
          {shown.map((vertex) => (
            <li key={vertex.id}>
              <button
                type="button"
                onClick={() => onSelect(vertex.id)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left transition-colors",
                  selectedIds.includes(vertex.id)
                    ? "bg-signal-cmd/12 text-signal-cmd"
                    : "hover:bg-elevated",
                )}
              >
                <span className="instrument-label w-3 shrink-0 text-muted-foreground">
                  {vertexGlyph(vertex.type)}
                </span>
                <span className="readout min-w-0 flex-1 truncate text-[12px]">
                  {vertex.name}
                </span>
                {pendingIds.has(vertex.id) && (
                  // The toolbar Save's dot, so the eye links them; words for a screen reader.
                  <span className="flex shrink-0 items-center" title="Unsaved">
                    <span aria-hidden className="size-1.5 rounded-full bg-signal-caution" />
                    <span className="sr-only">(unsaved)</span>
                  </span>
                )}
                <span className="readout shrink-0 text-[11px] text-muted-foreground">
                  {vertex.x.toFixed(1)}, {vertex.y.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VertexForm({
  kind,
  pose,
  z,
  moved = false,
  initialName,
  initialType,
  busy,
  locked = false,
  onTypeChange,
  onSubmit,
  onCancel,
  onDelete,
}: {
  kind: "create" | "edit";
  pose: PlanarPose;
  /** Ground height, metres: which floor the waypoint is on. */
  z: number;
  /** Edit mode only: the heading shown is staged, not what the row holds. */
  moved?: boolean;
  initialName: string;
  initialType: VertexType;
  busy: boolean;
  locked?: boolean;
  /** Create mode only: keep the shell's next-placement type in step. */
  onTypeChange?: (type: VertexType) => void;
  onSubmit: (name: string, type: VertexType) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = React.useState(initialName);
  const [type, setType] = React.useState<VertexType>(initialType);
  const nameId = React.useId();

  const trimmed = name.trim();
  // The backend's `min_length=1` would 422 a blank name with a validation
  // array, not a sentence; refusing here keeps that off the screen.
  const submittable = trimmed.length > 0 && !busy && !locked;
  const dirty = kind === "create" || trimmed !== initialName || type !== initialType || moved;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onSubmit(trimmed, type);
      }}
    >
      {/* Name and type on one row, by request; the type is the same list as
        * the placing row, so it is chosen one way everywhere. */}
      <div>
        <label
          htmlFor={nameId}
          className="instrument-label mb-1 block text-muted-foreground"
        >
          Name
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            id={nameId}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="dock-a"
            // Squared and shortened to the overlay's chrome.
            className="h-7 min-w-0 flex-1 rounded-sm md:text-[13px]"
          />
          <Select
            items={TYPE_OPTIONS}
            value={type}
            onValueChange={(next) => {
              if (!next) return;
              setType(next);
              onTypeChange?.(next);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Type"
              title="What this waypoint is for"
              className="shrink-0 rounded-sm text-[12px] pointer-coarse:min-h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VERTEX_TYPES.map((spec) => (
                <SelectItem key={spec.value} value={spec.value}>
                  <span className="flex items-baseline gap-2">
                    {spec.label}
                    <span className="text-xs text-muted-foreground">{spec.hint}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1 border-t border-hairline pt-2">
        <Readout label="X" value={pose.x.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Y" value={pose.y.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Z" value={z.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Orientation" value={pose.theta.toFixed(1)} unit="°" tone="cmd" />
      </div>

      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={!submittable || !dirty}
          className="instrument-label h-7 flex-1 rounded-sm bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {/* Apply, not Save: this stages; the toolbar's Save sends. */}
          {kind === "create" ? "Create" : "Apply"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="instrument-label h-7 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-50"
        >
          {kind === "create" ? "Cancel" : "Close"}
        </button>
        {kind === "edit" && (
          <button
            type="button"
            disabled={busy || locked}
            aria-label="Delete waypoint"
            title="Delete waypoint"
            // No confirm: staged, so Undo is the way back.
            onClick={onDelete}
            className="instrument-label flex h-7 items-center rounded-sm border border-signal-warn/50 px-2 text-signal-warn transition-colors hover:bg-signal-warn/12 disabled:opacity-50"
          >
            <Trash2Icon className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
