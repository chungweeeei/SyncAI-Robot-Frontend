"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GripVerticalIcon,
  Trash2Icon,
} from "lucide-react";

import { Chip, Segmented } from "@/components/console/instrument";
import { IconButton } from "@/components/tasks/icon-button";
import { TaskStatusChip } from "@/components/console/task-chip";
import { VertexPicker } from "@/components/tasks/vertex-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import { normalizeTheta } from "@/lib/angle";
import type { TaskStepState } from "@/lib/api/task";
import {
  SPEAK_TEXT_MAX,
  STEP_TYPES,
  formatDraftAngle,
  formatDraftPosition,
  stepDraftError,
  stepSummary,
  type StepDraft,
} from "@/lib/task/step";
import type { MapVertex } from "@/lib/types/map";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS = STEP_TYPES.map(({ value, label }) => ({ value, label }));

export interface StepRowProps {
  step: StepDraft;
  /** 0-based. Rendered as index + 1, and what the backend step id is built from. */
  index: number;
  total: number;
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  disabled: boolean;
  /** Tracked status + error_msg for this step, or null when nothing is tracked. */
  state: TaskStepState | null;
  onPatch: (changes: Partial<Omit<StepDraft, "key">>) => void;
  onRemove: () => void;
  /** Move this row to a 0-based position; out of range is a no-op. */
  onMoveTo: (index: number) => void;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}

export function StepRow({
  step,
  index,
  total,
  vertices,
  verticesStatus,
  mapName,
  disabled,
  state,
  onPatch,
  onRemove,
  onMoveTo,
  expanded: open,
  onExpandedChange,
}: StepRowProps) {
  const rowError = stepDraftError(step);
  // Any row folds, errors included — an unfinished row that refused to fold made
  // the fold useless exactly while a list was being built. What a folded row
  // with a problem shows instead is the problem itself, in place of the summary
  // and in warn tone, so it is still the row the eye lands on.
  const problem = rowError ?? state?.error_msg ?? null;
  const bodyId = React.useId();
  const typeLabel = STEP_TYPES.find((spec) => spec.value === step.type)?.label;
  const waypointName =
    step.vertexId === null
      ? null
      : (vertices.find((vertex) => vertex.id === step.vertexId)?.name ?? null);
  const summary = stepSummary(step, waypointName);
  const ordinal = index + 1;
  const first = index === 0;
  const last = index === total - 1;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.key, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{
        // Translate only: the default Transform also scales a row to the height
        // of the one it is passing, which squashes a MOVE row's inputs into a
        // STANDUP row's single line mid-drag.
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "relative rounded-sm border border-hairline bg-elevated/40 px-2 py-2",
        // Opaque while lifted, or the rows it slides over show through it.
        !open && problem && "border-signal-warn/50",
        isDragging && "z-10 bg-elevated shadow-lg ring-1 ring-signal-cmd/40",
      )}
    >
      {/* One line, folded or not: that is what keeps a twenty-step list scannable.
       * The toggle takes the slack and truncates its summary, so on a narrow
       * console the text gives way before the controls do. */}
      <div className="flex items-center gap-2">
        {/* The only part of the row that starts a drag. Making the whole row the
         * activator would turn every press on an input, the type picker or the
         * waypoint picker into a potential drag. `touch-none` stops the browser
         * claiming a finger on the handle as a page scroll. */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder step ${ordinal}`}
          title="Drag to reorder"
          disabled={disabled}
          className={cn(
            "-ml-1 flex h-6 w-4 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent",
            disabled ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <GripVerticalIcon className="size-3.5" aria-hidden />
        </button>
        <span className="readout w-4 shrink-0 text-[12px] text-muted-foreground">
          {ordinal}
        </span>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          // Not disabled while a run is in flight: folding changes nothing that
          // is sent, so a running list can still be read either way.
          onClick={() => onExpandedChange(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-0.5 text-left transition-colors hover:bg-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
            aria-hidden
          />
          {/* The type spelled out rather than the glyph the library rows use:
           * this is the line an operator scans to read the job, and there is
           * room for the word. Fixed width so the summaries line up. */}
          <span className="instrument-label w-11 shrink-0">{typeLabel}</span>
          {!open && problem ? (
            <span className="min-w-0 truncate text-[11px] text-signal-warn">
              {problem}
            </span>
          ) : (
            summary && (
              <span className="readout min-w-0 truncate text-[12px] text-muted-foreground">
                {summary}
              </span>
            )
          )}
        </button>

        {/* Loaded from a template whose vertex has since been deleted, so these
         * coordinates are the snapshot rather than a live pose. Not an error — the
         * row dispatches fine — but the operator should know the map no longer
         * agrees, and re-picking a vertex clears it. */}
        {step.vertexMissing && step.vertexId !== null && (
          <Chip tone="caution">waypoint deleted</Chip>
        )}

        {state && <TaskStatusChip status={state.status} />}

        <div className="flex shrink-0 items-center gap-0.5">
          {/* The one-click jumps a drag makes fiddly: to either end of a long
           * list, or a single slot without aiming at a neighbour. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`More actions for step ${ordinal}`}
              title="More actions"
              disabled={disabled}
              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <EllipsisIcon className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={first} onClick={() => onMoveTo(0)}>
                <ArrowUpToLineIcon aria-hidden />
                Move to top
              </DropdownMenuItem>
              <DropdownMenuItem disabled={first} onClick={() => onMoveTo(index - 1)}>
                <ArrowUpIcon aria-hidden />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onClick={() => onMoveTo(index + 1)}>
                <ArrowDownIcon aria-hidden />
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onClick={() => onMoveTo(total - 1)}>
                <ArrowDownToLineIcon aria-hidden />
                Move to bottom
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            label="Remove step"
            disabled={disabled}
            onClick={onRemove}
            className="text-signal-warn hover:bg-signal-warn/12"
          >
            <Trash2Icon className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      </div>

      {open && (
        <div id={bodyId} className="mt-2 space-y-2 pl-[46px]">
          <Segmented
            value={step.type}
            options={TYPE_OPTIONS}
            disabled={disabled}
            onChange={(type) => onPatch({ type })}
          />

          {/* Coordinates and the spoken line are kept in the draft across a type
           * change, so switching to STANDUP and back does not lose what was typed —
           * the wire shape is derived from the type, not stored alongside it. */}
          {step.type === "MOVE" && (
            <div className="space-y-1.5">
              <VertexPicker
                vertices={vertices}
                status={verticesStatus}
                mapName={mapName}
                value={step.vertexId}
                disabled={disabled}
                onPick={(vertex) =>
                  // One patch, not four: two updates would render a frame whose
                  // numbers are this vertex's but whose label is still the old one.
                  // normalizeTheta on the way *in* because the vertex table has no
                  // range constraint while MoveParams is (-180, 180] — a row written
                  // by curl can hold exactly -180, which the task endpoint rejects.
                  onPatch({
                    x: formatDraftPosition(vertex.x),
                    y: formatDraftPosition(vertex.y),
                    theta: formatDraftAngle(normalizeTheta(vertex.theta)),
                    vertexId: vertex.id,
                    // Re-picking resolves the provenance, so the stale-snapshot
                    // warning goes with it.
                    vertexMissing: false,
                  })
                }
              />

              <div className="grid grid-cols-3 gap-1.5">
                <CoordinateField
                  label="X"
                  unit="m"
                  value={step.x}
                  disabled={disabled}
                  onChange={(x) => onPatch({ x, vertexId: null, vertexMissing: false })}
                />
                <CoordinateField
                  label="Y"
                  unit="m"
                  value={step.y}
                  disabled={disabled}
                  onChange={(y) => onPatch({ y, vertexId: null, vertexMissing: false })}
                />
                <CoordinateField
                  label="Heading"
                  unit="°"
                  value={step.theta}
                  disabled={disabled}
                  onChange={(theta) => onPatch({ theta, vertexId: null, vertexMissing: false })}
                  hint={foldHint(step.theta)}
                />
              </div>
            </div>
          )}

          {step.type === "SPEAK" && (
            <div>
              <label className="block">
                <span className="instrument-label text-muted-foreground">Say</span>
                <Input
                  value={step.text}
                  disabled={disabled}
                  // No maxLength attribute: it would silently truncate a paste, and
                  // a hidden edit is worse than the row error below saying how far
                  // over the limit the text is. Same stance as the coordinate
                  // fields never rewriting under the cursor.
                  onChange={(event) => onPatch({ text: event.target.value })}
                  placeholder="Delivery arrived — please take your items."
                  className="mt-0.5 h-7 rounded-sm text-[13px]"
                />
                {/* The counter appears only near the limit — a line short enough
                 * to obviously fit does not need bookkeeping over it. */}
                {step.text.length > SPEAK_TEXT_MAX - 100 && (
                  <span
                    className={
                      step.text.trim().length > SPEAK_TEXT_MAX
                        ? "readout mt-0.5 block text-[11px] text-signal-warn"
                        : "readout mt-0.5 block text-[11px] text-signal-caution"
                    }
                  >
                    {step.text.length} / {SPEAK_TEXT_MAX}
                  </span>
                )}
              </label>
            </div>
          )}
        </div>
      )}

      {/* Folded, the header line already carries the problem; saying it twice
       * would make a folded row two lines again. */}
      {open && rowError && (
        <p
          role="alert"
          className="mt-1.5 pl-[46px] text-[11px] leading-snug break-words text-signal-warn"
        >
          {rowError}
        </p>
      )}

      {open && state?.error_msg && (
        <p
          role="alert"
          className="mt-1.5 pl-[46px] text-[11px] leading-snug break-words text-signal-warn"
        >
          {state.error_msg}
        </p>
      )}
    </li>
  );
}

/**
 * What the heading will actually be sent as, shown only when the fold changes it.
 *
 * The field itself is never rewritten under the cursor — that would make typing
 * "180" one character at a time impossible, since "1" and "18" are both valid
 * angles the fold would leave alone but "1800" is not. Showing the result instead
 * means the fold is not a surprise discovered after dispatch.
 */
function foldHint(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const folded = normalizeTheta(value);
  return folded === value ? null : `→ ${folded.toFixed(1)}°`;
}

function CoordinateField({
  label,
  unit,
  value,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  hint?: string | null;
}) {
  return (
    <label className="block">
      <span className="instrument-label text-muted-foreground">
        {label} <span className="font-normal">({unit})</span>
      </span>
      <Input
        // Not type="number": the spinners are useless at this size, and a browser
        // that clears the value on an intermediate string ("1e") would fight the
        // text-in-parse-once model the draft is built on. inputMode gets the
        // numeric keypad on a touch console without any of that.
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0.00"
        // Squared off and shortened to match the console's chrome; the shared
        // Input is sized for the settings forms, which have room.
        className="readout mt-0.5 h-7 rounded-sm text-[13px]"
      />
      {hint && (
        <span className="readout mt-0.5 block text-[11px] text-signal-caution">
          {hint}
        </span>
      )}
    </label>
  );
}
