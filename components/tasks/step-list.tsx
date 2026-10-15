"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronsDownUpIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";

import { StepGroupHeader, StepSeam } from "@/components/tasks/step-group";
import { StepRow } from "@/components/tasks/step-row";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import type { StepType, TaskStepState } from "@/lib/api/task";
import {
  STEP_TYPES,
  stepGroupError,
  stepGroupPlaces,
  stepIdFor,
  stepLinkProblem,
  stepMoveProblem,
  stepSpans,
  type StepDraft,
  type StepSpan,
} from "@/lib/task/step";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

export interface StepListProps {
  steps: StepDraft[];
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  /** The map's geometry, for a Move row's floor plan; null with no floor plan. */
  mapGrid: MapMetadata | null;
  /** Vertex id → the job's step numbers that go there; see stepWaypointOrdinals. */
  stepMarks: ReadonlyMap<string, readonly number[]>;
  /** The waypoints a dock row is picked on; see stepDockVertices. */
  dockMarks: ReadonlySet<string>;
  /** True while a dispatched task is running — see the note below. */
  disabled: boolean;
  /** Per-step state of the tracked task, keyed by the derived step id. */
  stepStates: ReadonlyMap<string, TaskStepState>;
  /** Returns the new row's key; the list unfolds that row. */
  onAdd: (type: StepType) => number;
  onPatch: (key: number, changes: Partial<Omit<StepDraft, "key">>) => void;
  onRemove: (key: number) => void;
  onMoveTo: (key: number, index: number) => void;
  onUngroup: (keys: readonly number[]) => void;
  /** The row the backend refused the last save over, and its sentence. */
  refusal?: { key: number; message: string } | null;
}

/**
 * The ordered step list plus its add row. Presentation only.
 *
 * `disabled` freezes the whole list while a task is in flight: step ids are
 * positional (`stepIdFor`), so a reorder mid-run would attach the tracked
 * statuses to the wrong rows.
 */
export function StepList({
  steps,
  vertices,
  verticesStatus,
  mapName,
  mapGrid,
  stepMarks,
  dockMarks,
  disabled,
  stepStates,
  onAdd,
  onPatch,
  onRemove,
  onMoveTo,
  onUngroup,
  refusal = null,
}: StepListProps) {
  // PointerSensor covers mouse, pen and touch. The distance threshold keeps a
  // tap or a resting finger on the handle from lifting the row.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Unfolded rows. Here, not in the drafts: nothing sent depends on it. Folded
  // by default so a long patrol stays one line a step. Keys are never reused,
  // so a removed row's key left in the set is inert.
  const [expanded, setExpanded] = React.useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const setRowExpanded = (key: number, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  const handleAdd = (type: StepType) => {
    setRowExpanded(onAdd(type), true);
  };

  // No seams mid-drag: they would link to rows about to move.
  const [dragging, setDragging] = React.useState(false);
  // By row key, so Ungroup can focus the seam that would rejoin the box (the
  // header that held focus goes with it).
  const seamRefs = React.useRef(new Map<number, HTMLButtonElement>());

  const keys = steps.map((step) => step.key);
  const groupPlaces = stepGroupPlaces(steps);
  const groupErrors = steps.map((_, index) => stepGroupError(steps, index));
  const spanAt: StepSpan[] = [];
  const warnSpans = new Set<StepSpan>();
  for (const span of stepSpans(steps)) {
    for (let index = span.start; index <= span.end; index += 1) {
      spanAt[index] = span;
      if (groupErrors[index]) warnSpans.add(span);
    }
  }
  const showSeams = !disabled && !dragging;

  // A snapped-back drag has no control to explain itself on, so the list says
  // why, for a few seconds.
  const [dropRefused, setDropRefused] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!dropRefused) return;
    const timer = setTimeout(() => setDropRefused(null), 6_000);
    return () => clearTimeout(timer);
  }, [dropRefused]);
  const dropProblem = (active: UniqueIdentifier, over: UniqueIdentifier) =>
    stepMoveProblem(steps, keys.indexOf(Number(active)), keys.indexOf(Number(over)));

  const handleUngroup = (span: StepSpan) => {
    const members = keys.slice(span.start, span.end + 1);
    onUngroup(members);
    seamRefs.current.get(members[1]!)?.focus();
  };
  const allExpanded = keys.every((key) => expanded.has(key));
  const position = (id: UniqueIdentifier) => keys.indexOf(Number(id)) + 1;

  // dnd-kit's defaults read the raw client keys; these use the row ordinals.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up step ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Step ${position(active.id)} is over position ${position(over.id)} of ${steps.length}.`
        : `Step ${position(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) => {
      if (!over) return `Step ${position(active.id)} dropped back in place.`;
      const problem = dropProblem(active.id, over.id);
      return problem
        ? `Step ${position(active.id)} stays in place. ${problem}`
        : `Step ${position(active.id)} moved to position ${position(over.id)} of ${steps.length}.`;
    },
    onDragCancel: ({ active }) =>
      `Reorder cancelled. Step ${position(active.id)} is back in place.`,
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    if (!over || active.id === over.id) return;
    const problem = dropProblem(active.id, over.id);
    if (problem) {
      setDropRefused(problem);
      return;
    }
    onMoveTo(Number(active.id), keys.indexOf(Number(over.id)));
  };

  return (
    <div className="space-y-2">
      {steps.length === 0 ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          No steps yet. A task is the list below, run top to bottom. Point at
          the gap between two steps to start them together.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To reorder, press space to pick the step up, use the arrow keys to move it, then press space again to drop it, or escape to cancel.",
            },
          }}
          onDragStart={() => {
            setDragging(true);
            setDropRefused(null);
          }}
          onDragCancel={() => setDragging(false)}
          onDragEnd={handleDragEnd}
        >
          {steps.length > 1 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(keys))}
                className="instrument-label flex h-6 items-center gap-1 rounded-sm px-1.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
              >
                {allExpanded ? (
                  <ChevronsDownUpIcon className="size-3" aria-hidden />
                ) : (
                  <ChevronsUpDownIcon className="size-3" aria-hidden />
                )}
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            </div>
          )}
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            {/* No gap: each row carries its own (see StepRow). */}
            <ul>
              {steps.map((step, index) => {
                const span = spanAt[index]!;
                const boxed = span.end > span.start;
                const joined = groupPlaces[index] === "middle" || groupPlaces[index] === "end";
                return (
                  <StepRow
                    // The client key: the step id is positional, and keying on it would
                    // move a focused input's DOM mid-reorder.
                    key={step.key}
                    step={step}
                    index={index}
                    total={steps.length}
                    vertices={vertices}
                    verticesStatus={verticesStatus}
                    mapName={mapName}
                    mapGrid={mapGrid}
                    stepMarks={stepMarks}
                    dockMarks={dockMarks}
                    disabled={disabled}
                    groupPlace={groupPlaces[index] ?? null}
                    groupWarn={warnSpans.has(span)}
                    groupHeader={
                      boxed && index === span.start ? (
                        <StepGroupHeader
                          first={span.start + 1}
                          last={span.end + 1}
                          disabled={disabled}
                          onUngroup={() => handleUngroup(span)}
                        />
                      ) : undefined
                    }
                    seam={
                      showSeams && index > 0 ? (
                        <StepSeam
                          ref={(node) => {
                            if (node) seamRefs.current.set(step.key, node);
                            else seamRefs.current.delete(step.key);
                          }}
                          kind={joined ? "split" : "join"}
                          upper={index}
                          blocked={joined ? null : stepLinkProblem(steps, index)}
                          onClick={() => onPatch(step.key, { withPrevious: !joined })}
                        />
                      ) : undefined
                    }
                    groupError={groupErrors[index] ?? null}
                    linkProblem={stepLinkProblem(steps, index)}
                    moveProblem={(to) => stepMoveProblem(steps, index, to)}
                    refusal={refusal?.key === step.key ? refusal.message : null}
                    state={stepStates.get(stepIdFor(index, step.type)) ?? null}
                    onPatch={(changes) => onPatch(step.key, changes)}
                    onRemove={() => onRemove(step.key)}
                    onMoveTo={(to) => onMoveTo(step.key, to)}
                    expanded={expanded.has(step.key)}
                    onExpandedChange={(open) => setRowExpanded(step.key, open)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {dropRefused && (
        <p role="status" className="text-[11px] leading-snug text-signal-warn">
          {dropRefused}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2">
        <span className="instrument-label mr-0.5 text-muted-foreground">Add</span>
        {STEP_TYPES.map((spec) => (
          <button
            key={spec.value}
            type="button"
            disabled={disabled}
            title={spec.hint}
            onClick={() => handleAdd(spec.value)}
            className="instrument-label flex h-7 items-center gap-1 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <PlusIcon className="size-3" aria-hidden />
            {spec.label}
          </button>
        ))}
      </div>
    </div>
  );
}
