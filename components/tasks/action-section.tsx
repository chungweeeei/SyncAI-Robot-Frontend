"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  EllipsisIcon,
  FootprintsIcon,
  GripVerticalIcon,
  Link2Icon,
  MapPinIcon,
  PlusIcon,
  Trash2Icon,
  Unlink2Icon,
} from "lucide-react";

import { TaskStatusChip } from "@/components/console/task-chip";
import { IconButton } from "@/components/tasks/icon-button";
import { ParamFields } from "@/components/tasks/param-fields";
import { StepGroupHeader, StepSeam } from "@/components/tasks/step-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskStepState } from "@/lib/api/task";
import {
  stepLimits,
  stepSpec,
  transitSpecs,
  type StepCatalogue,
  type StepSpec,
} from "@/lib/task/catalogue";
import {
  newStepDraft,
  stepDraftError,
  stepGroupError,
  stepGroupPlaces,
  stepIdFor,
  type GroupPlace,
  type StepDraft,
} from "@/lib/task/step";
import {
  actionLinkProblem,
  actionMoveTarget,
  addAction,
  duplicateAction,
  moveAction,
  moveActionTo,
  removeAction,
  setTransit,
  type StopSection,
} from "@/lib/task/stops";
import { cn } from "@/lib/utils";

/** An edit to the step list, recorded for Undo; `tag` merges typing in one field. */
export type EditSteps = (change: (steps: StepDraft[]) => StepDraft[], tag?: string | null) => void;

export interface ActionSectionProps {
  section: StopSection;
  /** What the robot does here, as the section's heading says it. */
  label: React.ReactNode;
  /** Appended to each row's accessible names: "on arrival at stop 2". */
  context: string;
  steps: StepDraft[];
  /** Rows `[from, to)` of `steps` are this section's. */
  range: { from: number; to: number };
  catalogue: StepCatalogue;
  /** What Add offers here: nothing that moves the body on a walk. */
  addSpecs: readonly StepSpec[];
  disabled: boolean;
  stepStates: ReadonlyMap<string, TaskStepState>;
  refusal: { key: number; message: string } | null;
  selected: number | "start" | null;
  onSelect: (key: number) => void;
  edit: EditSteps;
  /** Below the heading while the section is empty; nothing when absent. */
  emptyHint?: string;
  /**
   * Add in the heading. A stop card leaves it out and offers both of its
   * sections' Adds in its footer instead, and an empty section there is not
   * drawn at all: two empty headings a card made a route of eight stops a
   * wall of them.
   */
  withAdd?: boolean;
}

/**
 * One run of actions on a stop card (on the way, on arrival) or before
 * setting off: the rows, the boxes of rows that start together, and Add.
 *
 * Drag reorders inside the section only. Moving an action to another stop
 * is Move up / Move down at the section's edge, and onto or off the walk is
 * its own menu item, because a drop between two cards could not say which of
 * the two the operator meant.
 */
export function ActionSection({
  section,
  label,
  context,
  steps,
  range,
  catalogue,
  addSpecs,
  disabled,
  stepStates,
  refusal,
  selected,
  onSelect,
  edit,
  emptyHint,
  withAdd = true,
}: ActionSectionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rows = steps.slice(range.from, range.to);
  const limits = stepLimits(catalogue);
  const keys = rows.map((row) => row.key);
  const onWalk = section.kind === "transit";
  // Boxes mean nothing on a walk: everything there starts with it.
  const places = onWalk ? null : stepGroupPlaces(steps);

  // By row key, so Ungroup can focus the seam that would rejoin the box (the
  // header that held focus goes with it).
  const seamRefs = React.useRef(new Map<number, HTMLButtonElement>());

  if (!withAdd && rows.length === 0) return null;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = steps.findIndex((step) => step.key === Number(over.id));
    edit((current) => moveActionTo(current, Number(active.id), to));
  };

  return (
    <div className="space-y-1">
      <div className="flex min-h-6 items-center gap-2">
        <span className="instrument-label text-muted-foreground">{label}</span>
        {rows.length === 0 && emptyHint && (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground/80">{emptyHint}</span>
        )}
        {withAdd && (
          <AddActionMenu
            label="Add"
            ariaLabel={`Add an action ${context}`}
            section={section}
            specs={addSpecs}
            disabled={disabled}
            edit={edit}
            onSelect={onSelect}
            className="ml-auto"
          />
        )}
      </div>

      {rows.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "To reorder, press space to pick the action up, use the arrow keys to move it, then press space again to drop it, or escape to cancel.",
            },
          }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            <ul>
              {rows.map((step, offset) => {
                const index = range.from + offset;
                const place = places?.[index] ?? null;
                const joined = place === "middle" || place === "end";
                const boxStart = place === "start";
                const boxEnd = boxStart
                  ? (() => {
                      let end = index + 1;
                      while (end + 1 < range.to && steps[end + 1]!.withPrevious) end += 1;
                      return end;
                    })()
                  : index;
                const boxKeys = steps.slice(index, boxEnd + 1).map((row) => row.key);
                const linkProblem = actionLinkProblem(steps, step.key);
                return (
                  <ActionRow
                    key={step.key}
                    step={step}
                    spec={stepSpec(catalogue, step.type)}
                    context={context}
                    first={offset === 0}
                    groupPlace={place}
                    groupHeader={
                      boxStart ? (
                        <StepGroupHeader
                          first={offset + 1}
                          last={offset + 1 + (boxEnd - index)}
                          disabled={disabled}
                          onUngroup={() => {
                            edit((current) =>
                              current.map((row) =>
                                boxKeys.includes(row.key) && row.withPrevious
                                  ? { ...row, withPrevious: false }
                                  : row,
                              ),
                            );
                            seamRefs.current.get(boxKeys[1]!)?.focus();
                          }}
                        />
                      ) : undefined
                    }
                    seam={
                      !onWalk && offset > 0 && !disabled ? (
                        <StepSeam
                          ref={(node) => {
                            if (node) seamRefs.current.set(step.key, node);
                            else seamRefs.current.delete(step.key);
                          }}
                          kind={joined ? "split" : "join"}
                          upper={offset}
                          blocked={joined ? null : linkProblem}
                          onClick={() =>
                            edit((current) =>
                              current.map((row) =>
                                row.key === step.key ? { ...row, withPrevious: !joined } : row,
                              ),
                            )
                          }
                        />
                      ) : undefined
                    }
                    disabled={disabled}
                    error={
                      stepDraftError(step, limits) ??
                      stepGroupError(steps, index) ??
                      (refusal?.key === step.key ? refusal.message : null)
                    }
                    state={stepStates.get(stepIdFor(index, step.type)) ?? null}
                    selected={selected === step.key}
                    onSelect={() => onSelect(step.key)}
                    onField={(key, value) =>
                      edit(
                        (current) =>
                          current.map((row) =>
                            row.key === step.key ? { ...row, [key]: value } : row,
                          ),
                        `${step.key}:${key}`,
                      )
                    }
                    menu={{
                      up: actionMoveTarget(steps, step.key, "up")
                        ? () => edit((current) => moveAction(current, step.key, "up"))
                        : null,
                      down: actionMoveTarget(steps, step.key, "down")
                        ? () => edit((current) => moveAction(current, step.key, "down"))
                        : null,
                      walk:
                        section.kind === "start"
                          ? null
                          : onWalk
                            ? { onWalk: true, toggle: () => edit((current) => setTransit(current, step.key, false)) }
                            : !transitSpecs(catalogue).some((each) => each.type === step.type)
                              ? null
                              : { onWalk: false, toggle: () => edit((current) => setTransit(current, step.key, true)) },
                      link:
                        onWalk || offset === 0
                          ? null
                          : {
                              linked: joined,
                              problem: joined ? null : linkProblem,
                              toggle: () =>
                                edit((current) =>
                                  current.map((row) =>
                                    row.key === step.key ? { ...row, withPrevious: !joined } : row,
                                  ),
                                ),
                            },
                      duplicate: () => edit((current) => duplicateAction(current, step.key)),
                      remove: () => edit((current) => removeAction(current, step.key)),
                    }}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/**
 * Add, as a menu of the actions a section takes, each with its hint: the menu
 * is where the vocabulary is learned, so it says what each one does.
 */
export function AddActionMenu({
  label,
  ariaLabel,
  section,
  specs,
  disabled,
  edit,
  onSelect,
  className,
}: {
  label: string;
  ariaLabel: string;
  section: StopSection;
  specs: readonly StepSpec[];
  disabled: boolean;
  edit: EditSteps;
  onSelect: (key: number) => void;
  className?: string;
}) {
  const add = (spec: StepSpec) => {
    // Minted here, not in the updater, so a twice-run updater cannot mint two.
    const row = newStepDraft(spec.type);
    edit((current) => addAction(current, section, row));
    onSelect(row.key);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "instrument-label flex h-6 shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-10",
          className,
        )}
      >
        <PlusIcon className="size-3" aria-hidden />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {specs.map((spec) => (
          <DropdownMenuItem key={spec.type} onClick={() => add(spec)}>
            <span className="flex min-w-0 flex-col">
              <span>{spec.label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{spec.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ActionMenu {
  up: (() => void) | null;
  down: (() => void) | null;
  /** Onto the walk or off it; null where that means nothing. */
  walk: { onWalk: boolean; toggle: () => void } | null;
  /** Start together with the action above; null for the first row or on a walk. */
  link: { linked: boolean; problem: string | null; toggle: () => void } | null;
  duplicate: () => void;
  remove: () => void;
}

function ActionRow({
  step,
  spec: found,
  context,
  first,
  groupPlace,
  groupHeader,
  seam,
  disabled,
  error,
  state,
  selected,
  onSelect,
  onField,
  menu,
}: {
  step: StepDraft;
  spec: StepSpec | null;
  context: string;
  first: boolean;
  groupPlace: GroupPlace;
  groupHeader?: React.ReactNode;
  seam?: React.ReactNode;
  disabled: boolean;
  error: string | null;
  state: TaskStepState | null;
  selected: boolean;
  onSelect: () => void;
  onField: (key: string, value: string) => void;
  menu: ActionMenu;
}) {
  const label = found?.label ?? step.type;
  const joined = groupPlace === "middle" || groupPlace === "end";
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.key, disabled });
  const rowContext = `${label} ${context}`;

  return (
    <li
      data-row-key={step.key}
      ref={setNodeRef}
      // Translate only: a scale would squash a row passing a taller one.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", !first && !joined && "pt-3 pointer-coarse:pt-1", isDragging && "z-10")}
    >
      {seam}
      <div
        className={cn(
          groupPlace && "border-x px-1.5",
          groupPlace && (isDragging ? "border-transparent" : "border-signal-cmd/40 bg-signal-cmd/5"),
          groupPlace === "start" && "rounded-t-sm border-t",
          joined && "pt-3 pointer-coarse:pt-1",
          groupPlace === "end" && "rounded-b-sm border-b pb-1.5",
        )}
      >
        {groupHeader && <div className={cn(isDragging && "invisible")}>{groupHeader}</div>}
        {joined && <span className="sr-only">Starts together with the action above.</span>}
        {/* A press anywhere but a control selects the row: the map's next tap
          * then adds its stop after this one's. */}
        <div
          onPointerDown={onSelect}
          className={cn(
            "rounded-sm border bg-elevated/40 px-1.5 py-1",
            selected ? "border-signal-cmd/60" : "border-hairline",
            error && "border-signal-warn/50",
            isDragging && "bg-elevated shadow-lg ring-1 ring-signal-cmd/40",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${rowContext}`}
              title="Drag to reorder"
              disabled={disabled}
              className={cn(
                "-ml-0.5 flex h-6 w-4 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:w-8",
                disabled ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab",
              )}
            >
              <GripVerticalIcon className="size-3.5" aria-hidden />
            </button>
            <span className="instrument-label shrink-0" title={found?.hint}>
              {label}
            </span>
            {found && (
              <ParamFields
                spec={found}
                step={step}
                context={context}
                disabled={disabled}
                onChange={onField}
              />
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {state && <TaskStatusChip status={state.status} />}
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`More actions for ${rowContext}`}
                  title="More actions"
                  disabled={disabled}
                  className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10"
                >
                  <EllipsisIcon className="size-3.5" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem disabled={!menu.up} onClick={() => menu.up?.()}>
                    <ArrowUpIcon aria-hidden />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!menu.down} onClick={() => menu.down?.()}>
                    <ArrowDownIcon aria-hidden />
                    Move down
                  </DropdownMenuItem>
                  {menu.walk && (
                    <DropdownMenuItem onClick={menu.walk.toggle}>
                      {menu.walk.onWalk ? <MapPinIcon aria-hidden /> : <FootprintsIcon aria-hidden />}
                      {menu.walk.onWalk ? "Do on arrival instead" : "Do on the way instead"}
                    </DropdownMenuItem>
                  )}
                  {menu.link && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!menu.link.linked && menu.link.problem !== null}
                        onClick={menu.link.toggle}
                      >
                        {menu.link.linked ? <Unlink2Icon aria-hidden /> : <Link2Icon aria-hidden />}
                        {menu.link.linked ? "Run after the action above" : "Start together with the action above"}
                      </DropdownMenuItem>
                      {/* Under the item, not in a title a finger never sees. */}
                      {!menu.link.linked && menu.link.problem && (
                        <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                          {menu.link.problem}
                        </p>
                      )}
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={menu.duplicate}>
                    <CopyIcon aria-hidden />
                    Duplicate
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* One press, mouse or finger: Undo brings it back. */}
              <IconButton
                label={`Remove ${rowContext}`}
                disabled={disabled}
                onClick={menu.remove}
                className="text-signal-warn hover:bg-signal-warn/12"
              >
                <Trash2Icon className="size-3.5" aria-hidden />
              </IconButton>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-1 text-[11px] leading-snug break-words text-signal-warn">
              {error}
            </p>
          )}
          {state?.message && (
            <p className="mt-1 text-[11px] leading-snug break-words text-muted-foreground">
              {state.message}
            </p>
          )}
          {state?.error_msg && (
            <p role="alert" className="mt-1 text-[11px] leading-snug break-words text-signal-warn">
              {state.error_msg}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
