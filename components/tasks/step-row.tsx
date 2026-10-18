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
  Link2Icon,
  MapIcon,
  Trash2Icon,
  Unlink2Icon,
} from "lucide-react";

import { Chip, Segmented } from "@/components/console/instrument";
import { IconButton } from "@/components/tasks/icon-button";
import { TaskStatusChip } from "@/components/console/task-chip";
import { VertexPicker } from "@/components/tasks/vertex-picker";
import { WaypointPreview } from "@/components/tasks/waypoint-preview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import { normalizeTheta } from "@/lib/angle";
import type { TaskStepState } from "@/lib/api/task";
import {
  SPEAK_REPEAT_MAX,
  SPEAK_TEXT_MAX,
  STEP_TYPES,
  WAIT_SECONDS_MAX,
  formatDraftAngle,
  formatDraftPosition,
  isNavStep,
  stepDraftError,
  stepSummary,
  type GroupPlace,
  type StepDraft,
} from "@/lib/task/step";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";
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
  /** The map's geometry; null when it has no floor plan to show. */
  mapGrid: MapMetadata | null;
  /** Vertex id → the job's step numbers that go there, lit on the floor plan. */
  stepMarks: ReadonlyMap<string, readonly number[]>;
  dockMarks: ReadonlySet<string>;
  disabled: boolean;
  /** Where the row sits in the group it starts together with; see stepGroupPlaces. */
  groupPlace: GroupPlace;
  /** Some row of the group cannot run in it, so the whole box is drawn in warn. */
  groupWarn: boolean;
  /** The box's header (StepGroupHeader), on the group's first row only. */
  groupHeader?: React.ReactNode;
  /** The control in the gap above the row (StepSeam). */
  seam?: React.ReactNode;
  /** Why the row cannot run with the steps it is linked to; see stepGroupError. */
  groupError: string | null;
  /** Why the row may not start together with the one above; see stepLinkProblem. */
  linkProblem: string | null;
  /** Why the row may not move to a 0-based position; see stepMoveProblem. */
  moveProblem: (index: number) => string | null;
  /** The backend's refusal of the last save over this row, for a rule the editor does not mirror. */
  refusal: string | null;
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
  mapGrid,
  stepMarks,
  dockMarks,
  disabled,
  groupPlace,
  groupWarn,
  groupHeader,
  seam,
  groupError,
  linkProblem,
  moveProblem,
  refusal,
  state,
  onPatch,
  onRemove,
  onMoveTo,
  expanded: open,
  onExpandedChange,
}: StepRowProps) {
  const rowError = stepDraftError(step) ?? groupError ?? refusal;
  // Any row folds, errors included, or folding is useless while a list is being
  // built. A folded row shows its problem in place of the summary, in warn tone.
  const problem = rowError ?? state?.error_msg ?? null;
  const bodyId = React.useId();
  const [removeArmed, setRemoveArmed] = React.useState(false);
  React.useEffect(() => {
    if (!removeArmed) return;
    const timer = setTimeout(() => setRemoveArmed(false), 3_000);
    return () => clearTimeout(timer);
  }, [removeArmed]);
  const typeLabel = STEP_TYPES.find((spec) => spec.value === step.type)?.label;
  const waypointName =
    step.vertexId === null
      ? null
      : (vertices.find((vertex) => vertex.id === step.vertexId)?.name ?? null);
  const summary = stepSummary(step, waypointName);
  const ordinal = index + 1;
  const first = index === 0;
  const last = index === total - 1;
  const linked = !first && step.withPrevious;
  const joined = groupPlace === "middle" || groupPlace === "end";

  // One patch, so no frame shows the new numbers under the old label.
  // normalizeTheta on the way in: the vertex table has no range constraint and
  // can hold exactly -180, which the task endpoint rejects.
  const pickWaypoint = (vertex: MapVertex) =>
    onPatch({
      x: formatDraftPosition(vertex.x),
      y: formatDraftPosition(vertex.y),
      theta: formatDraftAngle(normalizeTheta(vertex.theta)),
      z: vertex.z,
      vertexId: vertex.id,
      vertexMissing: false,
    });
  // Closed by default; the choice lives with the row, so folding keeps it.
  const canPreview = mapName !== null && mapGrid !== null;
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const previewId = React.useId();

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
        // Translate only: Transform also scales a row to the height of the one
        // it passes, squashing a MOVE row mid-drag.
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "relative",
        // The gap is the item's own padding, not list margin: inside a box it
        // has to sit between the box's sides, and the seam lives in it.
        !first && !joined && "pt-3.5 pointer-coarse:pt-1.5",
        isDragging && "z-10",
      )}
    >
      {seam}
      {/* This row's slice of its group's box, drawn per row rather than as a
       * wrapper so a row joining or leaving a group keeps its place in the
       * tree (inputs, open floor plan, focused seam). Lifted, it goes clear
       * but keeps its padding so the row does not jump wider. */}
      <div
        className={cn(
          groupPlace && "border-x px-1.5",
          groupPlace && (isDragging ? "border-transparent" : "bg-signal-cmd/5"),
          groupPlace && !isDragging && (groupWarn ? "border-signal-warn/50" : "border-signal-cmd/40"),
          groupPlace === "start" && "rounded-t-sm border-t",
          joined && "pt-3.5 pointer-coarse:pt-1.5",
          groupPlace === "end" && "rounded-b-sm border-b pb-1.5",
        )}
      >
        {groupHeader && <div className={cn(isDragging && "invisible")}>{groupHeader}</div>}
        {joined && <span className="sr-only">Starts together with the step above.</span>}
        <div
          className={cn(
            "relative rounded-sm border border-hairline bg-elevated/40 px-2 py-2",
            !open && problem && "border-signal-warn/50",
            // Opaque while lifted, or the rows it slides over show through it.
            isDragging && "bg-elevated shadow-lg ring-1 ring-signal-cmd/40",
          )}
        >
          {/* One line, folded or not, so a long list stays scannable; the summary
           * truncates before the controls do. */}
          <div className="flex items-center gap-2">
            {/* The only drag activator, so presses on the row's inputs never start
             * a drag. `touch-none` stops a finger here becoming a page scroll. */}
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Reorder step ${ordinal}`}
              title="Drag to reorder"
              disabled={disabled}
              className={cn(
                "-ml-1 flex h-6 w-4 shrink-0 touch-none items-center justify-center rounded-sm pointer-coarse:h-10 pointer-coarse:w-8 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent",
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
              // Not disabled during a run: folding changes nothing that is sent.
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
              {/* The type as a word, not the library's glyph: this is the line
               * that is scanned. Fixed width so the summaries line up. */}
              <span className="instrument-label w-11 shrink-0">{typeLabel}</span>
              {!open && problem ? (
                <span className="min-w-0 truncate text-[11px] text-signal-warn">
                  {problem}
                </span>
              ) : !open && state?.message ? (
                // Muted: news about the row, not something wrong with it.
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {state.message}
                </span>
              ) : (
                summary && (
                  <span className="readout min-w-0 truncate text-[12px] text-muted-foreground">
                    {summary}
                  </span>
                )
              )}
            </button>

            {/* Below sm the chips do not fit beside the 40 px targets, so they
             * get their own line below (see StepChips). */}
            <StepChips step={step} state={state} className="hidden sm:contents" />

            <div className="flex shrink-0 items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`More actions for step ${ordinal}`}
                  title="More actions"
                  disabled={disabled}
                  className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10"
                >
                  <EllipsisIcon className="size-3.5" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem disabled={first} onClick={() => onMoveTo(0)}>
                    <ArrowUpToLineIcon aria-hidden />
                    Move to top
                  </DropdownMenuItem>
                  {/* Only up and down can land a row inside a box. */}
                  <DropdownMenuItem
                    disabled={first || moveProblem(index - 1) !== null}
                    onClick={() => onMoveTo(index - 1)}
                  >
                    <ArrowUpIcon aria-hidden />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={last || moveProblem(index + 1) !== null}
                    onClick={() => onMoveTo(index + 1)}
                  >
                    <ArrowDownIcon aria-hidden />
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={last} onClick={() => onMoveTo(total - 1)}>
                    <ArrowDownToLineIcon aria-hidden />
                    Move to bottom
                  </DropdownMenuItem>
                  {/* The seam's link, for a finger, which gets no seam. */}
                  {!first && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!linked && linkProblem !== null}
                        onClick={() => onPatch({ withPrevious: !linked })}
                      >
                        {linked ? <Unlink2Icon aria-hidden /> : <Link2Icon aria-hidden />}
                        {linked
                          ? `Run after step ${ordinal - 1}`
                          : `Start together with step ${ordinal - 1}`}
                      </DropdownMenuItem>
                      {/* Under the item, not in a title a finger never sees. */}
                      {!linked && linkProblem && (
                        <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                          {linkProblem}
                        </p>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* A finger taps twice, a mouse once: the button sits 2 px from the
               * ⋯ menu and a missed tap deleted a step with no undo. The armed
               * state is drawn on the button (a finger sees no title) and
               * disarms after 3 s. */}
              <IconButton
                label={removeArmed ? "Tap again to remove this step" : "Remove step"}
                disabled={disabled}
                onClick={(event) => {
                  const touch =
                    "pointerType" in event.nativeEvent &&
                    (event.nativeEvent as PointerEvent).pointerType === "touch";
                  if (touch && !removeArmed) {
                    setRemoveArmed(true);
                    return;
                  }
                  onRemove();
                }}
                className={cn(
                  "text-signal-warn hover:bg-signal-warn/12",
                  removeArmed && "border border-signal-warn/50 bg-signal-warn/12",
                )}
              >
                <Trash2Icon className="size-3.5" aria-hidden />
              </IconButton>
            </div>
          </div>

          <StepChips step={step} state={state} className="mt-1.5 flex flex-wrap gap-1 sm:hidden" />

          {open && (
            <div id={bodyId} className="mt-2 space-y-2 sm:pl-[46px]">
              <Segmented
                label={`Type of step ${ordinal}`}
                value={step.type}
                options={TYPE_OPTIONS}
                disabled={disabled}
                onChange={(type) => onPatch({ type })}
              />

              {/* Every type's fields stay in the draft across a type change, so
               * switching away and back loses nothing; the wire shape derives
               * from the type. */}
              {/* A Move or Dock row is set by its waypoint only, no X / Y / heading
               * fields; the draft still carries the numbers that are sent. The
               * floor plan sits with the row, behind a button so a long patrol
               * is not a wall of maps. It shows the whole job and is not a
               * picker: the dropdown sets the step. */}
              {isNavStep(step) && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <VertexPicker
                        vertices={vertices}
                        status={verticesStatus}
                        mapName={mapName}
                        value={step.vertexId}
                        disabled={disabled}
                        onPick={pickWaypoint}
                        label={`${step.type === "MOVE" ? "Waypoint" : "Charger waypoint"} for step ${ordinal}`}
                      />
                    </div>
                    {/* Disabled rather than absent without a floor plan, so the row
                     * keeps its shape. Not held by `disabled`: opening the map
                     * changes nothing that is sent. */}
                    <button
                      type="button"
                      aria-pressed={previewOpen && canPreview}
                      aria-controls={canPreview && previewOpen ? previewId : undefined}
                      aria-label={`Floor plan for step ${ordinal}`}
                      disabled={!canPreview}
                      title={
                        !canPreview
                          ? "This map has no floor plan yet"
                          : previewOpen
                            ? "Hide the floor plan"
                            : "Show where each waypoint is on the floor plan"
                      }
                      onClick={() => setPreviewOpen((open) => !open)}
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-sm border transition-colors disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:size-10",
                        previewOpen && canPreview
                          ? "border-signal-cmd/40 bg-signal-cmd/8 text-signal-cmd hover:bg-signal-cmd/16"
                          : "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
                      )}
                    >
                      <MapIcon className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  {canPreview && previewOpen && (
                    <div id={previewId}>
                      <WaypointPreview
                        mapName={mapName}
                        meta={mapGrid}
                        vertices={vertices}
                        steps={stepMarks}
                        docks={dockMarks}
                      />
                    </div>
                  )}
                </div>
              )}

              {step.type === "SPEAK" && (
                <div>
                  <label className="block">
                    <span className="instrument-label text-muted-foreground">Say</span>
                    <Input
                      value={step.text}
                      disabled={disabled}
                      // No maxLength: it would silently truncate a paste; the
                      // row error says how far over the text is instead.
                      onChange={(event) => onPatch({ text: event.target.value })}
                      placeholder="Delivery arrived — please take your items."
                      // No size below md, on every Input override: iOS Safari
                      // zooms into any field under 16 px on focus.
                      className="mt-0.5 h-7 rounded-sm md:text-[13px]"
                    />
                    {/* The counter appears only near the limit. */}
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
                  <label className="mt-2 block">
                    <span className="instrument-label text-muted-foreground">Times</span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <Input
                        value={step.repeat}
                        disabled={disabled}
                        // Not type="number", for the reason Duration gives.
                        inputMode="numeric"
                        onChange={(event) => onPatch({ repeat: event.target.value })}
                        placeholder="1"
                        aria-describedby={`step-${step.key}-repeat-unit`}
                        className="h-7 w-20 rounded-sm md:text-[13px]"
                      />
                      <span
                        id={`step-${step.key}-repeat-unit`}
                        className="text-[11px] text-muted-foreground"
                      >
                        in a row, up to {SPEAK_REPEAT_MAX}
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {step.type === "WAIT" && (
                <label className="block">
                  <span className="instrument-label text-muted-foreground">Duration</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <Input
                      value={step.seconds}
                      disabled={disabled}
                      // Not type="number": it reports "" for "1." and "-",
                      // erasing what is halfway typed.
                      inputMode="decimal"
                      onChange={(event) => onPatch({ seconds: event.target.value })}
                      placeholder="10"
                      aria-describedby={`step-${step.key}-wait-unit`}
                      className="h-7 w-20 rounded-sm md:text-[13px]"
                    />
                    <span
                      id={`step-${step.key}-wait-unit`}
                      className="text-[11px] text-muted-foreground"
                    >
                      seconds, up to {WAIT_SECONDS_MAX}
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {/* Folded, the header line already carries the problem. */}
          {open && rowError && (
            <p
              role="alert"
              className="mt-1.5 text-[11px] leading-snug break-words text-signal-warn sm:pl-[46px]"
            >
              {rowError}
            </p>
          )}

          {open && state?.message && (
            <p className="mt-1.5 text-[11px] leading-snug break-words text-muted-foreground sm:pl-[46px]">
              {state.message}
            </p>
          )}

          {open && state?.error_msg && (
            <p
              role="alert"
              className="mt-1.5 text-[11px] leading-snug break-words text-signal-warn sm:pl-[46px]"
            >
              {state.error_msg}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The row's status chips: a deleted waypoint, and the running job's state.
 * Rendered twice with different visibility so a phone gets them on a line of
 * their own instead of an overflowing header.
 */
function StepChips({
  step,
  state,
  className,
}: {
  step: StepDraft;
  state: TaskStepState | null;
  className: string;
}) {
  const missing = step.vertexMissing && step.vertexId !== null;
  if (!missing && !state) return null;
  return (
    <div className={className}>
      {/* The coordinates are a snapshot of a since-deleted vertex. Not an
       * error, the row dispatches fine; re-picking clears it. */}
      {missing && <Chip tone="caution">waypoint deleted</Chip>}
      {state && <TaskStatusChip status={state.status} />}
    </div>
  );
}
