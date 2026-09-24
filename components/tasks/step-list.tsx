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

import { StepRow } from "@/components/tasks/step-row";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import type { StepType, TaskStepState } from "@/lib/api/task";
import {
  STEP_TYPES,
  stepDraftError,
  stepIdFor,
  type StepDraft,
} from "@/lib/task/step";
import type { MapVertex } from "@/lib/types/map";

export interface StepListProps {
  steps: StepDraft[];
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  /** True while a dispatched task is running — see the note below. */
  disabled: boolean;
  /** Per-step state of the tracked task, keyed by the derived step id. */
  stepStates: ReadonlyMap<string, TaskStepState>;
  /** Returns the new row's key; the list unfolds that row. */
  onAdd: (type: StepType) => number;
  onPatch: (key: number, changes: Partial<Omit<StepDraft, "key">>) => void;
  onRemove: (key: number) => void;
  onMoveTo: (key: number, index: number) => void;
}

/**
 * The ordered step list plus its add row. Presentation only.
 *
 * `disabled` is the whole list at once, not per control, and it is driven by a
 * task being in flight. The reason is that the backend step ids are positional
 * (`stepIdFor`): reorder or delete a row while a task is running and the tracked
 * statuses would silently attach to the wrong rows. Freezing the list is the
 * cheap fix. The rejected alternative — rendering a second, frozen, read-only
 * copy of the submitted steps below the editable one — is more code and puts each
 * status further from the row it describes.
 */
export function StepList({
  steps,
  vertices,
  verticesStatus,
  mapName,
  disabled,
  stepStates,
  onAdd,
  onPatch,
  onRemove,
  onMoveTo,
}: StepListProps) {
  // One PointerSensor rather than Mouse + Touch: pointer events cover the mouse,
  // a pen and the tablet console alike. The distance threshold is what keeps a
  // tap on the handle (or a finger resting on it while scrolling) from lifting
  // the row; the handle's `touch-none` stops the browser claiming the gesture as
  // a scroll before the threshold is met.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Which rows are unfolded. Presentation state, so it lives here rather than
  // in the drafts: nothing sent to the backend depends on it. Folded is the
  // default because a twenty-step patrol unfolded is three screens of inputs,
  // and a template loaded to be reviewed or reordered wants the one-line view.
  // Keys are never reused, so a removed row's key left in the set is inert.
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

  // A row that cannot be sent, or that the robot failed on, is held unfolded:
  // folding would hide the one row the operator has to find. It is written into
  // `expanded` rather than OR-ed in at render time, because otherwise the fix
  // itself folds the row — the first character typed into an empty Speak row
  // clears its error and the input would vanish from under the cursor. This is
  // the adjust-state-during-render pattern, so it settles before paint.
  const stateOf = (step: StepDraft, index: number) =>
    stepStates.get(stepIdFor(index, step.type)) ?? null;
  const pinned = new Set(
    steps
      .filter(
        (step, index) =>
          stepDraftError(step) !== null || Boolean(stateOf(step, index)?.error_msg),
      )
      .map((step) => step.key),
  );
  if ([...pinned].some((key) => !expanded.has(key))) {
    setExpanded(new Set([...expanded, ...pinned]));
  }

  const handleAdd = (type: StepType) => {
    // A row just added is a row about to be filled in.
    setRowExpanded(onAdd(type), true);
  };

  const keys = steps.map((step) => step.key);
  const allExpanded = keys.every((key) => expanded.has(key));
  const position = (id: UniqueIdentifier) => keys.indexOf(Number(id)) + 1;

  // dnd-kit's default announcements read the raw ids ("draggable item 7"),
  // which are client keys the operator never sees. These speak in the ordinals
  // printed on the rows.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up step ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Step ${position(active.id)} is over position ${position(over.id)} of ${steps.length}.`
        : `Step ${position(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Step ${position(active.id)} moved to position ${position(over.id)} of ${steps.length}.`
        : `Step ${position(active.id)} dropped back in place.`,
    onDragCancel: ({ active }) =>
      `Reorder cancelled. Step ${position(active.id)} is back in place.`,
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMoveTo(Number(active.id), keys.indexOf(Number(over.id)));
  };

  return (
    <div className="space-y-2">
      {steps.length === 0 ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          No steps yet. A task is the list below, run top to bottom.
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
            <ul className="space-y-1.5">
              {steps.map((step, index) => (
                <StepRow
                  // The client key, not the derived step id: that id is positional, so
                  // reconciling on it would move a focused input's DOM mid-reorder.
                  key={step.key}
                  step={step}
                  index={index}
                  total={steps.length}
                  vertices={vertices}
                  verticesStatus={verticesStatus}
                  mapName={mapName}
                  disabled={disabled}
                  state={stateOf(step, index)}
                  onPatch={(changes) => onPatch(step.key, changes)}
                  onRemove={() => onRemove(step.key)}
                  onMoveTo={(to) => onMoveTo(step.key, to)}
                  expanded={expanded.has(step.key)}
                  pinnedOpen={pinned.has(step.key)}
                  onExpandedChange={(open) => setRowExpanded(step.key, open)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
